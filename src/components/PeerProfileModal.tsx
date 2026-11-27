import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  Check,
  ExternalLink,
  Flag,
  Loader2,
  Mail,
  Phone,
  Pin,
  PinOff,
  Radio,
  Send,
  Sparkles,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from 'lucide-react';
import { maskEmail, resolvePeerMaskedHint } from '../lib/firebase';
import { t } from '../lib/i18n';
import { AppLanguage, CallMode, ChatRoom, UserPublicProfile, UserStatus } from '../types/chat';
import { STATUS_GRADIENTS } from './StatusModal';
import { UserAvatar } from './UserAvatar';

interface Props {
  isOpen: boolean;
  lang: AppLanguage;
  chat: ChatRoom;
  displayName: string;
  peerProfile?: UserPublicProfile;
  isOnline: boolean;
  presenceLabel: string;
  peerStatuses: UserStatus[];
  isChatMuted: boolean;
  isChatSoundMuted: boolean;
  isPinned?: boolean;
  isBlocked?: boolean;
  savedPeerEmail: string;
  viewerEmail?: string;
  autoOfferOfflineGmail: boolean;
  officialMailerReady?: boolean | null;
  onToggleChatMute: () => void;
  onToggleChatSoundMute: () => void;
  onTogglePinChat?: () => void;
  onToggleBlock?: () => Promise<void>;
  onOpenReport?: () => void;
  onSavePeerEmail: (email: string) => void;
  onToggleAutoOfferOfflineGmail: () => void;
  onSendGmailAlert: (toEmail: string) => Promise<void>;
  getGmailComposeUrl?: (toEmail: string) => string;
  onStartCall?: (mode: CallMode) => void;
  onOpenStatus: (statuses: UserStatus[], index: number) => void;
  onDeleteChat: () => Promise<void>;
  onClose: () => void;
}

