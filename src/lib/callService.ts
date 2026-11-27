import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import { CallCandidate, CallMode, CallSession, CallStateStatus, LIMITS } from '../types/chat';
import {
  db,
  handleFirestoreError,
  logFirestoreError,
  OperationType,
  sanitizeStr,
} from './firebase';

export const CALL_RTC_CONFIG: RTCConfiguration = {
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
      urls: 'turn:openrelay.metered.ca:80?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turns:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 6,
};

let dynamicIceServers: RTCIceServer[] | null = null;
let lastIceFetchAt = 0;

export async function warmRtcConfig(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (dynamicIceServers && Date.now() - lastIceFetchAt < 5 * 60 * 1000) return;
  try {
    const resp = await fetch('/api/rtc-config');
    if (!resp.ok) return;
    const data = (await resp.json()) as { iceServers?: RTCIceServer[] };
    if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
      dynamicIceServers = data.iceServers;
      lastIceFetchAt = Date.now();
    }
  } catch {
    // Non-fatal; built-in STUN/TURN defaults remain active
  }
}

export function getCallRtcConfig(): RTCConfiguration {
  if (dynamicIceServers && dynamicIceServers.length > 0) {
    return {
      iceServers: dynamicIceServers,
      iceCandidatePoolSize: 6,
    };
  }
  return CALL_RTC_CONFIG;
}

export function generateCallId(): string {
  return doc(collection(db, 'calls')).id;
}

export async function createCallSession(params: {
  callId: string;
  chatId: string;
  callerUid: string;
  callerName: string;
  callerPhoto: string;
  calleeUid: string;
  calleeName: string;
  calleePhoto: string;
  mode: CallMode;
  offerSdp: string;
}): Promise<void> {
  const ref = doc(db, 'calls', params.callId);
  if (!params.offerSdp || params.offerSdp.length > LIMITS.CALL_SDP_MAX) {
    throw new Error('Call SDP offer exceeded size limit.');
  }
  try {
    await setDoc(ref, {
      id: params.callId,
      chatId: params.chatId,
      callerUid: params.callerUid,
      callerName: sanitizeStr(params.callerName, LIMITS.DISPLAY_NAME_MAX) || 'Caller',
      callerPhoto: sanitizeStr(params.callerPhoto || '', LIMITS.PHOTO_URL_MAX),
      calleeUid: params.calleeUid,
      calleeName: sanitizeStr(params.calleeName, LIMITS.DISPLAY_NAME_MAX) || 'Friend',
      calleePhoto: sanitizeStr(params.calleePhoto || '', LIMITS.PHOTO_URL_MAX),
      participantIds: [params.callerUid, params.calleeUid],
      mode: params.mode,
      status: 'ringing' as CallStateStatus,
      offerSdp: params.offerSdp,
      answerSdp: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `calls/${params.callId}`);
  }
}

export async function acceptCallSession(params: {
  callId: string;
  answerSdp: string;
}): Promise<void> {
  const ref = doc(db, 'calls', params.callId);
  if (!params.answerSdp || params.answerSdp.length > LIMITS.CALL_SDP_MAX) {
    throw new Error('Call SDP answer exceeded size limit.');
  }
  try {
    await updateDoc(ref, {
      answerSdp: params.answerSdp,
      status: 'connected' as CallStateStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `calls/${params.callId}`);
  }
}

export async function updateCallStatus(params: {
  callId: string;
  status: Extract<CallStateStatus, 'declined' | 'ended' | 'missed'>;
}): Promise<void> {
  const ref = doc(db, 'calls', params.callId);
  try {
    await updateDoc(ref, {
      status: params.status,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Call may already be in terminal state ('declined' | 'ended' | 'missed'); ignore cleanly
  }
}

export async function sendCallCandidate(params: {
  callId: string;
  senderId: string;
  candidate: RTCIceCandidateInit;
}): Promise<void> {
  const raw = JSON.stringify(params.candidate);
  if (!raw || raw.length > LIMITS.CALL_CANDIDATE_MAX) return;
  const candRef = doc(collection(db, 'calls', params.callId, 'candidates'));
  try {
    await setDoc(candRef, {
      senderId: params.senderId,
      candidate: raw,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal if call already closed while ICE trickle completes
  }
}

export function subscribeIncomingCalls(
  currentUid: string,
  onIncoming: (calls: CallSession[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'calls'),
    where('participantIds', 'array-contains', currentUid)
  );
  let initialResolved = false;
  const liveAddedIds = new Set<string>();

  return onSnapshot(
    q,
    (snapshot) => {
      const now = Date.now();
      if (initialResolved) {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            liveAddedIds.add(change.doc.id);
          }
        });
      } else {
        initialResolved = true;
      }

      const incoming = snapshot.docs
        .map((d) => d.data() as CallSession)
        .filter((c) => {
          if (c.calleeUid !== currentUid || c.status !== 'ringing') return false;
          // Any doc added live during this session is unconditionally fresh (avoids device clock skew!)
          if (liveAddedIds.has(c.id)) return true;
          const createdMs = c.createdAt?.toMillis?.();
          if (!createdMs) return true;
          return Math.abs(now - createdMs) < 180_000;
        })
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      onIncoming(incoming);
    },
    (err) => {
      logFirestoreError(err, OperationType.LIST, 'calls');
    }
  );
}

export function subscribeCallSession(
  callId: string,
  onSession: (session: CallSession | null) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'calls', callId),
    (snap) => {
      onSession(snap.exists() ? (snap.data() as CallSession) : null);
    },
    (err) => {
      logFirestoreError(err, OperationType.GET, `calls/${callId}`);
      onError?.(err);
    }
  );
}

export function subscribeCallCandidates(
  callId: string,
  currentUid: string,
  onCandidate: (candidate: RTCIceCandidateInit, candidateDocId: string) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const seen = new Set<string>();
  return onSnapshot(
    collection(db, 'calls', callId, 'candidates'),
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const docId = change.doc.id;
        if (seen.has(docId)) return;
        seen.add(docId);
        const data = change.doc.data() as CallCandidate;
        if (!data || data.senderId === currentUid || !data.candidate) return;
        try {
          const parsed = JSON.parse(data.candidate) as RTCIceCandidateInit;
          onCandidate(parsed, docId);
        } catch {
          // Ignore malformed ICE candidate
        }
      });
    },
    (err) => {
      logFirestoreError(err, OperationType.LIST, `calls/${callId}/candidates`);
      onError?.(err);
    }
  );
}
