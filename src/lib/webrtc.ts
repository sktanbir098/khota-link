import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
} from 'firebase/firestore';
import {
  LIMITS,
  LocalDirectMessage,
  NearbyRoom,
  PreparedAttachment,
  UserPublicProfile,
} from '../types/chat';
import { db, handleFirestoreError, OperationType, sanitizeStr } from './firebase';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

const P2P_FILE_CHUNK_SIZE = 16_000;

function generate6DigitCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

export interface NearbyP2PSession {
  roomCode: string;
  role: 'host' | 'guest';
  peerConnection: RTCPeerConnection;
  sendMessage: (text: string) => Promise<'webrtc' | 'nearby'>;
  sendAttachment: (att: PreparedAttachment, caption?: string) => Promise<void>;
  closeSession: () => Promise<void>;
  cleanup: () => void;
}

interface IncomingFileBuffer {
  id: string;
  senderName: string;
  caption: string;
  attachmentType: 'image' | 'file';
  attachmentName: string;
  attachmentMime: string;
  attachmentSize: number;
  totalChunks: number;
  chunks: string[];
  received: number;
  timestamp: number;
}

function createChannelMessageHandler(
  seenMsgIds: Set<string>,
  onIncomingMessage: (msg: LocalDirectMessage) => void
) {
  const fileBuffers = new Map<string, IncomingFileBuffer>();

  return (rawData: string) => {
    try {
      const payload = JSON.parse(rawData) as
        | {
            type?: 'text';
            id: string;
            senderName: string;
            text: string;
            timestamp: number;
          }
        | {
            type: 'file-meta';
            id: string;
            senderName: string;
            caption: string;
            attachmentType: 'image' | 'file';
            attachmentName: string;
            attachmentMime: string;
            attachmentSize: number;
            totalChunks: number;
            timestamp: number;
          }
        | {
            type: 'file-chunk';
            id: string;
            index: number;
            data: string;
          };

      if (payload.type === 'file-meta') {
        fileBuffers.set(payload.id, {
          id: payload.id,
          senderName: payload.senderName,
          caption: payload.caption || '',
          attachmentType: payload.attachmentType,
          attachmentName: payload.attachmentName,
          attachmentMime: payload.attachmentMime,
          attachmentSize: payload.attachmentSize,
          totalChunks: payload.totalChunks,
          chunks: new Array<string>(payload.totalChunks),
          received: 0,
          timestamp: payload.timestamp || Date.now(),
        });
        return;
      }

      if (payload.type === 'file-chunk') {
        const buf = fileBuffers.get(payload.id);
        if (!buf) return;
        if (buf.chunks[payload.index] === undefined) {
          buf.chunks[payload.index] = payload.data;
          buf.received += 1;
        }
        if (buf.received >= buf.totalChunks) {
          fileBuffers.delete(payload.id);
          if (!seenMsgIds.has(buf.id)) {
            seenMsgIds.add(buf.id);
            onIncomingMessage({
              id: buf.id,
              sender: 'peer',
              senderName: buf.senderName,
              text: buf.caption,
              transport: 'webrtc',
              timestamp: buf.timestamp,
              attachmentType: buf.attachmentType,
              attachmentName: buf.attachmentName,
              attachmentMime: buf.attachmentMime,
              attachmentSize: buf.attachmentSize,
              attachmentData: buf.chunks.join(''),
            });
          }
        }
        return;
      }

      if (!seenMsgIds.has(payload.id)) {
        seenMsgIds.add(payload.id);
        onIncomingMessage({
          id: payload.id,
          sender: 'peer',
          senderName: payload.senderName,
          text: payload.text,
          transport: 'webrtc',
          timestamp: payload.timestamp || Date.now(),
        });
      }
    } catch {
      // Ignore malformed packet
    }
  };
}

