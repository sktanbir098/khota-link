import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  Bell,
  BellOff,
  BellRing,
  Bluetooth,
  Camera,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Film,
  Globe,
  ImagePlus,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  Moon,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Search,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Smile,
  Square,
  Sun,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Video,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from 'lucide-react';
import { AppLockScreen } from './components/AppLockScreen';
import { BluetoothNearbyPanel } from './components/BluetoothNearbyPanel';
import { ActiveCallSession, CallOverlay } from './components/CallOverlay';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { ConnectModal } from './components/ConnectModal';
import { GeminiChatPanel } from './components/GeminiChatPanel';
import { GeminiLogo } from './components/GeminiLogo';
import { LoopLyLogo, LaunchSplash } from './components/LoopLyLogo';
import { LegalPolicyModal, PolicyTab } from './components/LegalPolicyModal';
import { AggregatedReaction, MessageBubble } from './components/MessageBubble';
import { PeerProfileModal } from './components/PeerProfileModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { ProfileModal } from './components/ProfileModal';
import { ReportUserModal } from './components/ReportUserModal';
import { SandDissolveHandle, SandDissolveOverlay } from './components/SandDissolveOverlay';
import { STATUS_GRADIENTS, StatusModal } from './components/StatusModal';
import { UserAvatar } from './components/UserAvatar';
import { useOnlineStatus } from './hooks/usePWA';
import { getAppLockConfig, isAppLockEnabled } from './lib/appLock';
import { formatFileSize, prepareAttachment, triggerFileDownload } from './lib/attachments';
import { decryptVaultJson, encryptVaultJson } from './lib/cryptoVault';
import {
  acceptPolicyVersion,
  claimPendingEmailChats,
  createClientMessageId,
  deleteChatMessage,
  deleteChatRoom,
  deleteUserAccount,
  ensureUserProfile,
  exportMyUserData,
  fetchAllChatParticipantEmails,
  formatFriendlyError,
  getInstantLocalUserMatches,
  hydrateSearchResultProfiles,
  joinChatByInviteCode,
  markChatMessagesDelivered,
  markChatMessagesSeen,
  resolveChunkedAttachment,
  searchUserProfiles,
  sendChatMessage,
  setTypingStatus,
  startChatByUserProfile,
  submitUserReport,
  subscribeChatMessages,
  subscribeChatParticipantEmails,
  subscribeChatReactions,
  subscribeOwnPrivateInfo,
  subscribeOwnUserProfile,
  subscribeStatusesForUids,
  subscribeTypingStatus,
  subscribeUserChats,
  subscribeUserProfiles,
  syncMyChatParticipantEmail,
  toggleMessageReaction,
  updateBlockedUsers,
  updatePinnedChats,
  updateUserPresence,
} from './lib/chatService';
import {
  auth,
  buildGmailWebComposeUrl,
  captureGmailTokenFromCredential,
  checkOfficialMailerStatus,
  clearGmailAccessToken,
  googleProvider,
  maskEmail,
  resolvePeerMaskedHint,
  sendGmailAlertEmail,
} from './lib/firebase';
import { useFloatingBadgeClearance } from './lib/floatingBadge';
import { isRtlLanguage, normalizeAppLanguage, t } from './lib/i18n';
import { buildInviteShareUrl, getPublicAppOrigin } from './lib/shareLink';
import {
  getNotificationPermission,
  initAudioUnlock,
  isSoundEnabled,
  playIncomingTone,
  playSentPop,
  registerServiceWorker,
  requestNotificationPermission,
  setSoundEnabled,
  showBackgroundNotification,
  unlockAudioNow,
} from './lib/sound';
import { generateCallId, subscribeIncomingCalls, warmRtcConfig } from './lib/callService';
import {
  AppLanguage,
  AppTheme,
  CallMode,
  ChatMessage,
  ChatRoom,
  CURRENT_POLICY_VERSION,
  LIMITS,
  MessageReaction,
  PreparedAttachment,
  ReactionEmoji,
  ReportReason,
  TypingStatus,
  UserPrivateInfo,
  UserPublicProfile,
  UserSearchResult,
  UserStatus,
  WORLD_LANGUAGES,
} from './types/chat';

const QUICK_EMOJIS = ['👋', '😊', '👍', '❤️', '😂', '🙏', '🔥', '✨'];
const ONLINE_STALE_MS = 75_000;

function canSeePeerPresence(
  peer: { showOnlineStatus?: boolean; onlineVisibility?: string } | undefined,
  hasSharedChat = true
): boolean {
  if (!peer || peer.showOnlineStatus === false || peer.onlineVisibility === 'nobody') {
    return false;
  }
  if (peer.onlineVisibility === 'contacts' && !hasSharedChat) {
    return false;
  }
  return true;
}

function isPeerOnline(
  peer: UserPublicProfile | undefined,
  nowMs: number,
  hasSharedChat = true
): boolean {
  if (!canSeePeerPresence(peer, hasSharedChat) || !peer || peer.onlineStatus !== 'online') {
    return false;
  }
  const lastSeenMs = peer.lastSeenAt?.toMillis?.();
  if (!lastSeenMs) return false;
  return nowMs - lastSeenMs < ONLINE_STALE_MS;
}

function formatPresenceLabel(
  peer: UserPublicProfile | undefined,
  lang: AppLanguage,
  nowMs: number,
  hasSharedChat = true
): string {
  if (!canSeePeerPresence(peer, hasSharedChat)) {
    return t(lang, 'presenceHidden');
  }
  if (isPeerOnline(peer, nowMs, hasSharedChat)) {
    return t(lang, 'online');
  }
  const lastSeenMs = peer?.lastSeenAt?.toMillis?.();
  if (!lastSeenMs) {
    return t(lang, 'offline');
  }
  const seenDate = new Date(lastSeenMs);
  const nowDate = new Date(nowMs);
  const timeStr = seenDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay =
    seenDate.getFullYear() === nowDate.getFullYear() &&
    seenDate.getMonth() === nowDate.getMonth() &&
    seenDate.getDate() === nowDate.getDate();
  const prefix = t(lang, 'lastSeenPrefix');
  if (sameDay) {
    return `${prefix} ${timeStr}`;
  }
  const yesterday = new Date(nowDate);
  yesterday.setDate(nowDate.getDate() - 1);
  const isYesterday =
    seenDate.getFullYear() === yesterday.getFullYear() &&
    seenDate.getMonth() === yesterday.getMonth() &&
    seenDate.getDate() === yesterday.getDate();
  if (isYesterday) {
    return `${prefix} ${lang === 'bn' ? 'গতকাল' : 'Yesterday'}, ${timeStr}`;
  }
  const dateStr = seenDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${prefix} ${dateStr}, ${timeStr}`;
}

function formatTime(ts: { toDate?: () => Date } | null | undefined, isOptimistic?: boolean): string {
  if (ts && typeof ts.toDate === 'function') {
    return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (isOptimistic) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return '';
}

function formatFullDateTime(
  ts: { toDate?: () => Date } | null | undefined,
  lang: AppLanguage
): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  const d = ts.toDate();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return `${lang === 'bn' ? 'আজ' : 'Today'}, ${timeStr}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) {
    return `${lang === 'bn' ? 'গতকাল' : 'Yesterday'}, ${timeStr}`;
  }
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  return `${dateStr}, ${timeStr}`;
}

