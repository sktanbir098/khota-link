import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Play,
  RefreshCw,
  ShieldCheck,
  Video,
  VideoOff,
  Volume1,
  Volume2,
} from 'lucide-react';
import {
  acceptCallSession,
  createCallSession,
  getCallRtcConfig,
  sendCallCandidate,
  subscribeCallCandidates,
  subscribeCallSession,
  updateCallStatus,
  warmRtcConfig,
} from '../lib/callService';
import { t } from '../lib/i18n';
import {
  playCallHangupTone,
  startRingtone,
  stopRingtone,
  suspendAudioForCall,
  unlockAudioNow,
} from '../lib/sound';
import { startVoiceRelay, VoiceRelaySession } from '../lib/voiceRelay';
import { AppLanguage, CallMode, CallSession, LIMITS, UserPublicProfile } from '../types/chat';
import { UserAvatar } from './UserAvatar';

export interface ActiveCallSession {
  callId: string;
  direction: 'outgoing' | 'incoming';
  mode: CallMode;
  chatId: string;
  peerUid: string;
  peerName: string;
  peerPhoto: string;
  initialSession?: CallSession;
}

interface Props {
  lang: AppLanguage;
  currentUser: UserPublicProfile;
  activeCall: ActiveCallSession;
  onClose: () => void;
}

type CallPhase =
  | 'initializing'
  | 'ringing-outgoing'
  | 'ringing-incoming'
  | 'connecting'
  | 'connected'
  | 'ended';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function waitForInitialIce(pc: RTCPeerConnection, timeoutMs = 420): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      pc.removeEventListener('icegatheringstatechange', onGatherState);
      pc.removeEventListener('icecandidate', onCandidate);
      window.clearTimeout(timer);
      resolve();
    };
    const onGatherState = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const onCandidate = (ev: RTCPeerConnectionIceEvent) => {
      if (!ev.candidate) {
        finish();
        return;
      }
      if (ev.candidate.type === 'srflx' || ev.candidate.type === 'relay') {
        window.setTimeout(finish, 90);
      }
    };
    const timer = window.setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onGatherState);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

function serializeBoundedSdp(
  preferred: RTCSessionDescription | null,
  fallback: RTCSessionDescriptionInit
): string {
  const candidateDesc = preferred
    ? { type: preferred.type, sdp: preferred.sdp }
    : { type: fallback.type, sdp: fallback.sdp || '' };
  const fullJson = JSON.stringify(candidateDesc);
  if (fullJson.length <= LIMITS.CALL_SDP_MAX) {
    return fullJson;
  }
  return JSON.stringify({ type: fallback.type, sdp: fallback.sdp || '' });
}

