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
import { db, handleFirestoreError, OperationType, sanitizeStr } from './firebase';

export const CALL_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: 'e8dd65b92f6110e8b12a022b',
      credential: 'uWdWNmkhvyqTWxH+',
    },
    {
      urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username: 'e8dd65b92f6110e8b12a022b',
      credential: 'uWdWNmkhvyqTWxH+',
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username: 'e8dd65b92f6110e8b12a022b',
      credential: 'uWdWNmkhvyqTWxH+',
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: 'e8dd65b92f6110e8b12a022b',
      credential: 'uWdWNmkhvyqTWxH+',
    },
  ],
  iceCandidatePoolSize: 6,
};

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
      offerSdp: sanitizeStr(params.offerSdp, LIMITS.CALL_SDP_MAX),
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
  try {
    await updateDoc(ref, {
      answerSdp: sanitizeStr(params.answerSdp, LIMITS.CALL_SDP_MAX),
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
  const candidateStr = sanitizeStr(JSON.stringify(params.candidate), LIMITS.CALL_CANDIDATE_MAX);
  if (!candidateStr) return;
  const candRef = doc(collection(db, 'calls', params.callId, 'candidates'));
  try {
    await setDoc(candRef, {
      senderId: params.senderId,
      candidate: candidateStr,
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
  return onSnapshot(
    q,
    (snapshot) => {
      const now = Date.now();
      const incoming = snapshot.docs
        .map((d) => d.data() as CallSession)
        .filter((c) => {
          if (c.calleeUid !== currentUid || c.status !== 'ringing') return false;
          const createdMs = c.createdAt?.toMillis?.() ?? now;
          return now - createdMs < 75_000;
        })
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      onIncoming(incoming);
    },
    () => {
      // Ignore transient call subscription errors
    }
  );
}

export function subscribeCallSession(
  callId: string,
  onSession: (session: CallSession | null) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'calls', callId),
    (snap) => {
      onSession(snap.exists() ? (snap.data() as CallSession) : null);
    },
    () => {
      // Ignore transient snapshot errors on call end
    }
  );
}

export function subscribeCallCandidates(
  callId: string,
  currentUid: string,
  onCandidate: (candidate: RTCIceCandidateInit, candidateDocId: string) => void
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
    () => {
      // Ignore transient candidate listener errors
    }
  );
}
