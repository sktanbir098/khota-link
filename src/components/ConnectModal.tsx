import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, KeyRound, Loader2, Mail, MessageSquare, Search, UserCheck, X } from 'lucide-react';
import {
  formatFriendlyError,
  getInstantLocalUserMatches,
  hydrateSearchResultProfiles,
  joinChatByInviteCode,
  searchUserProfiles,
  startChatByGmail,
  startChatByUserProfile,
} from '../lib/chatService';
import { t } from '../lib/i18n';
import { AppLanguage, ChatRoom, UserPublicProfile, UserSearchResult } from '../types/chat';
import { UserAvatar } from './UserAvatar';

interface Props {
  isOpen: boolean;
  initialTab?: 'search' | 'gmail' | 'invite';
  initialInviteCode?: string;
  lang: AppLanguage;
  currentUser: UserPublicProfile;
  existingChats: ChatRoom[];
  knownProfiles?: Record<string, UserPublicProfile>;
  blockedUids?: string[];
  onClose: () => void;
  onChatReady: (chatId: string, meta?: { pendingEmail?: string; recipientEmail?: string }) => void;
  onPreviewUserProfile?: (user: UserSearchResult) => void;
}

function renderHighlightedText(text: string, query: string): React.ReactNode {
  const cleanQ = query.trim();
  if (!cleanQ || !text) return text;
  const escaped = cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  if (parts.length <= 1) return text;
  const lowerQ = cleanQ.toLowerCase();
  return parts.map((part, idx) =>
    part.toLowerCase() === lowerQ ? (
      <mark
        key={idx}
        className="bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 rounded px-0.5 font-semibold"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    )
  );
}

