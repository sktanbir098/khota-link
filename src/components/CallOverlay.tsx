import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneIncoming,
  PhoneOff,
  RefreshCw,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import {
  acceptCallSession,
  CALL_RTC_CONFIG,
  createCallSession,
  sendCallCandidate,
  subscribeCallCandidates,
  subscribeCallSession,
  updateCallStatus,
} from '../lib/callService';
import { t } from '../lib/i18n';
import {
  playCallHangupTone,
  startRingtone,
  stopRingtone,
  suspendAudioForCall,
  unlockAudioNow,
} from '../lib/sound';
import { AppLanguage, CallMode, CallSession, UserPublicProfile } from '../types/chat';
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
  const [camOff, setCamOff] = useState(activeCall.mode === 'audio');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [minimized, setMinimized] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [finalDurationSec, setFinalDurationSec] = useState(0);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [hasLocalVideo, setHasLocalVideo] = useState(false);
  const [hasRemoteAudio, setHasRemoteAudio] = useState(false);
  const [iceConnected, setIceConnected] = useState(false);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [pickupBurstKey, setPickupBurstKey] = useState(0);
  const [voiceBars, setVoiceBars] = useState<number[]>([0.25, 0.45, 0.65, 0.45, 0.25]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const callDocCreatedRef = useRef(activeCall.direction === 'incoming');
  const outgoingIceQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSetRef = useRef(false);
  const incomingIceQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const latestOfferSdpRef = useRef<string>(activeCall.initialSession?.offerSdp || '');
  const cleanedUpRef = useRef(false);
  const closingRef = useRef(false);
  const userEndedRef = useRef(false);
  const connectedStartedRef = useRef(false);
  const connectedAtMsRef = useRef<number | null>(null);
  const elapsedSecRef = useRef(0);
  const iceRestartTimerRef = useRef<number | null>(null);

  // Keep latest props/callbacks in refs so media & signaling effects never restart mid-call
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const langRef = useRef(lang);
  langRef.current = lang;
  const activeCallRef = useRef(activeCall);
  activeCallRef.current = activeCall;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const ensureRemoteAudioPlaying = useCallback(() => {
    const audioEl = remoteAudioRef.current;
    const remoteStream = remoteStreamRef.current;
    if (!audioEl || !remoteStream) return;

    if (audioEl.srcObject !== remoteStream) {
      audioEl.srcObject = remoteStream;
    }
    audioEl.muted = false;
    audioEl.volume = 1;

    if (remoteStream.getAudioTracks().length > 0) {
      const p = audioEl.play();
      if (p) {
        p.then(() => {
          setAudioPlaybackBlocked(false);
        }).catch(() => {
          setAudioPlaybackBlocked(true);
        });
      }
    }
  }, []);

  const attachStreamsToElements = useCallback(() => {
    if (localVideoRef.current && localStreamRef.current) {
      if (localVideoRef.current.srcObject !== localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      localVideoRef.current.play().catch(() => {});
    }
    if (remoteStreamRef.current) {
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
        remoteVideoRef.current.play().catch(() => {});
      }
      ensureRemoteAudioPlaying();
    }
  }, [ensureRemoteAudioPlaying]);

  useEffect(() => {
    attachStreamsToElements();
  }, [minimized, phase, hasRemoteVideo, hasLocalVideo, hasRemoteAudio, attachStreamsToElements]);

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
    if (iceRestartTimerRef.current !== null) {
      window.clearTimeout(iceRestartTimerRef.current);
      iceRestartTimerRef.current = null;
    }
    if (cleanedUpRef.current) return;
    cleanedUpRef.current = true;
    stopRingtone();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((tr) => tr.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((tr) => tr.stop());
      remoteStreamRef.current = null;
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
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
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
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          if (mode === 'video') {
            try {
              const audioOnly = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
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
      const pc = new RTCPeerConnection(CALL_RTC_CONFIG);
      pcRef.current = pc;

      const remoteStream = new MediaStream();
      remoteStreamRef.current = remoteStream;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        const track = event.track;
        if (track) {
          track.enabled = true;
          track.onunmute = () => {
            ensureRemoteAudioPlaying();
          };
          if (!remoteStream.getTracks().some((existing) => existing.id === track.id)) {
            remoteStream.addTrack(track);
          }
        }
        if (event.streams && event.streams[0]) {
          event.streams[0].getTracks().forEach((tr) => {
            tr.enabled = true;
            tr.onunmute = () => {
              ensureRemoteAudioPlaying();
            };
            if (!remoteStream.getTracks().some((existing) => existing.id === tr.id)) {
              remoteStream.addTrack(tr);
            }
          });
        }
        if (remoteStream.getVideoTracks().length > 0) {
          setHasRemoteVideo(true);
        }
        if (remoteStream.getAudioTracks().length > 0) {
          setHasRemoteAudio(true);
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

      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState;
        if (iceState === 'connected' || iceState === 'completed') {
          setIceConnected(true);
          if (iceRestartTimerRef.current !== null) {
            window.clearTimeout(iceRestartTimerRef.current);
            iceRestartTimerRef.current = null;
          }
          ensureRemoteAudioPlaying();
          if (connectedStartedRef.current) {
            setPhase('connected');
            setStatusLabel(t(langRef.current, 'callConnected'));
          }
        } else if (iceState === 'disconnected') {
          setIceConnected(false);
          if (iceRestartTimerRef.current === null) {
            iceRestartTimerRef.current = window.setTimeout(() => {
              iceRestartTimerRef.current = null;
              if (pcRef.current && pcRef.current.iceConnectionState === 'disconnected') {
                pcRef.current.restartIce?.();
              }
            }, 3000);
          }
        } else if (iceState === 'failed') {
          setIceConnected(false);
          pc.restartIce?.();
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'connected') {
          setIceConnected(true);
          markCallConnected();
        } else if (state === 'failed') {
          setIceConnected(false);
          setErrorMsg(
            langRef.current === 'bn' ? 'সংযোগ বিচ্ছিন্ন হয়েছে' : 'Network connection lost'
          );
        }
      };

      return pc;
    },
    [attachStreamsToElements, ensureRemoteAudioPlaying, markCallConnected]
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

  // Firestore signaling listener (handles accept -> caller timer start + remote hangup)
  useEffect(() => {
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

      // When callee accepts, caller immediately leaves Ringing, stops ringback, plays pickup wave & starts live timer!
      if (dir === 'outgoing' && session.status === 'connected') {
        markCallConnected();

        if (session.answerSdp && pcRef.current && !remoteDescSetRef.current) {
          try {
            const answer = JSON.parse(session.answerSdp) as RTCSessionDescriptionInit;
            pcRef.current
              .setRemoteDescription(new RTCSessionDescription(answer))
              .then(() => {
                remoteDescSetRef.current = true;
                return drainIncomingIce();
              })
              .then(() => {
                ensureRemoteAudioPlaying();
              })
              .catch(() => {
                setErrorMsg(
                  langRef.current === 'bn'
                    ? 'কল সংযোগ করতে ব্যর্থ হয়েছে'
                    : 'Failed to connect call audio/video.'
                );
              });
          } catch {
            // Ignore malformed answer
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
    activeCall.callId,
    activeCall.direction,
    currentUser.uid,
    drainIncomingIce,
    ensureRemoteAudioPlaying,
    finishAndClose,
    markCallConnected,
  ]);

  // Outgoing call initializer (keyed strictly by callId so UI updates never abort offer creation)
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

    (async () => {
      try {
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
        if (cancelled) return;

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
          offerSdp: JSON.stringify(offer),
        });

        callDocCreatedRef.current = true;
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

  // Passive WebRTC stats meter (never uses createMediaStreamSource so <audio> playback stays crystal clear)
  useEffect(() => {
    if (phase !== 'connected') return;
    let disposed = false;

    const timerId = window.setInterval(async () => {
      if (disposed) return;
      let level = 0;
      const pc = pcRef.current;
      if (pc) {
        try {
          const stats = await pc.getStats();
          stats.forEach((report) => {
            const r = report as { type?: string; kind?: string; audioLevel?: number };
            if (
              (r.type === 'inbound-rtp' || r.type === 'media-source') &&
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
      if (level > 0.015) {
        const scaled = Math.min(1, 0.25 + level * 1.45);
        setVoiceBars([
          Math.max(0.22, scaled * 0.65),
          Math.max(0.3, scaled * 0.9),
          scaled,
          Math.max(0.3, scaled * 0.85),
          Math.max(0.22, scaled * 0.6),
        ]);
      } else {
        const tSec = Date.now() / 260;
        const base = (Math.sin(tSec) + 1) * 0.14 + 0.22;
        setVoiceBars([base * 0.85, base * 1.15, base * 1.3, base * 1.1, base * 0.8]);
      }
    }, 150);

    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, [phase]);

  // Safety cleanup on unmount & abrupt browser tab close (pagehide)
  useEffect(() => {
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

    // Prime remoteAudioRef directly inside user gesture to bypass mobile autoplay restrictions
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.volume = 1;
      remoteAudioRef.current.play().catch(() => {});
    }

    try {
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
      await acceptCallSession({
        callId: activeCall.callId,
        answerSdp: JSON.stringify(answer),
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
      tr.enabled = !nextMuted;
    });
    setMicMuted(nextMuted);
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

  const subtitleText =
    phase === 'connected' ? formatDuration(elapsedSec) : errorMsg ? errorMsg : statusLabel;

  return (
    <>
      {/* Always-mounted, in-viewport WebRTC audio sink so mobile Chrome/Safari plays voice clearly */}
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
          className="fixed top-3 right-3 z-[60] max-w-[92vw] bg-slate-900/95 text-white border border-white/20 rounded-2xl shadow-2xl px-3.5 py-2.5 flex items-center gap-3"
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
            <button
              type="button"
              onClick={toggleMic}
              aria-label={micMuted ? t(lang, 'unmuteMic') : t(lang, 'muteMic')}
              className={`min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center transition-colors ${
                micMuted ? 'bg-amber-500 text-slate-950' : 'bg-white/15 hover:bg-white/25 text-white border border-white/15'
              }`}
            >
              {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setMinimized(false)}
              aria-label={t(lang, 'expandCall')}
              className="min-h-[36px] min-w-[36px] rounded-xl bg-white/15 hover:bg-white/25 border border-white/15 text-white flex items-center justify-center"
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
          className="fixed inset-0 z-[60] bg-slate-950/95 flex items-center justify-center p-0 sm:p-4"
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
            className="relative w-full h-[100dvh] sm:h-[86dvh] sm:max-h-[760px] sm:max-w-lg sm:rounded-3xl overflow-hidden bg-gradient-to-b from-slate-900/95 via-slate-950/95 to-black/95 border-0 sm:border sm:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_24px_64px_rgba(0,0,0,0.5)] flex flex-col justify-between text-white"
          >
            {/* Dynamic Ambient Backdrop Glow based on Call State */}
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${
                phase === 'connected'
                  ? 'bg-[radial-gradient(circle_at_50%_38%,rgba(16,185,129,0.22),transparent_60%)]'
                  : phase === 'ended'
                  ? 'bg-[radial-gradient(circle_at_50%_42%,rgba(239,68,68,0.25),transparent_58%)]'
                  : 'bg-[radial-gradient(circle_at_50%_38%,rgba(37,99,235,0.22),transparent_60%)]'
              }`}
            />

            {/* Top Bar with Top-Left Back/Minimize Button */}
            <div className="relative z-20 px-4 pt-4 pb-3 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent">
              <div className="flex items-center gap-2.5 min-w-0">
                {phase !== 'ended' && (
                  <button
                    type="button"
                    onClick={() =>
                      phase === 'ringing-incoming' ? void handleDeclineIncoming() : setMinimized(true)
                    }
                    aria-label={t(lang, 'backBtn')}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors shrink-0"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <div className="flex items-center gap-2 text-xs font-semibold text-white/85 truncate">
                  {activeCall.mode === 'video' ? (
                    <Video className="w-4 h-4 text-blue-400 shrink-0" />
                  ) : (
                    <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
                  )}
                  <span>{t(lang, activeCall.mode === 'video' ? 'videoCall' : 'voiceCall')}</span>
                </div>
              </div>

              {phase !== 'ringing-incoming' && phase !== 'ended' && (
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  aria-label={t(lang, 'minimizeCall')}
                  className="min-h-[36px] px-3 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>{t(lang, 'minimizeCall')}</span>
                </button>
              )}
            </div>

            {/* Center Video / Voice Stage */}
            <div className="relative flex-1 flex items-center justify-center overflow-hidden px-6">
              {/* Remote Video Feed (muted so remoteAudioRef handles all audio cleanly with zero echo) */}
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

              {/* Ringing / Connected Voice / Hangup Stage */}
              {(!hasRemoteVideo || activeCall.mode === 'audio' || phase !== 'connected') && (
                <div className="relative z-10 flex flex-col items-center text-center space-y-5 max-w-xs">
                  <div className="relative flex items-center justify-center">
                    {/* Ringing Ripples */}
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

                    {/* Cool Pick-Up Sonic Shockwave Burst */}
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

                    {/* Cool Hang-Up Crimson Collapse Wave */}
                    {phase === 'ended' && (
                      <>
                        <motion.span
                          initial={{ scale: 1.4, opacity: 0.75 }}
                          animate={{ scale: 0.85, opacity: 0 }}
                          transition={{ duration: 0.65, ease: 'easeOut' }}
                          className="pointer-events-none absolute inset-0 rounded-full border-2 border-red-500 bg-red-500/20"
                        />
                      </>
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

                    {/* Live Animated Connected Timer + Voice Equalizer Bars */}
                    {phase === 'connected' ? (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.92 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 24 }}
                        className="flex flex-col items-center gap-2.5"
                      >
                        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/35 text-emerald-300 text-sm font-semibold font-mono-tabular">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <span>{formatDuration(elapsedSec)}</span>
                        </div>

                        {/* Real Live Audio Equalizer Bars */}
                        <div className="flex items-center gap-2 text-[11px] text-white/75">
                          <div className="flex items-end gap-1 h-4" aria-hidden="true">
                            {voiceBars.map((level, i) => (
                              <motion.span
                                key={i}
                                animate={{ height: `${Math.round(level * 16)}px` }}
                                transition={{ duration: 0.09 }}
                                className="w-1 rounded-full bg-emerald-400"
                              />
                            ))}
                          </div>
                          <span>
                            {micMuted
                              ? t(lang, 'micMutedBadge')
                              : iceConnected || hasRemoteAudio
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
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-xs font-mono-tabular text-white/80">
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

                    {/* Autoplay fallback unlock button ONLY if browser explicitly blocked remote <audio>.play() */}
                    {audioPlaybackBlocked && phase === 'connected' && (
                      <motion.button
                        type="button"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        whileTap={{ scale: 0.94 }}
                        onClick={() => {
                          unlockAudioNow();
                          ensureRemoteAudioPlaying();
                        }}
                        className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold shadow-lg"
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>{t(lang, 'tapToEnableAudio')}</span>
                      </motion.button>
                    )}
                  </div>
                </div>
              )}

              {/* Floating Timer Pill over Remote Video */}
              {hasRemoteVideo && phase === 'connected' && activeCall.mode === 'video' && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-full bg-black/75 border border-white/15 text-xs font-mono-tabular text-white flex items-center gap-2"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-semibold truncate max-w-[140px]">{activeCall.peerName}</span>
                  <span className="text-emerald-300 font-semibold">{formatDuration(elapsedSec)}</span>
                </motion.div>
              )}

              {/* Floating Audio Enable Fallback over Video */}
              {audioPlaybackBlocked && hasRemoteVideo && phase === 'connected' && (
                <button
                  type="button"
                  onClick={() => {
                    unlockAudioNow();
                    ensureRemoteAudioPlaying();
                  }}
                  className="absolute top-14 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-semibold shadow-lg"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>{t(lang, 'tapToEnableAudio')}</span>
                </button>
              )}

              {/* Local Self-View PiP for Video Calls */}
              {activeCall.mode === 'video' && hasLocalVideo && !camOff && (
                <div className="absolute bottom-4 right-4 z-20 w-28 sm:w-32 aspect-[3/4] rounded-2xl overflow-hidden border-2 border-white/25 bg-slate-900 shadow-xl">
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
            <div className="relative z-20 px-5 pt-4 pb-8 sm:pb-6 bg-gradient-to-t from-black/90 via-black/65 to-transparent">
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
                <div className="flex items-center justify-center gap-3 sm:gap-4 flex-wrap">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    onClick={toggleMic}
                    aria-label={micMuted ? t(lang, 'unmuteMic') : t(lang, 'muteMic')}
                    className={`min-h-[52px] min-w-[52px] px-3.5 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors border ${
                      micMuted
                        ? 'bg-amber-500 border-amber-400 text-slate-950'
                        : 'bg-slate-800/90 border-white/20 hover:bg-slate-700 text-white'
                    }`}
                  >
                    {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    <span className="text-[10px] font-medium whitespace-nowrap">
                      {micMuted ? t(lang, 'unmuteMic') : t(lang, 'muteMic')}
                    </span>
                  </motion.button>

                  {activeCall.mode === 'video' && (
                    <>
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.9 }}
                        onClick={toggleCamera}
                        aria-label={camOff ? t(lang, 'cameraOn') : t(lang, 'cameraOff')}
                        className={`min-h-[52px] min-w-[52px] px-3.5 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors border ${
                          camOff
                            ? 'bg-amber-500 border-amber-400 text-slate-950'
                            : 'bg-slate-800/90 border-white/20 hover:bg-slate-700 text-white'
                        }`}
                      >
                        {camOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                        <span className="text-[10px] font-medium whitespace-nowrap">
                          {camOff ? t(lang, 'cameraOn') : t(lang, 'cameraOff')}
                        </span>
                      </motion.button>

                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.9 }}
                        onClick={() => void switchCamera()}
                        aria-label={t(lang, 'switchCamera')}
                        className="min-h-[52px] min-w-[52px] px-3.5 rounded-2xl bg-slate-800/90 border border-white/20 hover:bg-slate-700 text-white flex flex-col items-center justify-center gap-1 transition-colors"
                      >
                        <RefreshCw className="w-5 h-5" />
                        <span className="text-[10px] font-medium whitespace-nowrap">
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
                    className="min-h-[52px] min-w-[64px] px-5 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex flex-col items-center justify-center gap-1 shadow-lg shadow-red-600/35 transition-colors"
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
    </>
  );
};