export const CallOverlay: React.FC<Props> = ({ lang, currentUser, activeCall, onClose }) => {
  const [phase, setPhase] = useState<CallPhase>(
    activeCall.direction === 'incoming' ? 'ringing-incoming' : 'initializing'
  );
  const [statusLabel, setStatusLabel] = useState<string>(
    activeCall.direction === 'incoming'
      ? t(lang, activeCall.mode === 'video' ? 'incomingVideoCall' : 'incomingVoiceCall')
      : t(lang, 'callingPeer')
  );
  const [errorMsg, setErrorMsg] = useState('');
  const [micMuted, setMicMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [peerOnHold, setPeerOnHold] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [camOff, setCamOff] = useState(activeCall.mode === 'audio');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [minimized, setMinimized] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [finalDurationSec, setFinalDurationSec] = useState(0);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [hasLocalVideo, setHasLocalVideo] = useState(false);
  const [remoteAudioFlowing, setRemoteAudioFlowing] = useState(false);
  const [relayPeerConnected, setRelayPeerConnected] = useState(false);
  const [iceConnected, setIceConnected] = useState(false);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [pickupBurstKey, setPickupBurstKey] = useState(0);
  const [voiceBars, setVoiceBars] = useState<number[]>([0.25, 0.45, 0.65, 0.45, 0.25]);
  const [callDocReady, setCallDocReady] = useState(activeCall.direction === 'incoming');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const relaySessionRef = useRef<VoiceRelaySession | null>(null);
  const boundAudioTrackIdsRef = useRef<string>('');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const callDocCreatedRef = useRef(activeCall.direction === 'incoming');
  const outgoingIceQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSetRef = useRef(false);
  const settingRemoteDescRef = useRef(false);
  const incomingIceQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const latestOfferSdpRef = useRef<string>(activeCall.initialSession?.offerSdp || '');
  const cleanedUpRef = useRef(false);
  const closingRef = useRef(false);
  const userEndedRef = useRef(false);
  const connectedStartedRef = useRef(false);
  const connectedAtMsRef = useRef<number | null>(null);
  const elapsedSecRef = useRef(0);
  const iceConnectedRef = useRef(false);
  const micMutedRef = useRef(false);
  const lastInboundBytesRef = useRef(0);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const langRef = useRef(lang);
  langRef.current = lang;
  const activeCallRef = useRef(activeCall);
  activeCallRef.current = activeCall;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const onHoldRef = useRef(false);
  const speakerOnRef = useRef(true);
  iceConnectedRef.current = iceConnected;
  micMutedRef.current = micMuted;
  onHoldRef.current = onHold;
  speakerOnRef.current = speakerOn;

  const ensureRemoteAudioPlaying = useCallback(() => {
    const audioEl = remoteAudioRef.current;
    const remoteStream = remoteStreamRef.current;
    if (!audioEl || !remoteStream) return;

    const audioTracks = remoteStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    const trackKey = audioTracks.map((tr) => tr.id).sort().join(',');
    if (boundAudioTrackIdsRef.current !== trackKey || !audioEl.srcObject) {
      boundAudioTrackIdsRef.current = trackKey;
      audioEl.srcObject = new MediaStream(audioTracks);
    }

    audioEl.muted = onHoldRef.current;
    audioEl.volume = speakerOnRef.current ? 1 : 0.42;

    if (audioEl.paused) {
      const p = audioEl.play();
      if (p) {
        p.then(() => {
          setAudioPlaybackBlocked(false);
        }).catch(() => {
          setAudioPlaybackBlocked(true);
        });
      }
    } else {
      setAudioPlaybackBlocked(false);
    }
  }, []);

  const attachStreamsToElements = useCallback(() => {
    if (localVideoRef.current && localStreamRef.current) {
      if (localVideoRef.current.srcObject !== localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      localVideoRef.current.muted = true;
      localVideoRef.current.play().catch(() => {});
    }
    if (remoteStreamRef.current) {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.muted = true;
        if (remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current;
        }
        if (remoteStreamRef.current.getVideoTracks().length > 0) {
          remoteVideoRef.current.play().catch(() => {});
        }
      }
      ensureRemoteAudioPlaying();
    }
  }, [ensureRemoteAudioPlaying]);

  useEffect(() => {
    attachStreamsToElements();
  }, [minimized, phase, hasRemoteVideo, hasLocalVideo, remoteAudioFlowing, attachStreamsToElements]);

  const activateFreeVoiceRelay = useCallback(() => {
    if (closingRef.current || relaySessionRef.current || !localStreamRef.current) return;
    if (iceConnectedRef.current) return;

    relaySessionRef.current = startVoiceRelay({
      callId: activeCallRef.current.callId,
      uid: currentUserRef.current.uid,
      localStream: localStreamRef.current,
      initiallyMuted: micMutedRef.current || onHoldRef.current,
      initiallySpeakerOn: speakerOnRef.current,
      onPeerStateChange: (joined) => {
        setRelayPeerConnected(joined);
        if (joined) {
          setErrorMsg('');
          if (onHoldRef.current) {
            relaySessionRef.current?.sendHoldState(true);
          }
        }
      },
      onPeerHoldChange: (held) => {
        setPeerOnHold(held);
      },
      onReceivingAudio: () => {
        setRemoteAudioFlowing(true);
      },
      onAudioLevel: (lvl) => {
        if (onHoldRef.current) return;
        const scaled = Math.min(1, 0.24 + lvl * 0.9);
        setVoiceBars([
          Math.max(0.22, scaled * 0.65),
          Math.max(0.3, scaled * 0.9),
          scaled,
          Math.max(0.3, scaled * 0.85),
          Math.max(0.22, scaled * 0.6),
        ]);
      },
      onPlaybackBlocked: (blocked) => {
        setAudioPlaybackBlocked(blocked);
      },
    });
  }, []);

  const markCallConnected = useCallback(() => {
    suspendAudioForCall();
    if (!connectedStartedRef.current) {
      connectedStartedRef.current = true;
      connectedAtMsRef.current = Date.now();
      setPickupBurstKey((k) => k + 1);
    }
    setPhase('connected');
    setStatusLabel(t(langRef.current, 'callConnected'));
    ensureRemoteAudioPlaying();
  }, [ensureRemoteAudioPlaying]);

  const teardownMediaAndPc = useCallback(() => {
    if (cleanedUpRef.current) return;
    cleanedUpRef.current = true;
    stopRingtone();

    if (relaySessionRef.current) {
      relaySessionRef.current.stop();
      relaySessionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((tr) => tr.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((tr) => tr.stop());
      remoteStreamRef.current = null;
    }
    boundAudioTrackIdsRef.current = '';
    if (remoteAudioRef.current) {
      try {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
      } catch {
        // Ignore
      }
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
  }, []);

  const finishAndClose = useCallback(
    (label: string, delayMs = 1150) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setFinalDurationSec(elapsedSecRef.current);
      setPhase('ended');
      setStatusLabel(label);
      void playCallHangupTone();
      teardownMediaAndPc();
      window.setTimeout(() => {
        onCloseRef.current();
      }, delayMs);
    },
    [teardownMediaAndPc]
  );

  const acquireLocalMedia = useCallback(
    async (mode: CallMode, facing: 'user' | 'environment'): Promise<MediaStream> => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(t(langRef.current, 'noMediaDevice'));
      }
      cleanedUpRef.current = false;

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video:
              mode === 'video'
                ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }
                : false,
          });
        } catch (primaryErr) {
          const errName = (primaryErr as { name?: string })?.name || '';
          if (errName === 'OverconstrainedError' || errName === 'TypeError') {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: mode === 'video' ? { facingMode: facing } : false,
            });
          } else {
            throw primaryErr;
          }
        }

        stream.getAudioTracks().forEach((tr) => {
          tr.enabled = true;
        });
        localStreamRef.current = stream;
        setHasLocalVideo(stream.getVideoTracks().length > 0);
        setCamOff(stream.getVideoTracks().length === 0);
        attachStreamsToElements();
        return stream;
      } catch (err) {
        const name = (err as { name?: string })?.name || '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          throw new Error(t(langRef.current, 'mediaPermDenied'));
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'NotReadableError') {
          if (mode === 'video') {
            try {
              const audioOnly = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false,
              });
              audioOnly.getAudioTracks().forEach((tr) => {
                tr.enabled = true;
              });
              localStreamRef.current = audioOnly;
              setHasLocalVideo(false);
              setCamOff(true);
              return audioOnly;
            } catch {
              throw new Error(t(langRef.current, 'noMediaDevice'));
            }
          }
          throw new Error(t(langRef.current, 'noMediaDevice'));
        }
        throw err instanceof Error ? err : new Error(t(langRef.current, 'mediaPermDenied'));
      }
    },
    [attachStreamsToElements]
  );

  const createPeerConnection = useCallback(
    (stream: MediaStream) => {
      cleanedUpRef.current = false;
      const pc = new RTCPeerConnection(getCallRtcConfig());
      pcRef.current = pc;

      const remoteStream = new MediaStream();
      remoteStreamRef.current = remoteStream;
      boundAudioTrackIdsRef.current = '';

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        const addRemoteTrack = (tr: MediaStreamTrack) => {
          tr.enabled = true;
          tr.onunmute = () => {
            ensureRemoteAudioPlaying();
          };
          if (!remoteStream.getTracks().some((existing) => existing.id === tr.id)) {
            remoteStream.addTrack(tr);
          }
        };

        if (event.track) {
          addRemoteTrack(event.track);
        }
        if (event.streams && event.streams[0]) {
          event.streams[0].getTracks().forEach(addRemoteTrack);
        }

        if (remoteStream.getVideoTracks().length > 0) {
          setHasRemoteVideo(true);
        }
        attachStreamsToElements();
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const json = event.candidate.toJSON();
        if (!callDocCreatedRef.current) {
          outgoingIceQueueRef.current.push(json);
        } else {
          void sendCallCandidate({
            callId: activeCallRef.current.callId,
            senderId: currentUserRef.current.uid,
            candidate: json,
          });
        }
      };

      const checkIceConnected = () => {
        const iceState = pc.iceConnectionState;
        const connState = pc.connectionState;
        if (
          iceState === 'connected' ||
          iceState === 'completed' ||
          connState === 'connected'
        ) {
          setIceConnected(true);
          setErrorMsg('');
          relaySessionRef.current?.setPaused(true);
          ensureRemoteAudioPlaying();
          if (connectedStartedRef.current) {
            setPhase('connected');
            setStatusLabel(t(langRef.current, 'callConnected'));
          }
        } else if (iceState === 'disconnected' || iceState === 'failed' || connState === 'failed') {
          setIceConnected(false);
          if (connectedStartedRef.current) {
            if (relaySessionRef.current) {
              relaySessionRef.current.setPaused(false);
            } else {
              activateFreeVoiceRelay();
            }
          }
        }
      };

      pc.oniceconnectionstatechange = checkIceConnected;
      pc.onconnectionstatechange = checkIceConnected;

      return pc;
    },
    [activateFreeVoiceRelay, attachStreamsToElements, ensureRemoteAudioPlaying]
  );

  const drainIncomingIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !remoteDescSetRef.current) return;
    while (incomingIceQueueRef.current.length > 0) {
      const cand = incomingIceQueueRef.current.shift();
      if (!cand) continue;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        // Ignore stale/duplicate ICE candidates
      }
    }
  }, []);

  // Automatically start 100% free WebSocket Live Voice Relay backup if WebRTC P2P hasn't connected within 2.5s after pickup
  useEffect(() => {
    if (phase !== 'connected' || iceConnected) return;
    const timer = window.setTimeout(() => {
      if (!iceConnectedRef.current && !closingRef.current) {
        activateFreeVoiceRelay();
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [phase, iceConnected, activateFreeVoiceRelay]);

  // Firestore signaling listener — ONLY attaches once calls/{callId} exists (callDocReady === true)
  useEffect(() => {
    if (!callDocReady) return;
    const callId = activeCall.callId;
    const myUid = currentUser.uid;
    const dir = activeCall.direction;

    const unsubSession = subscribeCallSession(callId, (session) => {
      if (!session) return;
      if (session.offerSdp) {
        latestOfferSdpRef.current = session.offerSdp;
      }

      if (session.status === 'declined') {
        finishAndClose(t(langRef.current, 'callDeclined'), 1150);
        return;
      }
      if (session.status === 'ended') {
        finishAndClose(t(langRef.current, 'callEnded'), 1100);
        return;
      }
      if (session.status === 'missed') {
        finishAndClose(t(langRef.current, 'callMissed'), 1150);
        return;
      }

      if (dir === 'outgoing' && session.status === 'connected') {
        markCallConnected();

        const pc = pcRef.current;
        if (
          session.answerSdp &&
          pc &&
          !remoteDescSetRef.current &&
          !settingRemoteDescRef.current &&
          pc.signalingState === 'have-local-offer'
        ) {
          try {
            const answer = JSON.parse(session.answerSdp) as RTCSessionDescriptionInit;
            settingRemoteDescRef.current = true;
            pc.setRemoteDescription(new RTCSessionDescription(answer))
              .then(() => {
                remoteDescSetRef.current = true;
                settingRemoteDescRef.current = false;
                return drainIncomingIce();
              })
              .then(() => {
                ensureRemoteAudioPlaying();
                if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                  setIceConnected(true);
                }
              })
              .catch(() => {
                settingRemoteDescRef.current = false;
                // Fallback free voice relay will still carry audio seamlessly
                activateFreeVoiceRelay();
              });
          } catch {
            settingRemoteDescRef.current = false;
          }
        }
      }
    });

    const unsubCandidates = subscribeCallCandidates(callId, myUid, (cand) => {
      if (pcRef.current && remoteDescSetRef.current) {
        pcRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      } else {
        incomingIceQueueRef.current.push(cand);
      }
    });

    return () => {
      unsubSession();
      unsubCandidates();
    };
  }, [
    callDocReady,
    activeCall.callId,
    activeCall.direction,
    currentUser.uid,
    activateFreeVoiceRelay,
    drainIncomingIce,
    ensureRemoteAudioPlaying,
    finishAndClose,
    markCallConnected,
  ]);

  // Outgoing call initializer (keyed strictly by callId)
  useEffect(() => {
    const call = activeCallRef.current;
    const me = currentUserRef.current;

    if (call.direction !== 'outgoing') {
      startRingtone('incoming');
      return () => {
        stopRingtone();
      };
    }

    let cancelled = false;
    let missTimer: number | null = null;
    outgoingIceQueueRef.current = [];
    incomingIceQueueRef.current = [];
    remoteDescSetRef.current = false;
    settingRemoteDescRef.current = false;

    (async () => {
      try {
        await Promise.race([warmRtcConfig(), new Promise((r) => window.setTimeout(r, 250))]);
        if (cancelled) return;

        const stream = await acquireLocalMedia(call.mode, 'user');
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        const pc = createPeerConnection(stream);
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: call.mode === 'video',
        });
        await pc.setLocalDescription(offer);
        await waitForInitialIce(pc, 400);
        if (cancelled) {
          pc.close();
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }

        const offerSdpJson = serializeBoundedSdp(pc.localDescription, offer);

        await createCallSession({
          callId: call.callId,
          chatId: call.chatId,
          callerUid: me.uid,
          callerName: me.displayName,
          callerPhoto: me.photoUrl || '',
          calleeUid: call.peerUid,
          calleeName: call.peerName,
          calleePhoto: call.peerPhoto || '',
          mode: call.mode,
          offerSdp: offerSdpJson,
        });

        callDocCreatedRef.current = true;
        if (!cancelled) {
          setCallDocReady(true);
        }

        if (userEndedRef.current || cancelled || closingRef.current) {
          void updateCallStatus({ callId: call.callId, status: 'ended' });
          return;
        }

        while (outgoingIceQueueRef.current.length > 0) {
          const cand = outgoingIceQueueRef.current.shift();
          if (cand) {
            void sendCallCandidate({
              callId: call.callId,
              senderId: me.uid,
              candidate: cand,
            });
          }
        }

        if (!cancelled && !connectedStartedRef.current && !userEndedRef.current) {
          setPhase('ringing-outgoing');
          setStatusLabel(t(langRef.current, 'ringingPeer'));
          startRingtone('ringback');
          missTimer = window.setTimeout(() => {
            if (!closingRef.current && !connectedStartedRef.current && !userEndedRef.current) {
              void updateCallStatus({ callId: call.callId, status: 'missed' });
              finishAndClose(t(langRef.current, 'callMissed'), 1150);
            }
          }, 45_000);
        }
      } catch (err) {
        if (!cancelled) {
          stopRingtone();
          setErrorMsg(err instanceof Error ? err.message : 'Unable to start call.');
          setPhase('ended');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (missTimer !== null) window.clearTimeout(missTimer);
    };
  }, [activeCall.callId, acquireLocalMedia, createPeerConnection, finishAndClose]);

  // High-precision wall-clock call duration timer once connected
  useEffect(() => {
    if (phase !== 'connected') return;
    if (connectedAtMsRef.current === null) {
      connectedAtMsRef.current = Date.now();
    }
    const tick = () => {
      const secs = Math.max(
        0,
        Math.floor((Date.now() - (connectedAtMsRef.current ?? Date.now())) / 1000)
      );
      elapsedSecRef.current = secs;
      setElapsedSec(secs);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  // Passive WebRTC stats meter (checks real inbound/outbound audio bytes & audioLevel)
  useEffect(() => {
    if (phase !== 'connected') return;
    let disposed = false;

    const timerId = window.setInterval(async () => {
      if (disposed) return;
      let level = 0;
      let inboundAudioBytes = 0;
      const pc = pcRef.current;
      if (pc) {
        try {
          const stats = await pc.getStats();
          stats.forEach((report) => {
            const r = report as {
              type?: string;
              kind?: string;
              mediaType?: string;
              audioLevel?: number;
              bytesReceived?: number;
            };
            if (
              r.type === 'inbound-rtp' &&
              (r.kind === 'audio' || r.mediaType === 'audio')
            ) {
              if (typeof r.bytesReceived === 'number') {
                inboundAudioBytes = Math.max(inboundAudioBytes, r.bytesReceived);
              }
              if (typeof r.audioLevel === 'number') {
                level = Math.max(level, r.audioLevel);
              }
            } else if (
              r.type === 'media-source' &&
              (r.kind === 'audio' || typeof r.audioLevel === 'number')
            ) {
              level = Math.max(level, Number(r.audioLevel) || 0);
            }
          });
        } catch {
          // Ignore stats polling failures
        }
      }
      if (disposed) return;
      if (inboundAudioBytes > lastInboundBytesRef.current) {
        lastInboundBytesRef.current = inboundAudioBytes;
        setRemoteAudioFlowing(true);
        setIceConnected(true);
        relaySessionRef.current?.setPaused(true);
        ensureRemoteAudioPlaying();
      }
      if (level > 0.012) {
        const scaled = Math.min(1, 0.25 + level * 1.55);
        setVoiceBars([
          Math.max(0.22, scaled * 0.65),
          Math.max(0.3, scaled * 0.9),
          scaled,
          Math.max(0.3, scaled * 0.85),
          Math.max(0.22, scaled * 0.6),
        ]);
      } else if (!relaySessionRef.current || iceConnectedRef.current) {
        const tSec = Date.now() / 300;
        const base = (Math.sin(tSec) + 1) * 0.1 + 0.2;
        setVoiceBars([base * 0.85, base * 1.15, base * 1.25, base * 1.1, base * 0.8]);
      }
    }, 180);

    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, [phase, ensureRemoteAudioPlaying]);

  // Safety cleanup on unmount & abrupt browser tab close (pagehide) — StrictMode safe
  useEffect(() => {
    cleanedUpRef.current = false;
    const onPageHide = () => {
      if (!closingRef.current) {
        userEndedRef.current = true;
        if (callDocCreatedRef.current) {
          void updateCallStatus({ callId: activeCallRef.current.callId, status: 'ended' });
        }
      }
      teardownMediaAndPc();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      teardownMediaAndPc();
    };
  }, [teardownMediaAndPc]);

  const handleAcceptIncoming = async () => {
    unlockAudioNow();
    stopRingtone();
    setPhase('connecting');
    setStatusLabel(t(lang, 'connectingCall'));
    setErrorMsg('');

    try {
      await Promise.race([warmRtcConfig(), new Promise((r) => window.setTimeout(r, 200))]);
      const stream = await acquireLocalMedia(activeCall.mode, facingMode);
      const pc = createPeerConnection(stream);

      const offerRaw = latestOfferSdpRef.current;
      if (!offerRaw) {
        throw new Error('Call offer missing.');
      }
      const offer = JSON.parse(offerRaw) as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteDescSetRef.current = true;
      await drainIncomingIce();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForInitialIce(pc, 400);

      const answerSdpJson = serializeBoundedSdp(pc.localDescription, answer);
      await acceptCallSession({
        callId: activeCall.callId,
        answerSdp: answerSdpJson,
      });

      markCallConnected();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to answer call.');
      void updateCallStatus({ callId: activeCall.callId, status: 'ended' });
    }
  };

  const handleDeclineIncoming = () => {
    unlockAudioNow();
    userEndedRef.current = true;
    stopRingtone();
    void updateCallStatus({ callId: activeCall.callId, status: 'declined' });
    finishAndClose(t(lang, 'callDeclined'), 850);
  };

  const handleHangup = () => {
    userEndedRef.current = true;
    stopRingtone();
    if (callDocCreatedRef.current) {
      void updateCallStatus({ callId: activeCall.callId, status: 'ended' });
    }
    finishAndClose(t(lang, 'callEnded'), 1050);
  };

  const toggleMic = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextMuted = !micMuted;
    stream.getAudioTracks().forEach((tr) => {
      tr.enabled = !nextMuted && !onHold;
    });
    relaySessionRef.current?.setMuted(nextMuted || onHold);
    setMicMuted(nextMuted);
  };

  const toggleHold = () => {
    const nextHold = !onHold;
    setOnHold(nextHold);

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((tr) => {
        tr.enabled = !nextHold && !micMuted;
      });
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getAudioTracks().forEach((tr) => {
        tr.enabled = !nextHold;
      });
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = nextHold;
    }
    if (relaySessionRef.current) {
      relaySessionRef.current.setMuted(nextHold || micMuted);
      relaySessionRef.current.setPaused(nextHold || iceConnectedRef.current);
      relaySessionRef.current.sendHoldState(nextHold);
    }
  };

  const toggleSpeaker = async () => {
    const nextSpeaker = !speakerOn;
    setSpeakerOn(nextSpeaker);

    const audioEl = remoteAudioRef.current as
      | (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
      | null;
    if (audioEl) {
      audioEl.volume = nextSpeaker ? 1 : 0.42;
      if (typeof audioEl.setSinkId === 'function' && navigator.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const outputs = devices.filter((d) => d.kind === 'audiooutput');
          if (outputs.length > 1) {
            const preferred = nextSpeaker
              ? outputs.find((d) => /speaker|default|built-in/i.test(d.label)) || outputs[0]
              : outputs.find((d) => /earpiece|headphone|communications/i.test(d.label)) || outputs[0];
            if (preferred?.deviceId) {
              await audioEl.setSinkId(preferred.deviceId).catch(() => {});
            }
          }
        } catch {
          // Device enumeration unavailable; volume gain switch still applies cleanly
        }
      }
    }
    relaySessionRef.current?.setSpeakerMode(nextSpeaker);
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextOff = !camOff;
    stream.getVideoTracks().forEach((tr) => {
      tr.enabled = !nextOff;
    });
    setCamOff(nextOff);
  };

  const switchCamera = async () => {
    if (activeCall.mode !== 'video' || !pcRef.current || !localStreamRef.current) return;
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newVideoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const newTrack = newVideoStream.getVideoTracks()[0];
      if (!newTrack) return;

      const oldTrack = localStreamRef.current.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newTrack);
      }
      if (oldTrack) {
        oldTrack.stop();
        localStreamRef.current.removeTrack(oldTrack);
      }
      localStreamRef.current.addTrack(newTrack);
      newTrack.enabled = !camOff;
      setFacingMode(nextFacing);
      setHasLocalVideo(true);
      attachStreamsToElements();
    } catch {
      // Single camera device; ignore
    }
  };

  const handleUnlockAudioTap = () => {
    unlockAudioNow();
    ensureRemoteAudioPlaying();
    void relaySessionRef.current?.resumePlayback().then((ok) => {
      if (ok) setAudioPlaybackBlocked(false);
    });
  };

  const isVoiceLive = iceConnected || remoteAudioFlowing || relayPeerConnected;
  const subtitleText =
    phase === 'connected' ? formatDuration(elapsedSec) : errorMsg ? errorMsg : statusLabel;

  return (
    <div
      onPointerDown={() => {
        if (audioPlaybackBlocked) {
          handleUnlockAudioTap();
        }
      }}
    >
      {/* Always-mounted dedicated WebRTC audio sink */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        controls={false}
        className="fixed bottom-0 right-0 w-1 h-1 opacity-[0.001] pointer-events-none"
      />

      {minimized ? (
        <motion.div
          initial={{ opacity: 0, y: -14, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -14, scale: 0.92 }}
          className="fixed top-3 right-3 z-[60] max-w-[94vw] bg-slate-900 text-white border border-slate-700 rounded-2xl shadow-2xl px-3.5 py-2.5 flex items-center gap-3"
        >
          <UserAvatar
            name={activeCall.peerName}
            photoUrl={activeCall.peerPhoto}
            size="sm"
            isOnline={true}
            ringColorClass="ring-slate-900"
          />
          <div className="min-w-0">
            <div className="text-xs font-bold truncate max-w-[130px]">{activeCall.peerName}</div>
            <div className="text-[11px] text-emerald-400 font-mono-tabular flex items-center gap-1">
              {activeCall.mode === 'video' ? (
                <Video className="w-3 h-3" />
              ) : (
                <Phone className="w-3 h-3" />
              )}
              <span>{subtitleText}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {audioPlaybackBlocked && phase === 'connected' && (
              <button
                type="button"
                onClick={handleUnlockAudioTap}
                aria-label={t(lang, 'tapToEnableAudio')}
                className="min-h-[36px] px-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-semibold flex items-center gap-1"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={toggleMic}
              aria-label={micMuted ? t(lang, 'unmuteMic') : t(lang, 'muteMic')}
              className={`min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center transition-colors ${
                micMuted
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
              }`}
            >
              {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            {phase === 'connected' && (
              <button
                type="button"
                onClick={toggleHold}
                aria-label={onHold ? t(lang, 'resumeCall') : t(lang, 'holdCall')}
                className={`min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center transition-colors ${
                  onHold
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
                }`}
              >
                {onHold ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => setMinimized(false)}
              aria-label={t(lang, 'expandCall')}
              className="min-h-[36px] min-w-[36px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white flex items-center justify-center"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.9 }}
              onClick={handleHangup}
              aria-label={t(lang, 'endCall')}
              className="min-h-[36px] min-w-[36px] rounded-xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center"
            >
              <PhoneOff className="w-4 h-4" />
            </motion.button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] bg-slate-950 flex items-center justify-center p-0 sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 18 }}
            animate={
              phase === 'ended'
                ? { opacity: 0.94, scale: 0.94, y: 10 }
                : { opacity: 1, scale: 1, y: 0 }
            }
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative w-full h-[100dvh] sm:h-[88dvh] sm:max-h-[780px] sm:max-w-lg sm:rounded-3xl overflow-hidden bg-slate-950 border-0 sm:border sm:border-slate-800 shadow-2xl flex flex-col justify-between text-white"
          >
            {/* Dynamic Studio Accent Backdrop */}
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${
                onHold
                  ? 'bg-[radial-gradient(circle_at_50%_36%,rgba(245,158,11,0.22),transparent_62%)]'
                  : phase === 'connected'
                  ? 'bg-[radial-gradient(circle_at_50%_36%,rgba(16,185,129,0.24),transparent_62%)]'
                  : phase === 'ended'
                  ? 'bg-[radial-gradient(circle_at_50%_42%,rgba(239,68,68,0.25),transparent_58%)]'
                  : 'bg-[radial-gradient(circle_at_50%_38%,rgba(37,99,235,0.24),transparent_60%)]'
              }`}
            />

            {/* Top Bar */}
            <div className="relative z-20 px-4 pt-4 pb-3 flex items-center justify-between bg-gradient-to-b from-slate-950/95 via-slate-950/75 to-transparent">
              <div className="flex items-center gap-2.5 min-w-0">
                {phase !== 'ended' && (
                  <button
                    type="button"
                    onClick={() =>
                      phase === 'ringing-incoming' ? void handleDeclineIncoming() : setMinimized(true)
                    }
                    aria-label={t(lang, 'backBtn')}
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-white transition-colors shrink-0"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-white truncate">
                    {activeCall.mode === 'video' ? (
                      <Video className="w-4 h-4 text-blue-400 shrink-0" />
                    ) : (
                      <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                    <span>{t(lang, activeCall.mode === 'video' ? 'videoCall' : 'voiceCall')}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                    <ShieldCheck className="w-3 h-3 shrink-0" />
                    <span>{t(lang, 'encryptionActiveBadge')}</span>
                  </div>
                </div>
              </div>

              {phase !== 'ringing-incoming' && phase !== 'ended' && (
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  aria-label={t(lang, 'minimizeCall')}
                  className="min-h-[38px] px-3 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>{t(lang, 'minimizeCall')}</span>
                </button>
              )}
            </div>

            {/* Center Video / Voice Stage */}
            <div className="relative flex-1 flex items-center justify-center overflow-hidden px-6">
              {activeCall.mode === 'video' && (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                    hasRemoteVideo && phase === 'connected' ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                />
              )}

              {(!hasRemoteVideo || activeCall.mode === 'audio' || phase !== 'connected') && (
                <div className="relative z-10 flex flex-col items-center text-center space-y-5 max-w-xs">
                  <div className="relative flex items-center justify-center">
                    {(phase === 'ringing-incoming' || phase === 'ringing-outgoing') && (
                      <>
                        <motion.span
                          animate={{ scale: [1, 1.62], opacity: [0.65, 0] }}
                          transition={{ duration: 1.55, repeat: Infinity, ease: 'easeOut' }}
                          className="absolute inset-0 rounded-full border-2 border-emerald-400"
                        />
                        <motion.span
                          animate={{ scale: [1, 1.95], opacity: [0.45, 0] }}
                          transition={{
                            duration: 1.55,
                            delay: 0.45,
                            repeat: Infinity,
                            ease: 'easeOut',
                          }}
                          className="absolute inset-0 rounded-full border-2 border-blue-400"
                        />
                      </>
                    )}

                    <AnimatePresence>
                      {pickupBurstKey > 0 && phase === 'connected' && (
                        <>
                          <motion.span
                            key={`pickup-ring-1-${pickupBurstKey}`}
                            initial={{ scale: 0.85, opacity: 0.9 }}
                            animate={{ scale: 2.35, opacity: 0 }}
                            transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
                            className="pointer-events-none absolute inset-0 rounded-full border-[3px] border-emerald-400"
                          />
                          <motion.span
                            key={`pickup-ring-2-${pickupBurstKey}`}
                            initial={{ scale: 0.9, opacity: 0.7 }}
                            animate={{ scale: 1.9, opacity: 0 }}
                            transition={{ duration: 0.65, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                            className="pointer-events-none absolute inset-0 rounded-full bg-emerald-400/20"
                          />
                        </>
                      )}
                    </AnimatePresence>

                    {phase === 'ended' && (
                      <motion.span
                        initial={{ scale: 1.4, opacity: 0.75 }}
                        animate={{ scale: 0.85, opacity: 0 }}
                        transition={{ duration: 0.65, ease: 'easeOut' }}
                        className="pointer-events-none absolute inset-0 rounded-full border-2 border-red-500 bg-red-500/20"
                      />
                    )}

                    <motion.div
                      key={phase}
                      initial={
                        phase === 'connected'
                          ? { scale: 0.86 }
                          : phase === 'ended'
                          ? { scale: 1.06 }
                          : false
                      }
                      animate={
                        phase === 'connected'
                          ? { scale: [0.86, 1.08, 1] }
                          : phase === 'ended'
                          ? { scale: 0.92, filter: 'grayscale(35%)' }
                          : { scale: 1 }
                      }
                      transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                      className="relative"
                    >
                      <UserAvatar
                        name={activeCall.peerName}
                        photoUrl={activeCall.peerPhoto}
                        size="xl"
                        isOnline={phase !== 'ended'}
                        ringColorClass="ring-slate-950"
                        className="w-24 h-24"
                      />
                      {phase === 'ended' && (
                        <motion.div
                          initial={{ scale: 0, rotate: -45 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                          className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-red-600 text-white flex items-center justify-center ring-4 ring-slate-950 shadow-lg"
                        >
                          <PhoneOff className="w-4 h-4" />
                        </motion.div>
                      )}
                    </motion.div>
                  </div>

                  <div className="space-y-2">
                    <h2 className="font-display text-2xl font-bold text-white break-words">
                      {activeCall.peerName}
                    </h2>

                    {phase === 'connected' ? (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.92 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 24 }}
                        className="flex flex-col items-center gap-2.5"
                      >
                        <div
                          className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-sm font-bold font-mono-tabular ${
                            onHold || peerOnHold
                              ? 'bg-amber-500/15 border-amber-400/45 text-amber-300'
                              : 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              onHold || peerOnHold ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
                            }`}
                          />
                          <span>{formatDuration(elapsedSec)}</span>
                          {(onHold || peerOnHold) && (
                            <span className="text-[11px] font-sans font-semibold uppercase tracking-wide">
                              · {onHold ? t(lang, 'callOnHoldBadge') : t(lang, 'peerOnHoldBadge')}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-white/85">
                          <div className="flex items-end gap-1 h-4" aria-hidden="true">
                            {voiceBars.map((level, i) => (
                              <motion.span
                                key={i}
                                animate={{
                                  height:
                                    onHold || peerOnHold
                                      ? '4px'
                                      : `${Math.round(level * 16)}px`,
                                }}
                                transition={{ duration: 0.09 }}
                                className={`w-1 rounded-full ${
                                  onHold || peerOnHold
                                    ? 'bg-amber-400'
                                    : isVoiceLive
                                    ? 'bg-emerald-400'
                                    : 'bg-blue-400'
                                }`}
                              />
                            ))}
                          </div>
                          <span>
                            {onHold
                              ? t(lang, 'callOnHoldBadge')
                              : peerOnHold
                              ? t(lang, 'peerOnHoldBadge')
                              : micMuted
                              ? t(lang, 'micMutedBadge')
                              : errorMsg
                              ? errorMsg
                              : isVoiceLive
                              ? t(lang, 'hdAudioLive')
                              : t(lang, 'connectingAudioNote')}
                          </span>
                        </div>
                      </motion.div>
                    ) : phase === 'ended' ? (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-1.5"
                      >
                        <p className="text-sm font-semibold text-red-400">{statusLabel}</p>
                        {finalDurationSec > 0 && (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 text-xs font-mono-tabular text-white/85">
                            <span>{t(lang, 'callDurationSummary')}:</span>
                            <span className="font-semibold text-white">
                              {formatDuration(finalDurationSec)}
                            </span>
                          </div>
                        )}
                      </motion.div>
                    ) : (
                      <p
                        className={`text-sm font-medium font-mono-tabular ${
                          errorMsg ? 'text-red-400' : 'text-blue-300'
                        }`}
                      >
                        {subtitleText}
                      </p>
                    )}

                    {audioPlaybackBlocked && phase === 'connected' && (
                      <motion.button
                        type="button"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        whileTap={{ scale: 0.94 }}
                        onClick={handleUnlockAudioTap}
                        className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold shadow-lg"
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>{t(lang, 'tapToEnableAudio')}</span>
                      </motion.button>
                    )}
                  </div>
                </div>
              )}

              {hasRemoteVideo && phase === 'connected' && activeCall.mode === 'video' && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-full bg-slate-900 border border-slate-700 text-xs font-mono-tabular text-white flex items-center gap-2"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-semibold truncate max-w-[140px]">{activeCall.peerName}</span>
                  <span className="text-emerald-300 font-semibold">{formatDuration(elapsedSec)}</span>
                </motion.div>
              )}

              {audioPlaybackBlocked && hasRemoteVideo && phase === 'connected' && (
                <button
                  type="button"
                  onClick={handleUnlockAudioTap}
                  className="absolute top-14 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-semibold shadow-lg"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>{t(lang, 'tapToEnableAudio')}</span>
                </button>
              )}

              {activeCall.mode === 'video' && hasLocalVideo && !camOff && (
                <div className="absolute bottom-4 right-4 z-20 w-28 sm:w-32 aspect-[3/4] rounded-2xl overflow-hidden border-2 border-slate-600 bg-slate-900 shadow-xl">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${
                      facingMode === 'user' ? '-scale-x-100' : ''
                    }`}
                  />
                </div>
              )}
            </div>

            {/* Bottom Controls Dock */}
            <div className="relative z-20 px-5 pt-4 pb-8 sm:pb-6 bg-gradient-to-t from-black/95 via-black/75 to-transparent">
              {errorMsg && phase === 'ended' ? (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      teardownMediaAndPc();
                      onClose();
                    }}
                    className="min-h-[48px] px-8 rounded-2xl bg-white text-slate-900 font-semibold text-sm"
                  >
                    {t(lang, 'cancel')}
                  </button>
                </div>
              ) : phase === 'ended' ? (
                <div className="h-[52px]" />
              ) : phase === 'ringing-incoming' ? (
                <div className="flex items-center justify-center gap-10">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.06, rotate: -6 }}
                    whileTap={{ scale: 0.88 }}
                    onClick={handleDeclineIncoming}
                    className="flex flex-col items-center gap-2"
                  >
                    <span className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg shadow-red-600/35 transition-colors">
                      <PhoneOff className="w-7 h-7" />
                    </span>
                    <span className="text-xs font-medium text-white/90">{t(lang, 'declineCall')}</span>
                  </motion.button>

                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.86 }}
                    onClick={() => void handleAcceptIncoming()}
                    className="relative flex flex-col items-center gap-2"
                  >
                    <motion.span
                      animate={{
                        scale: [1, 1.12, 1],
                        boxShadow: [
                          '0 0 0 0 rgba(16, 185, 129, 0.5)',
                          '0 0 0 14px rgba(16, 185, 129, 0)',
                          '0 0 0 0 rgba(16, 185, 129, 0)',
                        ],
                      }}
                      transition={{ duration: 1.25, repeat: Infinity }}
                      className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-500/35"
                    >
                      {activeCall.mode === 'video' ? (
                        <Video className="w-7 h-7" />
                      ) : (
                        <PhoneIncoming className="w-7 h-7" />
                      )}
                    </motion.span>
                    <span className="text-xs font-medium text-white/90">{t(lang, 'acceptCall')}</span>
                  </motion.button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2.5 sm:gap-3 flex-wrap">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.91 }}
                    onClick={toggleMic}
                    aria-label={micMuted ? t(lang, 'unmuteMic') : t(lang, 'muteMic')}
                    className={`min-h-[56px] min-w-[60px] px-3 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors border ${
                      micMuted
                        ? 'bg-amber-500 border-amber-400 text-slate-950'
                        : 'bg-slate-900 border-slate-700 hover:bg-slate-800 text-white'
                    }`}
                  >
                    {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    <span className="text-[10px] font-semibold whitespace-nowrap">
                      {micMuted ? t(lang, 'unmuteMic') : t(lang, 'muteMic')}
                    </span>
                  </motion.button>

                  {phase === 'connected' && (
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.91 }}
                      onClick={toggleHold}
                      aria-label={onHold ? t(lang, 'resumeCall') : t(lang, 'holdCall')}
                      className={`min-h-[56px] min-w-[60px] px-3 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors border ${
                        onHold
                          ? 'bg-amber-500 border-amber-400 text-slate-950'
                          : 'bg-slate-900 border-slate-700 hover:bg-slate-800 text-white'
                      }`}
                    >
                      {onHold ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                      <span className="text-[10px] font-semibold whitespace-nowrap">
                        {onHold ? t(lang, 'resumeCall') : t(lang, 'holdCall')}
                      </span>
                    </motion.button>
                  )}

                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.91 }}
                    onClick={() => void toggleSpeaker()}
                    aria-label={speakerOn ? t(lang, 'speakerOnLabel') : t(lang, 'speakerOffLabel')}
                    className={`min-h-[56px] min-w-[60px] px-3 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors border ${
                      speakerOn
                        ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-600/30'
                        : 'bg-slate-900 border-slate-700 hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    {speakerOn ? <Volume2 className="w-5 h-5" /> : <Volume1 className="w-5 h-5" />}
                    <span className="text-[10px] font-semibold whitespace-nowrap">
                      {speakerOn ? t(lang, 'speakerOnLabel') : t(lang, 'speakerOffLabel')}
                    </span>
                  </motion.button>

                  {activeCall.mode === 'video' && (
                    <>
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.91 }}
                        onClick={toggleCamera}
                        aria-label={camOff ? t(lang, 'cameraOn') : t(lang, 'cameraOff')}
                        className={`min-h-[56px] min-w-[60px] px-3 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors border ${
                          camOff
                            ? 'bg-amber-500 border-amber-400 text-slate-950'
                            : 'bg-slate-900 border-slate-700 hover:bg-slate-800 text-white'
                        }`}
                      >
                        {camOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                        <span className="text-[10px] font-semibold whitespace-nowrap">
                          {camOff ? t(lang, 'cameraOn') : t(lang, 'cameraOff')}
                        </span>
                      </motion.button>

                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.91 }}
                        onClick={() => void switchCamera()}
                        aria-label={t(lang, 'switchCamera')}
                        className="min-h-[56px] min-w-[60px] px-3 rounded-2xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-white flex flex-col items-center justify-center gap-1 transition-colors"
                      >
                        <RefreshCw className="w-5 h-5" />
                        <span className="text-[10px] font-semibold whitespace-nowrap">
                          {t(lang, 'switchCamera')}
                        </span>
                      </motion.button>
                    </>
                  )}

                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.88, rotate: -12 }}
                    onClick={handleHangup}
                    aria-label={t(lang, 'endCall')}
                    className="min-h-[56px] min-w-[68px] px-5 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex flex-col items-center justify-center gap-1 shadow-lg shadow-red-600/35 transition-colors"
                  >
                    <PhoneOff className="w-5 h-5" />
                    <span className="text-[10px] font-semibold whitespace-nowrap">
                      {t(lang, 'endCall')}
                    </span>
                  </motion.button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
};