export default function App() {
  // Theme (Light default | Dark) & language
  const [themeMode, setThemeMode] = useState<AppTheme>(() => {
    if (typeof window === 'undefined') return 'light';
    if (localStorage.getItem('kl_theme_user_picked') === '1') {
      const stored = localStorage.getItem('kl_theme');
      if (stored === 'light' || stored === 'dark') return stored;
      if (stored === 'glass') return 'light';
    }
    return 'light';
  });
  const [lang, setLang] = useState<AppLanguage>(() => {
    if (typeof window === 'undefined') return 'en';
    return normalizeAppLanguage(localStorage.getItem('kl_lang'));
  });
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled());
  const [enterToSend, setEnterToSend] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('kl_enter_send') !== 'false';
  });

  // Launch intro splash & auth/profile
  const [splashMinDone, setSplashMinDone] = useState(false);
  const [splashDismissed, setSplashDismissed] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [publicProfile, setPublicProfile] = useState<UserPublicProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<UserPrivateInfo | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeSecurity, setAgreeSecurity] = useState(false);
  const [consentFlash, setConsentFlash] = useState(false);
  const isOnline = useOnlineStatus();
  const hasNetlifyBadge = useFloatingBadgeClearance();
  const sandDissolveRef = useRef<SandDissolveHandle | null>(null);

  // Chats, presence, messages, reactions, typing & attachments
  const [chats, setChats] = useState<ChatRoom[]>([]);
  const [peerProfiles, setPeerProfiles] = useState<Record<string, UserPublicProfile>>({});
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInfoTarget, setMessageInfoTarget] = useState<ChatMessage | null>(null);
  const [optimisticByChat, setOptimisticByChat] = useState<Record<string, ChatMessage[]>>({});
  const [unreadChatIds, setUnreadChatIds] = useState<Set<string>>(() => new Set());
  const [notifOpen, setNotifOpen] = useState(false);
  const [incomingBanner, setIncomingBanner] = useState<{
    chatId: string;
    senderName: string;
    text: string;
  } | null>(null);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [typingStatuses, setTypingStatuses] = useState<TypingStatus[]>([]);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [messageInput, setMessageInput] = useState('');
  const [sendPulseKey, setSendPulseKey] = useState(0);
  const [justSentIds, setJustSentIds] = useState<Set<string>>(() => new Set());
  const [justArrivedIds, setJustArrivedIds] = useState<Set<string>>(() => new Set());
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [chatCameraOpen, setChatCameraOpen] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PreparedAttachment | null>(null);
  const [preparingAttachment, setPreparingAttachment] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
  const [chatError, setChatError] = useState('');
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceRecordSeconds, setVoiceRecordSeconds] = useState(0);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceWaveform, setVoiceWaveform] = useState<number[]>(() => Array(24).fill(0.18));

  // Statuses & Notification state
  const [statuses, setStatuses] = useState<UserStatus[]>([]);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getNotificationPermission()
  );

  // Navigation & filters
  const [filterTab, setFilterTab] = useState<'all' | 'gmail' | 'nearby'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [workspaceView, setWorkspaceView] = useState<'hub' | 'chat' | 'bluetooth' | 'gemini'>('hub');
  const [officialMailerReady, setOfficialMailerReady] = useState<boolean | null>(null);
  const [pendingEmailsByChat, setPendingEmailsByChat] = useState<Record<string, string>>({});
  const [peerEmailsByChat, setPeerEmailsByChat] = useState<Record<string, string>>({});
  const emailVaultLoadedRef = useRef(false);
  const [mutedChatIds, setMutedChatIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const parsed = JSON.parse(localStorage.getItem('kl_muted_chats') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [mutedSoundChatIds, setMutedSoundChatIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const parsed = JSON.parse(localStorage.getItem('kl_muted_sound_chats') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const parsed = JSON.parse(localStorage.getItem('kl_pinned_chats') || '[]');
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string').slice(0, LIMITS.PINNED_CHATS_MAX)
        : [];
    } catch {
      return [];
    }
  });
  const [offlineAlertOptOutChats, setOfflineAlertOptOutChats] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const parsed = JSON.parse(localStorage.getItem('kl_offline_alert_optout') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [offlineEmailPrompt, setOfflineEmailPrompt] = useState<{
    chatId: string;
    peerName: string;
    presenceText: string;
    messagePreview: string;
    toEmail: string;
    editingEmail?: boolean;
    sending: boolean;
    error: string;
  } | null>(null);
  const [gmailToast, setGmailToast] = useState('');
  const [btInitialMode, setBtInitialMode] = useState<'bluetooth' | 'nearby'>('bluetooth');
  const [guestBluetoothOpen, setGuestBluetoothOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(new URLSearchParams(window.location.search).get('offline'));
  });

  // Modals & deep links
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectModalTab, setConnectModalTab] = useState<'search' | 'gmail' | 'invite'>('search');
  const [sidebarPeopleResults, setSidebarPeopleResults] = useState<UserSearchResult[]>([]);
  const [sidebarSearchingPeople, setSidebarSearchingPeople] = useState(false);
  const [startingSearchUid, setStartingSearchUid] = useState<string | null>(null);
  const [previewedUser, setPreviewedUser] = useState<UserSearchResult | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileModalTab, setProfileModalTab] = useState<'profile' | 'settings' | 'account'>('profile');
  const [peerProfileModalOpen, setPeerProfileModalOpen] = useState(false);
  const [headerLangOpen, setHeaderLangOpen] = useState(false);
  const [headerLangSearch, setHeaderLangSearch] = useState('');
  const [legalModalState, setLegalModalState] = useState<{ open: boolean; tab: PolicyTab }>(() => {
    if (typeof window !== 'undefined') {
      const qPolicy = (new URLSearchParams(window.location.search).get('policy') || '').toLowerCase();
      if (qPolicy === 'privacy' || qPolicy === 'terms' || qPolicy === 'safety' || qPolicy === 'security') {
        return { open: true, tab: qPolicy };
      }
    }
    return { open: false, tab: 'privacy' };
  });
  const [reportTarget, setReportTarget] = useState<{
    uid: string;
    name: string;
    chatId?: string;
  } | null>(null);
  const [appLocked, setAppLocked] = useState(false);
  const [appLockVersion, setAppLockVersion] = useState(0);
  const justSignedInUidRef = useRef<string | null>(null);
  const [statusCreateOpen, setStatusCreateOpen] = useState(false);
  const [statusViewer, setStatusViewer] = useState<{
    statuses: UserStatus[];
    initialIndex: number;
    authorOnline?: boolean;
  } | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCallSession | null>(null);
  const activeCallRef = useRef<ActiveCallSession | null>(null);
  const dismissedCallIdsRef = useRef<Set<string>>(new Set());
  const [deepInviteCode, setDeepInviteCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    const q = new URLSearchParams(window.location.search).get('invite');
    if (q) return q.toUpperCase();
    const match = window.location.pathname.match(/^\/invite\/([a-zA-Z0-9_-]+)/);
    return match ? match[1].toUpperCase() : '';
  });
  const [deepNearbyCode, setDeepNearbyCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    const q = new URLSearchParams(window.location.search).get('nearby');
    if (q) return q.replace(/\D/g, '').slice(0, 6);
    const match = window.location.pathname.match(/^\/nearby\/(\d{6})/);
    return match ? match[1] : '';
  });
  const [deepOfflineCode, setDeepOfflineCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('offline') || '';
  });
  const [deepChatId, setDeepChatId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('chat') || '';
  });
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [copiedAppLink, setCopiedAppLink] = useState(false);

  const [showNewMsgBtn, setShowNewMsgBtn] = useState(false);
  const [unseenScrollCount, setUnseenScrollCount] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const pendingSnapBottomChatRef = useRef<string | null>(null);
  const userScrolledUpInOpenRef = useRef(false);
  const prevEnteredChatMetaRef = useRef<{ view: string; chatId: string | null }>({
    view: 'hub',
    chatId: null,
  });
  const prevScrollMetaRef = useRef<{ chatId: string | null; count: number; lastId: string | null }>({
    chatId: null,
    count: 0,
    lastId: null,
  });
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoMenuRef = useRef<HTMLDivElement>(null);
  const notifContainerRef = useRef<HTMLDivElement>(null);
  const headerLangBtnRef = useRef<HTMLButtonElement>(null);
  const headerLangMenuRef = useRef<HTMLDivElement>(null);
  const handledDeepLinkRef = useRef(false);
  const lastTypingSentAtRef = useRef<number>(0);
  const typingTimeoutRef = useRef<number | null>(null);
  const bannerTimeoutRef = useRef<number | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const workspaceViewRef = useRef(workspaceView);
  const mutedChatIdsRef = useRef<string[]>(mutedChatIds);
  const mutedSoundChatIdsRef = useRef<string[]>(mutedSoundChatIds);
  const langRef = useRef<AppLanguage>(lang);
  const offlinePromptCooldownRef = useRef<Map<string, number>>(new Map());
  const chatsInitializedRef = useRef(false);
  const prevChatTimeRef = useRef<Map<string, number>>(new Map());
  const loadedChatMessagesRef = useRef<Set<string>>(new Set());
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<number | null>(null);
  const voiceStartMsRef = useRef<number>(0);
  const voiceIntentRef = useRef<'send' | 'cancel'>('cancel');
  const voiceAudioCtxRef = useRef<AudioContext | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceAnimFrameRef = useRef<number | null>(null);
  const voiceWaveLastTickRef = useRef<number>(0);

  useEffect(() => {
    initAudioUnlock();
    void registerServiceWorker();
    void checkOfficialMailerStatus().then(setOfficialMailerReady);
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const onSwMsg = (event: MessageEvent) => {
        if (event.data && event.data.type === 'OPEN_CHAT' && event.data.chatId) {
          setActiveChatId(event.data.chatId);
          setWorkspaceView('chat');
        }
      };
      navigator.serviceWorker.addEventListener('message', onSwMsg);
      return () => navigator.serviceWorker.removeEventListener('message', onSwMsg);
    }
  }, []);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    workspaceViewRef.current = workspaceView;
  }, [workspaceView]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    if (!headerLangOpen) return;
    const onPointerDown = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (
        headerLangBtnRef.current?.contains(target) ||
        headerLangMenuRef.current?.contains(target)
      ) {
        return;
      }
      setHeaderLangOpen(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setHeaderLangOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [headerLangOpen]);

  const toggleSound = () => {
    unlockAudioNow();
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) void playSentPop();
  };

  const toggleEnterToSend = (val: boolean) => {
    setEnterToSend(val);
    localStorage.setItem('kl_enter_send', val ? 'true' : 'false');
  };

  const handleRequestBgNotifications = async () => {
    unlockAudioNow();
    const res = await requestNotificationPermission();
    setNotifPermission(res);
    if (res === 'granted') {
      void playSentPop();
    }
  };

  const handleTestAlert = () => {
    unlockAudioNow();
    void playIncomingTone();
    const alertData = {
      chatId: activeChatId || chats[0]?.id || '',
      senderName: t(lang, 'testAlertTitle'),
      text: t(lang, 'testAlertBody'),
    };
    setIncomingBanner(alertData);
    if (bannerTimeoutRef.current !== null) {
      window.clearTimeout(bannerTimeoutRef.current);
    }
    bannerTimeoutRef.current = window.setTimeout(() => {
      setIncomingBanner(null);
    }, 4500);
    if (notifPermission === 'granted') {
      void showBackgroundNotification({
        title: alertData.senderName,
        body: alertData.text,
        chatId: alertData.chatId,
      });
    }
    setNotifOpen(false);
  };

  useEffect(() => {
    if (!notifOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (notifContainerRef.current && !notifContainerRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [notifOpen]);

  // Apply Light / Dark class to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', themeMode === 'dark');
    root.classList.remove('liquid-glass');
    localStorage.setItem('kl_theme', themeMode);
  }, [themeMode]);

  const handleSelectThemeMode = (mode: AppTheme) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('kl_theme_user_picked', '1');
    }
    setThemeMode(mode);
  };

  const cycleThemeMode = () => {
    handleSelectThemeMode(themeMode === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => {
      setSplashMinDone(true);
    }, prefersReduced ? 160 : 1150);
    const maxCapTimer = window.setTimeout(() => {
      setSplashDismissed(true);
    }, prefersReduced ? 500 : 2400);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(maxCapTimer);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('kl_lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtlLanguage(lang) ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    if (!photoMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (photoMenuRef.current && !photoMenuRef.current.contains(e.target as Node)) {
        setPhotoMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPhotoMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [photoMenuOpen]);

  useEffect(() => {
    mutedChatIdsRef.current = mutedChatIds;
    localStorage.setItem('kl_muted_chats', JSON.stringify(mutedChatIds));
  }, [mutedChatIds]);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  useEffect(() => {
    mutedSoundChatIdsRef.current = mutedSoundChatIds;
    localStorage.setItem('kl_muted_sound_chats', JSON.stringify(mutedSoundChatIds));
  }, [mutedSoundChatIds]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [vaultPeer, vaultPending] = await Promise.all([
        decryptVaultJson<Record<string, string>>('kl_vault_v1_peer_emails', 'kl_peer_emails'),
        decryptVaultJson<Record<string, string>>('kl_vault_v1_pending_emails', 'kl_pending_emails'),
      ]);
      if (!active) return;
      if (vaultPeer && typeof vaultPeer === 'object') {
        setPeerEmailsByChat((prev) => ({ ...vaultPeer, ...prev }));
      }
      if (vaultPending && typeof vaultPending === 'object') {
        setPendingEmailsByChat((prev) => ({ ...vaultPending, ...prev }));
      }
      emailVaultLoadedRef.current = true;
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!emailVaultLoadedRef.current) return;
    void encryptVaultJson('kl_vault_v1_peer_emails', peerEmailsByChat);
  }, [peerEmailsByChat]);

  useEffect(() => {
    if (!emailVaultLoadedRef.current) return;
    void encryptVaultJson('kl_vault_v1_pending_emails', pendingEmailsByChat);
  }, [pendingEmailsByChat]);

  useEffect(() => {
    localStorage.setItem('kl_offline_alert_optout', JSON.stringify(offlineAlertOptOutChats));
  }, [offlineAlertOptOutChats]);

  useEffect(() => {
    localStorage.setItem('kl_pinned_chats', JSON.stringify(pinnedChatIds));
  }, [pinnedChatIds]);

  // Auth listener (with offline fast-ready guard so offline Bluetooth/Code never hangs)
  useEffect(() => {
    const offlineFallbackTimer =
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? window.setTimeout(() => {
            setAuthReady(true);
          }, 1400)
        : null;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (offlineFallbackTimer !== null) {
        window.clearTimeout(offlineFallbackTimer);
      }
      setFirebaseUser(user);
      if (!user) {
        justSignedInUidRef.current = null;
        setAppLocked(false);
        clearGmailAccessToken();
        setPublicProfile(null);
        setPrivateInfo(null);
        setChats([]);
        setActiveChatId(null);
        setMessages([]);
        setAuthReady(true);
        return;
      }

      try {
        const { publicProfile: pub, privateInfo: priv } = await ensureUserProfile(user);
        setPublicProfile(pub);
        setPrivateInfo(priv);
        setAuthError('');
        setAppLocked(
          justSignedInUidRef.current === pub.uid ? false : isAppLockEnabled(pub.uid)
        );
        if (priv.language) {
          setLang(normalizeAppLanguage(priv.language));
        }
        if (Array.isArray(priv.pinnedChatIds)) {
          setPinnedChatIds(priv.pinnedChatIds.slice(0, LIMITS.PINNED_CHATS_MAX));
        } else {
          setPinnedChatIds((localPins) => {
            if (localPins.length > 0) {
              void updatePinnedChats({ uid: pub.uid, pinnedChatIds: localPins }).catch(() => {});
            }
            return localPins;
          });
        }
        void claimPendingEmailChats({ user, currentUser: pub }).catch(() => 0);
      } catch (err) {
        setAuthError(formatFriendlyError(err));
      } finally {
        setAuthReady(true);
      }
    });
    return () => {
      if (offlineFallbackTimer !== null) {
        window.clearTimeout(offlineFallbackTimer);
      }
      unsub();
    };
  }, []);

  // Real-time cross-device self profile & settings listener
  useEffect(() => {
    const uid = firebaseUser?.uid;
    if (!uid) return;
    const unsubPub = subscribeOwnUserProfile(uid, (prof) => {
      setPublicProfile(prof);
    });
    const unsubPriv = subscribeOwnPrivateInfo(uid, (priv) => {
      setPrivateInfo(priv);
      if (priv.language) {
        setLang(normalizeAppLanguage(priv.language));
      }
      if (Array.isArray(priv.pinnedChatIds)) {
        setPinnedChatIds(priv.pinnedChatIds.slice(0, LIMITS.PINNED_CHATS_MAX));
      }
    });
    return () => {
      unsubPub();
      unsubPriv();
    };
  }, [firebaseUser?.uid]);

  // App PIN Auto-Lock (visibility + inactivity timer)
  useEffect(() => {
    const uid = publicProfile?.uid;
    if (!uid || appLocked) return;
    const cfg = getAppLockConfig(uid);
    if (!cfg?.enabled) return;

    let hiddenAt = 0;
    let idleTimer: number | null = null;
    const delayMs = cfg.autoLockMinutes * 60_000;

    const resetIdleTimer = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      if (delayMs > 0) {
        idleTimer = window.setTimeout(() => {
          if (isAppLockEnabled(uid)) setAppLocked(true);
        }, delayMs);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (cfg.autoLockMinutes === 0) {
          setAppLocked(true);
        } else {
          hiddenAt = Date.now();
        }
      } else if (document.visibilityState === 'visible') {
        if (hiddenAt > 0 && delayMs > 0 && Date.now() - hiddenAt >= delayMs) {
          setAppLocked(true);
        }
        hiddenAt = 0;
        resetIdleTimer();
      }
    };

    resetIdleTimer();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pointerdown', resetIdleTimer, { passive: true });
    window.addEventListener('keydown', resetIdleTimer);

    return () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pointerdown', resetIdleTimer);
      window.removeEventListener('keydown', resetIdleTimer);
    };
  }, [publicProfile?.uid, appLocked, appLockVersion]);

  // Auto-handle deep-linked invite or nearby room once signed in
  useEffect(() => {
    if (!publicProfile || handledDeepLinkRef.current) return;
    if (deepInviteCode) {
      handledDeepLinkRef.current = true;
      window.history.replaceState({}, '', window.location.pathname);
      joinChatByInviteCode({
        currentUser: publicProfile,
        inviteCodeRaw: deepInviteCode,
        existingChats: chats,
      })
        .then((chatId) => {
          setDeepInviteCode('');
          setActiveChatId(chatId);
          setWorkspaceView('chat');
        })
        .catch(() => {
          setConnectModalTab('invite');
          setConnectModalOpen(true);
        });
    } else if (deepNearbyCode || deepOfflineCode) {
      handledDeepLinkRef.current = true;
      window.history.replaceState({}, '', window.location.pathname);
      setBtInitialMode('nearby');
      setWorkspaceView('bluetooth');
    } else if (deepChatId) {
      handledDeepLinkRef.current = true;
      window.history.replaceState({}, '', window.location.pathname);
      setActiveChatId(deepChatId);
      setWorkspaceView('chat');
      setDeepChatId('');
    }
  }, [publicProfile, deepInviteCode, deepNearbyCode, deepOfflineCode, deepChatId, chats]);

  // Firebase Presence Heartbeat (updates lastSeenAt & onlineStatus in real time)
  useEffect(() => {
    if (!publicProfile?.uid) return;
    const uid = publicProfile.uid;

    const sendHeartbeat = () => {
      if (document.visibilityState === 'visible') {
        void updateUserPresence(uid, 'online');
      }
    };

    const handleVisibility = () => {
      void updateUserPresence(uid, document.visibilityState === 'visible' ? 'online' : 'away');
    };

    const handlePageHide = () => {
      void updateUserPresence(uid, 'offline');
    };

    sendHeartbeat();
    const hbInterval = window.setInterval(sendHeartbeat, 25_000);
    const clockInterval = window.setInterval(() => setNowTick(Date.now()), 20_000);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.clearInterval(hbInterval);
      window.clearInterval(clockInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [publicProfile?.uid]);

  // Subscribe to peer profiles for real-time online/offline avatar indicators
  const peerUidsKey = useMemo(() => {
    if (!publicProfile) return '';
    const ids = chats
      .map((c) => c.participantIds.find((id) => id !== publicProfile.uid))
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids)).sort().join(',');
  }, [chats, publicProfile]);

  useEffect(() => {
    if (!peerUidsKey) {
      setPeerProfiles({});
      return;
    }
    const uids = peerUidsKey.split(',').filter(Boolean);
    return subscribeUserProfiles(uids, setPeerProfiles);
  }, [peerUidsKey]);

  // Subscribe to 24h statuses for self + all chat peers
  useEffect(() => {
    if (!publicProfile?.uid) {
      setStatuses([]);
      return;
    }
    const peerIds = peerUidsKey ? peerUidsKey.split(',').filter(Boolean) : [];
    return subscribeStatusesForUids([publicProfile.uid, ...peerIds], setStatuses);
  }, [publicProfile?.uid, peerUidsKey]);

  // Subscribe globally to incoming 1-on-1 Voice & Video calls
  useEffect(() => {
    if (!publicProfile?.uid) {
      setActiveCall(null);
      return;
    }
    void warmRtcConfig();
    return subscribeIncomingCalls(publicProfile.uid, (incomingList) => {
      if (activeCallRef.current) return;
      const nextCall = incomingList.find((c) => !dismissedCallIdsRef.current.has(c.id));
      if (!nextCall) return;
      setActiveCall({
        callId: nextCall.id,
        direction: 'incoming',
        mode: nextCall.mode,
        chatId: nextCall.chatId,
        peerUid: nextCall.callerUid,
        peerName: nextCall.callerName,
        peerPhoto: nextCall.callerPhoto,
        initialSession: nextCall,
      });
      if (document.hidden && getNotificationPermission() === 'granted' && !mutedChatIdsRef.current.includes(nextCall.chatId)) {
        void showBackgroundNotification({
          title: t(langRef.current, nextCall.mode === 'video' ? 'incomingVideoCall' : 'incomingVoiceCall'),
          body: `${nextCall.callerName}`,
          chatId: nextCall.chatId,
        });
      }
    });
  }, [publicProfile?.uid]);

  // Subscribe to user's chats + play incoming chime & show alert banner on new messages
  useEffect(() => {
    if (!publicProfile) {
      chatsInitializedRef.current = false;
      prevChatTimeRef.current.clear();
      return;
    }
    const unsub = subscribeUserChats(publicProfile.uid, (list) => {
      if (chatsInitializedRef.current) {
        let shouldChime = false;
        const newlyUnread: string[] = [];
        let latestIncoming: { chatId: string; senderName: string; text: string } | null = null;

        for (const c of list) {
          const ts = c.lastMessageAt?.toMillis?.() ?? 0;
          const prevTs = prevChatTimeRef.current.get(c.id) ?? 0;
          const isNewFromPeer =
            ts > prevTs &&
            c.lastMessageSenderId &&
            c.lastMessageSenderId !== publicProfile.uid;

            if (isNewFromPeer) {
              void markChatMessagesDelivered(c.id, publicProfile.uid, true);
              const isViewingThisChat =
                workspaceViewRef.current === 'chat' &&
                activeChatIdRef.current === c.id &&
                !document.hidden;
              const isMutedChat = mutedChatIdsRef.current.includes(c.id);
              const isSoundMutedChat = mutedSoundChatIdsRef.current.includes(c.id);
              if (!isViewingThisChat) {
                newlyUnread.push(c.id);
                if (!isMutedChat && !isSoundMutedChat) {
                  shouldChime = true;
                }
                if (!isMutedChat) {
                  const senderName =
                    c.creatorId === publicProfile.uid
                      ? c.peerName || c.title
                      : c.creatorName || c.title;
                  latestIncoming = {
                    chatId: c.id,
                    senderName,
                    text: c.lastMessageText,
                  };
                }
              }
            }
            if (ts > 0) prevChatTimeRef.current.set(c.id, ts);
          }

          if (shouldChime) void playIncomingTone();
          if (latestIncoming) {
            if (document.hidden) {
              void showBackgroundNotification({
                title: `${t(lang, 'newMsgFrom')} ${latestIncoming.senderName}`,
                body: latestIncoming.text || t(lang, 'tapToOpen'),
                chatId: latestIncoming.chatId,
              });
            }
            setIncomingBanner(latestIncoming);
            if (bannerTimeoutRef.current !== null) {
              window.clearTimeout(bannerTimeoutRef.current);
            }
            bannerTimeoutRef.current = window.setTimeout(() => {
              setIncomingBanner(null);
            }, 4800);
          }
          if (newlyUnread.length > 0) {
            setUnreadChatIds((prev) => {
              const next = new Set(prev);
              newlyUnread.forEach((id) => next.add(id));
              return next;
            });
          }
        } else {
          for (const c of list) {
            const ts = c.lastMessageAt?.toMillis?.() ?? 0;
            if (ts > 0) prevChatTimeRef.current.set(c.id, ts);
            if (c.participantIds.length > 1) {
              void markChatMessagesDelivered(c.id, publicProfile.uid, false);
            }
          }
          chatsInitializedRef.current = true;
        }

        setChats(list);
      }, (errMsg) => setChatError(errMsg));
    return () => unsub();
  }, [publicProfile]);

  // Subscribe to active chat messages, reactions, and typing indicators
  useEffect(() => {
    setJustArrivedIds(new Set());
    if (!activeChatId || !publicProfile) {
      setMessages([]);
      setReactions([]);
      setTypingStatuses([]);
      return;
    }
    let initialSnapshotDelivered = false;
    const knownInChatIds = new Set<string>();
    const arrivalTimers: number[] = [];

    const unsubMsgs = subscribeChatMessages(
      activeChatId,
      (msgs) => {
        if (!initialSnapshotDelivered) {
          initialSnapshotDelivered = true;
          loadedChatMessagesRef.current.add(activeChatId);
          for (const m of msgs) {
            knownInChatIds.add(m.id);
            seenMessageIdsRef.current.add(m.id);
          }
        } else {
          let hasIncomingPeerMsg = false;
          const freshArrivalIds: string[] = [];
          for (const m of msgs) {
            if (!knownInChatIds.has(m.id)) {
              knownInChatIds.add(m.id);
              const isUnseen = !seenMessageIdsRef.current.has(m.id);
              seenMessageIdsRef.current.add(m.id);
              if (m.senderId !== publicProfile.uid) {
                freshArrivalIds.push(m.id);
                if (isUnseen) {
                  hasIncomingPeerMsg = true;
                }
              }
            }
          }
          if (freshArrivalIds.length > 0) {
            setJustArrivedIds((prev) => {
              const next = new Set(prev);
              freshArrivalIds.forEach((id) => next.add(id));
              return next;
            });
            const timer = window.setTimeout(() => {
              setJustArrivedIds((prev) => {
                const next = new Set(prev);
                let changed = false;
                freshArrivalIds.forEach((id) => {
                  if (next.delete(id)) changed = true;
                });
                return changed ? next : prev;
              });
            }, 1800);
            arrivalTimers.push(timer);
          }
          if (
            hasIncomingPeerMsg &&
            !mutedChatIdsRef.current.includes(activeChatId) &&
            !mutedSoundChatIdsRef.current.includes(activeChatId)
          ) {
            void playIncomingTone();
          }
        }

        // Prune confirmed optimistic messages
        const confirmedIds = new Set(msgs.map((m) => m.id));
        setOptimisticByChat((prev) => {
          const current = prev[activeChatId];
          if (!current || current.length === 0) return prev;
          const remaining = current.filter((m) => !confirmedIds.has(m.id));
          if (remaining.length === current.length) return prev;
          return { ...prev, [activeChatId]: remaining };
        });

        setMessages(msgs);
      },
      (errMsg) => setChatError(errMsg)
    );
    const unsubReacts = subscribeChatReactions(activeChatId, setReactions);
    const unsubTyping = subscribeTypingStatus(activeChatId, (statuses) => {
      setNowTick(Date.now());
      setTypingStatuses(statuses);
    });

    const unsubParticipantEmails = subscribeChatParticipantEmails(activeChatId, (emailsByUid) => {
      const peerEntry = Object.entries(emailsByUid).find(([uid]) => uid !== publicProfile.uid);
      if (peerEntry && peerEntry[1]) {
        const detectedEmail = peerEntry[1];
        setPeerEmailsByChat((prev) =>
          prev[activeChatId] === detectedEmail ? prev : { ...prev, [activeChatId]: detectedEmail }
        );
        setOfflineEmailPrompt((prev) =>
          prev && prev.chatId === activeChatId && !prev.toEmail
            ? { ...prev, toEmail: detectedEmail, editingEmail: false }
            : prev
        );
      }
    });

    return () => {
      unsubMsgs();
      unsubReacts();
      unsubTyping();
      unsubParticipantEmails();
      arrivalTimers.forEach((id) => window.clearTimeout(id));
      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (lastTypingSentAtRef.current > 0) {
        lastTypingSentAtRef.current = 0;
        void setTypingStatus({
          chatId: activeChatId,
          user: publicProfile,
          isTyping: false,
        });
      }
    };
  }, [activeChatId, publicProfile]);

  // Automatically share own verified Gmail and pre-fetch peers' verified Gmails across all chats
  useEffect(() => {
    const uid = publicProfile?.uid;
    const email = privateInfo?.email;
    if (!uid || chats.length === 0) return;

    if (email) {
      chats.forEach((c) => {
        if (c.participantIds.includes(uid)) {
          void syncMyChatParticipantEmail({ chatId: c.id, uid, email });
        }
      });
    }

    let cancelled = false;
    void fetchAllChatParticipantEmails(
      chats.map((c) => c.id),
      uid
    ).then((detectedMap) => {
      if (cancelled || Object.keys(detectedMap).length === 0) return;
      setPeerEmailsByChat((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(detectedMap).forEach(([cid, peerEmail]) => {
          if (!next[cid] && peerEmail) {
            next[cid] = peerEmail;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [chats, publicProfile?.uid, privateInfo?.email]);

  // Mark incoming messages as Seen (green plane) only while actively viewing this chat and tab is visible
  useEffect(() => {
    const uid = publicProfile?.uid;
    if (!uid || !activeChatId || workspaceView !== 'chat' || messages.length === 0) return;

    const receiptsEnabled = privateInfo?.readReceiptsEnabled !== false;
    const tryMarkSeen = () => {
      if (document.visibilityState === 'visible') {
        void markChatMessagesSeen(activeChatId, uid, messages, receiptsEnabled);
      }
    };

    tryMarkSeen();
    document.addEventListener('visibilitychange', tryMarkSeen);
    window.addEventListener('focus', tryMarkSeen);
    return () => {
      document.removeEventListener('visibilitychange', tryMarkSeen);
      window.removeEventListener('focus', tryMarkSeen);
    };
  }, [activeChatId, workspaceView, messages, publicProfile?.uid, privateInfo?.readReceiptsEnabled]);

  // Keep open Message Info dialog synchronized with real-time delivery/seen timestamps
  const liveMessageInfo = useMemo(() => {
    if (!messageInfoTarget) return null;
    return messages.find((m) => m.id === messageInfoTarget.id) || messageInfoTarget;
  }, [messageInfoTarget, messages]);

  const renderedMessages = useMemo(() => {
    if (!activeChatId) return messages;
    const pending = optimisticByChat[activeChatId] || [];
    if (pending.length === 0) return messages;
    const confirmedIds = new Set(messages.map((m) => m.id));
    const unconfirmed = pending.filter((m) => !confirmedIds.has(m.id));
    return unconfirmed.length > 0 ? [...messages, ...unconfirmed] : messages;
  }, [messages, optimisticByChat, activeChatId]);

  const activePeerTypers = useMemo(() => {
    if (!publicProfile) return [];
    return typingStatuses.filter((s) => {
      if (s.uid === publicProfile.uid || !s.isTyping) return false;
      const updatedMs = s.updatedAt?.toMillis?.();
      if (!updatedMs) return true;
      return nowTick - updatedMs < 9000;
    });
  }, [typingStatuses, publicProfile, nowTick]);

  // Periodically refresh "Last online" labels every 30s and expire typing indicators every 2s
  useEffect(() => {
    if (!publicProfile) return;
    const ms = activePeerTypers.length > 0 ? 2000 : 30_000;
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, ms);
    return () => window.clearInterval(interval);
  }, [publicProfile, activePeerTypers.length]);

  const snapFeedToVeryBottom = useCallback(() => {
    const el = feedScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    isNearBottomRef.current = true;
    setShowNewMsgBtn(false);
    setUnseenScrollCount(0);
  }, []);

  const setFeedScrollNode = useCallback(
    (node: HTMLDivElement | null) => {
      feedScrollRef.current = node;
      if (node && activeChatId && pendingSnapBottomChatRef.current === activeChatId) {
        node.scrollTop = node.scrollHeight;
        isNearBottomRef.current = true;
        setShowNewMsgBtn(false);
        setUnseenScrollCount(0);
        window.requestAnimationFrame(() => {
          if (!userScrolledUpInOpenRef.current && feedScrollRef.current === node) {
            node.scrollTop = node.scrollHeight;
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
          }
        });
      }
    },
    [activeChatId]
  );

  const scrollFeedToTop = useCallback((smooth = true) => {
    userScrolledUpInOpenRef.current = true;
    pendingSnapBottomChatRef.current = null;
    feedScrollRef.current?.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const scrollFeedToBottom = useCallback((smooth = true) => {
    isNearBottomRef.current = true;
    setShowNewMsgBtn(false);
    setUnseenScrollCount(0);
    const el = feedScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
  }, []);

  const handleFeedScroll = useCallback(() => {
    const el = feedScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= 110;
    isNearBottomRef.current = nearBottom;
    if (!nearBottom) {
      userScrolledUpInOpenRef.current = true;
      pendingSnapBottomChatRef.current = null;
    } else {
      setShowNewMsgBtn(false);
      setUnseenScrollCount(0);
    }
  }, []);

  // Track whenever user enters any chat view (sidebar click, profile open, invite link, or banner)
  useEffect(() => {
    const prev = prevEnteredChatMetaRef.current;
    const enteredChatView =
      workspaceView === 'chat' &&
      Boolean(activeChatId) &&
      (prev.view !== 'chat' || prev.chatId !== activeChatId);
    prevEnteredChatMetaRef.current = { view: workspaceView, chatId: activeChatId };
    if (enteredChatView && activeChatId) {
      pendingSnapBottomChatRef.current = activeChatId;
      userScrolledUpInOpenRef.current = false;
      isNearBottomRef.current = true;
    }
  }, [workspaceView, activeChatId]);

  // Smart auto-scroll: always snap directly to the very last message when opening a chat/profile, else follow new messages near bottom
  useLayoutEffect(() => {
    const lastMsg = renderedMessages[renderedMessages.length - 1];
    const lastId = lastMsg?.id ?? null;
    const prev = prevScrollMetaRef.current;
    const chatChanged = prev.chatId !== activeChatId;
    const grew = renderedMessages.length > prev.count || (lastId !== null && lastId !== prev.lastId);

    prevScrollMetaRef.current = {
      chatId: activeChatId,
      count: renderedMessages.length,
      lastId,
    };

    if (!activeChatId || workspaceView !== 'chat') {
      setShowNewMsgBtn(false);
      setUnseenScrollCount(0);
      isNearBottomRef.current = true;
      return;
    }

    if (pendingSnapBottomChatRef.current === activeChatId) {
      snapFeedToVeryBottom();
      if (renderedMessages.length > 0 && feedScrollRef.current) {
        pendingSnapBottomChatRef.current = null;
        const rafId = window.requestAnimationFrame(() => {
          if (!userScrolledUpInOpenRef.current) snapFeedToVeryBottom();
        });
        const t1 = window.setTimeout(() => {
          if (!userScrolledUpInOpenRef.current) snapFeedToVeryBottom();
        }, 190);
        const t2 = window.setTimeout(() => {
          if (!userScrolledUpInOpenRef.current) snapFeedToVeryBottom();
        }, 380);
        return () => {
          window.cancelAnimationFrame(rafId);
          window.clearTimeout(t1);
          window.clearTimeout(t2);
        };
      }
      return;
    }

    if (chatChanged) {
      isNearBottomRef.current = true;
      setShowNewMsgBtn(false);
      setUnseenScrollCount(0);
      snapFeedToVeryBottom();
      return;
    }

    if (grew && lastMsg) {
      const sentByMe = publicProfile ? lastMsg.senderId === publicProfile.uid : false;
      if (sentByMe || isNearBottomRef.current) {
        scrollFeedToBottom(true);
      } else {
        setShowNewMsgBtn(true);
        setUnseenScrollCount((c) => c + 1);
      }
      return;
    }

    if (activePeerTypers.length > 0 && isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [
    activeChatId,
    workspaceView,
    renderedMessages,
    activePeerTypers.length,
    publicProfile,
    scrollFeedToBottom,
    snapFeedToVeryBottom,
  ]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) || null,
    [chats, activeChatId]
  );

  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, AggregatedReaction[]>();
    const grouped = new Map<string, Map<ReactionEmoji, { count: number; reactedByMe: boolean }>>();
    for (const r of reactions) {
      let emojiMap = grouped.get(r.messageId);
      if (!emojiMap) {
        emojiMap = new Map();
        grouped.set(r.messageId, emojiMap);
      }
      const existing = emojiMap.get(r.emoji) || { count: 0, reactedByMe: false };
      existing.count += 1;
      if (publicProfile && r.uid === publicProfile.uid) {
        existing.reactedByMe = true;
      }
      emojiMap.set(r.emoji, existing);
    }
    grouped.forEach((emojiMap, messageId) => {
      const arr: AggregatedReaction[] = [];
      emojiMap.forEach((info, emoji) => {
        arr.push({ emoji, count: info.count, reactedByMe: info.reactedByMe });
      });
      arr.sort((a, b) => b.count - a.count);
      map.set(messageId, arr);
    });
    return map;
  }, [reactions, publicProfile]);

  const myReactionByMessage = useMemo(() => {
    const map = new Map<string, ReactionEmoji>();
    if (!publicProfile) return map;
    for (const r of reactions) {
      if (r.uid === publicProfile.uid) {
        map.set(r.messageId, r.emoji);
      }
    }
    return map;
  }, [reactions, publicProfile]);

  const pinnedOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    pinnedChatIds.forEach((id, idx) => map.set(id, idx));
    return map;
  }, [pinnedChatIds]);

  const filteredChats = useMemo(() => {
    const matches = chats.filter((chat) => {
      if (filterTab !== 'all' && chat.channel !== filterTab) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const peerId = chat.participantIds.find((id) => id !== publicProfile?.uid);
      const livePeerName = peerId ? peerProfiles[peerId]?.displayName?.toLowerCase() || '' : '';
      return (
        chat.title.toLowerCase().includes(q) ||
        chat.peerName.toLowerCase().includes(q) ||
        livePeerName.includes(q) ||
        chat.targetHint.toLowerCase().includes(q) ||
        chat.lastMessageText.toLowerCase().includes(q)
      );
    });
    if (pinnedOrderMap.size === 0) return matches;
    return [...matches].sort((a, b) => {
      const aPinIdx = pinnedOrderMap.get(a.id);
      const bPinIdx = pinnedOrderMap.get(b.id);
      if (aPinIdx !== undefined && bPinIdx !== undefined) {
        return aPinIdx - bPinIdx;
      }
      if (aPinIdx !== undefined) return -1;
      if (bPinIdx !== undefined) return 1;
      return 0;
    });
  }, [chats, filterTab, searchQuery, pinnedOrderMap, peerProfiles, publicProfile?.uid]);

  const handleTogglePinChat = useCallback(
    (chatId: string) => {
      setPinnedChatIds((prev) => {
        const isCurrentlyPinned = prev.includes(chatId);
        let next: string[];
        if (isCurrentlyPinned) {
          next = prev.filter((id) => id !== chatId);
        } else {
          if (prev.length >= LIMITS.PINNED_CHATS_MAX) {
            setChatError(t(lang, 'pinLimitReached'));
            return prev;
          }
          next = [chatId, ...prev.filter((id) => id !== chatId)];
        }
        if (publicProfile?.uid) {
          void updatePinnedChats({ uid: publicProfile.uid, pinnedChatIds: next }).catch(() => {});
        }
        return next;
      });
    },
    [publicProfile?.uid, lang]
  );

  // Fast 3-letter global user profile search synchronized with sidebar search input
  useEffect(() => {
    if (!publicProfile?.uid) {
      setSidebarPeopleResults([]);
      setSidebarSearchingPeople(false);
      return;
    }
    const trimmed = searchQuery.trim();
    const charLen = Array.from(trimmed).length;
    if (charLen < 2) {
      setSidebarPeopleResults([]);
      setSidebarSearchingPeople(false);
      return;
    }

    const blockedUids = privateInfo?.blockedUids || [];
    const instant = getInstantLocalUserMatches({
      queryText: trimmed,
      currentUid: publicProfile.uid,
      knownProfiles: peerProfiles,
      blockedUids,
    });
    setSidebarPeopleResults(instant);

    if (charLen < 3) {
      setSidebarSearchingPeople(false);
      return;
    }

    let cancelled = false;
    setSidebarSearchingPeople(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchUserProfiles({
          queryText: trimmed,
          currentUid: publicProfile.uid,
          knownProfiles: peerProfiles,
          blockedUids,
        });
        if (cancelled) return;
        setSidebarPeopleResults(found);
        setSidebarSearchingPeople(false);

        if (found.length > 0) {
          const liveMap = await hydrateSearchResultProfiles(found.map((u) => u.uid));
          if (cancelled || Object.keys(liveMap).length === 0) return;
          setSidebarPeopleResults((prev) =>
            prev.map((item) => {
              const live = liveMap[item.uid];
              if (!live) return item;
              return {
                ...item,
                displayName: live.displayName || item.displayName,
                photoUrl: live.photoUrl !== undefined ? live.photoUrl : item.photoUrl,
                bio: live.bio || item.bio,
                maskedEmail: live.showGmail === false ? '' : live.maskedEmail || item.maskedEmail,
                showGmail: live.showGmail !== false,
                onlineStatus: live.onlineStatus,
                lastSeenAt: live.lastSeenAt,
                showOnlineStatus: live.showOnlineStatus,
                onlineVisibility: live.onlineVisibility,
              };
            })
          );
        }
      } catch {
        if (!cancelled) setSidebarSearchingPeople(false);
      }
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, publicProfile?.uid, peerProfiles, privateInfo?.blockedUids]);

  const unreadChats = useMemo(
    () => chats.filter((c) => unreadChatIds.has(c.id)),
    [chats, unreadChatIds]
  );

  const handleGoogleSignIn = async () => {
    unlockAudioNow();
    if (!agreeTerms || !agreePrivacy || !agreeSecurity) {
      setAuthError(t(lang, 'consentMissingError'));
      setConsentFlash(true);
      window.setTimeout(() => setConsentFlash(false), 550);
      return;
    }
    setAuthError('');
    setAuthLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      captureGmailTokenFromCredential(GoogleAuthProvider.credentialFromResult(result));
      setGuestBluetoothOpen(false);
      // If the same user was already signed in (e.g. retrying after a network error), ensure profile loads immediately
      if (result.user) {
        justSignedInUidRef.current = result.user.uid;
        setAppLocked(false);
        const { publicProfile: pub, privateInfo: priv } = await ensureUserProfile(result.user);
        setFirebaseUser(result.user);
        setPublicProfile(pub);
        setPrivateInfo(priv);
        if (priv.acceptedPolicyVersion !== CURRENT_POLICY_VERSION) {
          void acceptPolicyVersion({ uid: result.user.uid, version: CURRENT_POLICY_VERSION }).catch(() => {});
        }
        if (priv.language) {
          setLang(normalizeAppLanguage(priv.language));
        }
        if (Array.isArray(priv.pinnedChatIds)) {
          setPinnedChatIds(priv.pinnedChatIds.slice(0, LIMITS.PINNED_CHATS_MAX));
        }
        void claimPendingEmailChats({ user: result.user, currentUser: pub }).catch(() => 0);
      }
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      const msg = err instanceof Error ? err.message : 'Sign-in failed.';
      if (code === 'auth/popup-closed-by-user' || msg.includes('popup-closed-by-user')) {
        return;
      }
      if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setAuthError(
          `UNAUTHORIZED_DOMAIN::${host}`
        );
      } else if (code === 'auth/popup-blocked' || msg.includes('popup-blocked')) {
        setAuthError(
          lang === 'bn'
            ? 'ব্রাউজার লগইন পপআপ ব্লক করেছে। অনুগ্রহ করে এই সাইটের জন্য pop-up চালু করে আবার চেষ্টা করুন।'
            : 'Browser blocked the Google sign-in popup. Please allow pop-ups for this site and try again.'
        );
      } else {
        setAuthError(formatFriendlyError(err) || msg);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setProfileModalOpen(false);
    setAppLocked(false);
    setAgreeTerms(false);
    setAgreePrivacy(false);
    setAgreeSecurity(false);
    setAuthError('');
    justSignedInUidRef.current = null;
    clearGmailAccessToken();
    if (publicProfile?.uid) {
      await updateUserPresence(publicProfile.uid, 'offline');
    }
    await signOut(auth);
  };

  const handleToggleBlockUid = async (targetUid: string, forceBlock?: boolean) => {
    if (!publicProfile || !privateInfo || !targetUid || targetUid === publicProfile.uid) return;
    const current = privateInfo.blockedUids || [];
    const alreadyBlocked = current.includes(targetUid);
    const shouldBlock = typeof forceBlock === 'boolean' ? forceBlock : !alreadyBlocked;
    if (shouldBlock === alreadyBlocked) return;
    const next = shouldBlock
      ? [targetUid, ...current].slice(0, LIMITS.BLOCKED_USERS_MAX)
      : current.filter((id) => id !== targetUid);
    setPrivateInfo((prev) => (prev ? { ...prev, blockedUids: next } : prev));
    await updateBlockedUsers({ uid: publicProfile.uid, blockedUids: next });
  };

  const handleAcceptPolicy = async () => {
    if (!publicProfile) return;
    await acceptPolicyVersion({ uid: publicProfile.uid, version: CURRENT_POLICY_VERSION });
    setPrivateInfo((prev) =>
      prev ? { ...prev, acceptedPolicyVersion: CURRENT_POLICY_VERSION } : prev
    );
  };

  const handleExportMyData = () => {
    if (!publicProfile || !privateInfo) return;
    exportMyUserData({
      publicProfile,
      privateInfo,
      chats,
      statuses,
    });
  };

  const handleDeleteAccount = async () => {
    if (!firebaseUser) return;
    await deleteUserAccount(firebaseUser, privateInfo);
    setProfileModalOpen(false);
  };

  const handleDeleteChat = async (chat: ChatRoom) => {
    if (!publicProfile) return;
    await deleteChatRoom({ chat, currentUid: publicProfile.uid });
    setPinnedChatIds((prev) => {
      if (!prev.includes(chat.id)) return prev;
      const next = prev.filter((id) => id !== chat.id);
      void updatePinnedChats({ uid: publicProfile.uid, pinnedChatIds: next }).catch(() => {});
      return next;
    });
    setPeerProfileModalOpen(false);
    if (activeChatId === chat.id) {
      setActiveChatId(null);
      setWorkspaceView('hub');
    }
  };

  const clearOwnTyping = useCallback(
    (chatId?: string | null) => {
      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (lastTypingSentAtRef.current > 0 && chatId && publicProfile) {
        lastTypingSentAtRef.current = 0;
        void setTypingStatus({
          chatId,
          user: publicProfile,
          isTyping: false,
        });
      } else {
        lastTypingSentAtRef.current = 0;
      }
    },
    [publicProfile]
  );

  const handleComposerChange = (value: string) => {
    setMessageInput(value);
    if (!activeChat || !publicProfile) return;

    if (!value.trim()) {
      clearOwnTyping(activeChat.id);
      return;
    }

    const now = Date.now();
    if (now - lastTypingSentAtRef.current > 1800) {
      lastTypingSentAtRef.current = now;
      void setTypingStatus({
        chatId: activeChat.id,
        user: publicProfile,
        isTyping: true,
      });
    }

    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    const targetChatId = activeChat.id;
    typingTimeoutRef.current = window.setTimeout(() => {
      clearOwnTyping(targetChatId);
    }, 3000);
  };

  const handleAttachmentPicked = async (file: File) => {
    setChatError('');
    setPreparingAttachment(true);
    try {
      const prepared = await prepareAttachment(file);
      setPendingAttachment(prepared);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Unable to attach file.');
    } finally {
      setPreparingAttachment(false);
    }
  };

  const cleanupVoiceStream = useCallback(() => {
    if (voiceAnimFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceAnimFrameRef.current);
      voiceAnimFrameRef.current = null;
    }
    if (voiceTimerRef.current !== null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    if (voiceAnalyserRef.current) {
      try {
        voiceAnalyserRef.current.disconnect();
      } catch {
        // Ignore disconnect failure
      }
      voiceAnalyserRef.current = null;
    }
    if (voiceAudioCtxRef.current) {
      try {
        void voiceAudioCtxRef.current.close();
      } catch {
        // Ignore close failure
      }
      voiceAudioCtxRef.current = null;
    }
    if (voiceStreamRef.current) {
      voiceStreamRef.current.getTracks().forEach((tr) => tr.stop());
      voiceStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setVoiceWaveform(Array(24).fill(0.18));
  }, []);

  useEffect(() => {
    return () => {
      voiceIntentRef.current = 'cancel';
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // Ignore stop errors on unmount
      }
      cleanupVoiceStream();
    };
  }, [cleanupVoiceStream]);

  useEffect(() => {
    if (isRecordingVoice) {
      voiceIntentRef.current = 'cancel';
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // Ignore
      }
      cleanupVoiceStream();
      setIsRecordingVoice(false);
      setVoiceRecordSeconds(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);

  const handleSendMessage = async (
    e?: React.FormEvent,
    overrideText?: string,
    overrideAttachment?: PreparedAttachment | null
  ) => {
    e?.preventDefault();
    unlockAudioNow();
    if (!activeChat || !publicProfile || preparingAttachment) return;
    const peerUid = activeChat.participantIds.find((id) => id !== publicProfile.uid);
    if (peerUid && privateInfo?.blockedUids?.includes(peerUid)) {
      setChatError(t(lang, 'blockedBannerText'));
      return;
    }
    const textToSend = (overrideText ?? messageInput).trim();
    const attachmentToSend =
      overrideAttachment !== undefined
        ? overrideAttachment
        : overrideText
        ? null
        : pendingAttachment;
    if (!textToSend && !attachmentToSend) return;

    const targetChat = activeChat;
    const clientMsgId = createClientMessageId(targetChat.id);
    const replySnippet = replyingTo
      ? (replyingTo.text || replyingTo.attachmentName || '').slice(0, 120)
      : '';

    clearOwnTyping(targetChat.id);
    setChatError('');
    if (!overrideText && overrideAttachment === undefined) {
      setMessageInput('');
      setPendingAttachment(null);
    }
    setReplyingTo(null);
    setShowEmojiPicker(false);
    setSendPulseKey((k) => k + 1);

    // Instant 0ms optimistic render
    const optimisticMsg: ChatMessage = {
      id: clientMsgId,
      chatId: targetChat.id,
      senderId: publicProfile.uid,
      senderName: publicProfile.displayName,
      text: textToSend,
      attachmentType: attachmentToSend ? attachmentToSend.attachmentType : 'none',
      attachmentName: attachmentToSend ? attachmentToSend.attachmentName : '',
      attachmentMime: attachmentToSend ? attachmentToSend.attachmentMime : '',
      attachmentSize: attachmentToSend ? attachmentToSend.attachmentSize : 0,
      attachmentData: attachmentToSend ? attachmentToSend.attachmentData : '',
      transport: targetChat.channel === 'gmail' ? 'gmail' : 'nearby',
      replyToText: replySnippet,
      createdAt: null,
      optimistic: true,
    };

    seenMessageIdsRef.current.add(clientMsgId);
    setJustSentIds((prev) => {
      const next = new Set(prev);
      next.add(clientMsgId);
      return next;
    });
    window.setTimeout(() => {
      setJustSentIds((prev) => {
        if (!prev.has(clientMsgId)) return prev;
        const next = new Set(prev);
        next.delete(clientMsgId);
        return next;
      });
    }, 1500);

    setOptimisticByChat((prev) => ({
      ...prev,
      [targetChat.id]: [...(prev[targetChat.id] || []), optimisticMsg],
    }));
    void playSentPop();
    if (attachmentToSend) {
      setUploadProgress(5);
    }

    try {
      await sendChatMessage({
        chat: targetChat,
        sender: publicProfile,
        text: textToSend,
        replyToText: replySnippet,
        clientMessageId: clientMsgId,
        attachment: attachmentToSend,
        onProgress: attachmentToSend ? (pct) => setUploadProgress(pct) : undefined,
      });

      const peerProfile = getChatPeerProfile(targetChat);
      const nowMs = Date.now();
      const peerOnlineNow = isPeerOnline(peerProfile, nowMs);
      const isOptedOut = offlineAlertOptOutChats.includes(targetChat.id);
      if (!peerOnlineNow && targetChat.channel !== 'nearby' && !isOptedOut) {
        const lastPromptedAt = offlinePromptCooldownRef.current.get(targetChat.id) ?? 0;
        if (nowMs - lastPromptedAt > 120_000) {
          offlinePromptCooldownRef.current.set(targetChat.id, nowMs);
          const savedEmail =
            peerProfile?.showGmail === false
              ? ''
              : peerEmailsByChat[targetChat.id] || pendingEmailsByChat[targetChat.id] || '';
          setOfflineEmailPrompt({
            chatId: targetChat.id,
            peerName: getChatDisplayName(targetChat),
            presenceText: formatPresenceLabel(peerProfile, lang, nowMs),
            messagePreview: textToSend || attachmentToSend?.attachmentName || 'Attachment',
            toEmail: savedEmail,
            editingEmail: !savedEmail,
            sending: false,
            error: '',
          });
        }
      }
    } catch (err) {
      setOptimisticByChat((prev) => ({
        ...prev,
        [targetChat.id]: (prev[targetChat.id] || []).filter((m) => m.id !== clientMsgId),
      }));
      setChatError(formatFriendlyError(err));
      if (!overrideText && overrideAttachment === undefined && textToSend) {
        setMessageInput((curr) => (curr ? curr : textToSend));
      }
      if (attachmentToSend && overrideAttachment === undefined) {
        setPendingAttachment((curr) => curr ?? attachmentToSend);
      }
    } finally {
      setUploadProgress(null);
    }
  };

  const stopVoiceRecording = (intent: 'send' | 'cancel') => {
    voiceIntentRef.current = intent;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        cleanupVoiceStream();
        setIsRecordingVoice(false);
        setVoiceRecordSeconds(0);
      }
    } else {
      cleanupVoiceStream();
      setIsRecordingVoice(false);
      setVoiceRecordSeconds(0);
    }
  };

  const startVoiceRecording = async () => {
    unlockAudioNow();
    setChatError('');
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setChatError(t(lang, 'voiceUnsupported'));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      voiceIntentRef.current = 'send';

      const mimeCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const chosenMime =
        typeof MediaRecorder.isTypeSupported === 'function'
          ? mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || ''
          : '';

      const recorder = new MediaRecorder(
        stream,
        chosenMime ? { mimeType: chosenMime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }
      );
      mediaRecorderRef.current = recorder;
      voiceStartMsRef.current = Date.now();
      setVoiceRecordSeconds(0);
      setIsRecordingVoice(true);

      // Attach read-only Web Audio AnalyserNode for real-time voice waveform visualization
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.72;
          source.connect(analyser);
          voiceAudioCtxRef.current = ctx;
          voiceAnalyserRef.current = analyser;
          if (ctx.state === 'suspended') {
            void ctx.resume().catch(() => {});
          }

          const freqBuf = new Uint8Array(analyser.frequencyBinCount);
          const barCount = 24;
          const stepSample = (now: number) => {
            if (!voiceAnalyserRef.current) return;
            if (now - voiceWaveLastTickRef.current >= 34) {
              voiceWaveLastTickRef.current = now;
              voiceAnalyserRef.current.getByteFrequencyData(freqBuf);
              const bars: number[] = [];
              for (let i = 0; i < barCount; i++) {
                // Mirror/distribute frequency bins cleanly across 24 bars
                const binIdx = Math.min(freqBuf.length - 1, Math.floor((i / barCount) * (freqBuf.length * 0.75)));
                const v = freqBuf[binIdx] / 255;
                const floor = 0.14 + Math.sin(now / 180 + i * 0.45) * 0.05;
                bars.push(Math.min(1, Math.max(floor, v * 1.15)));
              }
              setVoiceWaveform(bars);
            }
            voiceAnimFrameRef.current = window.requestAnimationFrame(stepSample);
          };
          voiceAnimFrameRef.current = window.requestAnimationFrame(stepSample);
        }
      } catch {
        // Fallback gently if Web Audio API analyser is blocked
      }

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          voiceChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const intent = voiceIntentRef.current;
        const elapsedSec = Math.max(1, Math.round((Date.now() - voiceStartMsRef.current) / 1000));
        const rawMime = recorder.mimeType || chosenMime || 'audio/webm';
        const cleanMime = rawMime.split(';')[0] || 'audio/webm';
        const chunks = voiceChunksRef.current.slice();
        voiceChunksRef.current = [];
        cleanupVoiceStream();
        setIsRecordingVoice(false);
        setVoiceRecordSeconds(0);

        if (intent !== 'send' || chunks.length === 0) return;

        const ext = cleanMime.includes('mp4')
          ? 'm4a'
          : cleanMime.includes('ogg')
          ? 'ogg'
          : 'webm';
        const mins = Math.floor(elapsedSec / 60);
        const secs = (elapsedSec % 60).toString().padStart(2, '0');
        const label = `Voice message (${mins}:${secs}).${ext}`;

        setVoiceBusy(true);
        try {
          const blob = new Blob(chunks, { type: cleanMime });
          const voiceFile = new File([blob], label, { type: cleanMime });
          const prepared = await prepareAttachment(voiceFile);
          await handleSendMessage(undefined, '', prepared);
        } catch (err) {
          setChatError(err instanceof Error ? err.message : 'Unable to send voice message.');
        } finally {
          setVoiceBusy(false);
        }
      };

      recorder.start(250);
      if (voiceTimerRef.current !== null) {
        window.clearInterval(voiceTimerRef.current);
      }
      voiceTimerRef.current = window.setInterval(() => {
        const sec = Math.floor((Date.now() - voiceStartMsRef.current) / 1000);
        setVoiceRecordSeconds(sec);
        if (sec >= 180) {
          stopVoiceRecording('send');
        }
      }, 250);
    } catch {
      cleanupVoiceStream();
      setIsRecordingVoice(false);
      setChatError(t(lang, 'micDenied'));
    }
  };

  const getInviteUrl = (inviteCode: string) => buildInviteShareUrl(inviteCode);

  const sharePublicApp = async () => {
    const url = getPublicAppOrigin();
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'LoopLy Chat',
          text: 'Chat with me on LoopLy via Gmail, Invite Code, or Nearby:',
          url,
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    await navigator.clipboard.writeText(url);
    setCopiedAppLink(true);
    setTimeout(() => setCopiedAppLink(false), 2200);
  };

  const copyChatInviteLink = async (chat: ChatRoom) => {
    if (!chat.inviteCode) return;
    await navigator.clipboard.writeText(getInviteUrl(chat.inviteCode));
    setCopiedInviteId(chat.id);
    setTimeout(() => setCopiedInviteId(null), 2000);
  };

  const shareChatInvite = async (chat: ChatRoom) => {
    if (!chat.inviteCode) return;
    const url = getInviteUrl(chat.inviteCode);
    const shareText = `Join my chat on LoopLy (Code: ${chat.inviteCode}): ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'LoopLy Chat Invite', text: shareText, url });
        return;
      } catch {
        // Fall through to copy
      }
    }
    await copyChatInviteLink(chat);
  };

  const openChat = (chatId: string) => {
    unlockAudioNow();
    if (activeChatId !== chatId) {
      setMessages([]);
    }
    pendingSnapBottomChatRef.current = chatId;
    userScrolledUpInOpenRef.current = false;
    isNearBottomRef.current = true;
    setActiveChatId(chatId);
    setWorkspaceView('chat');
    setReplyingTo(null);
    setPendingAttachment(null);
    setChatError('');
    setIncomingBanner((prev) => (prev?.chatId === chatId ? null : prev));
    setUnreadChatIds((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.delete(chatId);
      return next;
    });
  };

  const handleStartChatFromSearch = async (target: UserSearchResult) => {
    if (!publicProfile || startingSearchUid) return;
    const existingDm = chats.find(
      (c) =>
        c.participantIds.length === 2 &&
        c.participantIds.includes(publicProfile.uid) &&
        c.participantIds.includes(target.uid)
    );
    if (existingDm) {
      setPreviewedUser(null);
      openChat(existingDm.id);
      return;
    }
    setStartingSearchUid(target.uid);
    try {
      const chatId = await startChatByUserProfile({
        currentUser: publicProfile,
        target,
        existingChats: chats,
      });
      setPreviewedUser(null);
      openChat(chatId);
    } catch (err) {
      setChatError(formatFriendlyError(err));
    } finally {
      setStartingSearchUid(null);
    }
  };

  const getChatDisplayName = (chat: ChatRoom): string => {
    if (!publicProfile) return chat.title;
    const peerUid = chat.participantIds.find((id) => id !== publicProfile.uid);
    const livePeer = peerUid ? peerProfiles[peerUid] : undefined;
    if (livePeer?.displayName?.trim()) {
      return livePeer.displayName;
    }
    if (chat.creatorId === publicProfile.uid) {
      return chat.peerName || chat.title;
    }
    return chat.creatorName || chat.title;
  };

  const getChatPeerProfile = (chat: ChatRoom): UserPublicProfile | undefined => {
    if (!publicProfile) return undefined;
    const peerUid = chat.participantIds.find((id) => id !== publicProfile.uid);
    return peerUid ? peerProfiles[peerUid] : undefined;
  };

  const handleStartCall = (chat: ChatRoom, mode: CallMode) => {
    unlockAudioNow();
    if (!publicProfile) return;
    const peerUid = chat.participantIds.find((id) => id !== publicProfile.uid);
    if (!peerUid) {
      setChatError(t(lang, 'callInviteWaitingWarn'));
      return;
    }
    if (privateInfo?.blockedUids?.includes(peerUid)) {
      setChatError(t(lang, 'blockedBannerText'));
      return;
    }
    const peer = peerProfiles[peerUid];
    const callId = generateCallId();
    setActiveCall({
      callId,
      direction: 'outgoing',
      mode,
      chatId: chat.id,
      peerUid,
      peerName: peer?.displayName || getChatDisplayName(chat),
      peerPhoto: peer?.photoUrl || '',
    });
  };

  const showLaunchSplash = !splashDismissed && (!authReady || !splashMinDone);
  const isMobileDetailActive =
    workspaceView === 'chat' ||
    workspaceView === 'bluetooth' ||
    workspaceView === 'gemini';

  let appBody: React.ReactNode;

  if (!authReady) {
    appBody = (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  } else if (!firebaseUser || !publicProfile || !privateInfo) {
    if (guestBluetoothOpen) {
      appBody = (
        <div className="h-[100dvh] w-full flex flex-col bg-white dark:bg-slate-950">
          <BluetoothNearbyPanel
            lang={lang}
            currentUser={null}
            initialMode={deepOfflineCode || deepNearbyCode ? 'nearby' : 'bluetooth'}
            initialNearbyCode={deepNearbyCode}
            initialOfflineCode={deepOfflineCode}
            onRequireAuth={() => {
              setDeepOfflineCode('');
              setGuestBluetoothOpen(false);
            }}
            onClose={() => {
              setDeepOfflineCode('');
              setGuestBluetoothOpen(false);
            }}
          />
        </div>
      );
    } else {
      appBody = (
      <div className="h-[100dvh] w-full overflow-y-auto overflow-x-hidden overscroll-y-auto bg-slate-50 dark:bg-slate-950 flex flex-col">
        {/* Clean 3-zone Top Bar */}
        <header className="sticky top-0 z-30 shrink-0 px-3 sm:px-6 py-3 sm:py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between gap-2 sm:gap-6">
          <LoopLyLogo variant="compact" className="shrink-0" />

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
            <span className="whitespace-nowrap shrink-0">Gmail</span>
            <span className="whitespace-nowrap shrink-0">Invite Code</span>
            <span className="whitespace-nowrap shrink-0">Offline Code / QR</span>
            <span className="whitespace-nowrap shrink-0">Web Bluetooth</span>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <PWAInstallButton lang={lang} />
            <div className="hidden sm:grid grid-cols-2 gap-0.5 p-0.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              {(
                [
                  { id: 'light' as const, label: t(lang, 'lightMode'), Icon: Sun },
                  { id: 'dark' as const, label: t(lang, 'darkMode'), Icon: Moon },
                ] as const
              ).map((opt) => {
                const Icon = opt.Icon;
                const active = themeMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectThemeMode(opt.id)}
                    className={`min-h-[34px] px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      active
                        ? opt.id === 'dark'
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={cycleThemeMode}
              aria-label="Switch theme"
              className="sm:hidden min-h-[38px] px-2 flex items-center justify-center gap-1 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900"
            >
              {themeMode === 'dark' ? (
                <Moon className="w-4 h-4 shrink-0" />
              ) : (
                <Sun className="w-4 h-4 text-amber-500 shrink-0" />
              )}
              <span className="hidden xs:inline">{t(lang, themeMode === 'dark' ? 'darkMode' : 'lightMode')}</span>
            </button>
            <button
              ref={headerLangBtnRef}
              type="button"
              onClick={() => {
                setHeaderLangSearch('');
                setHeaderLangOpen((prev) => !prev);
              }}
              aria-label={t(lang, 'allLanguagesLabel')}
              aria-expanded={headerLangOpen}
              title={
                WORLD_LANGUAGES.find((item) => item.code === lang)?.nativeName ||
                t(lang, 'allLanguagesLabel')
              }
              className={`min-h-[38px] min-w-[38px] px-2.5 flex items-center justify-center rounded-xl border transition-colors ${
                headerLangOpen
                  ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400'
                  : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900'
              }`}
            >
              <Globe className="w-4 h-4 shrink-0" />
            </button>

            <AnimatePresence>
              {headerLangOpen && (
                <motion.div
                  ref={headerLangMenuRef}
                  initial={{ opacity: 0, y: 6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.97 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="fixed top-[58px] sm:top-[62px] right-3 sm:right-6 z-50 w-[min(340px,calc(100vw-24px))] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
                >
                  <div className="px-3.5 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {t(lang, 'allLanguagesLabel')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHeaderLangOpen(false)}
                      aria-label="Close"
                      className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="p-2.5 border-b border-slate-100 dark:border-slate-800">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={headerLangSearch}
                        onChange={(e) => setHeaderLangSearch(e.target.value)}
                        placeholder={t(lang, 'searchLanguagesPlaceholder')}
                        className="w-full min-h-[36px] pl-8 pr-8 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {headerLangSearch && (
                        <button
                          type="button"
                          onClick={() => setHeaderLangSearch('')}
                          aria-label="Clear"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="p-2.5 grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
                    {WORLD_LANGUAGES.filter((item) => {
                      const q = headerLangSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        item.nativeName.toLowerCase().includes(q) ||
                        item.englishName.toLowerCase().includes(q) ||
                        item.code.toLowerCase().includes(q)
                      );
                    }).map((item) => {
                      const isSel = lang === item.code;
                      return (
                        <button
                          key={item.code}
                          type="button"
                          onClick={() => {
                            setLang(item.code);
                            setHeaderLangOpen(false);
                            setHeaderLangSearch('');
                          }}
                          className={`px-2.5 py-2 rounded-xl border text-left transition-colors flex items-center justify-between gap-1.5 ${
                            isSel
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'bg-slate-50/70 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:border-blue-400'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate">{item.nativeName}</div>
                            <div
                              className={`text-[10px] truncate ${
                                isSel ? 'text-blue-100' : 'text-slate-400'
                              }`}
                            >
                              {item.englishName}
                            </div>
                          </div>
                          {isSel && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        {!isOnline && (
          <OfflineIndicator
            lang={lang}
            onOpenOfflineMode={() => {
              unlockAudioNow();
              setGuestBluetoothOpen(true);
            }}
          />
        )}

        <main className="flex-1 w-full px-3.5 sm:px-6 lg:px-8 py-5 sm:py-8 pb-12 flex flex-col">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-5xl w-full mx-auto my-auto grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 lg:gap-8 items-stretch"
          >
            {/* Left Sign-in Column */}
            <div className="md:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 lg:p-8 flex flex-col justify-between space-y-5 sm:space-y-6">
              <div className="space-y-4">
                <LoopLyLogo variant="hero" />
                <div className="space-y-2.5 pt-1">
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    Gmail · Invite Code · Bluetooth · Nearby P2P
                  </p>
                  <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
                    {t(lang, 'tagline')}
                  </h1>
                  <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                    Sign in once with your Gmail account and chat effortlessly using Gmail addresses, invite codes, or pair nearby devices directly over Web Bluetooth and 6-digit QR rooms.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {authError && (
                  <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 leading-relaxed space-y-2">
                    {authError.startsWith('UNAUTHORIZED_DOMAIN::') ? (
                      <>
                        <p>
                          {lang === 'bn'
                            ? 'এই ডোমেইনটি এখনো Firebase Authorized Domains-এ যুক্ত নেই। Firebase Console -> Authentication -> Settings -> Authorized domains-এ নিচের ডোমেইনটি যোগ করুন:'
                            : 'This domain is not yet allowlisted in Firebase Auth. Add this hostname under Firebase Console -> Authentication -> Settings -> Authorized domains:'}
                        </p>
                        <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/80 dark:bg-slate-900 border border-red-200 dark:border-red-900">
                          <code className="font-mono-tabular text-[11px] text-slate-900 dark:text-slate-100 truncate">
                            {authError.replace('UNAUTHORIZED_DOMAIN::', '')}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              const host = authError.replace('UNAUTHORIZED_DOMAIN::', '');
                              if (host) void navigator.clipboard?.writeText(host);
                            }}
                            className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold shrink-0 flex items-center gap-1"
                          >
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </button>
                        </div>
                      </>
                    ) : (
                      authError
                    )}
                  </div>
                )}

                {/* 3 Mandatory Unchecked Security & Legal Agreements */}
                <motion.div
                  animate={consentFlash ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
                  transition={{ duration: 0.35 }}
                  className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-200/80 dark:border-slate-800">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>{t(lang, 'encryptionActiveBadge')}</span>
                    </span>
                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                      {agreeTerms && agreePrivacy && agreeSecurity ? '3 / 3 ✓' : `${Number(agreeTerms) + Number(agreePrivacy) + Number(agreeSecurity)} / 3`}
                    </span>
                  </div>

                  {(
                    [
                      {
                        id: 'terms',
                        checked: agreeTerms,
                        onToggle: () => {
                          setAgreeTerms((v) => !v);
                          setAuthError('');
                        },
                        prefix: t(lang, 'consentTermsLabel'),
                        linkLabel: t(lang, 'termsOfServiceTitle'),
                        tab: 'terms' as PolicyTab,
                      },
                      {
                        id: 'privacy',
                        checked: agreePrivacy,
                        onToggle: () => {
                          setAgreePrivacy((v) => !v);
                          setAuthError('');
                        },
                        prefix: t(lang, 'consentPrivacyLabel'),
                        linkLabel: t(lang, 'privacyPolicyTitle'),
                        tab: 'privacy' as PolicyTab,
                      },
                      {
                        id: 'security',
                        checked: agreeSecurity,
                        onToggle: () => {
                          setAgreeSecurity((v) => !v);
                          setAuthError('');
                        },
                        prefix: t(lang, 'consentSecurityLabel'),
                        linkLabel: t(lang, 'consentSecurityLink'),
                        tab: 'security' as PolicyTab,
                      },
                    ] as const
                  ).map((box) => (
                    <div
                      key={box.id}
                      className={`min-h-[44px] px-2.5 py-2 rounded-xl border transition-colors flex items-center gap-3 cursor-pointer ${
                        box.checked
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700'
                      }`}
                      onClick={box.onToggle}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={box.checked}
                        aria-label={`${box.prefix} ${box.linkLabel}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          box.onToggle();
                        }}
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                          box.checked
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-600 text-transparent'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </button>
                      <span className="text-xs text-slate-700 dark:text-slate-200 leading-snug">
                        {box.prefix}{' '}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLegalModalState({ open: true, tab: box.tab });
                          }}
                          className="font-semibold text-blue-600 dark:text-blue-400 hover:underline inline"
                        >
                          {box.linkLabel}
                        </button>
                      </span>
                    </div>
                  ))}
                </motion.div>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  disabled={authLoading || !agreeTerms || !agreePrivacy || !agreeSecurity}
                  onClick={handleGoogleSignIn}
                  className="w-full min-h-[48px] px-6 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-45 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-2.5"
                >
                  <Mail className="w-4 h-4" />
                  {authLoading ? t(lang, 'signingIn') : t(lang, 'signInGoogle')}
                </motion.button>

                {(!agreeTerms || !agreePrivacy || !agreeSecurity) && (
                  <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400 text-center sm:text-left">
                    {t(lang, 'consentRequiredHint')}
                  </p>
                )}

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    unlockAudioNow();
                    setGuestBluetoothOpen(true);
                  }}
                  className="w-full min-h-[44px] px-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Bluetooth className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  {t(lang, 'tryBluetoothNow')}
                </motion.button>

                <div className="pt-1 flex flex-wrap items-center justify-center sm:justify-start gap-x-3 gap-y-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                  {(
                    [
                      { id: 'privacy' as const, label: t(lang, 'privacyPolicyTitle') },
                      { id: 'terms' as const, label: t(lang, 'termsOfServiceTitle') },
                      { id: 'safety' as const, label: t(lang, 'safetyPolicyTitle') },
                      { id: 'security' as const, label: t(lang, 'securityInfoTitle') },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setLegalModalState({ open: true, tab: item.id })}
                      className="hover:underline"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Channel Overview Column */}
            <div className="md:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between divide-y divide-slate-100 dark:divide-slate-800">
              <div className="pb-5 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {t(lang, 'cardGmailTitle')}
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {t(lang, 'cardGmailDesc')}
                  </p>
                </div>
              </div>

              <div className="py-5 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {t(lang, 'cardCodeTitle')}
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {t(lang, 'cardCodeDesc')}
                  </p>
                </div>
              </div>

              <div className="pt-5 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0">
                  <Bluetooth className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {t(lang, 'cardBtTitle')}
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {t(lang, 'cardBtDesc')}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </main>
      </div>
      );
    }
  } else {
    appBody = (
    <div className="relative h-[100dvh] w-full overflow-hidden flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Floating Incoming Message Notification Banner (plays with tone) */}
      <AnimatePresence>
        {incomingBanner && (
          <motion.div
            key={`banner-${incomingBanner.chatId}-${incomingBanner.text}`}
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[92vw] max-w-sm"
          >
            <div className="bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 rounded-2xl shadow-lg p-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (incomingBanner.chatId) {
                    openChat(incomingBanner.chatId);
                  } else {
                    setIncomingBanner(null);
                  }
                }}
                className="flex-1 min-w-0 flex items-center gap-3 text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                  <BellRing className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {t(lang, 'newMsgFrom')} {incomingBanner.senderName}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 truncate">
                    {incomingBanner.text}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setIncomingBanner(null)}
                aria-label="Dismiss alert"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* LEFT SIDEBAR: Conversation List & Channel Filters */}
      <aside
        className={`${
          isMobileDetailActive ? 'hidden md:flex' : 'flex'
        } w-full md:w-[300px] lg:w-[340px] xl:w-[368px] shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 h-full min-h-0 overflow-hidden`}
      >
        {/* Sidebar Header */}
        <div className="px-2.5 sm:px-4 py-2.5 sm:py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveChatId(null);
              setWorkspaceView('hub');
            }}
            className="text-left shrink-0"
          >
            <LoopLyLogo variant="compact" />
          </button>

          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            {/* Workable Interactive Notification Center Bell */}
            <div ref={notifContainerRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  unlockAudioNow();
                  setNotifOpen((prev) => !prev);
                }}
                title={t(lang, 'notificationsTitle')}
                aria-label={t(lang, 'notificationsTitle')}
                aria-expanded={notifOpen}
                className={`relative min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl transition-colors ${
                  notifOpen
                    ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900'
                }`}
              >
                {unreadChats.length > 0 || notifPermission === 'granted' ? (
                  <BellRing
                    className={`w-4 h-4 ${
                      unreadChats.length > 0
                        ? 'text-amber-500 animate-pulse'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  />
                ) : (
                  <Bell className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                )}
                {unreadChats.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-950">
                    {unreadChats.length > 9 ? '9+' : unreadChats.length}
                  </span>
                )}
              </button>

              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                    transition={{ duration: 0.14 }}
                    className="fixed top-[60px] left-3 right-3 sm:left-4 sm:right-auto sm:w-[340px] max-w-[calc(100vw-24px)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden"
                  >
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <BellRing className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          {t(lang, 'notificationsTitle')}
                        </span>
                        {unreadChats.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                            {unreadChats.length}
                          </span>
                        )}
                      </div>
                      {unreadChats.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setUnreadChatIds(new Set())}
                          className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {t(lang, 'markAllRead')}
                        </button>
                      )}
                    </div>

                    <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                      {unreadChats.length === 0 ? (
                        <div className="px-4 py-5 text-center text-xs text-slate-500 dark:text-slate-400">
                          {t(lang, 'noUnreadNotifications')}
                        </div>
                      ) : (
                        unreadChats.map((c) => {
                          const chatName = getChatDisplayName(c);
                          const peer = getChatPeerProfile(c);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                openChat(c.id);
                                setNotifOpen(false);
                              }}
                              className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                            >
                              <UserAvatar
                                name={chatName}
                                photoUrl={peer?.photoUrl}
                                size="sm"
                                isOnline={isPeerOnline(peer, nowTick)}
                                hasUnread
                                ringColorClass="ring-white dark:ring-slate-900"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                    {chatName}
                                  </span>
                                  <span className="text-[10px] text-slate-400 shrink-0 font-mono-tabular">
                                    {formatTime(c.lastMessageAt)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                  {c.lastMessageText || t(lang, 'tapToOpen')}
                                </p>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                          {t(lang, 'soundAlertsLabel')}
                        </span>
                        <button
                          type="button"
                          onClick={toggleSound}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                            soundOn
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {soundOn ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      {notifPermission !== 'unsupported' && (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-slate-600 dark:text-slate-300 font-medium">
                            {t(lang, 'pushAlertsLabel')}
                          </span>
                          {notifPermission === 'granted' ? (
                            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                              ✓ Active
                            </span>
                          ) : notifPermission === 'denied' ? (
                            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                              Blocked
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={handleRequestBgNotifications}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold"
                            >
                              Enable
                            </button>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleTestAlert}
                        className="w-full min-h-[34px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <BellRing className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>{t(lang, 'testAlertBtn')}</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button
              type="button"
              onClick={toggleSound}
              title={soundOn ? t(lang, 'soundOn') : t(lang, 'soundOff')}
              aria-label={soundOn ? t(lang, 'soundOn') : t(lang, 'soundOff')}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
            >
              {soundOn ? <Volume2 className="w-4 h-4 text-blue-600 dark:text-blue-400" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'bn' : 'en')}
              className="min-h-[38px] px-2.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 whitespace-nowrap transition-colors"
            >
              {lang === 'en' ? 'বাংলা' : 'EN'}
            </button>
            <button
              type="button"
              onClick={cycleThemeMode}
              title={`${t(lang, 'themeLabel')}: ${t(lang, themeMode === 'dark' ? 'darkMode' : 'lightMode')}`}
              aria-label="Switch theme"
              className="min-h-[38px] px-2 flex items-center justify-center gap-1 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors shrink-0"
            >
              {themeMode === 'dark' ? (
                <Moon className="w-4 h-4 shrink-0" />
              ) : (
                <Sun className="w-4 h-4 text-amber-500 shrink-0" />
              )}
              <span className="hidden sm:inline">
                {t(lang, themeMode === 'dark' ? 'darkMode' : 'lightMode')}
              </span>
            </button>
            {isAppLockEnabled(publicProfile.uid) && (
              <button
                type="button"
                onClick={() => setAppLocked(true)}
                title={t(lang, 'appLockNowBtn')}
                aria-label={t(lang, 'appLockNowBtn')}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
              >
                <Lock className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setProfileModalTab('profile');
                setProfileModalOpen(true);
              }}
              aria-label="Settings"
              className="md:hidden min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!isOnline && (
          <OfflineIndicator
            lang={lang}
            onOpenOfflineMode={() => {
              setActiveChatId(null);
              setBtInitialMode('bluetooth');
              setWorkspaceView('bluetooth');
            }}
          />
        )}

        {/* Search & Channel Filter */}
        <div className="p-3 space-y-2.5 border-b border-slate-100 dark:border-slate-900 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t(lang, 'searchPlaceholder')}
              className="w-full min-h-[40px] pl-9 pr-9 rounded-xl bg-slate-100 dark:bg-slate-900 border border-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {searchQuery.trim().length > 0 && Array.from(searchQuery.trim()).length < 3 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 px-1">
              {t(lang, 'searchMinCharsHint')}
            </p>
          )}

          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-transparent rounded-xl">
            {(
              [
                { id: 'all', label: t(lang, 'allChats') },
                { id: 'gmail', label: t(lang, 'gmailTab') },
                { id: 'nearby', label: 'BT/Code' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`py-1.5 px-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap truncate ${
                  filterTab === tab.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Cool Top Quick-Access Strip for BT / QR & Gemini AI */}
        <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-900 grid grid-cols-2 gap-2 shrink-0 bg-slate-50/70 dark:bg-slate-900/35">
          <button
            type="button"
            onClick={() => {
              unlockAudioNow();
              setActiveChatId(null);
              setBtInitialMode('bluetooth');
              setWorkspaceView('bluetooth');
            }}
            className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-xl border text-left transition-all active:scale-[0.98] ${
              workspaceView === 'bluetooth'
                ? 'bg-blue-600 border-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'bg-gradient-to-br from-blue-50/95 to-indigo-50/85 dark:from-blue-950/45 dark:to-indigo-950/35 border-blue-200/80 dark:border-blue-800/60 text-slate-900 dark:text-white hover:border-blue-400'
            }`}
          >
            <span
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${
                workspaceView === 'bluetooth'
                  ? 'bg-white/20 text-white'
                  : 'bg-blue-600 text-white shadow-xs'
              }`}
            >
              <Bluetooth className="w-4 h-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold leading-tight truncate">BT / QR</span>
              <span
                className={`block text-[10px] leading-tight truncate mt-0.5 ${
                  workspaceView === 'bluetooth'
                    ? 'text-blue-100'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {lang === 'bn' ? 'অফলাইন ও স্ক্যান' : 'Nearby & Scan'}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              unlockAudioNow();
              setActiveChatId(null);
              setWorkspaceView('gemini');
            }}
            className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-xl border text-left transition-all active:scale-[0.98] ${
              workspaceView === 'gemini'
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 border-indigo-600 text-white shadow-sm shadow-indigo-600/20'
                : 'bg-gradient-to-br from-violet-50/95 to-sky-50/85 dark:from-violet-950/45 dark:to-sky-950/35 border-violet-200/80 dark:border-violet-800/60 text-slate-900 dark:text-white hover:border-violet-400'
            }`}
          >
            <span
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${
                workspaceView === 'gemini'
                  ? 'bg-white/20'
                  : 'bg-white dark:bg-slate-900 border border-violet-100 dark:border-violet-800/50 shadow-xs'
              }`}
            >
              <GeminiLogo variant="icon" size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold leading-tight truncate">
                {t(lang, 'geminiAssistantTitle')}
              </span>
              <span
                className={`block text-[10px] leading-tight truncate mt-0.5 ${
                  workspaceView === 'gemini'
                    ? 'text-indigo-100'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {lang === 'bn' ? 'স্মার্ট সহায়ক' : 'Smart Chat'}
              </span>
            </span>
          </button>
        </div>

        {/* 24h Status / Stories Strip */}
        {(() => {
          const myStatuses = statuses.filter((s) => s.uid === publicProfile.uid);
          const friendStatusGroups = new Map<string, UserStatus[]>();
          for (const s of statuses) {
            if (s.uid === publicProfile.uid) continue;
            const list = friendStatusGroups.get(s.uid) || [];
            list.push(s);
            friendStatusGroups.set(s.uid, list);
          }

          return (
            <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-900 flex items-center gap-3 overflow-x-auto shrink-0">
              {/* My Status */}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (myStatuses.length > 0) {
                        setStatusViewer({
                          statuses: myStatuses,
                          initialIndex: 0,
                          authorOnline: true,
                        });
                      } else {
                        setStatusCreateOpen(true);
                      }
                    }}
                    className={`relative overflow-hidden w-12 h-12 rounded-full p-0.5 flex items-center justify-center transition-transform active:scale-95 ${
                      myStatuses.length > 0
                        ? 'bg-gradient-to-tr from-blue-600 to-emerald-500'
                        : 'border-2 border-dashed border-slate-300 dark:border-slate-700'
                    }`}
                    title={t(lang, 'myStatus')}
                  >
                    {publicProfile.photoUrl ? (
                      <img
                        src={publicProfile.photoUrl}
                        alt={publicProfile.displayName}
                        referrerPolicy="no-referrer"
                        className="w-full h-full rounded-full object-cover border border-white/75 dark:border-slate-800/80 ring-1 ring-slate-900/5"
                      />
                    ) : (
                      <div className="w-full h-full rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm border border-white/75 dark:border-slate-800/80">
                        {publicProfile.displayName.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0.5 rounded-full bg-gradient-to-b from-white/35 via-white/5 to-transparent ring-1 ring-inset ring-white/60 shadow-[inset_0_1.5px_3px_rgba(255,255,255,0.75)]"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusCreateOpen(true)}
                    aria-label={t(lang, 'addStatus')}
                    className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center ring-2 ring-white dark:ring-slate-950 hover:bg-blue-700"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 max-w-[56px] truncate">
                  {t(lang, 'myStatus')}
                </span>
              </div>

              {/* Friends' Active 24h Statuses */}
              {Array.from(friendStatusGroups.entries()).map(([uid, group]) => {
                const first = group[0];
                const peerProf = peerProfiles[uid];
                const showPres = canSeePeerPresence(peerProf, true);
                const online = isPeerOnline(peerProf, nowTick, true);
                const statusAuthorPhoto = peerProf ? peerProf.photoUrl : first.photoUrl;
                const statusAuthorName = peerProf?.displayName || first.displayName;
                return (
                  <motion.button
                    key={uid}
                    type="button"
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() =>
                      setStatusViewer({
                        statuses: group,
                        initialIndex: 0,
                        authorOnline: showPres ? online : undefined,
                      })
                    }
                    className="flex flex-col items-center gap-1 shrink-0 group"
                  >
                    <div className="relative w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-emerald-500 to-blue-600">
                      {online && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute -inset-[3px] rounded-full border-2 border-emerald-500 animate-pulse"
                        />
                      )}
                      {first.mediaType === 'image' && first.imageData ? (
                        <img
                          src={first.imageData}
                          alt={statusAuthorName}
                          referrerPolicy="no-referrer"
                          className="w-full h-full rounded-full object-cover border-2 border-white dark:border-slate-950"
                        />
                      ) : statusAuthorPhoto ? (
                        <img
                          src={statusAuthorPhoto}
                          alt={statusAuthorName}
                          referrerPolicy="no-referrer"
                          className="w-full h-full rounded-full object-cover border-2 border-white dark:border-slate-950"
                        />
                      ) : (
                        <div
                          className={`w-full h-full rounded-full flex items-center justify-center text-white font-bold text-sm border-2 border-white dark:border-slate-950 ${
                            STATUS_GRADIENTS[first.bgGradient] || STATUS_GRADIENTS.blue
                          }`}
                        >
                          {statusAuthorName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      {showPres && (
                        <span
                          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-white dark:ring-slate-950 ${
                            online ? 'bg-emerald-500' : 'bg-red-500'
                          }`}
                        />
                      )}
                    </div>
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 max-w-[56px] truncate">
                      {statusAuthorName.split(' ')[0]}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          );
        })()}

        {/* Chat List with Blinking Green Online Ring + Red Offline Dot + Blinking Yellow Unread Dot */}
        <div
          className={`flex-1 min-h-0 px-3 pt-3 space-y-1 chat-list-scroll${
            hasNetlifyBadge ? ' has-netlify-badge' : ''
          }`}
        >
          {filteredChats.length === 0 && !(searchQuery.trim() && Array.from(searchQuery.trim()).length >= 3) ? (
            <div className="py-10 px-4 text-center space-y-3">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {t(lang, 'noChatsTitle')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {t(lang, 'noChatsBody')}
              </p>
              <button
                type="button"
                onClick={() => {
                  setConnectModalTab('search');
                  setConnectModalOpen(true);
                }}
                className="min-h-[40px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" />
                {t(lang, 'startFirstChat')}
              </button>
            </div>
          ) : (
            <>
              {filteredChats.map((chat) => {
                const name = getChatDisplayName(chat);
                const peer = getChatPeerProfile(chat);
                const showPres = canSeePeerPresence(peer, true);
                const online = isPeerOnline(peer, nowTick, true);
                const presenceText = formatPresenceLabel(peer, lang, nowTick, true);
                const isSelected = activeChatId === chat.id && workspaceView === 'chat';
                const hasUnread = unreadChatIds.has(chat.id);
                const isPinned = pinnedOrderMap.has(chat.id);
                return (
                  <div
                    key={chat.id}
                    className={`group relative w-full min-h-[64px] px-2 py-1.5 rounded-xl flex items-center gap-1.5 transition-colors ${
                      isSelected
                        ? 'bg-slate-100 dark:bg-slate-900'
                        : isPinned
                        ? 'bg-blue-50/70 dark:bg-blue-950/25 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-900/50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openChat(chat.id)}
                      className="flex-1 min-w-0 px-1 py-1 rounded-lg text-left flex items-center gap-3 active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                      <UserAvatar
                        name={name}
                        photoUrl={peer?.photoUrl}
                        size="lg"
                        isOnline={showPres ? online : undefined}
                        hasUnread={hasUnread}
                        presenceTitle={presenceText}
                        ringColorClass="ring-white dark:ring-slate-950"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-sm truncate ${
                              hasUnread
                                ? 'font-bold text-slate-950 dark:text-white'
                                : 'font-semibold text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {name}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {mutedChatIds.includes(chat.id) && (
                              <BellOff className="w-3.5 h-3.5 text-slate-400" aria-label={t(lang, 'mutedBadge')} />
                            )}
                            {hasUnread && (
                              <span
                                className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"
                                aria-label="New unread message"
                              />
                            )}
                            <span className="text-[11px] text-slate-400 font-mono-tabular">
                              {formatTime(chat.lastMessageAt)}
                            </span>
                          </div>
                        </div>
                        <div
                          className={`flex items-center gap-1.5 text-xs truncate mt-0.5 ${
                            hasUnread
                              ? 'text-slate-800 dark:text-slate-200 font-medium'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          <span
                            className={`shrink-0 font-medium ${
                              online ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {presenceText}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{chat.lastMessageText}</span>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePinChat(chat.id);
                      }}
                      aria-label={isPinned ? t(lang, 'unpinChat') : t(lang, 'pinChat')}
                      aria-pressed={isPinned}
                      title={isPinned ? t(lang, 'unpinChat') : t(lang, 'pinChat')}
                      className={`min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg shrink-0 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        isPinned
                          ? 'text-blue-600 dark:text-blue-400 bg-blue-600/10 hover:bg-blue-600/15 opacity-100'
                          : 'text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 opacity-75 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'
                      }`}
                    >
                      <Pin
                        className={`w-3.5 h-3.5 transition-transform ${isPinned ? 'rotate-45 fill-current' : ''}`}
                      />
                    </button>
                  </div>
                );
              })}

              {/* Global 3-letter Prefix User Discovery inside Sidebar Search */}
              {Array.from(searchQuery.trim()).length >= 3 && (() => {
                const shownPeerUids = new Set(
                  filteredChats
                    .flatMap((c) => c.participantIds)
                    .filter((id) => id !== publicProfile.uid)
                );
                const discoverable = sidebarPeopleResults.filter((u) => !shownPeerUids.has(u.uid));
                return (
                  <div className="pt-2.5 mt-2 border-t border-slate-100 dark:border-slate-900 space-y-1.5">
                    <div className="px-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <span>{t(lang, 'peopleOnLoopLy')}</span>
                      {sidebarSearchingPeople && (
                        <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                      )}
                    </div>

                    {discoverable.length === 0 && sidebarSearchingPeople ? (
                      <div className="py-4 px-2 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                        <span>{t(lang, 'searchingPeople')}</span>
                      </div>
                    ) : discoverable.length === 0 && !sidebarSearchingPeople ? (
                      filteredChats.length === 0 ? (
                        <div className="py-5 px-3 text-center space-y-2.5">
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {t(lang, 'noPeopleFound')}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setConnectModalTab('gmail');
                              setConnectModalOpen(true);
                            }}
                            className="min-h-[36px] px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            <span>{t(lang, 'cardGmailAction')}</span>
                          </button>
                        </div>
                      ) : null
                    ) : (
                      discoverable.map((person) => {
                        const existingDm = chats.find(
                          (c) =>
                            c.participantIds.length === 2 &&
                            c.participantIds.includes(publicProfile.uid) &&
                            c.participantIds.includes(person.uid)
                        );
                        const canSeePres = canSeePeerPresence(person, Boolean(existingDm));
                        const online =
                          canSeePres && person.onlineStatus === 'online';
                        const isBusy = startingSearchUid === person.uid;
                        return (
                          <div
                            key={`search-user-${person.uid}`}
                            className="w-full min-h-[60px] px-2 py-1.5 rounded-xl bg-slate-50/75 dark:bg-slate-900/45 hover:bg-blue-50/70 dark:hover:bg-blue-950/30 border border-slate-200/70 dark:border-slate-800/70 flex items-center gap-2 transition-colors"
                          >
                            <button
                              type="button"
                              onClick={() => setPreviewedUser(person)}
                              className="flex-1 min-w-0 flex items-center gap-2.5 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                            >
                              <UserAvatar
                                name={person.displayName}
                                photoUrl={person.photoUrl}
                                size="md"
                                isOnline={canSeePres ? online : undefined}
                                ringColorClass="ring-white dark:ring-slate-950"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    {person.displayName}
                                  </span>
                                  {existingDm && (
                                    <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {(person.showGmail !== false && person.maskedEmail) ||
                                    person.bio ||
                                    t(lang, 'noBioYet')}
                                </p>
                              </div>
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(startingSearchUid)}
                              onClick={() => void handleStartChatFromSearch(person)}
                              className="min-h-[34px] px-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1 shrink-0 transition-colors"
                            >
                              {isBusy ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <MessageSquare className="w-3 h-3" />
                              )}
                              <span>{existingDm ? t(lang, 'openChatBtn') : t(lang, 'messageBtn')}</span>
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Bottom Profile Bar (Desktop) */}
        <div className="hidden md:flex p-3 border-t border-slate-200 dark:border-slate-800 items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              setProfileModalTab('profile');
              setProfileModalOpen(true);
            }}
            className="flex-1 min-w-0 flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-900 text-left transition-colors"
          >
            <UserAvatar
              name={publicProfile.displayName}
              photoUrl={publicProfile.photoUrl}
              size="sm"
              isOnline={publicProfile.showOnlineStatus !== false}
              ringColorClass="ring-white dark:ring-slate-950"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {publicProfile.displayName}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {publicProfile.bio?.trim()
                  ? publicProfile.bio
                  : privateInfo.email}
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              setProfileModalTab('profile');
              setProfileModalOpen(true);
            }}
            aria-label="Settings"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900 shrink-0"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* Bottom Action Dock: Keep Chats & New Chat on Left Side when floating badge exists */}
        <div className="shrink-0 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 chat-dock-container">
          <nav
            className={`h-14 sm:h-16 ${
              hasNetlifyBadge ? 'w-[54%] md:w-full' : 'w-full'
            } grid grid-cols-2 items-center`}
          >
            <button
              type="button"
              onClick={() => setWorkspaceView('hub')}
              className={`h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
                workspaceView === 'hub'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <MessageSquarePlus className="w-5 h-5" />
              <span className="text-[10px] font-medium whitespace-nowrap">{t(lang, 'backToChats')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                unlockAudioNow();
                setConnectModalTab('search');
                setConnectModalOpen(true);
              }}
              className="h-full flex flex-col items-center justify-center gap-0.5 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              <UserPlus className="w-5 h-5" />
              <span className="text-[10px] font-medium whitespace-nowrap">{t(lang, 'newChat')}</span>
            </button>
          </nav>
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <main
        className={`${
          isMobileDetailActive ? 'flex' : 'hidden md:flex'
        } flex-1 min-w-0 min-h-0 flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden`}
      >
        <AnimatePresence mode="wait">
        {workspaceView === 'bluetooth' ? (
          <motion.div
            key="view-bluetooth"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 min-h-0 min-w-0 flex flex-col h-full overflow-hidden"
          >
            <BluetoothNearbyPanel
              lang={lang}
              currentUser={publicProfile}
              initialMode={btInitialMode}
              initialNearbyCode={deepNearbyCode}
              initialOfflineCode={deepOfflineCode}
              onRequireAuth={handleGoogleSignIn}
              onClose={() => {
                setDeepOfflineCode('');
                setWorkspaceView('hub');
              }}
            />
          </motion.div>
        ) : workspaceView === 'gemini' ? (
          <motion.div
            key="view-gemini"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 min-h-0 min-w-0 flex flex-col h-full overflow-hidden"
          >
            <GeminiChatPanel
              lang={lang}
              userName={publicProfile.displayName}
              onClose={() => setWorkspaceView('hub')}
            />
          </motion.div>
        ) : workspaceView === 'chat' && activeChat ? (
          <motion.div
            key={`view-chat-${activeChat.id}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsDraggingOver(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleAttachmentPicked(file);
            }}
            className="relative flex-1 min-h-0 min-w-0 flex flex-col h-full bg-white dark:bg-slate-950 overflow-hidden"
          >
            {/* Drag & Drop File Overlay */}
            <AnimatePresence>
              {isDraggingOver && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="absolute inset-0 z-30 bg-blue-600/15 border-2 border-dashed border-blue-600 rounded-2xl m-3 flex flex-col items-center justify-center gap-2 pointer-events-none"
                >
                  <Upload className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                    {t(lang, 'dropHere')}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Active Chat Header (Blinking Online Ring + Voice/Video Call + Peer Profile) */}
            {(() => {
              const activePeer = getChatPeerProfile(activeChat);
              const activePeerUid = activeChat.participantIds.find((id) => id !== publicProfile.uid);
              const isActivePeerBlocked = Boolean(
                activePeerUid && privateInfo.blockedUids?.includes(activePeerUid)
              );
              const canSeeActivePres = canSeePeerPresence(activePeer, true);
              const activePeerOnline = isPeerOnline(activePeer, nowTick, true);
              const activePresenceText = formatPresenceLabel(activePeer, lang, nowTick, true);
              const canCallPeer = activeChat.participantIds.length >= 2 && !isActivePeerBlocked;
              return (
                <header className="px-2.5 sm:px-6 py-2.5 sm:py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between gap-1.5 sm:gap-2 shrink-0">
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveChatId(null);
                        setWorkspaceView('hub');
                      }}
                      aria-label={t(lang, 'backBtn')}
                      className="min-h-[38px] min-w-[38px] sm:min-h-[40px] px-2 sm:px-2.5 flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold shrink-0 transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4 shrink-0" />
                      <span className="hidden sm:inline">{t(lang, 'backBtn')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPeerProfileModalOpen(true)}
                      title={t(lang, 'viewProfile')}
                      className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 text-left rounded-xl p-1 -m-1 hover:bg-slate-100/80 dark:hover:bg-slate-900/70 transition-colors"
                    >
                      <UserAvatar
                        name={getChatDisplayName(activeChat)}
                        photoUrl={activePeer?.photoUrl}
                        size="md"
                        isOnline={canSeeActivePres ? activePeerOnline : undefined}
                        presenceTitle={activePresenceText}
                        ringColorClass="ring-white dark:ring-slate-950"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                            {getChatDisplayName(activeChat)}
                          </h2>
                          {mutedChatIds.includes(activeChat.id) && (
                            <BellOff className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-label={t(lang, 'mutedBadge')} />
                          )}
                        </div>
                        {activePeerTypers.length > 0 ? (
                          <div className="text-xs font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1.5 truncate">
                            <span className="truncate">
                              {activePeerTypers.map((p) => p.displayName).join(', ')}{' '}
                              {lang === 'bn' ? 'লিখছেন...' : 'is typing...'}
                            </span>
                            <span className="inline-flex items-center gap-0.5 shrink-0" aria-hidden="true">
                              {[0, 1, 2].map((d) => (
                                <motion.span
                                  key={d}
                                  animate={{ y: [0, -2.5, 0] }}
                                  transition={{ duration: 0.7, repeat: Infinity, delay: d * 0.14 }}
                                  className="w-1 h-1 rounded-full bg-blue-600 dark:bg-blue-400"
                                />
                              ))}
                            </span>
                          </div>
                        ) : (
                          <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
                            {activePeer && (
                              <>
                                <span
                                  className={
                                    activePeerOnline
                                      ? 'text-emerald-600 dark:text-emerald-400 font-medium shrink-0'
                                      : canSeeActivePres
                                      ? 'text-red-500 dark:text-red-400 font-medium shrink-0'
                                      : 'text-slate-400 dark:text-slate-500 font-medium shrink-0'
                                  }
                                >
                                  {activePresenceText}
                                </span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            <span className="shrink-0">
                              {activeChat.channel === 'gmail'
                                ? 'Gmail'
                                : activeChat.channel === 'phone'
                                ? 'Code'
                                : 'Nearby'}
                            </span>
                            <span className="hidden sm:inline" aria-hidden="true">·</span>
                            <span className="hidden sm:inline font-mono-tabular truncate">
                              {resolvePeerMaskedHint({
                                targetHint: activeChat.targetHint,
                                channel: activeChat.channel,
                                peerMaskedEmail: activePeer?.maskedEmail,
                                peerEmail:
                                  activePeer?.showGmail === false
                                    ? ''
                                    : peerEmailsByChat[activeChat.id] ||
                                      pendingEmailsByChat[activeChat.id] ||
                                      '',
                                peerShowGmail: activePeer?.showGmail,
                                viewerEmail: privateInfo?.email || firebaseUser?.email || '',
                                lang,
                              })}
                            </span>
                            {activeChat.participantIds.length === 1 && activeChat.inviteCode && (
                              <>
                                <span className="hidden xs:inline" aria-hidden="true">·</span>
                                <span className="hidden xs:inline text-amber-600 dark:text-amber-400 truncate">
                                  {t(lang, 'inviteWaiting')}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                  </div>

                  <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                    {canCallPeer && (
                      <>
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.92 }}
                          onClick={() => handleStartCall(activeChat, 'audio')}
                          title={t(lang, 'voiceCall')}
                          aria-label={t(lang, 'voiceCall')}
                          className="min-h-[38px] min-w-[38px] sm:min-h-[40px] sm:min-w-[40px] px-2 sm:px-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/70 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
                        >
                          <Phone className="w-4 h-4 shrink-0" />
                          <span className="hidden xl:inline">{t(lang, 'voiceCall')}</span>
                        </motion.button>
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.92 }}
                          onClick={() => handleStartCall(activeChat, 'video')}
                          title={t(lang, 'videoCall')}
                          aria-label={t(lang, 'videoCall')}
                          className="min-h-[38px] min-w-[38px] sm:min-h-[40px] sm:min-w-[40px] px-2 sm:px-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/70 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-400 flex items-center justify-center gap-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
                        >
                          <Video className="w-4 h-4 shrink-0" />
                          <span className="hidden xl:inline">{t(lang, 'videoCall')}</span>
                        </motion.button>
                      </>
                    )}

                    {activeChat.inviteCode && activeChat.participantIds.length === 1 && (
                      <>
                        {activeChat.channel === 'gmail' && (
                          <button
                            type="button"
                            onClick={() => {
                              const savedEmail =
                                pendingEmailsByChat[activeChat.id] ||
                                peerEmailsByChat[activeChat.id] ||
                                '';
                              const latestPreview =
                                activeChat.lastMessageText ||
                                messages[messages.length - 1]?.text ||
                                (lang === 'bn'
                                  ? 'LoopLy-এ আপনাকে মেসেজ করেছেন'
                                  : 'Sent you a message on LoopLy');
                              setOfflineEmailPrompt({
                                chatId: activeChat.id,
                                peerName: getChatDisplayName(activeChat),
                                presenceText: t(lang, 'inviteWaiting'),
                                messagePreview: latestPreview,
                                toEmail: savedEmail,
                                editingEmail: !savedEmail,
                                sending: false,
                                error: '',
                              });
                            }}
                            title={t(lang, 'notifyViaEmail')}
                            aria-label={t(lang, 'notifyViaEmail')}
                            className="min-h-[36px] sm:min-h-[40px] px-2 sm:px-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-xs font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <Mail className="w-3.5 h-3.5 shrink-0" />
                            <span className="hidden sm:inline">{t(lang, 'notifyViaEmail')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => copyChatInviteLink(activeChat)}
                          className="min-h-[36px] sm:min-h-[40px] px-2 sm:px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1 whitespace-nowrap"
                        >
                          {copiedInviteId === activeChat.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span className="hidden sm:inline">{t(lang, 'copied')}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 shrink-0" />
                              <span className="font-mono-tabular text-[11px] sm:text-xs">{activeChat.inviteCode}</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => shareChatInvite(activeChat)}
                          aria-label="Share invite link"
                          className="min-h-[36px] sm:min-h-[40px] px-2 sm:px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Share2 className="w-3.5 h-3.5 shrink-0" />
                          <span className="hidden sm:inline">Share Link</span>
                        </button>
                      </>
                    )}
                  </div>
                </header>
              );
            })()}

            {/* Pending Gmail Auto-Delivery Info Strip */}
            {activeChat.channel === 'gmail' && activeChat.participantIds.length === 1 && (
              <div className="px-4 sm:px-6 py-2 bg-blue-50/90 dark:bg-blue-950/30 border-b border-blue-100 dark:border-blue-900/50 text-xs text-blue-800 dark:text-blue-200 flex items-center gap-2 shrink-0">
                <Mail className="w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                <span className="leading-snug">{t(lang, 'pendingAutoDeliverNote')}</span>
              </div>
            )}

            {/* Message Feed + Scroll Up/Down Arrows & New Message Button */}
            <div className="relative flex-1 flex flex-col overflow-hidden min-h-0">
              <div
                ref={setFeedScrollNode}
                onScroll={handleFeedScroll}
                className="flex-1 overflow-y-auto px-4 sm:px-6 pr-14 sm:pr-16 py-5 space-y-3 bg-slate-50/50 dark:bg-slate-950"
              >
                {renderedMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Start chatting with {getChatDisplayName(activeChat)}.
                      {activeChat.channel === 'gmail' && activeChat.participantIds.length === 1
                        ? ` ${t(lang, 'pendingAutoDeliverNote')}`
                        : activeChat.participantIds.length === 1 && activeChat.inviteCode
                        ? ` Share invite code ${activeChat.inviteCode} so they can join directly.`
                        : ''}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {['Hello! 👋', 'Kemon acho?', 'Free to talk?'].map((quick) => (
                        <button
                          key={quick}
                          type="button"
                          onClick={() => handleSendMessage(undefined, quick)}
                          className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
                        >
                          {quick}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  renderedMessages.map((msg, realIdx) => (
                    <MessageBubble
                      key={msg.id}
                      id={msg.id}
                      lang={lang}
                      text={msg.text}
                      senderName={msg.senderName}
                      timestampText={formatTime(msg.createdAt, msg.optimistic)}
                      isMe={msg.senderId === publicProfile.uid}
                      replyToText={msg.replyToText}
                      attachmentType={msg.attachmentType}
                      attachmentName={msg.attachmentName}
                      attachmentMime={msg.attachmentMime}
                      attachmentSize={msg.attachmentSize}
                      attachmentData={msg.attachmentData}
                      deliveredAt={msg.deliveredAt}
                      readAt={msg.readAt}
                      optimistic={msg.optimistic}
                      justSent={justSentIds.has(msg.id)}
                      justArrived={justArrivedIds.has(msg.id)}
                      reactions={reactionsByMessage.get(msg.id) || []}
                      onReact={(emoji) =>
                        void toggleMessageReaction({
                          chatId: activeChat.id,
                          messageId: msg.id,
                          uid: publicProfile.uid,
                          emoji,
                          currentEmoji: myReactionByMessage.get(msg.id) || null,
                        })
                      }
                      onReply={() => setReplyingTo(msg)}
                      onCopy={() => {
                        if (msg.text) {
                          void navigator.clipboard?.writeText(msg.text).catch(() => null);
                        }
                      }}
                      onShowInfo={() => setMessageInfoTarget(msg)}
                      onBeforeDeleteSand={(rect, isSelf) =>
                        sandDissolveRef.current?.triggerBurst(rect, {
                          isMe: isSelf,
                          isDark: themeMode === 'dark',
                        })
                      }
                      onDelete={() =>
                        deleteChatMessage({
                          chat: activeChat,
                          message: msg,
                          previousMessage: realIdx > 0 ? renderedMessages[realIdx - 1] : null,
                          isLatest: realIdx === renderedMessages.length - 1,
                          currentUid: publicProfile.uid,
                        })
                      }
                      onPreviewImage={(url, name) => setLightboxImage({ url, name })}
                      onResolveAttachment={(msgId, marker) =>
                        resolveChunkedAttachment(activeChat.id, msgId, marker)
                      }
                    />
                  ))
                )}

                {/* Real-time Animated Peer Typing Indicator */}
                <AnimatePresence>
                  {activePeerTypers.length > 0 && (
                    <motion.div
                      key="peer-typing-bubble"
                      initial={{ opacity: 0, y: 10, scale: 0.94 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.96 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                      className="flex items-center gap-2 pt-1"
                    >
                      <div className="px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-2.5 shadow-sm">
                        <span className="w-6 h-6 rounded-full bg-blue-600/10 text-blue-600 dark:text-blue-400 text-[11px] font-bold flex items-center justify-center shrink-0">
                          {activePeerTypers[0].displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          {activePeerTypers[0].displayName}
                        </span>
                        <span className="flex items-center gap-1" aria-label="typing">
                          {[0, 1, 2].map((dot) => (
                            <motion.span
                              key={dot}
                              animate={{
                                y: [0, -4, 0],
                                opacity: [0.45, 1, 0.45],
                              }}
                              transition={{
                                duration: 0.85,
                                repeat: Infinity,
                                delay: dot * 0.14,
                              }}
                              className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400"
                            />
                          ))}
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div ref={messagesEndRef} />
              </div>

              {/* Jump-to-Top & Jump-to-Bottom Scroll Arrow Controls */}
              {renderedMessages.length > 0 && (
                <div className="absolute bottom-3 right-3 z-20 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => scrollFeedToTop(true)}
                    aria-label={t(lang, 'scrollToTopLabel')}
                    title={t(lang, 'scrollToTopLabel')}
                    className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 shadow-md flex items-center justify-center transition-colors"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollFeedToBottom(true)}
                    aria-label={t(lang, 'scrollToBottomLabel')}
                    title={t(lang, 'scrollToBottomLabel')}
                    className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 shadow-md flex items-center justify-center transition-colors"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Floating 'New Message' Action Button when user is scrolled up */}
              <AnimatePresence>
                {showNewMsgBtn && (
                  <motion.button
                    type="button"
                    initial={{ opacity: 0, y: 14, scale: 0.92 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.92 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => scrollFeedToBottom(true)}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 min-h-[38px] px-4 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <ArrowDown className="w-3.5 h-3.5 shrink-0" />
                    <span>{t(lang, 'newMessageBtn')}</span>
                    {unseenScrollCount > 1 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[10px] font-mono-tabular">
                        {unseenScrollCount}
                      </span>
                    )}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            {/* Reply Strip */}
            <AnimatePresence>
              {replyingTo && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.14 }}
                  className="px-4 sm:px-6 py-2 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 truncate text-slate-600 dark:text-slate-300">
                    <span className="font-semibold">{t(lang, 'replyingTo')}: </span>
                    {replyingTo.text || replyingTo.attachmentName}
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="text-slate-500 hover:text-slate-900 dark:hover:text-white shrink-0 font-medium"
                  >
                    {t(lang, 'cancel')}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Pending Image / File Attachment Preview & Upload Progress Strip */}
            <AnimatePresence>
              {(pendingAttachment || preparingAttachment || uploadProgress !== null) && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="px-4 sm:px-6 py-2.5 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3"
                >
                  {uploadProgress !== null ? (
                    <div className="flex-1 flex items-center gap-3">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
                      <div className="flex-1 space-y-1">
                        <div className="flex justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                          <span>{t(lang, 'uploadingFile')}</span>
                          <span className="font-mono-tabular">{uploadProgress}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-blue-600 transition-all duration-200"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : preparingAttachment ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      <span>Preparing upload...</span>
                    </div>
                  ) : pendingAttachment ? (
                    <>
                      <div className="flex items-center gap-3 min-w-0">
                        {pendingAttachment.attachmentType === 'image' ? (
                          <img
                            src={pendingAttachment.attachmentData}
                            alt={pendingAttachment.attachmentName}
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                        ) : pendingAttachment.attachmentMime.startsWith('video/') ? (
                          <div className="w-10 h-10 rounded-xl bg-violet-600/10 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                            <Film className="w-5 h-5" />
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                            <FileText className="w-5 h-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {pendingAttachment.attachmentName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                            {formatFileSize(pendingAttachment.attachmentSize)}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPendingAttachment(null)}
                        aria-label="Remove attachment"
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : null}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Quick Emoji Picker */}
            <AnimatePresence>
              {showEmojiPicker && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.14 }}
                  className="px-4 sm:px-6 py-2 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto"
                >
                  {QUICK_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => handleComposerChange(messageInput + em)}
                      className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-lg flex items-center justify-center"
                    >
                      {em}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {chatError && (
              <div className="px-4 sm:px-6 py-2 bg-red-50 dark:bg-red-950/40 border-t border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
                <span>{chatError}</span>
                <button
                  type="button"
                  onClick={() => setChatError('')}
                  className="font-semibold underline shrink-0"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Hidden File Inputs (supports images, videos, and any file up to 10 MB) */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleAttachmentPicked(file);
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="*/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleAttachmentPicked(file);
              }}
            />

            {/* Organized 2-Row Composer Dock (or Blocked Contact Banner) */}
            <div
              className={`border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0 chat-composer-container${
                hasNetlifyBadge ? ' has-netlify-badge' : ''
              }`}
            >
              {(() => {
                const composerPeerUid = activeChat.participantIds.find((id) => id !== publicProfile.uid);
                const composerPeerBlocked = Boolean(
                  composerPeerUid && privateInfo.blockedUids?.includes(composerPeerUid)
                );
                if (composerPeerBlocked && composerPeerUid) {
                  return (
                    <div className="px-4 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 bg-amber-50/80 dark:bg-amber-950/25">
                      <div className="flex items-center gap-2.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                        <Ban className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <span>{t(lang, 'blockedBannerText')}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleToggleBlockUid(composerPeerUid, false)}
                        className="min-h-[38px] px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
                      >
                        {t(lang, 'unblockUserBtn')}
                      </button>
                    </div>
                  );
                }
                return (
              <form
                onSubmit={(e) => handleSendMessage(e)}
                className="px-2.5 pt-2 pb-1.5 sm:px-4 sm:pt-3 sm:pb-2.5 space-y-2"
              >
                {/* Row 1: Full-width Input / Live Voice Waveform + Voice Button next to Send Button */}
                {isRecordingVoice ? (
                  <div className="flex items-center gap-2 p-2 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/70">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0 ml-1" />
                    <span className="text-xs font-mono-tabular font-bold text-red-600 dark:text-red-400 shrink-0">
                      {Math.floor(voiceRecordSeconds / 60)}:
                      {(voiceRecordSeconds % 60).toString().padStart(2, '0')}
                    </span>
                    {/* Live Real-Time AnalyserNode Frequency Waveform Graph */}
                    <div
                      role="img"
                      aria-label={t(lang, 'liveWaveLabel')}
                      className="flex-1 min-w-[60px] h-8 px-1.5 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-red-200/70 dark:border-red-900/40 flex items-center justify-between gap-[2px] overflow-hidden"
                    >
                      {voiceWaveform.map((level, idx) => (
                        <span
                          key={idx}
                          className="flex-1 max-w-[4px] min-w-[2px] rounded-full bg-gradient-to-t from-rose-500 via-red-500 to-amber-400 transition-[height] duration-75 ease-out"
                          style={{ height: `${Math.max(16, Math.round(level * 100))}%` }}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => stopVoiceRecording('cancel')}
                      aria-label={t(lang, 'cancelVoice')}
                      title={t(lang, 'cancelVoice')}
                      className="min-h-[36px] min-w-[36px] px-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-red-600 flex items-center justify-center shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => stopVoiceRecording('send')}
                      disabled={voiceBusy}
                      aria-label={t(lang, 'sendVoice')}
                      className="min-h-[36px] px-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm shadow-red-600/25"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span className="hidden xs:inline sm:inline">{t(lang, 'sendVoice')}</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 sm:gap-2 p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus-within:border-blue-500 dark:focus-within:border-blue-500 transition-colors">
                    <div className="relative flex-1 min-w-0 flex items-center">
                      <textarea
                        rows={1}
                        maxLength={2000}
                        value={messageInput}
                        onChange={(e) => handleComposerChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (enterToSend && !e.shiftKey) {
                              e.preventDefault();
                              void handleSendMessage();
                            } else if (!enterToSend && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault();
                              void handleSendMessage();
                            }
                          }
                        }}
                        onBlur={() => clearOwnTyping(activeChat.id)}
                        onPaste={(e) => {
                          const items = e.clipboardData?.items;
                          if (!items) return;
                          for (let i = 0; i < items.length; i++) {
                            const item = items[i];
                            if (item.type.startsWith('image/')) {
                              const blob = item.getAsFile();
                              if (blob) {
                                e.preventDefault();
                                void handleAttachmentPicked(blob);
                                break;
                              }
                            }
                          }
                        }}
                        placeholder={t(lang, 'typeMessage')}
                        className="w-full min-h-[40px] max-h-28 py-2.5 px-2.5 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none resize-none leading-snug"
                      />
                    </div>

                    {/* Voice Record Button right next to Send */}
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.9 }}
                      disabled={isRecordingVoice || voiceBusy}
                      onClick={() => void startVoiceRecording()}
                      title={t(lang, 'voiceBtn')}
                      aria-label={t(lang, 'voiceBtn')}
                      className="min-h-[40px] min-w-[40px] px-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 disabled:opacity-40 flex items-center justify-center gap-1 text-xs font-semibold transition-colors shrink-0"
                    >
                      <Mic className="w-4 h-4 shrink-0" />
                      <span className="hidden sm:inline">{t(lang, 'voiceBtn')}</span>
                    </motion.button>

                    {/* Send Button */}
                    <motion.button
                      type="submit"
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.91 }}
                      disabled={
                        (!messageInput.trim() && !pendingAttachment) ||
                        preparingAttachment ||
                        voiceBusy
                      }
                      className="min-h-[40px] px-3.5 sm:px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors overflow-hidden"
                    >
                      <motion.span
                        key={sendPulseKey}
                        initial={sendPulseKey > 0 ? { x: -10, y: 10, scale: 0.65, rotate: -15 } : false}
                        animate={{ x: 0, y: 0, scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                        className="inline-flex items-center"
                      >
                        <Send className="w-4 h-4" />
                      </motion.span>
                      <span className="hidden sm:inline">{t(lang, 'send')}</span>
                    </motion.button>
                  </div>
                )}

                {/* Row 2: Photo (Files vs Live Camera Menu), Emoji & File tucked neatly into the left space */}
                <div ref={photoMenuRef} className="relative">
                  <AnimatePresence>
                    {photoMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.96 }}
                        transition={{ duration: 0.14 }}
                        className="absolute bottom-full left-0 mb-2 z-40 w-64 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-1.5 space-y-1"
                      >
                        <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {t(lang, 'photoSourceTitle')}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoMenuOpen(false);
                            imageInputRef.current?.click();
                          }}
                          className="w-full min-h-[42px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left flex items-center gap-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors"
                        >
                          <span className="w-8 h-8 rounded-lg bg-blue-600/12 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                            <ImagePlus className="w-4 h-4" />
                          </span>
                          <span className="truncate">{t(lang, 'chooseFromFiles')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoMenuOpen(false);
                            setChatCameraOpen(true);
                          }}
                          className="w-full min-h-[42px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left flex items-center gap-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors"
                        >
                          <span className="w-8 h-8 rounded-lg bg-emerald-600/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                            <Camera className="w-4 h-4" />
                          </span>
                          <span className="truncate">{t(lang, 'takePhotoNow')}</span>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div
                    className={`flex items-center gap-1.5 justify-start overflow-x-auto no-scrollbar min-h-[42px] ${
                      hasNetlifyBadge ? 'pr-[186px] sm:pr-[206px]' : ''
                    }`}
                  >
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.92 }}
                      onClick={() => setPhotoMenuOpen((v) => !v)}
                      title={t(lang, 'photoSourceTitle')}
                      aria-label={t(lang, 'photoSourceTitle')}
                      aria-expanded={photoMenuOpen}
                      className={`min-h-[36px] px-2.5 rounded-xl border flex items-center gap-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        photoMenuOpen
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-900 border-transparent text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800'
                      }`}
                    >
                      <ImagePlus className={`w-3.5 h-3.5 shrink-0 ${photoMenuOpen ? 'text-white' : 'text-blue-600 dark:text-blue-400'}`} />
                      <span>{t(lang, 'photoBtn')}</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.92 }}
                      onClick={() => setShowEmojiPicker((v) => !v)}
                      aria-label="Toggle emojis"
                      className={`min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl transition-colors shrink-0 ${
                        showEmojiPicker
                          ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
                          : 'bg-slate-100 dark:bg-slate-900 border border-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Smile className="w-4 h-4" />
                    </motion.button>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.92 }}
                      onClick={() => fileInputRef.current?.click()}
                      title={t(lang, 'uploadFile')}
                      aria-label={t(lang, 'uploadFile')}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900 border border-transparent text-emerald-600 dark:text-emerald-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors shrink-0"
                    >
                      <Paperclip className="w-4 h-4 shrink-0" />
                    </motion.button>
                  </div>
                </div>
              </form>
                );
              })()}
            </div>
          </motion.div>
        ) : (
          /* Desktop & Tablet Quick Connect Hub */
          <motion.div
            key="view-hub"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 min-h-0 min-w-0 h-full overflow-y-auto p-5 sm:p-6 lg:p-10 flex flex-col"
          >
            <div className="max-w-4xl w-full mx-auto my-auto space-y-6 sm:space-y-8">
              <div className="space-y-2">
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white text-balance">
                  {t(lang, 'hubTitle')}
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
                  {t(lang, 'hubSubtitle')}
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
                {/* Gmail Card */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.18, delay: 0.02, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-5 shadow-xs"
                >
                  <div className="space-y-3">
                    <div className="w-11 h-11 rounded-2xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                      <Mail className="w-5 h-5" />
                    </div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      {t(lang, 'cardGmailTitle')}
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {t(lang, 'cardGmailDesc')}
                    </p>
                  </div>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      setConnectModalTab('gmail');
                      setConnectModalOpen(true);
                    }}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors text-center leading-snug"
                  >
                    {t(lang, 'cardGmailAction')}
                  </motion.button>
                </motion.div>

                {/* Invite Code Card */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.18, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-5 shadow-xs"
                >
                  <div className="space-y-3">
                    <div className="w-11 h-11 rounded-2xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <KeyRound className="w-5 h-5" />
                    </div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      {t(lang, 'cardCodeTitle')}
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {t(lang, 'cardCodeDesc')}
                    </p>
                  </div>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      setConnectModalTab('invite');
                      setConnectModalOpen(true);
                    }}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-medium transition-colors text-center leading-snug"
                  >
                    {t(lang, 'cardCodeAction')}
                  </motion.button>
                </motion.div>

                {/* Bluetooth & Nearby Card */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.18, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-5 shadow-xs"
                >
                  <div className="space-y-3">
                    <div className="w-11 h-11 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center">
                      <Wifi className="w-5 h-5" />
                    </div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      {t(lang, 'cardBtTitle')}
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {t(lang, 'cardBtDesc')}
                    </p>
                  </div>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      setBtInitialMode('bluetooth');
                      setWorkspaceView('bluetooth');
                    }}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-medium transition-colors text-center leading-snug"
                  >
                    {t(lang, 'cardBtAction')}
                  </motion.button>
                </motion.div>
              </div>

              {/* Join by Invite Code & Gemini AI Quick Bars */}
              <div className="pt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <KeyRound className="w-4 h-4" />
                  <span>Got an invite code from a friend?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setConnectModalTab('invite');
                      setConnectModalOpen(true);
                    }}
                    className="font-semibold text-blue-600 dark:text-blue-400 hover:underline ml-1"
                  >
                    Enter Invite Code
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void sharePublicApp()}
                    className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-2 whitespace-nowrap transition-colors"
                  >
                    {copiedAppLink ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-600" />
                        {t(lang, 'appLinkCopied')}
                      </>
                    ) : (
                      <>
                        <Share2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        {t(lang, 'shareAppLink')}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveChatId(null);
                      setWorkspaceView('gemini');
                    }}
                    className="min-h-[38px] px-3.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-medium flex items-center gap-2 whitespace-nowrap transition-colors"
                  >
                    <GeminiLogo variant="icon" size={16} />
                    Open Gemini AI
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {connectModalOpen && (
          <motion.div
            key="connect-modal-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50"
          >
            <ConnectModal
              isOpen={connectModalOpen}
              initialTab={connectModalTab}
              initialInviteCode={deepInviteCode}
              lang={lang}
              currentUser={publicProfile}
              existingChats={chats}
              knownProfiles={peerProfiles}
              blockedUids={privateInfo.blockedUids || []}
              onClose={() => {
                setConnectModalOpen(false);
                setDeepInviteCode('');
              }}
              onChatReady={(chatId, meta) => {
                if (meta?.pendingEmail) {
                  setPendingEmailsByChat((prev) => ({ ...prev, [chatId]: meta.pendingEmail! }));
                }
                if (meta?.recipientEmail) {
                  setPeerEmailsByChat((prev) => ({ ...prev, [chatId]: meta.recipientEmail! }));
                }
                openChat(chatId);
              }}
              onPreviewUserProfile={(person) => {
                setConnectModalOpen(false);
                setPreviewedUser(person);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Discovered User Profile Preview Modal */}
      <AnimatePresence>
        {previewedUser && (
          <motion.div
            key="discovered-user-preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setPreviewedUser(null)}
            className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 14 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl mobile-sheet-safe"
            >
              <div className="sm:hidden flex justify-center pt-2.5 pb-0.5">
                <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
              </div>
              <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => setPreviewedUser(null)}
                    aria-label={t(lang, 'backBtn')}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {t(lang, 'userProfilePreviewTitle')}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewedUser(null)}
                  aria-label="Close"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 flex flex-col items-center text-center space-y-4">
                {(() => {
                  const existingDm = chats.find(
                    (c) =>
                      c.participantIds.length === 2 &&
                      c.participantIds.includes(publicProfile.uid) &&
                      c.participantIds.includes(previewedUser.uid)
                  );
                  const canSeePres = canSeePeerPresence(previewedUser, Boolean(existingDm));
                  const isOnline =
                    canSeePres && previewedUser.onlineStatus === 'online';
                  const isBusy = startingSearchUid === previewedUser.uid;
                  return (
                    <>
                      <UserAvatar
                        name={previewedUser.displayName}
                        photoUrl={previewedUser.photoUrl}
                        size="xl"
                        isOnline={canSeePres ? isOnline : undefined}
                        ringColorClass="ring-white dark:ring-slate-900"
                      />
                      <div className="space-y-1">
                        <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                          {previewedUser.displayName}
                        </h4>
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {canSeePres ? (
                            isOnline ? (
                              <span className="text-emerald-600 dark:text-emerald-400">
                                ● {t(lang, 'online')}
                              </span>
                            ) : (
                              <span>{t(lang, 'offline')}</span>
                            )
                          ) : (
                            <span>{t(lang, 'presenceHidden')}</span>
                          )}
                          {previewedUser.showGmail !== false && previewedUser.maskedEmail ? (
                            <>
                              <span className="mx-1.5" aria-hidden="true">·</span>
                              <span className="font-mono-tabular">{previewedUser.maskedEmail}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-left">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {t(lang, 'bioLabel')}
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 leading-relaxed">
                          {previewedUser.bio?.trim() ? previewedUser.bio : t(lang, 'noBioYet')}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(startingSearchUid)}
                        onClick={() => void handleStartChatFromSearch(previewedUser)}
                        className="w-full min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                      >
                        {isBusy ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <MessageSquare className="w-4 h-4" />
                        )}
                        <span>{existingDm ? t(lang, 'openChatBtn') : t(lang, 'startChatBtn')}</span>
                      </button>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {profileModalOpen && (
          <motion.div
            key="profile-modal-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50"
          >
            <ProfileModal
              isOpen={profileModalOpen}
              initialTab={profileModalTab}
              lang={lang}
              themeMode={themeMode}
              soundOn={soundOn}
              notifPermission={notifPermission}
              enterToSend={enterToSend}
              publicProfile={publicProfile}
              privateInfo={privateInfo}
              peerProfiles={peerProfiles}
              onClose={() => setProfileModalOpen(false)}
              onUpdated={(updates) => {
                setPublicProfile((prev) =>
                  prev
                    ? {
                        ...prev,
                        displayName: updates.displayName,
                        bio: updates.bio,
                        photoUrl: updates.photoUrl,
                        showGmail: updates.showGmail,
                        onlineVisibility: updates.onlineVisibility,
                        showOnlineStatus: updates.showOnlineStatus,
                        searchable: updates.searchable,
                      }
                    : prev
                );
                setPrivateInfo((prev) =>
                  prev
                    ? {
                        ...prev,
                        language: updates.language,
                        readReceiptsEnabled: updates.readReceiptsEnabled,
                      }
                    : prev
                );
                setLang(updates.language);
              }}
              onChangeTheme={(mode) => handleSelectThemeMode(mode)}
              onChangeLanguage={(nextLang) => setLang(nextLang)}
              onToggleSound={toggleSound}
              onRequestBgNotifications={() => void handleRequestBgNotifications()}
              onToggleEnterToSend={toggleEnterToSend}
              onUnblockUser={(uid) => handleToggleBlockUid(uid, false)}
              onOpenLegalModal={(tab) => setLegalModalState({ open: true, tab })}
              onOpenInviteModal={() => {
                setConnectModalTab('invite');
                setConnectModalOpen(true);
              }}
              onExportData={handleExportMyData}
              onLockAppNow={() => setAppLocked(true)}
              onAppLockChanged={() => setAppLockVersion((v) => v + 1)}
              onSignOut={handleSignOut}
              onDeleteAccount={handleDeleteAccount}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contact / Peer Profile Modal (with active 24h statuses + Safety + Delete Chat) */}
      <AnimatePresence>
        {peerProfileModalOpen && activeChat && (() => {
          const activePeer = getChatPeerProfile(activeChat);
          const peerUid = activeChat.participantIds.find((id) => id !== publicProfile.uid);
          const peerStatuses = peerUid ? statuses.filter((s) => s.uid === peerUid) : [];
          const peerOnline = isPeerOnline(activePeer, nowTick, true);
          const peerIsBlocked = Boolean(peerUid && privateInfo.blockedUids?.includes(peerUid));
          return (
            <motion.div
              key="peer-profile-wrap"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50"
            >
              <PeerProfileModal
                isOpen={peerProfileModalOpen}
                lang={lang}
                chat={activeChat}
                displayName={getChatDisplayName(activeChat)}
                peerProfile={activePeer}
                isOnline={peerOnline}
                presenceLabel={formatPresenceLabel(activePeer, lang, nowTick, true)}
                peerStatuses={peerStatuses}
                isChatMuted={mutedChatIds.includes(activeChat.id)}
                isChatSoundMuted={mutedSoundChatIds.includes(activeChat.id)}
                isPinned={pinnedOrderMap.has(activeChat.id)}
                isBlocked={peerIsBlocked}
                savedPeerEmail={
                  activePeer?.showGmail === false
                    ? ''
                    : peerEmailsByChat[activeChat.id] || pendingEmailsByChat[activeChat.id] || ''
                }
                viewerEmail={privateInfo?.email || firebaseUser?.email || ''}
                autoOfferOfflineGmail={!offlineAlertOptOutChats.includes(activeChat.id)}
                officialMailerReady={officialMailerReady}
                onToggleChatMute={() => {
                  setMutedChatIds((prev) =>
                    prev.includes(activeChat.id)
                      ? prev.filter((id) => id !== activeChat.id)
                      : [...prev, activeChat.id]
                  );
                }}
                onToggleChatSoundMute={() => {
                  setMutedSoundChatIds((prev) =>
                    prev.includes(activeChat.id)
                      ? prev.filter((id) => id !== activeChat.id)
                      : [...prev, activeChat.id]
                  );
                }}
                onTogglePinChat={() => handleTogglePinChat(activeChat.id)}
                onToggleBlock={
                  peerUid ? () => handleToggleBlockUid(peerUid) : undefined
                }
                onOpenReport={
                  peerUid
                    ? () => {
                        setPeerProfileModalOpen(false);
                        setReportTarget({
                          uid: peerUid,
                          name: getChatDisplayName(activeChat),
                          chatId: activeChat.id,
                        });
                      }
                    : undefined
                }
                onSavePeerEmail={(email) => {
                  if (email) {
                    setPeerEmailsByChat((prev) => ({ ...prev, [activeChat.id]: email }));
                  }
                }}
                onToggleAutoOfferOfflineGmail={() => {
                  setOfflineAlertOptOutChats((prev) =>
                    prev.includes(activeChat.id)
                      ? prev.filter((id) => id !== activeChat.id)
                      : [...prev, activeChat.id]
                  );
                }}
                onSendGmailAlert={async (toEmail) => {
                  await sendGmailAlertEmail({
                    to: toEmail,
                    senderName: publicProfile.displayName,
                    senderEmail: privateInfo.email,
                    messagePreview: activeChat.lastMessageText || 'Sent you a message on LoopLy',
                    appUrl: `${getPublicAppOrigin()}/?chat=${encodeURIComponent(activeChat.id)}`,
                    isBangla: lang === 'bn',
                  });
                }}
                getGmailComposeUrl={(toEmail) =>
                  buildGmailWebComposeUrl({
                    to: toEmail,
                    senderName: publicProfile.displayName,
                    messagePreview: activeChat.lastMessageText || 'Sent you a message on LoopLy',
                    appUrl: `${getPublicAppOrigin()}/?chat=${encodeURIComponent(activeChat.id)}`,
                    isBangla: lang === 'bn',
                  })
                }
                onStartCall={(mode) => handleStartCall(activeChat, mode)}
                onOpenStatus={(list, idx) => {
                  setPeerProfileModalOpen(false);
                  setStatusViewer({
                    statuses: list,
                    initialIndex: idx,
                    authorOnline: peerOnline,
                  });
                }}
                onDeleteChat={() => handleDeleteChat(activeChat)}
                onClose={() => setPeerProfileModalOpen(false)}
              />
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Report User & Safety Modal */}
      {reportTarget && (
        <ReportUserModal
          isOpen={Boolean(reportTarget)}
          lang={lang}
          targetName={reportTarget.name}
          isAlreadyBlocked={Boolean(privateInfo.blockedUids?.includes(reportTarget.uid))}
          onSubmitReport={async ({ reason, details, alsoBlock }) => {
            await submitUserReport({
              reporterUid: publicProfile.uid,
              reportedUid: reportTarget.uid,
              chatId: reportTarget.chatId,
              reason: reason as ReportReason,
              details,
            });
            if (alsoBlock) {
              await handleToggleBlockUid(reportTarget.uid, true);
            }
          }}
          onClose={() => setReportTarget(null)}
        />
      )}

      {/* Create 24h Status Modal */}
      <AnimatePresence>
        {statusCreateOpen && (
          <motion.div
            key="status-create-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50"
          >
            <StatusModal
              mode="create"
              lang={lang}
              currentUser={publicProfile}
              onClose={() => setStatusCreateOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 24h Status Story Viewer */}
      <AnimatePresence>
        {statusViewer && (
          <motion.div
            key="status-viewer-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50"
          >
            <StatusModal
              mode="view"
              lang={lang}
              currentUser={publicProfile}
              peerProfiles={peerProfiles}
              statuses={statusViewer.statuses}
              initialIndex={statusViewer.initialIndex}
              authorOnline={statusViewer.authorOnline}
              onClose={() => setStatusViewer(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <CameraCaptureModal
        isOpen={chatCameraOpen}
        mode="chat"
        lang={lang}
        onCaptureFile={async (file) => {
          const prepared = await prepareAttachment(file);
          await handleSendMessage(undefined, '', prepared);
        }}
        onClose={() => setChatCameraOpen(false)}
      />

      {/* Smooth Image Lightbox Preview */}
      <AnimatePresence>
        {lightboxImage && (
          <motion.div
            key="image-lightbox"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setLightboxImage(null)}
            className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4 gap-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-3xl flex items-center justify-between text-white gap-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setLightboxImage(null)}
                  aria-label={t(lang, 'backBtn')}
                  className="min-h-[40px] px-3 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>{t(lang, 'backBtn')}</span>
                </button>
                <span className="text-sm font-medium truncate">{lightboxImage.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => triggerFileDownload(lightboxImage.url, lightboxImage.name)}
                  className="min-h-[40px] px-3.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Download className="w-4 h-4" />
                  {t(lang, 'downloadFile')}
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxImage(null)}
                  aria-label="Close image preview"
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <motion.img
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              src={lightboxImage.url}
              alt={lightboxImage.name}
              referrerPolicy="no-referrer"
              className="max-h-[80dvh] max-w-full rounded-2xl object-contain shadow-2xl"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Message Delivery & Seen Info Dialog */}
      <AnimatePresence>
        {liveMessageInfo && (
          <motion.div
            key="message-info-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setMessageInfoTarget(null)}
            className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 14 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 pt-3 sm:pt-5 shadow-2xl space-y-4 mobile-sheet-safe"
            >
              <div className="sm:hidden flex justify-center pb-0.5">
                <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-blue-600/12 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Info className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {t(lang, 'msgInfoTitle')}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setMessageInfoTarget(null)}
                  aria-label="Close"
                  className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3 rounded-xl bg-blue-600 text-white text-xs leading-relaxed break-words max-h-28 overflow-y-auto">
                {liveMessageInfo.text || liveMessageInfo.attachmentName || 'Attachment'}
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-slate-800 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      <Send className="w-3.5 h-3.5 -rotate-12 text-white" strokeWidth={2.2} />
                    </span>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {t(lang, 'msgSentLabel')}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 text-right">
                    {formatFullDateTime(liveMessageInfo.createdAt, lang) || formatTime(liveMessageInfo.createdAt, true)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                      <Send className="w-3.5 h-3.5 -rotate-12 text-amber-500" strokeWidth={2.2} />
                    </span>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {t(lang, 'msgDeliveredLabel')}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 text-right">
                    {formatFullDateTime(liveMessageInfo.deliveredAt || liveMessageInfo.readAt, lang) ||
                      t(lang, 'msgStatusPending')}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                      <Send className="w-3.5 h-3.5 -rotate-12 text-emerald-500" strokeWidth={2.2} />
                    </span>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {t(lang, 'msgSeenLabel')}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 text-right">
                    {formatFullDateTime(liveMessageInfo.readAt, lang) ||
                      (liveMessageInfo.deliveredAt ? t(lang, 'msgNotSeenYet') : '—')}
                  </span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Offline Peer Gmail Alert Confirmation Dialog */}
      <AnimatePresence>
        {offlineEmailPrompt && (
          <motion.div
            key="offline-gmail-prompt"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => !offlineEmailPrompt.sending && setOfflineEmailPrompt(null)}
            className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 14 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 pt-3 sm:pt-5 shadow-2xl space-y-4 mobile-sheet-safe"
            >
              <div className="sm:hidden flex justify-center pb-0.5">
                <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-600/12 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {offlineEmailPrompt.peerName} {t(lang, 'offlinePromptTitle')}
                    </h3>
                    <p className="text-[11px] text-red-500 dark:text-red-400 font-medium truncate">
                      {offlineEmailPrompt.presenceText}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={offlineEmailPrompt.sending}
                  onClick={() => setOfflineEmailPrompt(null)}
                  aria-label="Close"
                  className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {t(lang, 'offlinePromptDesc')}
              </p>

              <div className="space-y-1.5">
                {!offlineEmailPrompt.editingEmail &&
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(offlineEmailPrompt.toEmail.trim()) ? (
                  <div className="px-3.5 py-2.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                        {t(lang, 'sendingToGmailLabel')}
                      </div>
                      <div className="text-xs font-mono-tabular font-bold text-slate-900 dark:text-white truncate mt-0.5">
                        {maskEmail(offlineEmailPrompt.toEmail.trim().toLowerCase())}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={offlineEmailPrompt.sending}
                      onClick={() =>
                        setOfflineEmailPrompt((prev) =>
                          prev ? { ...prev, toEmail: '', editingEmail: true } : prev
                        )
                      }
                      className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                    >
                      {t(lang, 'editEmailBtn')}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        {t(lang, 'sendingToGmailLabel')}
                      </label>
                      {(
                        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(offlineEmailPrompt.toEmail.trim()) ||
                        Boolean(
                          peerEmailsByChat[offlineEmailPrompt.chatId] ||
                            pendingEmailsByChat[offlineEmailPrompt.chatId]
                        )
                      ) && (
                        <button
                          type="button"
                          onClick={() =>
                            setOfflineEmailPrompt((prev) => {
                              if (!prev) return prev;
                              const trimmed = prev.toEmail.trim().toLowerCase();
                              const fallbackSaved =
                                peerEmailsByChat[prev.chatId] ||
                                pendingEmailsByChat[prev.chatId] ||
                                '';
                              return {
                                ...prev,
                                toEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
                                  ? trimmed
                                  : fallbackSaved,
                                editingEmail: false,
                              };
                            })
                          }
                          className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(offlineEmailPrompt.toEmail.trim())
                            ? t(lang, 'done')
                            : t(lang, 'cancel')}
                        </button>
                      )}
                    </div>
                    <input
                      type="email"
                      value={offlineEmailPrompt.toEmail}
                      onChange={(e) =>
                        setOfflineEmailPrompt((prev) =>
                          prev ? { ...prev, toEmail: e.target.value, error: '' } : prev
                        )
                      }
                      placeholder={t(lang, 'recipientGmailPlaceholder')}
                      className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </>
                )}
              </div>

              {officialMailerReady === true && !offlineEmailPrompt.error && (
                <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  ✓ {t(lang, 'officialMailerReadyNote')}
                </p>
              )}

              {offlineEmailPrompt.error && (
                <p className="text-[11px] text-red-600 dark:text-red-400 font-medium leading-snug">
                  {offlineEmailPrompt.error}
                </p>
              )}

              {(offlineEmailPrompt.error || officialMailerReady === false) &&
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(offlineEmailPrompt.toEmail.trim()) && (
                  <a
                    href={buildGmailWebComposeUrl({
                      to: offlineEmailPrompt.toEmail.trim().toLowerCase(),
                      senderName: publicProfile.displayName,
                      messagePreview: offlineEmailPrompt.messagePreview,
                      appUrl: `${getPublicAppOrigin()}/?chat=${encodeURIComponent(offlineEmailPrompt.chatId)}`,
                      isBangla: lang === 'bn',
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      const cleanTo = offlineEmailPrompt.toEmail.trim().toLowerCase();
                      setPeerEmailsByChat((prev) => ({
                        ...prev,
                        [offlineEmailPrompt.chatId]: cleanTo,
                      }));
                      setOfflineEmailPrompt(null);
                    }}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{t(lang, 'openGmailAppBtn')}</span>
                  </a>
                )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={offlineEmailPrompt.sending}
                  onClick={() => setOfflineEmailPrompt(null)}
                  className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  {t(lang, 'dontAskOfflineChat')}
                </button>
                <button
                  type="button"
                  disabled={
                    offlineEmailPrompt.sending ||
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(offlineEmailPrompt.toEmail.trim())
                  }
                  onClick={async () => {
                    if (!offlineEmailPrompt) return;
                    const cleanTo = offlineEmailPrompt.toEmail.trim().toLowerCase();
                    setOfflineEmailPrompt((prev) => (prev ? { ...prev, sending: true, error: '' } : prev));
                    try {
                      setPeerEmailsByChat((prev) => ({
                        ...prev,
                        [offlineEmailPrompt.chatId]: cleanTo,
                      }));
                      await sendGmailAlertEmail({
                        to: cleanTo,
                        senderName: publicProfile.displayName,
                        senderEmail: privateInfo.email,
                        messagePreview: offlineEmailPrompt.messagePreview,
                        appUrl: `${getPublicAppOrigin()}/?chat=${encodeURIComponent(offlineEmailPrompt.chatId)}`,
                        isBangla: lang === 'bn',
                      });
                      setOfflineEmailPrompt(null);
                      setGmailToast(`${t(lang, 'gmailAlertSent')} (${maskEmail(cleanTo)})`);
                      window.setTimeout(() => setGmailToast(''), 4000);
                    } catch (err) {
                      setOfflineEmailPrompt((prev) =>
                        prev
                          ? {
                              ...prev,
                              sending: false,
                              error: err instanceof Error ? err.message : 'Unable to send Gmail alert.',
                            }
                          : prev
                      );
                    }
                  }}
                  className="flex-1 min-h-[42px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  {offlineEmailPrompt.sending ? (
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {offlineEmailPrompt.sending
                      ? t(lang, 'sendingGmailAlert')
                      : t(lang, 'sendGmailAlertBtn')}
                  </span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gmail Sent Success Toast */}
      <AnimatePresence>
        {gmailToast && (
          <motion.div
            key="gmail-sent-toast"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-emerald-600 text-white text-xs font-semibold shadow-lg flex items-center gap-2 whitespace-nowrap"
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>{gmailToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active 1-on-1 Voice / Video Call Overlay */}
      <AnimatePresence>
        {activeCall && publicProfile && (
          <CallOverlay
            key={activeCall.callId}
            lang={lang}
            currentUser={publicProfile}
            activeCall={activeCall}
            onClose={() => {
              dismissedCallIdsRef.current.add(activeCall.callId);
              setActiveCall(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* 4-Digit App PIN Lock Screen */}
      {appLocked && isAppLockEnabled(publicProfile.uid) && (
        <AppLockScreen
          uid={publicProfile.uid}
          displayName={publicProfile.displayName}
          lang={lang}
          onUnlocked={() => setAppLocked(false)}
          onSignOut={handleSignOut}
        />
      )}
    </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      {appBody}
      <LegalPolicyModal
        isOpen={legalModalState.open}
        initialTab={legalModalState.tab}
        lang={lang}
        isAuthenticated={Boolean(firebaseUser && publicProfile)}
        acceptedVersion={privateInfo?.acceptedPolicyVersion}
        onAcceptPolicy={publicProfile ? handleAcceptPolicy : undefined}
        onClose={() => setLegalModalState((prev) => ({ ...prev, open: false }))}
      />
      <SandDissolveOverlay ref={sandDissolveRef} />
      <LaunchSplash
        visible={showLaunchSplash}
        onDismiss={() => setSplashDismissed(true)}
      />
    </MotionConfig>
  );
}