export const PeerProfileModal: React.FC<Props> = ({
  isOpen,
  lang,
  chat,
  displayName,
  peerProfile,
  isOnline,
  presenceLabel,
  peerStatuses,
  isChatMuted,
  isChatSoundMuted,
  isPinned = false,
  isBlocked = false,
  savedPeerEmail,
  viewerEmail,
  autoOfferOfflineGmail,
  officialMailerReady,
  onToggleChatMute,
  onToggleChatSoundMute,
  onTogglePinChat,
  onToggleBlock,
  onOpenReport,
  onSavePeerEmail,
  onToggleAutoOfferOfflineGmail,
  onSendGmailAlert,
  getGmailComposeUrl,
  onStartCall,
  onOpenStatus,
  onDeleteChat,
  onClose,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [blockingBusy, setBlockingBusy] = useState(false);
  const [emailInput, setEmailInput] = useState(savedPeerEmail);
  const [editingEmail, setEditingEmail] = useState(!savedPeerEmail);
  const [emailSavedFeedback, setEmailSavedFeedback] = useState(false);
  const [sendingAlert, setSendingAlert] = useState(false);
  const [alertStatusMsg, setAlertStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setEmailInput(savedPeerEmail);
    setEditingEmail(!savedPeerEmail);
    setAlertStatusMsg(null);
  }, [savedPeerEmail, chat.id, isOpen]);

  if (!isOpen) return null;

  const trimmedEmail = emailInput.trim().toLowerCase();
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  const peerHidesGmail = peerProfile?.showGmail === false;
  const resolvedPeerHint = peerHidesGmail
    ? t(lang, 'gmailHiddenLabel')
    : resolvePeerMaskedHint({
        targetHint: chat.targetHint,
        channel: chat.channel,
        peerMaskedEmail: peerProfile?.maskedEmail,
        peerEmail: savedPeerEmail || (isEmailValid ? trimmedEmail : ''),
        peerShowGmail: peerProfile?.showGmail,
        viewerEmail,
        lang,
      });

  const handleSaveEmail = () => {
    onSavePeerEmail(trimmedEmail);
    setEmailSavedFeedback(true);
    window.setTimeout(() => setEmailSavedFeedback(false), 1800);
  };

  const handleSendAlertNow = async () => {
    if (!isEmailValid || sendingAlert) return;
    setSendingAlert(true);
    setAlertStatusMsg(null);
    try {
      onSavePeerEmail(trimmedEmail);
      await onSendGmailAlert(trimmedEmail);
      setEditingEmail(false);
      setAlertStatusMsg({ type: 'ok', text: `${t(lang, 'gmailAlertSent')} (${maskEmail(trimmedEmail)})` });
    } catch (err) {
      setAlertStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to send Gmail alert.',
      });
    } finally {
      setSendingAlert(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await onDeleteChat();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 14 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92dvh] flex flex-col mobile-sheet-safe"
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-0.5 shrink-0">
          <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onClose}
              aria-label={t(lang, 'backBtn')}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
              {t(lang, 'peerProfileTitle')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 p-4 sm:p-6 space-y-5 overflow-y-auto">
          {/* Avatar with Blinking Green Online Ring + Audio/Video Call Quick Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center text-center space-y-3"
          >
            <UserAvatar
              name={displayName}
              photoUrl={peerProfile?.photoUrl}
              size="xl"
              isOnline={isOnline}
              presenceTitle={presenceLabel}
              ringColorClass="ring-white dark:ring-slate-900"
            />

            <div className="space-y-1.5">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{displayName}</h3>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium">
                <span
                  className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`}
                />
                <span
                  className={
                    isOnline
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                >
                  {presenceLabel}
                </span>
              </div>
            </div>

            {onStartCall && peerProfile && (
              <div className="grid grid-cols-2 gap-2.5 w-full pt-1">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    onClose();
                    onStartCall('audio');
                  }}
                  className="min-h-[44px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
                >
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>{t(lang, 'voiceCall')}</span>
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    onClose();
                    onStartCall('video');
                  }}
                  className="min-h-[44px] px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
                >
                  <Video className="w-4 h-4 shrink-0" />
                  <span>{t(lang, 'videoCall')}</span>
                </motion.button>
              </div>
            )}
          </motion.div>

          {/* Bio / About Card */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
            className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t(lang, 'bioLabel')}
            </div>
            <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
              {peerProfile?.bio?.trim() ? peerProfile.bio : t(lang, 'noBioYet')}
            </p>
          </motion.div>

          {/* Connection Details */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                {chat.channel === 'gmail' ? (
                  <Mail className="w-4 h-4" />
                ) : (
                  <Wifi className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {chat.channel === 'gmail'
                    ? 'Gmail Chat'
                    : chat.channel === 'phone'
                    ? 'Invite Code Chat'
                    : 'Nearby Direct'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular truncate">
                  {resolvedPeerHint}
                </div>
              </div>
            </div>
            {onTogglePinChat && (
              <button
                type="button"
                onClick={onTogglePinChat}
                aria-pressed={isPinned}
                className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors ${
                  isPinned
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                <span>{isPinned ? t(lang, 'unpinChat') : t(lang, 'pinChat')}</span>
              </button>
            )}
          </motion.div>

          {/* Per-User Notification Mute & Sound Controls */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.09, ease: [0.16, 1, 0.3, 1] }}
            className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t(lang, 'notifSoundSection')}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isChatMuted
                      ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
                      : 'bg-blue-600/10 text-blue-600 dark:text-blue-400'
                  }`}
                >
                  {isChatMuted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {t(lang, 'muteNotifsLabel')}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {t(lang, 'muteNotifsHint')}
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isChatMuted}
                onClick={onToggleChatMute}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  isChatMuted ? 'bg-rose-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    isChatMuted ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isChatSoundMuted
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                      : 'bg-emerald-600/10 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {isChatSoundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {t(lang, 'chatSoundLabel')}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {t(lang, 'chatSoundHint')}
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!isChatSoundMuted}
                onClick={onToggleChatSoundMute}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  !isChatSoundMuted ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    !isChatSoundMuted ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </motion.div>

          {/* Offline Gmail Alert Section */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3"
          >
            <div className="space-y-0.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t(lang, 'offlineEmailAlertTitle')}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t(lang, 'offlineEmailAlertHint')}
              </p>
            </div>

            {!editingEmail && isEmailValid ? (
              <div className="px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/60 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    {t(lang, 'sendingToGmailLabel')}
                  </div>
                  <div className="text-xs font-mono-tabular font-semibold text-slate-900 dark:text-white truncate">
                    {maskEmail(trimmedEmail)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEmailInput('');
                    setEditingEmail(true);
                  }}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                >
                  {t(lang, 'editEmailBtn')}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value);
                    setAlertStatusMsg(null);
                  }}
                  placeholder={t(lang, 'recipientGmailPlaceholder')}
                  aria-label={t(lang, 'recipientGmailLabel')}
                  className="flex-1 min-w-0 min-h-[38px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => {
                    handleSaveEmail();
                    if (isEmailValid) setEditingEmail(false);
                  }}
                  disabled={!emailInput.trim() || !isEmailValid}
                  className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1 shrink-0"
                >
                  {emailSavedFeedback ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : null}
                  <span>{emailSavedFeedback ? t(lang, 'copied').replace('!', '') : t(lang, 'saveGmailBtn')}</span>
                </button>
                {savedPeerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(savedPeerEmail) && (
                  <button
                    type="button"
                    onClick={() => {
                      setEmailInput(savedPeerEmail);
                      setEditingEmail(false);
                    }}
                    className="min-h-[38px] px-2.5 rounded-xl text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 shrink-0"
                  >
                    {t(lang, 'cancel')}
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {t(lang, 'autoOfferGmailLabel')}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {t(lang, 'autoOfferGmailHint')}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoOfferOfflineGmail}
                onClick={onToggleAutoOfferOfflineGmail}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  autoOfferOfflineGmail ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    autoOfferOfflineGmail ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="space-y-2">
              {officialMailerReady === true && (
                <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  ✓ {t(lang, 'officialMailerReadyNote')}
                </p>
              )}

              <button
                type="button"
                disabled={!isEmailValid || sendingAlert}
                onClick={handleSendAlertNow}
                className="w-full min-h-[42px] px-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                {sendingAlert ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>{sendingAlert ? t(lang, 'sendingGmailAlert') : t(lang, 'sendGmailAlertBtn')}</span>
              </button>

              {isEmailValid && getGmailComposeUrl && officialMailerReady === false && (
                <a
                  href={getGmailComposeUrl(trimmedEmail)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => handleSaveEmail()}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/90 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>{t(lang, 'openGmailAppBtn')}</span>
                </a>
              )}
            </div>

            {alertStatusMsg && (
              <div className="space-y-2">
                <p
                  className={`text-[11px] font-medium ${
                    alertStatusMsg.type === 'ok'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {alertStatusMsg.text}
                </p>
                {alertStatusMsg.type === 'err' && isEmailValid && getGmailComposeUrl && officialMailerReady !== false && (
                  <a
                    href={getGmailComposeUrl(trimmedEmail)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{t(lang, 'openGmailAppBtn')}</span>
                  </a>
                )}
              </div>
            )}
          </motion.div>

          {/* Peer's Active 24h Statuses */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-2.5"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>{t(lang, 'activeStatuses')}</span>
            </div>

            {peerStatuses.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                {t(lang, 'noActiveStatus')}
              </div>
            ) : (
              <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                {peerStatuses.map((s, idx) => (
                  <motion.button
                    key={s.id}
                    type="button"
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => onOpenStatus(peerStatuses, idx)}
                    className={`relative w-24 h-32 rounded-xl overflow-hidden shrink-0 p-2 flex items-center justify-center text-center shadow-sm border border-white/15 ${
                      s.mediaType === 'image'
                        ? 'bg-black'
                        : STATUS_GRADIENTS[s.bgGradient] || STATUS_GRADIENTS.blue
                    }`}
                  >
                    {s.mediaType === 'image' && s.imageData ? (
                      <img
                        src={s.imageData}
                        alt={s.text || 'Status'}
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[11px] font-bold text-white line-clamp-4 leading-snug">
                        {s.text}
                      </span>
                    )}
                    <span className="absolute top-1.5 right-1.5 text-white/85">
                      <Radio className="w-3 h-3" />
                    </span>
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>

          {/* Safety Actions: Block & Report */}
          {(onToggleBlock || onOpenReport) && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-2">
              {onToggleBlock && (
                <button
                  type="button"
                  disabled={blockingBusy}
                  onClick={async () => {
                    setBlockingBusy(true);
                    try {
                      await onToggleBlock();
                    } finally {
                      setBlockingBusy(false);
                    }
                  }}
                  className={`min-h-[42px] px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                    isBlocked
                      ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100'
                      : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 hover:bg-amber-100'
                  }`}
                >
                  {blockingBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Ban className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{isBlocked ? t(lang, 'unblockUserBtn') : t(lang, 'blockUserBtn')}</span>
                </button>
              )}
              {onOpenReport && (
                <button
                  type="button"
                  onClick={onOpenReport}
                  className="min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Flag className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span>{t(lang, 'reportUserBtn')}</span>
                </button>
              )}
            </div>
          )}

          {/* Delete Chat Danger Action */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            {confirmDelete ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDeleteClick}
                  className="flex-1 min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  {deleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  {deleting ? t(lang, 'deletingChat') : t(lang, 'confirmDeleteChat')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleDeleteClick}
                className="w-full min-h-[44px] px-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                {t(lang, 'deleteChat')}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
