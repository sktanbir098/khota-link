import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bluetooth,
  BluetoothConnected,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  ImagePlus,
  Paperclip,
  QrCode,
  Radio,
  Send,
  ShieldAlert,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useOnlineStatus } from '../hooks/usePWA';
import { formatFileSize, prepareAttachment, triggerFileDownload } from '../lib/attachments';
import { BleSession, connectBluetoothDevice, isWebBluetoothSupported } from '../lib/bluetooth';
import { formatFriendlyError } from '../lib/chatService';
import { useFloatingBadgeClearance } from '../lib/floatingBadge';
import { t } from '../lib/i18n';
import { buildNearbyShareUrl, getPublicAppOrigin } from '../lib/shareLink';
import { playIncomingTone, playSentPop, unlockAudioNow } from '../lib/sound';
import {
  acceptOfflineOfferAndCreateAnswer,
  createNearbyHostSession,
  createOfflineHostOffer,
  joinNearbyGuestSession,
  NearbyP2PSession,
  OfflineP2PSession,
} from '../lib/webrtc';
import { AppLanguage, LocalDirectMessage, PreparedAttachment, UserPublicProfile } from '../types/chat';

interface Props {
  lang: AppLanguage;
  currentUser: UserPublicProfile | null;
  initialMode?: 'bluetooth' | 'nearby';
  initialNearbyCode?: string;
  initialOfflineCode?: string;
  onRequireAuth: () => void;
  onClose?: () => void;
}