export const ConnectModal: React.FC<Props> = ({
  isOpen,
  initialTab = 'search',
  initialInviteCode = '',
  lang,
  currentUser,
  existingChats,
  knownProfiles = {},
  blockedUids = [],
  onClose,
  onChatReady,
  onPreviewUserProfile,
}) => {
  const [tab, setTab] = useState<'search' | 'gmail' | 'invite'>(
    initialInviteCode ? 'invite' : initialTab
  );
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleResults, setPeopleResults] = useState<UserSearchResult[]>([]);
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [startingUid, setStartingUid] = useState<string | null>(null);
  const [gmail, setGmail] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTab(initialInviteCode ? 'invite' : initialTab);
    setError('');
    if (initialTab === 'search' && !initialInviteCode) {
      const id = window.setTimeout(() => searchInputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [isOpen, initialTab, initialInviteCode]);

  const existingPeerChatMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of existingChats) {
      if (c.participantIds.length === 2) {
        const peerId = c.participantIds.find((id) => id !== currentUser.uid);
        if (peerId) map.set(peerId, c.id);
      }
    }
    return map;
  }, [existingChats, currentUser.uid]);

  useEffect(() => {
    if (!isOpen || tab !== 'search') return;
    const trimmed = peopleQuery.trim();
    if (Array.from(trimmed).length < 2) {
      setPeopleResults([]);
      setSearchingPeople(false);
      return;
    }

    // 0ms instant matches from already-loaded peers, warm directory cache, & 3-letter bucket cache
    const instant = getInstantLocalUserMatches({
      queryText: trimmed,
      currentUid: currentUser.uid,
      knownProfiles,
      blockedUids,
    });

    if (Array.from(trimmed).length < 3) {
      setPeopleResults(instant);
      setSearchingPeople(false);
      return;
    }

    if (instant.length > 0) {
      setPeopleResults(instant);
    }

    let cancelled = false;
    setSearchingPeople(true);

    const timer = window.setTimeout(async () => {
      try {
        const found = await searchUserProfiles({
          queryText: trimmed,
          currentUid: currentUser.uid,
          knownProfiles,
          blockedUids,
        });
        if (cancelled) return;
        setPeopleResults(found);
        setSearchingPeople(false);

        if (found.length > 0) {
          const liveMap = await hydrateSearchResultProfiles(found.map((u) => u.uid));
          if (cancelled || Object.keys(liveMap).length === 0) return;
          setPeopleResults((prev) =>
            prev.map((item) => {
              const live = liveMap[item.uid];
              if (!live) return item;
              return {
                ...item,
                displayName: live.displayName || item.displayName,
                photoUrl: live.photoUrl || item.photoUrl,
                bio: live.bio || item.bio,
                maskedEmail: live.maskedEmail || item.maskedEmail,
                onlineStatus: live.onlineStatus,
                lastSeenAt: live.lastSeenAt,
                showOnlineStatus: live.showOnlineStatus,
              };
            })
          );
        }
      } catch {
        if (!cancelled) setSearchingPeople(false);
      }
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, tab, peopleQuery, currentUser.uid, knownProfiles]);

  if (!isOpen) return null;

  const handleStartWithPerson = async (person: UserSearchResult) => {
    if (startingUid) return;
    setError('');
    const existingChatId = existingPeerChatMap.get(person.uid);
    if (existingChatId) {
      onChatReady(existingChatId);
      onClose();
      return;
    }
    setStartingUid(person.uid);
    try {
      const chatId = await startChatByUserProfile({
        currentUser,
        target: person,
        existingChats,
      });
      onChatReady(chatId);
      onClose();
    } catch (err) {
      setError(formatFriendlyError(err));
    } finally {
      setStartingUid(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === 'search') return;
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

  const trimmedQueryLen = Array.from(peopleQuery.trim()).length;

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

        <div className="flex-1 min-h-0 p-4 sm:p-6 space-y-5 overflow-y-auto">
          {/* Segmented Method Tabs: Find People, Gmail & Invite Code */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setTab('search');
                setError('');
              }}
              className={`min-h-[40px] px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                tab === 'search'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{t(lang, 'searchPeopleTab')}</span>
            </button>
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
              <Mail className="w-3.5 h-3.5 shrink-0" />
              <span>Gmail</span>
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
              <KeyRound className="w-3.5 h-3.5 shrink-0" />
              <span>Code</span>
            </button>
          </div>

          {tab === 'search' ? (
            <div className="space-y-3.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={peopleQuery}
                  onChange={(e) => setPeopleQuery(e.target.value)}
                  placeholder={t(lang, 'searchPeoplePlaceholder')}
                  className="w-full min-h-[44px] pl-10 pr-10 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {peopleQuery && (
                  <button
                    type="button"
                    onClick={() => setPeopleQuery('')}
                    aria-label="Clear"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 flex items-center justify-center"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {trimmedQueryLen < 3 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 px-0.5">
                  {t(lang, 'searchMinCharsHint')}
                </p>
              )}

              {searchingPeople && peopleResults.length === 0 && (
                <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span>{t(lang, 'searchingPeople')}</span>
                </div>
              )}

              {trimmedQueryLen >= 3 && !searchingPeople && peopleResults.length === 0 && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center space-y-2.5">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t(lang, 'noPeopleFound')}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (peopleQuery.includes('@')) setGmail(peopleQuery.trim());
                      setTab('gmail');
                    }}
                    className="min-h-[36px] px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>{t(lang, 'cardGmailAction')}</span>
                  </button>
                </div>
              )}

              {peopleResults.length > 0 && (
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-0.5">
                  {peopleResults.map((person) => {
                    const isOnline =
                      person.showOnlineStatus !== false && person.onlineStatus === 'online';
                    const isConnected = existingPeerChatMap.has(person.uid);
                    const isBusy = startingUid === person.uid;
                    return (
                      <div
                        key={person.uid}
                        className="p-2.5 rounded-xl bg-slate-50/90 dark:bg-slate-950/80 border border-slate-200/80 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-800 flex items-center gap-3 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            onPreviewUserProfile
                              ? onPreviewUserProfile(person)
                              : void handleStartWithPerson(person)
                          }
                          className="flex-1 min-w-0 flex items-center gap-3 text-left"
                        >
                          <UserAvatar
                            name={person.displayName}
                            photoUrl={person.photoUrl}
                            size="md"
                            isOnline={isOnline}
                            ringColorClass="ring-white dark:ring-slate-900"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                {renderHighlightedText(person.displayName, peopleQuery)}
                              </span>
                              {isConnected && (
                                <UserCheck
                                  className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                                  aria-label={t(lang, 'alreadyConnectedBadge')}
                                />
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {person.maskedEmail || person.bio || t(lang, 'noBioYet')}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(startingUid)}
                          onClick={() => void handleStartWithPerson(person)}
                          className="min-h-[36px] px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <MessageSquare className="w-3.5 h-3.5" />
                          )}
                          <span>{isConnected ? t(lang, 'openChatBtn') : t(lang, 'messageBtn')}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {error && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}
            </div>
          ) : (
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
                      ? 'তারা LoopLy-এ থাকলে সাথে সাথে চ্যাট শুরু হবে। না থাকলে, তারা এই Gmail দিয়ে সাইন ইন করার সাথে সাথেই আপনার সব মেসেজ দেখতে পাবে!'
                      : 'If they already use LoopLy, chat opens immediately. Otherwise, any messages you send here automatically appear in their account as soon as they sign in with this Gmail.'}
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
          )}
        </div>
      </motion.div>
    </div>
  );
};
