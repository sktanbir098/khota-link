import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, KeyRound, Mail, X } from 'lucide-react';
import { formatFriendlyError, joinChatByInviteCode, startChatByGmail } from '../lib/chatService';
import { t } from '../lib/i18n';
import { AppLanguage, ChatRoom, UserPublicProfile } from '../types/chat';

interface Props {
  isOpen: boolean;
  initialTab?: 'gmail' | 'invite';
  initialInviteCode?: string;
  lang: AppLanguage;
  currentUser: UserPublicProfile;
  existingChats: ChatRoom[];
  onClose: () => void;
  onChatReady: (chatId: string, meta?: { pendingEmail?: string; recipientEmail?: string }) => void;
}

export const ConnectModal: React.FC<Props> = ({
  isOpen,
  initialTab = 'gmail',
  initialInviteCode = '',
  lang,
  currentUser,
  existingChats,
  onClose,
  onChatReady,
}) => {
  const [tab, setTab] = useState<'gmail' | 'invite'>(
    initialInviteCode ? 'invite' : initialTab
  );
  const [gmail, setGmail] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'gmail') {
        const res = await startChatByGmail({
          currentUser,
          targetGmail: gmail,
          existingChats,
        });
        const cleanGmail = gmail.trim().toLowerCase();
        onChatReady(res.chatId, {
          pendingEmail: res.isPendingInvite ? cleanGmail : undefined,
          recipientEmail: cleanGmail,
        });
        onClose();
      } else {
        const chatId = await joinChatByInviteCode({
          currentUser,
          inviteCodeRaw: inviteCode,
          existingChats,
        });
        onChatReady(chatId);
        onClose();
      }
    } catch (err) {
      setError(formatFriendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xl"
      >
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onClose}
              aria-label={t(lang, 'backBtn')}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
              {t(lang, 'connectModalTitle')}
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

        <div className="p-6 space-y-5">
          {/* Segmented Method Tabs: Gmail & Invite Code */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setTab('gmail');
                setError('');
              }}
              className={`min-h-[40px] px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                tab === 'gmail'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              Gmail
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('invite');
                setError('');
              }}
              className={`min-h-[40px] px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                tab === 'invite'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              Code
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'gmail' ? (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t(lang, 'enterGmailLabel')}
                </label>
                <input
                  type="email"
                  required
                  value={gmail}
                  onChange={(e) => setGmail(e.target.value)}
                  placeholder="friend@gmail.com"
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'bn'
                    ? 'তারা KothaLink-এ থাকলে সাথে সাথে চ্যাট শুরু হবে। না থাকলে, তারা এই Gmail দিয়ে সাইন ইন করার সাথে সাথেই আপনার সব মেসেজ দেখতে পাবে!'
                    : 'If they already use KothaLink, chat opens immediately. Otherwise, any messages you send here automatically appear in their account as soon as they sign in with this Gmail.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t(lang, 'enterInviteLabel')}
                </label>
                <input
                  type="text"
                  required
                  maxLength={16}
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="e.g., A7K9P2"
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-base tracking-[0.2em] font-mono-tabular focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {t(lang, 'cancel')}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {loading
                  ? t(lang, 'signingIn')
                  : tab === 'invite'
                  ? t(lang, 'joinByCode')
                  : t(lang, 'startChatBtn')}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
};