export const BluetoothNearbyPanel: React.FC<Props> = ({
  lang,
  currentUser,
  initialMode = 'bluetooth',
  initialNearbyCode = '',
  initialOfflineCode = '',
  onRequireAuth,
  onClose,
}) => {
  const isOnline = useOnlineStatus();
  const [subMode, setSubMode] = useState<'bluetooth' | 'nearby'>(
    initialNearbyCode || initialOfflineCode ? 'nearby' : initialMode
  );
  const [pairingKind, setPairingKind] = useState<'offline' | 'online'>(() => {
    if (initialNearbyCode) return 'online';
    if (initialOfflineCode) return 'offline';
    return !isOnline || !currentUser ? 'offline' : 'offline';
  });
  const [offlineNickname, setOfflineNickname] = useState<string>(() => {
    if (currentUser?.displayName) return currentUser.displayName;
    if (typeof window !== 'undefined') {
      return localStorage.getItem('kl_offline_nickname') || 'Offline User';
    }
    return 'Offline User';
  });
  const hasNetlifyBadge = useFloatingBadgeClearance();

  // Web Bluetooth state
  const bleSupported = isWebBluetoothSupported();
  const [bleSession, setBleSession] = useState<BleSession | null>(null);
  const [bleConnecting, setBleConnecting] = useState(false);
  const [bleError, setBleError] = useState('');
  const [bleMessages, setBleMessages] = useState<LocalDirectMessage[]>([]);
  const [bleInput, setBleInput] = useState('');

  // Nearby / Offline WebRTC state
  const [nearbySession, setNearbySession] = useState<NearbyP2PSession | OfflineP2PSession | null>(null);
  const [nearbyStatus, setNearbyStatus] = useState<'idle' | 'waiting' | 'paired' | 'p2p-open' | 'closed'>('idle');
  const [nearbyPeerName, setNearbyPeerName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState(initialNearbyCode);
  const [offlineJoinInput, setOfflineJoinInput] = useState(initialOfflineCode);
  const [hostAnswerInput, setHostAnswerInput] = useState('');
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState('');
  const [nearbyMessages, setNearbyMessages] = useState<LocalDirectMessage[]>([]);
  const [nearbyInput, setNearbyInput] = useState('');
  const [nearbyPendingAtt, setNearbyPendingAtt] = useState<PreparedAttachment | null>(null);
  const [nearbyPreparingAtt, setNearbyPreparingAtt] = useState(false);
  const [nearbySendPulse, setNearbySendPulse] = useState(0);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedSignalCode, setCopiedSignalCode] = useState(false);

  const bleScrollRef = useRef<HTMLDivElement>(null);
  const nearbyScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nearbyImgRef = useRef<HTMLInputElement>(null);
  const nearbyFileRef = useRef<HTMLInputElement>(null);
  const bleSessionRef = useRef<BleSession | null>(null);
  const nearbySessionRef = useRef<NearbyP2PSession | OfflineP2PSession | null>(null);
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  const activeSenderName = currentUser?.displayName || offlineNickname.trim() || 'Offline User';

  useEffect(() => {
    if (typeof window !== 'undefined' && !currentUser) {
      localStorage.setItem('kl_offline_nickname', offlineNickname);
    }
  }, [offlineNickname, currentUser]);

  useEffect(() => {
    bleSessionRef.current = bleSession;
  }, [bleSession]);

  useEffect(() => {
    nearbySessionRef.current = nearbySession;
  }, [nearbySession]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bleMessages, nearbyMessages]);

  useEffect(() => {
    return () => {
      bleSessionRef.current?.disconnect();
      nearbySessionRef.current?.cleanup();
    };
  }, []);

  const scrollBleToTop = useCallback(() => {
    bleScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const scrollBleToBottom = useCallback(() => {
    const el = bleScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  const scrollNearbyToTop = useCallback(() => {
    nearbyScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const scrollNearbyToBottom = useCallback(() => {
    const el = nearbyScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  const handleScanBle = async () => {
    unlockAudioNow();
    setBleError('');
    setBleConnecting(true);
    try {
      const session = await connectBluetoothDevice(
        (incomingText) => {
          void playIncomingTone();
          setBleMessages((prev) => [
            ...prev,
            {
              id: `ble_${Date.now()}_${Math.random()}`,
              sender: 'peer',
              senderName: session.deviceName,
              text: incomingText,
              transport: 'bluetooth',
              timestamp: Date.now(),
            },
          ]);
        },
        () => {
          setBleSession(null);
          setBleMessages((prev) => [
            ...prev,
            {
              id: `sys_${Date.now()}`,
              sender: 'system',
              senderName: 'Bluetooth',
              text: 'Device disconnected.',
              transport: 'bluetooth',
              timestamp: Date.now(),
            },
          ]);
        }
      );
      setBleSession(session);
      setBleMessages([
        {
          id: `sys_conn_${Date.now()}`,
          sender: 'system',
          senderName: 'Bluetooth',
          text: `Paired with ${session.deviceName}${session.supportsWrite ? ' (UART TX ready)' : ' (Read/Monitor only)'}`,
          transport: 'bluetooth',
          timestamp: Date.now(),
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bluetooth pairing cancelled or failed.';
      if (msg.toLowerCase().includes('permissions policy')) {
        setBleError(
          'Bluetooth scanning is blocked inside an embedded preview iframe. Open LoopLy in a full browser tab (button below) or use Offline Code / QR.'
        );
      } else if (!msg.toLowerCase().includes('cancelled')) {
        setBleError(formatFriendlyError(err));
      }
    } finally {
      setBleConnecting(false);
    }
  };

  const handleSendBle = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudioNow();
    if (!bleSession || !bleInput.trim()) return;
    const text = bleInput.trim();
    setBleError('');
    try {
      await bleSession.sendText(text);
      void playSentPop();
      setBleMessages((prev) => [
        ...prev,
        {
          id: `me_${Date.now()}`,
          sender: 'me',
          senderName: activeSenderName,
          text,
          transport: 'bluetooth',
          timestamp: Date.now(),
        },
      ]);
      setBleInput('');
    } catch (err) {
      setBleError(err instanceof Error ? err.message : 'Failed to send over Bluetooth.');
    }
  };

  // --- Zero-Internet Offline Code/QR Pairing ---
  const handleCreateOfflineHost = async () => {
    unlockAudioNow();
    setNearbyError('');
    setNearbyLoading(true);
    setHostAnswerInput('');
    try {
      nearbySession?.cleanup();
      const session = await createOfflineHostOffer({
        displayName: activeSenderName,
        onStatusChange: (status, peerName) => {
          setNearbyStatus(status);
          if (peerName) setNearbyPeerName(peerName);
        },
        onIncomingMessage: (msg) => {
          void playIncomingTone();
          setNearbyMessages((prev) => [...prev, msg]);
        },
      });
      setNearbySession(session);
      setNearbyMessages([]);
    } catch (err) {
      setNearbyError(err instanceof Error ? err.message : 'Failed to generate offline code.');
    } finally {
      setNearbyLoading(false);
    }
  };

  const handleJoinOfflineOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudioNow();
    if (!offlineJoinInput.trim()) return;
    setNearbyError('');
    setNearbyLoading(true);
    try {
      nearbySession?.cleanup();
      const session = await acceptOfflineOfferAndCreateAnswer({
        offerCode: offlineJoinInput.trim(),
        displayName: activeSenderName,
        onStatusChange: (status, peerName) => {
          setNearbyStatus(status);
          if (peerName) setNearbyPeerName(peerName);
        },
        onIncomingMessage: (msg) => {
          void playIncomingTone();
          setNearbyMessages((prev) => [...prev, msg]);
        },
      });
      setNearbySession(session);
      setNearbyMessages([]);
    } catch (err) {
      setNearbyError(err instanceof Error ? err.message : 'Invalid offline host code.');
    } finally {
      setNearbyLoading(false);
    }
  };

  const handleAcceptHostAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudioNow();
    const sess = nearbySession as OfflineP2PSession | null;
    if (!sess?.acceptAnswerCode || !hostAnswerInput.trim()) return;
    setNearbyError('');
    setNearbyLoading(true);
    try {
      await sess.acceptAnswerCode(hostAnswerInput.trim());
      setHostAnswerInput('');
    } catch (err) {
      setNearbyError(err instanceof Error ? err.message : 'Invalid reply code.');
    } finally {
      setNearbyLoading(false);
    }
  };

  // --- Online 6-Digit Room (Firestore + WebRTC) ---
  const handleCreateNearbyRoom = async () => {
    unlockAudioNow();
    if (!isOnline) {
      setNearbyError(
        lang === 'bn'
          ? 'অনলাইন ৬-ডিজিট রুমের জন্য ইন্টারনেট দরকার। ইন্টারনেট ছাড়া ব্যবহার করতে "Offline Code / QR" ট্যাব বেছে নিন।'
          : 'Online 6-digit rooms need internet. Switch to "Offline Code / QR" above for zero-internet pairing.'
      );
      return;
    }
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    setNearbyError('');
    setNearbyLoading(true);
    try {
      nearbySession?.cleanup();
      const session = await createNearbyHostSession({
        currentUser,
        onStatusChange: (status, peerName) => {
          setNearbyStatus(status);
          if (peerName) setNearbyPeerName(peerName);
        },
        onIncomingMessage: (msg) => {
          void playIncomingTone();
          setNearbyMessages((prev) => [...prev, msg]);
        },
      });
      setNearbySession(session);
      setNearbyMessages([]);
    } catch (err) {
      setNearbyError(err instanceof Error ? err.message : 'Failed to create Nearby room.');
    } finally {
      setNearbyLoading(false);
    }
  };

  const handleJoinNearbyRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudioNow();
    if (!isOnline) {
      setNearbyError(
        lang === 'bn'
          ? 'অনলাইন ৬-ডিজিট রুমে জয়েন করতে ইন্টারনেট দরকার। অফলাইনে চ্যাট করতে "Offline Code / QR" ব্যবহার করুন।'
          : 'Joining an online 6-digit room requires internet. Use "Offline Code / QR" above without internet.'
      );
      return;
    }
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    setNearbyError('');
    setNearbyLoading(true);
    try {
      nearbySession?.cleanup();
      const session = await joinNearbyGuestSession({
        roomCode: joinCodeInput,
        currentUser,
        onStatusChange: (status, peerName) => {
          setNearbyStatus(status);
          if (peerName) setNearbyPeerName(peerName);
        },
        onIncomingMessage: (msg) => {
          void playIncomingTone();
          setNearbyMessages((prev) => [...prev, msg]);
        },
      });
      setNearbySession(session);
      setNearbyMessages([]);
    } catch (err) {
      setNearbyError(err instanceof Error ? err.message : 'Failed to join Nearby room.');
    } finally {
      setNearbyLoading(false);
    }
  };

  const handlePickNearbyAttachment = async (file: File) => {
    setNearbyError('');
    setNearbyPreparingAtt(true);
    try {
      const prepared = await prepareAttachment(file);
      setNearbyPendingAtt(prepared);
    } catch (err) {
      setNearbyError(err instanceof Error ? err.message : 'Unable to attach file.');
    } finally {
      setNearbyPreparingAtt(false);
    }
  };

  const handleSendNearby = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudioNow();
    if (!nearbySession || (!nearbyInput.trim() && !nearbyPendingAtt)) return;
    const text = nearbyInput.trim();
    const att = nearbyPendingAtt;
    setNearbyError('');
    setNearbyInput('');
    setNearbyPendingAtt(null);
    setNearbySendPulse((k) => k + 1);
    void playSentPop();
    const localId = `me_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setNearbyMessages((prev) => [
      ...prev,
      {
        id: localId,
        sender: 'me',
        senderName: activeSenderName,
        text,
        transport: att ? 'webrtc' : 'nearby',
        timestamp: Date.now(),
        attachmentType: att ? att.attachmentType : 'none',
        attachmentName: att ? att.attachmentName : '',
        attachmentMime: att ? att.attachmentMime : '',
        attachmentSize: att ? att.attachmentSize : 0,
        attachmentData: att ? att.attachmentData : '',
      },
    ]);

    try {
      if (att) {
        await nearbySession.sendAttachment(att, text);
      } else {
        const transportUsed = await nearbySession.sendMessage(text);
        if (transportUsed === 'webrtc') {
          setNearbyMessages((prev) =>
            prev.map((m) => (m.id === localId ? { ...m, transport: 'webrtc' } : m))
          );
        }
      }
    } catch (err) {
      setNearbyMessages((prev) => prev.filter((m) => m.id !== localId));
      setNearbyError(err instanceof Error ? err.message : 'Failed to send.');
      if (text) setNearbyInput(text);
      if (att) setNearbyPendingAtt(att);
    }
  };

  const isOfflineDirectSession = Boolean(
    nearbySession && 'isOfflineDirect' in nearbySession && nearbySession.isOfflineDirect
  );
  const offlineDirectSession = isOfflineDirectSession ? (nearbySession as OfflineP2PSession) : null;
  const offlineSignalCode =
    offlineDirectSession?.offerCode || offlineDirectSession?.answerCode || '';

  const nearbyShareUrl = nearbySession
    ? isOfflineDirectSession && offlineSignalCode
      ? `${getPublicAppOrigin()}/?offline=${encodeURIComponent(offlineSignalCode)}`
      : buildNearbyShareUrl(nearbySession.roomCode)
    : '';

  const copyShare = async () => {
    if (!nearbySession) return;
    await navigator.clipboard.writeText(nearbyShareUrl);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyOfflineSignal = async () => {
    if (!offlineSignalCode) return;
    await navigator.clipboard.writeText(offlineSignalCode);
    setCopiedSignalCode(true);
    setTimeout(() => setCopiedSignalCode(false), 2000);
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col h-full bg-white dark:bg-slate-950 overflow-hidden">
      {/* Header with Top-Left Back Button + Offline Ready Badge */}
      <div className="px-3 sm:px-6 py-3 sm:py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => {
              if (bleSession) {
                bleSession.disconnect();
                setBleSession(null);
                return;
              }
              if (nearbySession) {
                void nearbySession.closeSession();
                setNearbySession(null);
                setNearbyStatus('idle');
                return;
              }
              onClose?.();
            }}
            aria-label={t(lang, 'backBtn')}
            className="min-h-[40px] px-3 flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-transparent hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-semibold shrink-0 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span>{t(lang, 'backBtn')}</span>
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                {t(lang, 'nearbyHeader')}
              </h2>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap shrink-0 flex items-center gap-1 ${
                  isOnline
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                }`}
              >
                {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                <span>{t(lang, 'offlineReadyBadge')}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              BLE Hardware GATT · Zero-Internet Offline Code & WebRTC P2P
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setSubMode('bluetooth')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                subMode === 'bluetooth'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Bluetooth className="w-3.5 h-3.5" />
              {t(lang, 'btHardwareTab')}
            </button>
            <button
              type="button"
              onClick={() => setSubMode('nearby')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                subMode === 'nearby'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              {t(lang, 'webrtcNearbyTab')}
            </button>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Offline Nickname Bar for Guest / Offline Sessions */}
      {!currentUser && !bleSession && !nearbySession && (
        <div className="px-4 sm:px-6 py-2.5 bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
            <span>{t(lang, 'offlineNicknameLabel')}:</span>
            <input
              type="text"
              maxLength={32}
              value={offlineNickname}
              onChange={(e) => setOfflineNickname(e.target.value)}
              className="min-h-[32px] px-2.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </label>
          {isOnline && (
            <button
              type="button"
              onClick={onRequireAuth}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              {t(lang, 'signInGoogle')}
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {subMode === 'bluetooth' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {!bleSession ? (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 flex flex-col">
              <div className="max-w-lg w-full mx-auto my-auto border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 bg-slate-50 dark:bg-slate-900 space-y-5">
                <div className="w-12 h-12 rounded-2xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Bluetooth className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                    Web Bluetooth Direct Scanner
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    Pair directly without internet with nearby Bluetooth Low Energy (BLE) chat peripherals, ESP32/Arduino Nordic UART devices, or HM-10 serial modules right from your browser.
                  </p>
                </div>

                {!bleSupported && (
                  <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-start gap-3 text-xs text-amber-800 dark:text-amber-200">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      Web Bluetooth is disabled or unsupported in this browser (e.g., iOS Safari or Firefox). Use Chrome/Edge on Android or Desktop, or switch to{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setPairingKind('offline');
                          setSubMode('nearby');
                        }}
                        className="underline font-semibold"
                      >
                        Offline Code / QR
                      </button>{' '}
                      to chat offline between any two phones or laptops.
                    </div>
                  </div>
                )}

                {isInIframe && (
                  <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 flex flex-col gap-2 text-xs text-blue-900 dark:text-blue-200">
                    <p className="leading-relaxed">
                      Browser security blocks Web Bluetooth inside embedded preview frames. For hardware Bluetooth scanning, open LoopLy in a full tab—or use <strong>Offline Code / QR</strong> right here between any two phones/laptops.
                    </p>
                    <a
                      href={window.location.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-semibold underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open Full Tab for Bluetooth
                    </a>
                  </div>
                )}

                {bleError && (
                  <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                    {bleError}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    disabled={!bleSupported || bleConnecting}
                    onClick={handleScanBle}
                    className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <Radio className="w-4 h-4" />
                    {bleConnecting ? 'Scanning...' : t(lang, 'scanBleBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPairingKind('offline');
                      setSubMode('nearby');
                    }}
                    className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    {t(lang, 'offlineModeCodeTab')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 sm:px-6 py-3 bg-emerald-50/80 dark:bg-emerald-950/30 border-b border-emerald-200 dark:border-emerald-900 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      bleSession.disconnect();
                      setBleSession(null);
                    }}
                    aria-label={t(lang, 'backBtn')}
                    className="min-h-[34px] px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 shrink-0"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>{t(lang, 'backBtn')}</span>
                  </button>
                  <BluetoothConnected className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {bleSession.deviceName}
                    </div>
                    <div className="text-xs text-emerald-700 dark:text-emerald-300 font-mono-tabular truncate">
                      BLE GATT Connected · {bleSession.supportsWrite ? 'TX Write Active' : 'Listen Mode'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    bleSession.disconnect();
                    setBleSession(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 whitespace-nowrap shrink-0"
                >
                  {t(lang, 'disconnectBt')}
                </button>
              </div>

              <div className="relative flex-1 flex flex-col overflow-hidden min-h-0">
                <div ref={bleScrollRef} className="flex-1 overflow-y-auto p-6 pr-14 space-y-3">
                  {bleMessages.map((msg) => {
                    const isFresh = Date.now() - msg.timestamp < 2500;
                    return (
                      <motion.div
                        key={msg.id}
                        initial={
                          isFresh
                            ? msg.sender === 'me'
                              ? { opacity: 0, y: 18, x: 18, scale: 0.9 }
                              : msg.sender === 'peer'
                              ? { opacity: 0, x: -28, y: 10, scale: 0.94 }
                              : { opacity: 0, y: 6 }
                            : false
                        }
                        animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 25, mass: 0.8 }}
                        className={`flex ${
                          msg.sender === 'system'
                            ? 'justify-center'
                            : msg.sender === 'me'
                            ? 'justify-end'
                            : 'justify-start'
                        }`}
                      >
                        {msg.sender === 'system' ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400 py-1">
                            {msg.text}
                          </span>
                        ) : (
                          <div
                            className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                              msg.sender === 'me'
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800'
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                            <div className="text-[11px] opacity-75 mt-1 font-mono-tabular">
                              Bluetooth · {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {bleMessages.length > 0 && (
                  <div className="absolute bottom-3 right-3 z-20 flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={scrollBleToTop}
                      aria-label={t(lang, 'scrollToTopLabel')}
                      title={t(lang, 'scrollToTopLabel')}
                      className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 shadow-md flex items-center justify-center transition-colors"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={scrollBleToBottom}
                      aria-label={t(lang, 'scrollToBottomLabel')}
                      title={t(lang, 'scrollToBottomLabel')}
                      className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 shadow-md flex items-center justify-center transition-colors"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {bleError && (
                <div className="px-6 py-2 bg-red-50 dark:bg-red-950/40 text-xs text-red-600 dark:text-red-300 border-t border-red-200 dark:border-red-900">
                  {bleError}
                </div>
              )}

              <div
                className={`border-t border-slate-200 dark:border-slate-800 shrink-0 chat-composer-container${
                  hasNetlifyBadge ? ' has-netlify-badge pb-[52px]' : ''
                }`}
              >
                <form
                  onSubmit={handleSendBle}
                  className="p-3 sm:p-4 flex items-center gap-2.5"
                >
                  <input
                    type="text"
                    value={bleInput}
                    onChange={(e) => setBleInput(e.target.value)}
                    placeholder="Send text over Bluetooth GATT..."
                    className="flex-1 min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="submit"
                    disabled={!bleInput.trim()}
                    className="min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium flex items-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <Send className="w-4 h-4" />
                    {t(lang, 'send')}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {!nearbySession ? (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 flex flex-col gap-5">
              <div className="w-full max-w-2xl mx-auto my-auto flex flex-col gap-5">
              {/* Switcher: Zero-Internet Offline Code/QR vs Online 6-Digit Room */}
              <div className="w-full grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setNearbyError('');
                    setPairingKind('offline');
                  }}
                  className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                    pairingKind === 'offline'
                      ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <WifiOff className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t(lang, 'offlineModeCodeTab')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNearbyError('');
                    setPairingKind('online');
                  }}
                  className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                    pairingKind === 'online'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Wifi className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t(lang, 'onlineRoomCodeTab')}</span>
                </button>
              </div>

              {pairingKind === 'offline' ? (
                <div className="max-w-2xl w-full grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Host Zero-Internet Offline Code */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-6 bg-slate-50/70 dark:bg-slate-900/50 flex flex-col justify-between space-y-5">
                    <div className="space-y-3">
                      <div className="w-11 h-11 rounded-2xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                        <QrCode className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {t(lang, 'offlineHostTitle')}
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        {t(lang, 'offlineHostDesc')}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={nearbyLoading}
                      onClick={() => void handleCreateOfflineHost()}
                      className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap"
                    >
                      {nearbyLoading ? 'Preparing...' : t(lang, 'generateOfflineCodeBtn')}
                    </button>
                  </div>

                  {/* Guest Zero-Internet Offline Code */}
                  <form
                    onSubmit={handleJoinOfflineOffer}
                    className="border border-slate-200 dark:border-slate-800 rounded-2xl p-6 bg-white dark:bg-slate-900 flex flex-col justify-between space-y-5"
                  >
                    <div className="space-y-3">
                      <div className="w-11 h-11 rounded-2xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                        <Wifi className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {t(lang, 'offlineJoinTitle')}
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        {t(lang, 'offlineJoinDesc')}
                      </p>
                      <textarea
                        rows={3}
                        value={offlineJoinInput}
                        onChange={(e) => setOfflineJoinInput(e.target.value)}
                        placeholder="Paste Host Code (KL1:...) or scanned QR link"
                        className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono-tabular focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={nearbyLoading || !offlineJoinInput.trim()}
                      className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 disabled:opacity-40 text-sm font-medium transition-colors whitespace-nowrap"
                    >
                      {t(lang, 'generateReplyCodeBtn')}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="max-w-2xl w-full grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Create Online 6-Digit Room */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-6 bg-slate-50/70 dark:bg-slate-900/50 flex flex-col justify-between space-y-5">
                    <div className="space-y-3">
                      <div className="w-11 h-11 rounded-2xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                        <QrCode className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        Host Nearby P2P Room
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        Generate a 6-digit pairing code and QR code. A friend next to you can scan or type the code to open a direct WebRTC channel.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={nearbyLoading}
                      onClick={handleCreateNearbyRoom}
                      className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap"
                    >
                      {nearbyLoading ? 'Starting...' : t(lang, 'createRoomBtn')}
                    </button>
                  </div>

                  {/* Join Online 6-Digit Room */}
                  <form
                    onSubmit={handleJoinNearbyRoom}
                    className="border border-slate-200 dark:border-slate-800 rounded-2xl p-6 bg-white dark:bg-slate-900 flex flex-col justify-between space-y-5"
                  >
                    <div className="space-y-3">
                      <div className="w-11 h-11 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center">
                        <Wifi className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        Join Nearby Room
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        Enter the 6-digit code shown on your friend’s screen to connect directly.
                      </p>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={joinCodeInput}
                        onChange={(e) => setJoinCodeInput(e.target.value.replace(/\D/g, ''))}
                        placeholder={t(lang, 'joinRoomPlaceholder')}
                        className="w-full min-h-[44px] px-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-lg tracking-[0.25em] font-mono-tabular focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={nearbyLoading || joinCodeInput.length < 6}
                      className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 disabled:opacity-40 text-sm font-medium transition-colors whitespace-nowrap"
                    >
                      {t(lang, 'joinRoomBtn')}
                    </button>
                  </form>
                </div>
              )}

              {nearbyError && (
                <div className="w-full p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                  {nearbyError}
                </div>
              )}
              </div>
            </div>
          ) : (
            <>
              {/* Active Nearby / Offline P2P Header Banner */}
              <div className="px-4 sm:px-6 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 space-y-3 shrink-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await nearbySession.closeSession();
                        setNearbySession(null);
                        setNearbyStatus('idle');
                      }}
                      aria-label={t(lang, 'backBtn')}
                      className="min-h-[34px] px-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1 shrink-0"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>{t(lang, 'backBtn')}</span>
                    </button>
                    {(!isOfflineDirectSession || nearbyStatus !== 'p2p-open') && (
                      <div className="p-1.5 bg-white rounded-lg border border-slate-200 shrink-0">
                        <QRCodeSVG
                          value={isOfflineDirectSession ? offlineSignalCode || nearbyShareUrl : nearbyShareUrl}
                          size={54}
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        <span>{isOfflineDirectSession ? 'Offline Code' : 'Room'}</span>
                        <span className="font-mono-tabular tracking-widest text-blue-600 dark:text-blue-400">
                          {nearbySession.roomCode}
                        </span>
                        <button
                          type="button"
                          onClick={isOfflineDirectSession ? copyOfflineSignal : copyShare}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500"
                          title="Copy code"
                        >
                          {(isOfflineDirectSession ? copiedSignalCode : copiedCode) ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {isOfflineDirectSession ? (
                          nearbyStatus === 'p2p-open'
                            ? `Offline Direct P2P active with ${nearbyPeerName || 'Peer'} (No Internet)`
                            : nearbySession.role === 'host'
                            ? 'Step 1: Share Host Code · Step 2: Paste friend’s Reply Code below'
                            : 'Send your Reply Code (KL2) to host so direct chat opens'
                        ) : (
                          <>
                            {nearbyStatus === 'waiting' && 'Waiting for peer to enter code or scan QR...'}
                            {nearbyStatus === 'paired' && `Paired with ${nearbyPeerName || 'Peer'} · Synced channel`}
                            {nearbyStatus === 'p2p-open' && `Direct WebRTC P2P active with ${nearbyPeerName || 'Peer'}`}
                            {nearbyStatus === 'closed' && 'Session ended'}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await nearbySession.closeSession();
                      setNearbySession(null);
                      setNearbyStatus('idle');
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 whitespace-nowrap shrink-0"
                  >
                    {t(lang, 'closeRoomBtn')}
                  </button>
                </div>

                {/* Offline Handshake Helper Box until WebRTC channel opens */}
                {isOfflineDirectSession && nearbyStatus !== 'p2p-open' && offlineDirectSession && (
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {offlineDirectSession.role === 'host'
                          ? lang === 'bn'
                            ? 'আপনার Host কোড (বন্ধুকে দিন):'
                            : 'Your Host Code (share with friend):'
                          : lang === 'bn'
                          ? 'আপনার Reply কোড (হোস্টকে দিন):'
                          : 'Your Reply Code (send to host):'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyOfflineSignal()}
                        className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold flex items-center gap-1"
                      >
                        {copiedSignalCode ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedSignalCode ? t(lang, 'copied') : 'Copy Code'}</span>
                      </button>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 font-mono-tabular text-[11px] text-slate-700 dark:text-slate-300 break-all max-h-16 overflow-y-auto select-all">
                      {offlineSignalCode}
                    </div>
                    {offlineDirectSession.role === 'host' && offlineDirectSession.acceptAnswerCode && (
                      <form onSubmit={handleAcceptHostAnswer} className="flex flex-col sm:flex-row gap-2 pt-1">
                        <input
                          type="text"
                          value={hostAnswerInput}
                          onChange={(e) => setHostAnswerInput(e.target.value)}
                          placeholder={
                            lang === 'bn'
                              ? 'বন্ধুর Reply কোড (KL2:...) এখানে পেস্ট করুন'
                              : 'Paste friend’s Reply Code (KL2:...) here'
                          }
                          className="flex-1 min-h-[38px] px-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono-tabular focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                        <button
                          type="submit"
                          disabled={!hostAnswerInput.trim() || nearbyLoading}
                          className="min-h-[38px] px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                        >
                          {t(lang, 'connectOfflinePeerBtn')}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>

              <div className="relative flex-1 flex flex-col overflow-hidden min-h-0">
                <div ref={nearbyScrollRef} className="flex-1 overflow-y-auto p-6 pr-14 space-y-3">
                  {nearbyMessages.length === 0 && (
                    <div className="h-full flex items-center justify-center text-center text-sm text-slate-500 dark:text-slate-400">
                      {nearbyStatus === 'p2p-open' || nearbyStatus === 'paired'
                        ? 'Connected! Say hello to your nearby peer.'
                        : isOfflineDirectSession
                        ? 'Complete the offline code handshake above to start chatting without internet.'
                        : 'Share the 6-digit code or QR above with your friend.'}
                    </div>
                  )}
                  {nearbyMessages.map((msg) => {
                    const isFresh = Date.now() - msg.timestamp < 2500;
                    return (
                      <motion.div
                        key={msg.id}
                        initial={
                          isFresh
                            ? msg.sender === 'me'
                              ? { opacity: 0, y: 20, x: 18, scale: 0.9 }
                              : { opacity: 0, x: -30, y: 12, scale: 0.94 }
                            : false
                        }
                        animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 25, mass: 0.82 }}
                        className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                            msg.sender === 'me'
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          {msg.attachmentType === 'image' && msg.attachmentData && (
                            <img
                              src={msg.attachmentData}
                              alt={msg.attachmentName || 'Image'}
                              referrerPolicy="no-referrer"
                              className={`max-h-56 w-auto max-w-full rounded-xl object-cover ${
                                msg.text ? 'mb-2' : ''
                              }`}
                            />
                          )}
                          {msg.attachmentType === 'file' && msg.attachmentData && (
                            <button
                              type="button"
                              onClick={() => triggerFileDownload(msg.attachmentData!, msg.attachmentName || 'file')}
                              className={`w-full flex items-center gap-2.5 p-2 rounded-xl border ${
                                msg.text ? 'mb-2' : ''
                              } ${
                                msg.sender === 'me'
                                  ? 'bg-blue-700/60 border-blue-400/40 text-white'
                                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              <FileText className="w-4 h-4 shrink-0" />
                              <div className="min-w-0 flex-1 text-left">
                                <div className="text-xs font-semibold truncate">{msg.attachmentName}</div>
                                <div className="text-[11px] opacity-80 font-mono-tabular">
                                  {formatFileSize(msg.attachmentSize || 0)}
                                </div>
                              </div>
                              <Download className="w-4 h-4 shrink-0" />
                            </button>
                          )}
                          {msg.text && <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
                          <div className="text-[11px] opacity-75 mt-1 font-mono-tabular">
                            {msg.transport === 'webrtc' ? 'WebRTC P2P' : 'Nearby Direct'} ·{' '}
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {nearbyMessages.length > 0 && (
                  <div className="absolute bottom-3 right-3 z-20 flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={scrollNearbyToTop}
                      aria-label={t(lang, 'scrollToTopLabel')}
                      title={t(lang, 'scrollToTopLabel')}
                      className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 shadow-md flex items-center justify-center transition-colors"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={scrollNearbyToBottom}
                      aria-label={t(lang, 'scrollToBottomLabel')}
                      title={t(lang, 'scrollToBottomLabel')}
                      className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 shadow-md flex items-center justify-center transition-colors"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {nearbyPendingAtt && (
                <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-medium">
                    {nearbyPendingAtt.attachmentName} ({formatFileSize(nearbyPendingAtt.attachmentSize)})
                  </span>
                  <button
                    type="button"
                    onClick={() => setNearbyPendingAtt(null)}
                    className="text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {nearbyError && (
                <div className="px-4 py-2 bg-red-50 dark:bg-red-950/40 border-t border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                  {nearbyError}
                </div>
              )}

              <input
                ref={nearbyImgRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void handlePickNearbyAttachment(f);
                }}
              />
              <input
                ref={nearbyFileRef}
                type="file"
                accept="*/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void handlePickNearbyAttachment(f);
                }}
              />

              <div
                className={`border-t border-slate-200 dark:border-slate-800 shrink-0 chat-composer-container${
                  hasNetlifyBadge ? ' has-netlify-badge' : ''
                }`}
              >
                <form
                  onSubmit={handleSendNearby}
                  className="px-2.5 pt-2 pb-1.5 sm:px-4 sm:pt-3 sm:pb-2.5 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={nearbyInput}
                      onChange={(e) => setNearbyInput(e.target.value)}
                      disabled={
                        nearbyStatus === 'closed' ||
                        (isOfflineDirectSession && nearbyStatus !== 'p2p-open')
                      }
                      placeholder={t(lang, 'typeMessage')}
                      className="flex-1 min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <motion.button
                      type="submit"
                      whileTap={{ scale: 0.92 }}
                      disabled={
                        (!nearbyInput.trim() && !nearbyPendingAtt) ||
                        nearbyStatus === 'closed' ||
                        (isOfflineDirectSession && nearbyStatus !== 'p2p-open')
                      }
                      className="min-h-[44px] px-4 sm:px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium flex items-center gap-2 whitespace-nowrap shrink-0"
                    >
                      <motion.span
                        key={nearbySendPulse}
                        initial={nearbySendPulse > 0 ? { x: -8, y: 8, scale: 0.7 } : false}
                        animate={{ x: 0, y: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                        className="inline-flex items-center"
                      >
                        <Send className="w-4 h-4" />
                      </motion.span>
                      <span className="hidden sm:inline">{t(lang, 'send')}</span>
                    </motion.button>
                  </div>
                  <div
                    className={`flex items-center gap-1.5 justify-start overflow-x-auto no-scrollbar min-h-[42px] ${
                      hasNetlifyBadge ? 'pr-[186px] sm:pr-[206px]' : ''
                    }`}
                  >
                    <button
                      type="button"
                      disabled={nearbyStatus !== 'p2p-open' || nearbyPreparingAtt}
                      onClick={() => nearbyImgRef.current?.click()}
                      title={
                        nearbyStatus === 'p2p-open'
                          ? t(lang, 'uploadImage')
                          : 'Open Direct WebRTC P2P to send photos'
                      }
                      className="min-h-[36px] px-2.5 flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 text-blue-600 dark:text-blue-400 disabled:opacity-40 hover:bg-slate-200 dark:hover:bg-slate-800 text-xs font-medium shrink-0"
                    >
                      <ImagePlus className="w-4 h-4" />
                      <span>{t(lang, 'photoBtn')}</span>
                    </button>
                    <button
                      type="button"
                      disabled={nearbyStatus !== 'p2p-open' || nearbyPreparingAtt}
                      onClick={() => nearbyFileRef.current?.click()}
                      title={
                        nearbyStatus === 'p2p-open'
                          ? t(lang, 'uploadFile')
                          : 'Open Direct WebRTC P2P to send files'
                      }
                      className="min-h-[36px] px-2.5 flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 disabled:opacity-40 hover:bg-slate-200 dark:hover:bg-slate-800 text-xs font-medium shrink-0"
                    >
                      <Paperclip className="w-4 h-4" />
                      <span>{t(lang, 'fileBtn')}</span>
                    </button>
                  </div>
                </form>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