async function sendFileOverChannel(
  dc: RTCDataChannel,
  senderName: string,
  att: PreparedAttachment,
  caption: string
): Promise<void> {
  const msgId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const totalChunks = Math.max(1, Math.ceil(att.attachmentData.length / P2P_FILE_CHUNK_SIZE));

  dc.send(
    JSON.stringify({
      type: 'file-meta',
      id: msgId,
      senderName,
      caption,
      attachmentType: att.attachmentType,
      attachmentName: att.attachmentName,
      attachmentMime: att.attachmentMime,
      attachmentSize: att.attachmentSize,
      totalChunks,
      timestamp: Date.now(),
    })
  );

  for (let i = 0; i < totalChunks; i++) {
    while (dc.bufferedAmount > 262_144) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const slice = att.attachmentData.slice(
      i * P2P_FILE_CHUNK_SIZE,
      (i + 1) * P2P_FILE_CHUNK_SIZE
    );
    dc.send(
      JSON.stringify({
        type: 'file-chunk',
        id: msgId,
        index: i,
        data: slice,
      })
    );
  }
}

export async function createNearbyHostSession(params: {
  currentUser: UserPublicProfile;
  onStatusChange: (status: 'waiting' | 'paired' | 'p2p-open' | 'closed', peerName?: string) => void;
  onIncomingMessage: (msg: LocalDirectMessage) => void;
}): Promise<NearbyP2PSession> {
  const roomCode = generate6DigitCode();
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const dataChannel = pc.createDataChannel('looply-direct', { ordered: true });

  let isP2POpen = false;
  let unsubRoom: Unsubscribe | null = null;
  let unsubSignals: Unsubscribe | null = null;
  let unsubMessages: Unsubscribe | null = null;
  const seenMsgIds = new Set<string>();
  const seenSignalIds = new Set<string>();
  const handleChannelMsg = createChannelMessageHandler(seenMsgIds, params.onIncomingMessage);

  const setupChannel = (dc: RTCDataChannel) => {
    dc.onopen = () => {
      isP2POpen = true;
      params.onStatusChange('p2p-open');
    };
    dc.onclose = () => {
      isP2POpen = false;
    };
    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        handleChannelMsg(event.data);
      }
    };
  };

  setupChannel(dataChannel);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const roomRef = doc(db, 'nearby_rooms', roomCode);
  try {
    await setDoc(roomRef, {
      code: roomCode,
      hostUid: params.currentUser.uid,
      hostName: sanitizeStr(params.currentUser.displayName, LIMITS.DISPLAY_NAME_MAX) || 'Host',
      guestUid: '',
      guestName: '',
      offerSdp: sanitizeStr(JSON.stringify(offer), LIMITS.SDP_MAX),
      answerSdp: '',
      status: 'waiting',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    pc.close();
    handleFirestoreError(err, OperationType.CREATE, `nearby_rooms/${roomCode}`);
  }

  params.onStatusChange('waiting');

  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      const candidateStr = sanitizeStr(JSON.stringify(event.candidate.toJSON()), LIMITS.CANDIDATE_MAX);
      try {
        await addDoc(collection(db, 'nearby_rooms', roomCode, 'signals'), {
          senderId: params.currentUser.uid,
          candidate: candidateStr,
          createdAt: serverTimestamp(),
        });
      } catch {
        // Non-fatal ICE trickle error
      }
    }
  };

  unsubRoom = onSnapshot(
    roomRef,
    async (snap) => {
      if (!snap.exists()) return;
      const room = snap.data() as NearbyRoom;
      if (room.status === 'closed') {
        params.onStatusChange('closed', room.guestName);
        return;
      }
      if (room.status === 'paired' && room.answerSdp && !pc.currentRemoteDescription) {
        try {
          const answer = JSON.parse(room.answerSdp) as RTCSessionDescriptionInit;
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          params.onStatusChange(isP2POpen ? 'p2p-open' : 'paired', room.guestName);
        } catch {
          // Ignore SDP timing error
        }
      }
    },
    (err) => handleFirestoreError(err, OperationType.GET, `nearby_rooms/${roomCode}`)
  );

  unsubSignals = onSnapshot(
    query(collection(db, 'nearby_rooms', roomCode, 'signals'), orderBy('createdAt', 'asc')),
    (snap) => {
      snap.docs.forEach(async (d) => {
        if (seenSignalIds.has(d.id)) return;
        seenSignalIds.add(d.id);
        const data = d.data() as { senderId: string; candidate: string };
        if (data.senderId !== params.currentUser.uid) {
          try {
            const cand = JSON.parse(data.candidate) as RTCIceCandidateInit;
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            }
          } catch {
            // Ignore candidate error
          }
        }
      });
    },
    () => {
      // Signals listener waits until guest joins
    }
  );

  unsubMessages = onSnapshot(
    query(collection(db, 'nearby_rooms', roomCode, 'messages'), orderBy('createdAt', 'asc')),
    (snap) => {
      snap.docs.forEach((d) => {
        if (seenMsgIds.has(d.id)) return;
        seenMsgIds.add(d.id);
        const data = d.data() as { senderId: string; senderName: string; text: string };
        if (data.senderId !== params.currentUser.uid) {
          params.onIncomingMessage({
            id: d.id,
            sender: 'peer',
            senderName: data.senderName,
            text: data.text,
            transport: 'nearby',
            timestamp: Date.now(),
          });
        }
      });
    },
    (err) => handleFirestoreError(err, OperationType.LIST, `nearby_rooms/${roomCode}/messages`)
  );

  const sendMessage = async (text: string): Promise<'webrtc' | 'nearby'> => {
    const clean = sanitizeStr(text, LIMITS.MESSAGE_TEXT_MAX);
    if (!clean) return 'nearby';
    const msgId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    if (isP2POpen && dataChannel.readyState === 'open') {
      dataChannel.send(
        JSON.stringify({
          type: 'text',
          id: msgId,
          senderName: params.currentUser.displayName,
          text: clean,
          timestamp: Date.now(),
        })
      );
      return 'webrtc';
    }

    try {
      await addDoc(collection(db, 'nearby_rooms', roomCode, 'messages'), {
        senderId: params.currentUser.uid,
        senderName: sanitizeStr(params.currentUser.displayName, LIMITS.DISPLAY_NAME_MAX) || 'User',
        text: clean,
        transport: 'nearby',
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `nearby_rooms/${roomCode}/messages`);
    }
    return 'nearby';
  };

  const sendAttachment = async (att: PreparedAttachment, caption = ''): Promise<void> => {
    if (!isP2POpen || dataChannel.readyState !== 'open') {
      throw new Error('Wait until Direct WebRTC P2P connection opens to send files nearby.');
    }
    await sendFileOverChannel(dataChannel, params.currentUser.displayName, att, caption);
  };

  const cleanup = () => {
    unsubRoom?.();
    unsubSignals?.();
    unsubMessages?.();
    try {
      dataChannel.close();
    } catch {
      // Ignore
    }
    try {
      pc.close();
    } catch {
      // Ignore
    }
  };

  const closeSession = async () => {
    try {
      await updateDoc(roomRef, {
        status: 'closed',
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Ignore if already closed
    }
    cleanup();
  };

  return {
    roomCode,
    role: 'host',
    peerConnection: pc,
    sendMessage,
    sendAttachment,
    closeSession,
    cleanup,
  };
}

export async function joinNearbyGuestSession(params: {
  roomCode: string;
  currentUser: UserPublicProfile;
  onStatusChange: (status: 'waiting' | 'paired' | 'p2p-open' | 'closed', peerName?: string) => void;
  onIncomingMessage: (msg: LocalDirectMessage) => void;
}): Promise<NearbyP2PSession> {
  const cleanCode = params.roomCode.trim();
  if (!cleanCode || cleanCode.length < 6 || !LIMITS.ID_PATTERN.test(cleanCode)) {
    throw new Error('Please enter a valid 6-digit Nearby room code.');
  }

  const roomRef = doc(db, 'nearby_rooms', cleanCode);
  let roomSnap;
  try {
    roomSnap = await getDoc(roomRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `nearby_rooms/${cleanCode}`);
  }

  if (!roomSnap || !roomSnap.exists()) {
    throw new Error('Nearby room not found. Check the 6-digit code and try again.');
  }

  const roomData = roomSnap.data() as NearbyRoom;
  if (roomData.status === 'closed') {
    throw new Error('This Nearby session has already ended.');
  }
  if (roomData.hostUid === params.currentUser.uid) {
    throw new Error('You created this room — share the code with your friend to join.');
  }
  if (roomData.guestUid && roomData.guestUid !== params.currentUser.uid) {
    throw new Error('This Nearby room already has two participants.');
  }

  const pc = new RTCPeerConnection(RTC_CONFIG);
  let activeChannel: RTCDataChannel | null = null;
  let isP2POpen = false;
  let unsubRoom: Unsubscribe | null = null;
  let unsubSignals: Unsubscribe | null = null;
  let unsubMessages: Unsubscribe | null = null;
  const seenMsgIds = new Set<string>();
  const seenSignalIds = new Set<string>();
  const handleChannelMsg = createChannelMessageHandler(seenMsgIds, params.onIncomingMessage);

  pc.ondatachannel = (event) => {
    activeChannel = event.channel;
    activeChannel.onopen = () => {
      isP2POpen = true;
      params.onStatusChange('p2p-open', roomData.hostName);
    };
    activeChannel.onclose = () => {
      isP2POpen = false;
    };
    activeChannel.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        handleChannelMsg(ev.data);
      }
    };
  };

  const pendingCandidates: RTCIceCandidateInit[] = [];
  let guestJoinedInDb = roomData.guestUid === params.currentUser.uid;

  pc.onicecandidate = async (event) => {
    if (!event.candidate) return;
    if (!guestJoinedInDb) {
      pendingCandidates.push(event.candidate.toJSON());
      return;
    }
    const candidateStr = sanitizeStr(JSON.stringify(event.candidate.toJSON()), LIMITS.CANDIDATE_MAX);
    try {
      await addDoc(collection(db, 'nearby_rooms', cleanCode, 'signals'), {
        senderId: params.currentUser.uid,
        candidate: candidateStr,
        createdAt: serverTimestamp(),
      });
    } catch {
      // Ignore ICE trickle failure
    }
  };

  if (roomData.offerSdp) {
    const offer = JSON.parse(roomData.offerSdp) as RTCSessionDescriptionInit;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (roomData.status === 'waiting') {
      try {
        await updateDoc(roomRef, {
          guestUid: params.currentUser.uid,
          guestName: sanitizeStr(params.currentUser.displayName, LIMITS.DISPLAY_NAME_MAX) || 'Guest',
          answerSdp: sanitizeStr(JSON.stringify(answer), LIMITS.SDP_MAX),
          status: 'paired',
          updatedAt: serverTimestamp(),
        });
        guestJoinedInDb = true;
      } catch (err) {
        pc.close();
        handleFirestoreError(err, OperationType.UPDATE, `nearby_rooms/${cleanCode}`);
      }
    }
  }

  if (guestJoinedInDb && pendingCandidates.length > 0) {
    for (const cand of pendingCandidates) {
      try {
        await addDoc(collection(db, 'nearby_rooms', cleanCode, 'signals'), {
          senderId: params.currentUser.uid,
          candidate: sanitizeStr(JSON.stringify(cand), LIMITS.CANDIDATE_MAX),
          createdAt: serverTimestamp(),
        });
      } catch {
        // Ignore
      }
    }
  }

  params.onStatusChange('paired', roomData.hostName);

  unsubRoom = onSnapshot(
    roomRef,
    (snap) => {
      if (!snap.exists()) return;
      const updated = snap.data() as NearbyRoom;
      if (updated.status === 'closed') {
        params.onStatusChange('closed', updated.hostName);
      }
    },
    (err) => handleFirestoreError(err, OperationType.GET, `nearby_rooms/${cleanCode}`)
  );

  unsubSignals = onSnapshot(
    query(collection(db, 'nearby_rooms', cleanCode, 'signals'), orderBy('createdAt', 'asc')),
    (snap) => {
      snap.docs.forEach(async (d) => {
        if (seenSignalIds.has(d.id)) return;
        seenSignalIds.add(d.id);
        const data = d.data() as { senderId: string; candidate: string };
        if (data.senderId !== params.currentUser.uid) {
          try {
            const cand = JSON.parse(data.candidate) as RTCIceCandidateInit;
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            }
          } catch {
            // Ignore
          }
        }
      });
    },
    (err) => handleFirestoreError(err, OperationType.LIST, `nearby_rooms/${cleanCode}/signals`)
  );

  unsubMessages = onSnapshot(
    query(collection(db, 'nearby_rooms', cleanCode, 'messages'), orderBy('createdAt', 'asc')),
    (snap) => {
      snap.docs.forEach((d) => {
        if (seenMsgIds.has(d.id)) return;
        seenMsgIds.add(d.id);
        const data = d.data() as { senderId: string; senderName: string; text: string };
        if (data.senderId !== params.currentUser.uid) {
          params.onIncomingMessage({
            id: d.id,
            sender: 'peer',
            senderName: data.senderName,
            text: data.text,
            transport: 'nearby',
            timestamp: Date.now(),
          });
        }
      });
    },
    (err) => handleFirestoreError(err, OperationType.LIST, `nearby_rooms/${cleanCode}/messages`)
  );

  const sendMessage = async (text: string): Promise<'webrtc' | 'nearby'> => {
    const clean = sanitizeStr(text, LIMITS.MESSAGE_TEXT_MAX);
    if (!clean) return 'nearby';
    const msgId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    if (isP2POpen && activeChannel && activeChannel.readyState === 'open') {
      activeChannel.send(
        JSON.stringify({
          type: 'text',
          id: msgId,
          senderName: params.currentUser.displayName,
          text: clean,
          timestamp: Date.now(),
        })
      );
      return 'webrtc';
    }

    try {
      await addDoc(collection(db, 'nearby_rooms', cleanCode, 'messages'), {
        senderId: params.currentUser.uid,
        senderName: sanitizeStr(params.currentUser.displayName, LIMITS.DISPLAY_NAME_MAX) || 'User',
        text: clean,
        transport: 'nearby',
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `nearby_rooms/${cleanCode}/messages`);
    }
    return 'nearby';
  };

  const sendAttachment = async (att: PreparedAttachment, caption = ''): Promise<void> => {
    if (!isP2POpen || !activeChannel || activeChannel.readyState !== 'open') {
      throw new Error('Wait until Direct WebRTC P2P connection opens to send files nearby.');
    }
    await sendFileOverChannel(activeChannel, params.currentUser.displayName, att, caption);
  };

  const cleanup = () => {
    unsubRoom?.();
    unsubSignals?.();
    unsubMessages?.();
    try {
      activeChannel?.close();
    } catch {
      // Ignore
    }
    try {
      pc.close();
    } catch {
      // Ignore
    }
  };

  const closeSession = async () => {
    try {
      await updateDoc(roomRef, {
        status: 'closed',
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Ignore
    }
    cleanup();
  };

  return {
    roomCode: cleanCode,
    role: 'guest',
    peerConnection: pc,
    sendMessage,
    sendAttachment,
    closeSession,
    cleanup,
  };
}

// ============================================================================
// ZERO-INTERNET OFFLINE CODE / QR WEBRTC P2P (Local Wi-Fi / Hotspot / LAN)
// ============================================================================

const OFFLINE_RTC_CONFIG: RTCConfiguration = {
  iceServers: [],
};

export interface OfflineP2PSession extends NearbyP2PSession {
  isOfflineDirect: true;
  offerCode?: string;
  answerCode?: string;
  acceptAnswerCode?: (answerCode: string) => Promise<void>;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function encodeOfflineSignal(prefix: 'KL1' | 'KL2', payload: { s: string; n: string }): Promise<string> {
  const rawBytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      await writer.write(rawBytes);
      await writer.close();
      const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
      return `${prefix}:${bytesToBase64Url(compressed)}`;
    } catch {
      // Fallback below
    }
  }
  return `${prefix}R:${bytesToBase64Url(rawBytes)}`;
}

async function decodeOfflineSignal(rawInput: string): Promise<{ kind: 'offer' | 'answer'; sdp: string; name: string }> {
  let clean = rawInput.trim();
  // Support scanning full LoopLy QR URL (?offline=KL1:...)
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    try {
      const url = new URL(clean);
      const param = url.searchParams.get('offline');
      if (param) clean = param.trim();
    } catch {
      // Ignore URL parse error
    }
  }

  const isCompressed = clean.startsWith('KL1:') || clean.startsWith('KL2:');
  const isRaw = clean.startsWith('KL1R:') || clean.startsWith('KL2R:');
  if (!isCompressed && !isRaw) {
    throw new Error('Invalid offline pairing code. Please paste the full KL1 / KL2 code or scan the QR.');
  }
  const kind: 'offer' | 'answer' = clean.startsWith('KL1') ? 'offer' : 'answer';
  const body = clean.slice(clean.indexOf(':') + 1);
  const bytes = base64UrlToBytes(body);

  let jsonText: string;
  if (isCompressed) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot decompress offline pairing codes.');
    }
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    await writer.write(new Uint8Array(bytes));
    await writer.close();
    const decompressed = await new Response(ds.readable).arrayBuffer();
    jsonText = new TextDecoder().decode(decompressed);
  } else {
    jsonText = new TextDecoder().decode(bytes);
  }

  const parsed = JSON.parse(jsonText) as { s?: string; n?: string };
  if (!parsed?.s) {
    throw new Error('Offline pairing code is incomplete or corrupted.');
  }
  return {
    kind,
    sdp: parsed.s,
    name: sanitizeStr(parsed.n || 'Offline Peer', LIMITS.DISPLAY_NAME_MAX) || 'Offline Peer',
  };
}

