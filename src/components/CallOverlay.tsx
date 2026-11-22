import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
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
import { playSentPop, startRingtone, stopRingtone, unlockAudioNow } from '../lib/sound';
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
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [hasLocalVideo, setHasLocalVideo] = useState(false);

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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
      if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== remoteStreamRef.current) {
        remoteAudioRef.current.srcObject = remoteStreamRef.current;
        remoteAudioRef.current.play().catch(() => {});
      }
    }
  }, []);

  useEffect(() => {
    attachStreamsToElements();
  }, [minimized, phase, hasRemoteVideo, hasLocalVideo, attachStreamsToElements]);

  const teardownMediaAndPc = useCallback(() => {
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
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
  }, []);

  const finishAndClose = useCallback(
    (label: string, delayMs = 950) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setPhase('ended');
      setStatusLabel(label);
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
        throw new Error(t(lang, 'noMediaDevice'));
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video:
            mode === 'video'
              ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }
              : false,
        });
        localStreamRef.current = stream;
        setHasLocalVideo(stream.getVideoTracks().length > 0);
        setCamOff(stream.getVideoTracks().length === 0);
        attachStreamsToElements();
        return stream;
      } catch (err) {
        const name = (err as { name?: string })?.name || '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          throw new Error(t(lang, 'mediaPermDenied'));
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          // If camera not found during video call, try audio-only fallback gracefully
          if (mode === 'video') {
            try {
              const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
              localStreamRef.current = audioOnly;
              setHasLocalVideo(false);
              setCamOff(true);
              return audioOnly;
            } catch {
              throw new Error(t(lang, 'noMediaDevice'));
            }
          }
          throw new Error(t(lang, 'noMediaDevice'));
        }
        throw err instanceof Error ? err : new Error(t(lang, 'mediaPermDenied'));
      }
    },
    [attachStreamsToElements, lang]
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
        const incomingStreams = event.streams;
        if (incomingStreams && incomingStreams[0]) {
          incomingStreams[0].getTracks().forEach((tr) => {
            if (!remoteStream.getTracks().some((existing) => existing.id === tr.id)) {
              remoteStream.addTrack(tr);
            }
          });
        } else if (event.track) {
          remoteStream.addTrack(event.track);
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
            callId: activeCall.callId,
            senderId: currentUser.uid,
            candidate: json,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'connected') {
          stopRingtone();
          setPhase('connected');
          setStatusLabel(t(lang, 'callConnected'));
        } else if (state === 'failed') {
          setErrorMsg(lang === 'bn' ? 'সংযোগ বিচ্ছিন্ন হয়েছে' : 'Connection lost');
        }
      };

      return pc;
    },
    [activeCall.callId, attachStreamsToElements, currentUser.uid, lang]
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

  // Setup Firestore listeners for CallSession & ICE Candidates
  useEffect(() => {
    const unsubSession = subscribeCallSession(activeCall.callId, (session) => {
      if (!session) return;
      if (session.offerSdp) {
        latestOfferSdpRef.current = session.offerSdp;
      }

      if (session.status === 'declined') {
        finishAndClose(t(lang, 'callDeclined'), 1100);
        return;
      }
      if (session.status === 'ended') {
        finishAndClose(t(lang, 'callEnded'), 950);
        return;
      }
      if (session.status === 'missed') {
        finishAndClose(t(lang, 'callMissed'), 1100);
        return;
      }

      if (
        activeCall.direction === 'outgoing' &&
        session.status === 'connected' &&
        session.answerSdp &&
        pcRef.current &&
        !remoteDescSetRef.current
      ) {
        stopRingtone();
        setPhase('connected');
        setStatusLabel(t(lang, 'callConnected'));
        try {
          const answer = JSON.parse(session.answerSdp) as RTCSessionDescriptionInit;
          pcRef.current
            .setRemoteDescription(new RTCSessionDescription(answer))
            .then(() => {
              remoteDescSetRef.current = true;
              return drainIncomingIce();
            })
            .catch(() => {
              setErrorMsg(lang === 'bn' ? 'কল সংযোগ করতে ব্যর্থ হয়েছে' : 'Failed to connect call audio/video.');
            });
        } catch {
          // Ignore malformed answer
        }
      }
    });

    const unsubCandidates = subscribeCallCandidates(activeCall.callId, currentUser.uid, (cand) => {
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
  }, [activeCall.callId, activeCall.direction, currentUser.uid, drainIncomingIce, finishAndClose, lang]);

  // Outgoing call auto-start + 45s missed timeout
  useEffect(() => {
    if (activeCall.direction !== 'outgoing') {
      startRingtone('incoming');
      return () => {
        stopRingtone();
      };
    }

    let cancelled = false;
    let missTimer: number | null = null;

    (async () => {
      try {
        const stream = await acquireLocalMedia(activeCall.mode, 'user');
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        const pc = createPeerConnection(stream);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (cancelled) return;

        await createCallSession({
          callId: activeCall.callId,
          chatId: activeCall.chatId,
          callerUid: currentUser.uid,
          callerName: currentUser.displayName,
          callerPhoto: currentUser.photoUrl || '',
          calleeUid: activeCall.peerUid,
          calleeName: activeCall.peerName,
          calleePhoto: activeCall.peerPhoto || '',
          mode: activeCall.mode,
          offerSdp: JSON.stringify(offer),
        });

        callDocCreatedRef.current = true;
        while (outgoingIceQueueRef.current.length > 0) {
          const cand = outgoingIceQueueRef.current.shift();
          if (cand) {
            void sendCallCandidate({
              callId: activeCall.callId,
              senderId: currentUser.uid,
              candidate: cand,
            });
          }
        }

        if (!cancelled) {
          setPhase('ringing-outgoing');
          setStatusLabel(t(lang, 'ringingPeer'));
          startRingtone('ringback');
          missTimer = window.setTimeout(() => {
            if (!closingRef.current && !remoteDescSetRef.current) {
              void updateCallStatus({ callId: activeCall.callId, status: 'missed' });
              finishAndClose(t(lang, 'callMissed'), 1100);
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
  }, [
    acquireLocalMedia,
    activeCall.callId,
    activeCall.chatId,
    activeCall.direction,
    activeCall.mode,
    activeCall.peerName,
    activeCall.peerPhoto,
    activeCall.peerUid,
    createPeerConnection,
    currentUser.displayName,
    currentUser.photoUrl,
    currentUser.uid,
    finishAndClose,
    lang,
  ]);

  // Connected duration timer
  useEffect(() => {
    if (phase !== 'connected') return;
    setElapsedSec(0);
    const id = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // Safety cleanup on unmount
  useEffect(() => {
    return () => {
      teardownMediaAndPc();
    };
  }, [teardownMediaAndPc]);

  const handleAcceptIncoming = async () => {
    unlockAudioNow();
    stopRingtone();
    void playSentPop();
    setPhase('connecting');
    setStatusLabel(t(lang, 'connectingCall'));
    setErrorMsg('');

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

      setPhase('connected');
      setStatusLabel(t(lang, 'callConnected'));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to answer call.');
      void updateCallStatus({ callId: activeCall.callId, status: 'ended' });
    }
  };

  const handleDeclineIncoming = async () => {
    unlockAudioNow();
    stopRingtone();
    await updateCallStatus({ callId: activeCall.callId, status: 'declined' });
    finishAndClose(t(lang, 'callDeclined'), 450);
  };

  const handleHangup = async () => {
    stopRingtone();
    await updateCallStatus({ callId: activeCall.callId, status: 'ended' });
    finishAndClose(t(lang, 'callEnded'), 450);
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
      {/* Always-mounted remote audio element so audio continues uninterrupted when minimized */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {minimized ? (
        <motion.div
          initial={{ opacity: 0, y: -12, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12 }}
          className="fixed top-3 right-3 z-[60] max-w-[92vw] bg-slate-900/95 text-white border border-slate-700/80 rounded-2xl shadow-2xl px-3.5 py-2.5 flex items-center gap-3 backdrop-blur-md"
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
                micMuted ? 'bg-amber-500 text-slate-950' : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setMinimized(false)}
              aria-label={t(lang, 'expandCall')}
              className="min-h-[36px] min-w-[36px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void handleHangup()}
              aria-label={t(lang, 'endCall')}
              className="min-h-[36px] min-w-[36px] rounded-xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      ) : (
        <div className="fixed inset-0 z-[60] bg-slate-950/92 backdrop-blur-md flex items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full h-[100dvh] sm:h-[86dvh] sm:max-h-[760px] sm:max-w-lg sm:rounded-3xl overflow-hidden bg-gradient-to-b from-slate-900 via-slate-950 to-black border-0 sm:border sm:border-white/10 shadow-2xl flex flex-col justify-between text-white"
          >
            {/* Top Bar */}
            <div className="relative z-20 px-4 pt-4 pb-3 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent">
              <div className="flex items-center gap-2 text-xs font-semibold text-white/85">
                {activeCall.mode === 'video' ? (
                  <Video className="w-4 h-4 text-blue-400" />
                ) : (
                  <Phone className="w-4 h-4 text-emerald-400" />
                )}
                <span>{t(lang, activeCall.mode === 'video' ? 'videoCall' : 'voiceCall')}</span>
              </div>

              {phase !== 'ringing-incoming' && (
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  aria-label={t(lang, 'minimizeCall')}
                  className="min-h-[36px] px-3 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>{t(lang, 'minimizeCall')}</span>
                </button>
              )}
            </div>

            {/* Center Video / Voice Stage */}
            <div className="relative flex-1 flex items-center justify-center overflow-hidden px-6">
              {/* Remote Video Feed */}
              {activeCall.mode === 'video' && (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted={false}
                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                    hasRemoteVideo && phase === 'connected' ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                />
              )}

              {/* Subtle Ringing / Voice Call Ambient Card */}
              {(!hasRemoteVideo || activeCall.mode === 'audio' || phase !== 'connected') && (
                <div className="relative z-10 flex flex-col items-center text-center space-y-5 max-w-xs">
                  <div className="relative flex items-center justify-center">
                    {(phase === 'ringing-incoming' || phase === 'ringing-outgoing') && (
                      <>
                        <motion.span
                          animate={{ scale: [1, 1.55], opacity: [0.55, 0] }}
                          transition={{ duration: 1.7, repeat: Infinity, ease: 'easeOut' }}
                          className="absolute inset-0 rounded-full border-2 border-emerald-400"
                        />
                        <motion.span
                          animate={{ scale: [1, 1.85], opacity: [0.4, 0] }}
                          transition={{ duration: 1.7, delay: 0.45, repeat: Infinity, ease: 'easeOut' }}
                          className="absolute inset-0 rounded-full border-2 border-blue-400"
                        />
                      </>
                    )}
                    <UserAvatar
                      name={activeCall.peerName}
                      photoUrl={activeCall.peerPhoto}
                      size="xl"
                      isOnline={true}
                      ringColorClass="ring-slate-950"
                      className="w-24 h-24"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <h2 className="font-display text-2xl font-bold text-white break-words">
                      {activeCall.peerName}
                    </h2>
                    <p
                      className={`text-sm font-medium font-mono-tabular ${
                        errorMsg
                          ? 'text-red-400'
                          : phase === 'connected'
                          ? 'text-emerald-400'
                          : 'text-blue-300'
                      }`}
                    >
                      {subtitleText}
                    </p>
                  </div>
                </div>
              )}

              {/* Floating Timer Pill over Remote Video */}
              {hasRemoteVideo && phase === 'connected' && activeCall.mode === 'video' && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-xs font-mono-tabular text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-semibold truncate max-w-[140px]">{activeCall.peerName}</span>
                  <span className="text-white/75">{formatDuration(elapsedSec)}</span>
                </div>
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
              ) : phase === 'ringing-incoming' ? (
                <div className="flex items-center justify-center gap-8">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.92 }}
                    onClick={() => void handleDeclineIncoming()}
                    className="flex flex-col items-center gap-2"
                  >
                    <span className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg shadow-red-600/35">
                      <PhoneOff className="w-7 h-7" />
                    </span>
                    <span className="text-xs font-medium text-white/90">{t(lang, 'declineCall')}</span>
                  </motion.button>

                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.92 }}
                    onClick={() => void handleAcceptIncoming()}
                    className="flex flex-col items-center gap-2"
                  >
                    <motion.span
                      animate={{ scale: [1, 1.08, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
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
                    whileTap={{ scale: 0.92 }}
                    onClick={toggleMic}
                    aria-label={micMuted ? t(lang, 'unmuteMic') : t(lang, 'muteMic')}
                    className={`min-h-[52px] min-w-[52px] px-3.5 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors ${
                      micMuted
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-white/15 hover:bg-white/25 text-white'
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
                        whileTap={{ scale: 0.92 }}
                        onClick={toggleCamera}
                        aria-label={camOff ? t(lang, 'cameraOn') : t(lang, 'cameraOff')}
                        className={`min-h-[52px] min-w-[52px] px-3.5 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors ${
                          camOff
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-white/15 hover:bg-white/25 text-white'
                        }`}
                      >
                        {camOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                        <span className="text-[10px] font-medium whitespace-nowrap">
                          {camOff ? t(lang, 'cameraOn') : t(lang, 'cameraOff')}
                        </span>
                      </motion.button>

                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.92 }}
                        onClick={() => void switchCamera()}
                        aria-label={t(lang, 'switchCamera')}
                        className="min-h-[52px] min-w-[52px] px-3.5 rounded-2xl bg-white/15 hover:bg-white/25 text-white flex flex-col items-center justify-center gap-1 transition-colors"
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
                    whileTap={{ scale: 0.92 }}
                    onClick={() => void handleHangup()}
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
        </div>
      )}
    </>
  );
};