function waitForLocalIceGathering(pc: RTCPeerConnection, timeoutMs = 950): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      pc.removeEventListener('icegatheringstatechange', onState);
      window.clearTimeout(timer);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = window.setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onState);
  });
}

export async function createOfflineHostOffer(params: {
  displayName: string;
  onStatusChange: (status: 'waiting' | 'paired' | 'p2p-open' | 'closed', peerName?: string) => void;
  onIncomingMessage: (msg: LocalDirectMessage) => void;
}): Promise<OfflineP2PSession> {
  const roomCode = generate6DigitCode();
  const safeName = sanitizeStr(params.displayName, LIMITS.DISPLAY_NAME_MAX) || 'Offline Host';
  const pc = new RTCPeerConnection(OFFLINE_RTC_CONFIG);
  const dataChannel = pc.createDataChannel('looply-offline', { ordered: true });
  const seenMsgIds = new Set<string>();
  const handleChannelMsg = createChannelMessageHandler(seenMsgIds, params.onIncomingMessage);

  let isOpen = false;
  let remotePeerName = 'Offline Peer';

  dataChannel.onopen = () => {
    isOpen = true;
    params.onStatusChange('p2p-open', remotePeerName);
  };
  dataChannel.onclose = () => {
    isOpen = false;
    params.onStatusChange('closed', remotePeerName);
  };
  dataChannel.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      handleChannelMsg(ev.data);
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForLocalIceGathering(pc, 950);

  const gatheredSdp = pc.localDescription?.sdp || offer.sdp || '';
  const offerCode = await encodeOfflineSignal('KL1', { s: gatheredSdp, n: safeName });
  params.onStatusChange('waiting');

  const acceptAnswerCode = async (answerCodeRaw: string): Promise<void> => {
    const decoded = await decodeOfflineSignal(answerCodeRaw);
    if (decoded.kind !== 'answer') {
      throw new Error('Please paste your friend’s Reply Code (starts with KL2:).');
    }
    remotePeerName = decoded.name;
    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'answer', sdp: decoded.sdp })
    );
    params.onStatusChange(isOpen ? 'p2p-open' : 'paired', remotePeerName);
  };

  const sendMessage = async (text: string): Promise<'webrtc' | 'nearby'> => {
    const clean = sanitizeStr(text, LIMITS.MESSAGE_TEXT_MAX);
    if (!clean) return 'webrtc';
    if (!isOpen || dataChannel.readyState !== 'open') {
      throw new Error('Wait until the offline P2P connection opens after entering your friend’s reply code.');
    }
    dataChannel.send(
      JSON.stringify({
        type: 'text',
        id: `off_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        senderName: safeName,
        text: clean,
        timestamp: Date.now(),
      })
    );
    return 'webrtc';
  };

  const sendAttachment = async (att: PreparedAttachment, caption = ''): Promise<void> => {
    if (!isOpen || dataChannel.readyState !== 'open') {
      throw new Error('Open Offline P2P channel first to send photos or files.');
    }
    await sendFileOverChannel(dataChannel, safeName, att, caption);
  };

  const cleanup = () => {
    try {
      dataChannel.close();
    } catch {
      // Ignore
    }
    try {
      pc.close();
    } catch {
      // Ignore
    }
  };

  return {
    roomCode,
    role: 'host',
    peerConnection: pc,
    isOfflineDirect: true,
    offerCode,
    acceptAnswerCode,
    sendMessage,
    sendAttachment,
    closeSession: async () => cleanup(),
    cleanup,
  };
}

export async function acceptOfflineOfferAndCreateAnswer(params: {
  offerCode: string;
  displayName: string;
  onStatusChange: (status: 'waiting' | 'paired' | 'p2p-open' | 'closed', peerName?: string) => void;
  onIncomingMessage: (msg: LocalDirectMessage) => void;
}): Promise<OfflineP2PSession> {
  const decoded = await decodeOfflineSignal(params.offerCode);
  if (decoded.kind !== 'offer') {
    throw new Error('Please paste the Host’s Offline Code (starts with KL1:).');
  }

  const roomCode = generate6DigitCode();
  const safeName = sanitizeStr(params.displayName, LIMITS.DISPLAY_NAME_MAX) || 'Offline Guest';
  const pc = new RTCPeerConnection(OFFLINE_RTC_CONFIG);
  const seenMsgIds = new Set<string>();
  const handleChannelMsg = createChannelMessageHandler(seenMsgIds, params.onIncomingMessage);

  let activeChannel: RTCDataChannel | null = null;
  let isOpen = false;

  pc.ondatachannel = (event) => {
    activeChannel = event.channel;
    activeChannel.onopen = () => {
      isOpen = true;
      params.onStatusChange('p2p-open', decoded.name);
    };
    activeChannel.onclose = () => {
      isOpen = false;
      params.onStatusChange('closed', decoded.name);
    };
    activeChannel.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        handleChannelMsg(ev.data);
      }
    };
  };

  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: decoded.sdp }));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForLocalIceGathering(pc, 950);

  const gatheredSdp = pc.localDescription?.sdp || answer.sdp || '';
  const answerCode = await encodeOfflineSignal('KL2', { s: gatheredSdp, n: safeName });
  params.onStatusChange('paired', decoded.name);

  const sendMessage = async (text: string): Promise<'webrtc' | 'nearby'> => {
    const clean = sanitizeStr(text, LIMITS.MESSAGE_TEXT_MAX);
    if (!clean) return 'webrtc';
    if (!isOpen || !activeChannel || activeChannel.readyState !== 'open') {
      throw new Error('Send your Reply Code to the host first so the direct offline channel opens.');
    }
    activeChannel.send(
      JSON.stringify({
        type: 'text',
        id: `off_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        senderName: safeName,
        text: clean,
        timestamp: Date.now(),
      })
    );
    return 'webrtc';
  };

  const sendAttachment = async (att: PreparedAttachment, caption = ''): Promise<void> => {
    if (!isOpen || !activeChannel || activeChannel.readyState !== 'open') {
      throw new Error('Wait until Host pastes your Reply Code to send photos or files.');
    }
    await sendFileOverChannel(activeChannel, safeName, att, caption);
  };

  const cleanup = () => {
    try {
      activeChannel?.close();
    } catch {
      // Ignore
    }
    try {
      pc.close();
    } catch {
      // Ignore
    }
  };

  return {
    roomCode,
    role: 'guest',
    peerConnection: pc,
    isOfflineDirect: true,
    answerCode,
    sendMessage,
    sendAttachment,
    closeSession: async () => cleanup(),
    cleanup,
  };
}
