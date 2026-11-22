import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  ImagePlus,
  Loader2,
  MessageCircle,
  Pause,
  Send,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { prepareStatusImage } from '../lib/attachments';
import {
  addStatusComment,
  createUserStatus,
  deleteStatusComment,
  deleteUserStatus,
  formatFriendlyError,
  subscribeStatusComments,
  subscribeStatusReactions,
  toggleStatusReaction,
} from '../lib/chatService';
import { t } from '../lib/i18n';
import {
  AppLanguage,
  STATUS_REACTION_EMOJIS,
  StatusBgGradient,
  StatusComment,
  StatusReaction,
  StatusReactionEmoji,
  UserPublicProfile,
  UserStatus,
} from '../types/chat';
import { UserAvatar } from './UserAvatar';

export const STATUS_GRADIENTS: Record<StatusBgGradient, string> = {
  blue: 'bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800',
  emerald: 'bg-gradient-to-br from-emerald-500 via-teal-600 to-cyan-800',
  amber: 'bg-gradient-to-br from-amber-500 via-orange-600 to-rose-700',
  rose: 'bg-gradient-to-br from-rose-500 via-pink-600 to-fuchsia-800',
  slate: 'bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950',
};

const GRADIENT_KEYS: StatusBgGradient[] = ['blue', 'emerald', 'amber', 'rose', 'slate'];
const STORY_DURATION_MS = 6500;

interface FloatingBurst {
  id: number;
  emoji: string;
  xOffset: number;
}

function formatRelativeTime(ts: { toMillis?: () => number } | null | undefined): string {
  const ms = ts?.toMillis?.();
  if (!ms) return 'Just now';
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

interface CreateProps {
  mode: 'create';
  lang: AppLanguage;
  currentUser: UserPublicProfile;
  onClose: () => void;
  onCreated?: () => void;
}

interface ViewProps {
  mode: 'view';
  lang: AppLanguage;
  currentUser: UserPublicProfile;
  statuses: UserStatus[];
  initialIndex?: number;
  authorOnline?: boolean;
  onClose: () => void;
}

type Props = CreateProps | ViewProps;

export const StatusModal: React.FC<Props> = (props) => {
  // Create mode state
  const [mediaType, setMediaType] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [bgGradient, setBgGradient] = useState<StatusBgGradient>('blue');
  const [imageData, setImageData] = useState('');
  const [preparingImg, setPreparingImg] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);

  // View mode state
  const [viewIndex, setViewIndex] = useState(props.mode === 'view' ? props.initialIndex ?? 0 : 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Story interactions: likes/reactions, comments, bursts & pause-on-interact progress
  const [reactions, setReactions] = useState<StatusReaction[]>([]);
  const [optimisticEmoji, setOptimisticEmoji] = useState<StatusReactionEmoji | null | undefined>(undefined);
  const [comments, setComments] = useState<StatusComment[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [likesOpen, setLikesOpen] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [holdingStory, setHoldingStory] = useState(false);
  const [bursts, setBursts] = useState<FloatingBurst[]>([]);
  const [progressRatio, setProgressRatio] = useState(0);

  const burstSeqRef = useRef(0);
  const elapsedMsRef = useRef(0);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  const viewStatusesLength = props.mode === 'view' ? props.statuses.length : 0;
  const currentViewStatus = props.mode === 'view' ? props.statuses[viewIndex] : undefined;
  const currentStatusId = currentViewStatus?.id || '';

  const isPaused =
    commentsOpen ||
    likesOpen ||
    holdingStory ||
    confirmDelete ||
    commentInput.trim().length > 0;

  // Keep viewIndex in bounds if statuses change (e.g. after delete)
  useEffect(() => {
    if (props.mode !== 'view') return;
    if (viewStatusesLength === 0) {
      onCloseRef.current();
      return;
    }
    if (viewIndex >= viewStatusesLength) {
      setViewIndex(Math.max(0, viewStatusesLength - 1));
    }
  }, [props.mode, viewStatusesLength, viewIndex]);

  // Reset per-slide UI state on slide change
  useEffect(() => {
    if (props.mode !== 'view') return;
    elapsedMsRef.current = 0;
    setProgressRatio(0);
    setConfirmDelete(false);
    setCommentsOpen(false);
    setLikesOpen(false);
    setCommentInput('');
    setOptimisticEmoji(undefined);
    setError('');
  }, [props.mode, viewIndex, currentStatusId]);

  // Subscribe to real-time reactions & comments for the active status
  useEffect(() => {
    if (props.mode !== 'view' || !currentStatusId) {
      setReactions([]);
      setComments([]);
      return;
    }
    const unsubReacts = subscribeStatusReactions(currentStatusId, (list) => {
      setReactions(list);
      setOptimisticEmoji(undefined);
    });
    const unsubComments = subscribeStatusComments(currentStatusId, setComments);
    return () => {
      unsubReacts();
      unsubComments();
    };
  }, [props.mode, currentStatusId]);

  // Smooth auto-advance ticker that pauses cleanly when interacting
  useEffect(() => {
    if (props.mode !== 'view' || viewStatusesLength === 0 || isPaused) return;
    let lastTick = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      elapsedMsRef.current += now - lastTick;
      lastTick = now;
      const ratio = Math.min(1, elapsedMsRef.current / STORY_DURATION_MS);
      setProgressRatio(ratio);
      if (ratio >= 1) {
        if (viewIndex < viewStatusesLength - 1) {
          setViewIndex((i) => i + 1);
        } else {
          onCloseRef.current();
        }
      }
    }, 50);
    return () => window.clearInterval(interval);
  }, [props.mode, viewIndex, viewStatusesLength, isPaused]);

  const reactionSummary = useMemo(() => {
    const counts = new Map<StatusReactionEmoji, number>();
    for (const r of reactions) {
      counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [reactions]);

  if (props.mode === 'view') {
    const status = props.statuses[viewIndex];
    if (!status) return null;
    const isOwn = status.uid === props.currentUser.uid;
    const serverMyReaction = reactions.find((r) => r.uid === props.currentUser.uid)?.emoji || null;
    const myReaction = optimisticEmoji !== undefined ? optimisticEmoji : serverMyReaction;

    const displayedReactions = (() => {
      if (optimisticEmoji === undefined) return reactions;
      const withoutMe = reactions.filter((r) => r.uid !== props.currentUser.uid);
      if (optimisticEmoji === null) return withoutMe;
      return [
        ...withoutMe,
        {
          id: props.currentUser.uid,
          statusId: status.id,
          uid: props.currentUser.uid,
          displayName: props.currentUser.displayName,
          photoUrl: props.currentUser.photoUrl || '',
          emoji: optimisticEmoji,
          updatedAt: null,
        },
      ];
    })();

    const spawnBurst = (emoji: string) => {
      const id = ++burstSeqRef.current;
      const xOffset = Math.round((Math.random() - 0.5) * 90);
      setBursts((prev) => [...prev.slice(-8), { id, emoji, xOffset }]);
      window.setTimeout(() => {
        setBursts((prev) => prev.filter((b) => b.id !== id));
      }, 1100);
    };

    const handleReact = async (emoji: StatusReactionEmoji) => {
      setError('');
      // Extend viewing window by 2.5s when user interacts so story doesn't close immediately
      elapsedMsRef.current = Math.max(0, elapsedMsRef.current - 2500);
      const nextEmoji = myReaction === emoji ? null : emoji;
      const prevServerReaction = serverMyReaction;
      setOptimisticEmoji(nextEmoji);
      if (nextEmoji) {
        spawnBurst(nextEmoji);
      }
      try {
        await toggleStatusReaction({
          statusId: status.id,
          user: props.currentUser,
          emoji,
          currentEmoji: prevServerReaction,
        });
      } catch (err) {
        setOptimisticEmoji(undefined);
        setError(formatFriendlyError(err));
      }
    };

    const handlePostComment = async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = commentInput.trim();
      if (!trimmed || sendingComment) return;
      setError('');
      setSendingComment(true);
      try {
        await addStatusComment({
          statusId: status.id,
          user: props.currentUser,
          text: trimmed,
        });
        setCommentInput('');
      } catch (err) {
        setError(formatFriendlyError(err));
      } finally {
        setSendingComment(false);
      }
    };

    const handleDeleteComment = async (commentId: string) => {
      try {
        await deleteStatusComment({ statusId: status.id, commentId });
      } catch (err) {
        setError(formatFriendlyError(err));
      }
    };

    const handleDelete = async () => {
      if (!confirmDelete) {
        setConfirmDelete(true);
        return;
      }
      setDeleting(true);
      try {
        await deleteUserStatus(status.id);
      } catch (err) {
        setError(formatFriendlyError(err));
      } finally {
        setDeleting(false);
      }
    };

    return (
      <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className={`relative w-full max-w-md h-[88dvh] sm:h-[84dvh] max-h-[720px] rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex flex-col justify-between ${
            status.mediaType === 'image' ? 'bg-black' : STATUS_GRADIENTS[status.bgGradient] || STATUS_GRADIENTS.blue
          }`}
        >
          {/* Top Story Progress Bars & Author Bar */}
          <div className="relative z-20 p-4 space-y-3 bg-gradient-to-b from-black/65 via-black/30 to-transparent">
            <div className="flex items-center gap-1.5">
              {props.statuses.map((s, idx) => (
                <div key={s.id} className="flex-1 h-1 rounded-full bg-white/25 overflow-hidden">
                  {idx < viewIndex ? (
                    <div className="h-full w-full bg-white" />
                  ) : idx === viewIndex ? (
                    <div
                      className="h-full bg-white origin-left transition-transform duration-75 ease-linear"
                      style={{ transform: `scaleX(${progressRatio})` }}
                    />
                  ) : null}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <UserAvatar
                  name={status.displayName}
                  photoUrl={status.photoUrl}
                  size="sm"
                  isOnline={props.authorOnline}
                  ringColorClass="ring-black/70"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-white truncate">{status.displayName}</span>
                    {isPaused && (
                      <Pause className="w-3 h-3 text-white/75 shrink-0" aria-label="Paused" />
                    )}
                  </div>
                  <div className="text-[11px] text-white/75 font-mono-tabular">
                    {formatRelativeTime(status.createdAt)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isOwn && (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={handleDelete}
                    className={`min-h-[36px] px-2.5 rounded-xl text-xs font-medium flex items-center gap-1 transition-colors ${
                      confirmDelete
                        ? 'bg-red-600 text-white'
                        : 'bg-white/15 hover:bg-red-600/80 text-white'
                    }`}
                  >
                    {deleting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    {confirmDelete && <span>{props.lang === 'bn' ? 'নিশ্চিত?' : 'Confirm'}</span>}
                  </button>
                )}
                <button
                  type="button"
                  onClick={props.onClose}
                  aria-label="Close status"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Story Content Area (hold to pause) */}
          <div
            onMouseDown={() => setHoldingStory(true)}
            onMouseUp={() => setHoldingStory(false)}
            onMouseLeave={() => setHoldingStory(false)}
            onTouchStart={() => setHoldingStory(true)}
            onTouchEnd={() => setHoldingStory(false)}
            className="relative flex-1 flex items-center justify-center px-6 py-4 overflow-hidden select-none"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={status.id}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full flex items-center justify-center"
              >
                {status.mediaType === 'image' && status.imageData ? (
                  <img
                    src={status.imageData}
                    alt={status.text || 'Status'}
                    referrerPolicy="no-referrer"
                    className="max-h-full max-w-full object-contain rounded-xl"
                  />
                ) : (
                  <p className="text-center font-display text-2xl sm:text-3xl font-bold text-white leading-snug break-words">
                    {status.text}
                  </p>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Floating Emoji Burst Particles */}
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center z-30">
              <AnimatePresence>
                {bursts.map((b) => (
                  <motion.span
                    key={b.id}
                    initial={{ opacity: 0, y: 12, x: b.xOffset, scale: 0.6 }}
                    animate={{ opacity: [0, 1, 1, 0], y: -150, x: b.xOffset * 1.4, scale: [0.7, 1.45, 1.1] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute text-3xl drop-shadow-lg"
                  >
                    {b.emoji}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>

            {/* Left / Right Navigation Tap Zones */}
            {props.statuses.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous status"
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewIndex((i) => Math.max(0, i - 1));
                  }}
                  className="absolute inset-y-0 left-0 w-1/5 flex items-center justify-start pl-2 text-white/60 hover:text-white transition-colors"
                >
                  {viewIndex > 0 && <ChevronLeft className="w-6 h-6 drop-shadow" />}
                </button>
                <button
                  type="button"
                  aria-label="Next status"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (viewIndex < props.statuses.length - 1) {
                      setViewIndex((i) => i + 1);
                    } else {
                      props.onClose();
                    }
                  }}
                  className="absolute inset-y-0 right-0 w-1/5 flex items-center justify-end pr-2 text-white/60 hover:text-white transition-colors"
                >
                  <ChevronRight className="w-6 h-6 drop-shadow" />
                </button>
              </>
            )}
          </div>

          {/* Bottom Caption, Emoji Reaction Strip, 1-Tap Like & Comments Trigger */}
          <div className="relative z-20 px-3.5 sm:px-4 pb-4 pt-3 bg-gradient-to-t from-black/85 via-black/55 to-transparent space-y-2.5">
            {status.mediaType === 'image' && status.text && (
              <p className="text-sm text-white text-center leading-relaxed line-clamp-2">{status.text}</p>
            )}

            {error && <p className="text-xs text-red-300 text-center">{error}</p>}

            {/* Quick Reaction Emoji Strip + 1-Tap Like + Comments */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl p-1.5">
              <div className="flex items-center justify-around sm:justify-start gap-0.5 sm:gap-1">
                {STATUS_REACTION_EMOJIS.map((emoji) => {
                  const active = myReaction === emoji;
                  return (
                    <motion.button
                      key={emoji}
                      type="button"
                      whileHover={{ scale: 1.15, y: -2 }}
                      whileTap={{ scale: 0.88 }}
                      onClick={() => void handleReact(emoji)}
                      aria-label={`React ${emoji}`}
                      className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-colors shrink-0 ${
                        active
                          ? 'bg-white text-slate-900 shadow-md ring-2 ring-blue-400'
                          : 'hover:bg-white/15 text-white'
                      }`}
                    >
                      {emoji}
                    </motion.button>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-1.5 shrink-0">
                {/* 1-Tap Heart Like Button */}
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => void handleReact('❤️')}
                  className={`min-h-[36px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    myReaction === '❤️'
                      ? 'bg-rose-500 text-white shadow-sm'
                      : 'bg-white/15 hover:bg-white/25 text-white'
                  }`}
                >
                  <Heart className={`w-3.5 h-3.5 ${myReaction === '❤️' ? 'fill-current' : ''}`} />
                  <span>{myReaction === '❤️' ? t(props.lang, 'likedBtn') : t(props.lang, 'likeBtn')}</span>
                </motion.button>

                {/* View Who Reacted / Liked */}
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={() => {
                    setCommentsOpen(false);
                    setLikesOpen((v) => !v);
                  }}
                  aria-label={t(props.lang, 'viewReactions')}
                  title={t(props.lang, 'viewReactions')}
                  className={`min-h-[36px] px-2.5 rounded-xl flex items-center gap-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    likesOpen
                      ? 'bg-white text-slate-900'
                      : 'bg-white/15 hover:bg-white/25 text-white'
                  }`}
                >
                  <span className="font-mono-tabular">{displayedReactions.length}</span>
                </motion.button>

                {/* Open Comments Drawer */}
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={() => {
                    setLikesOpen(false);
                    setCommentsOpen((v) => !v);
                  }}
                  aria-label={t(props.lang, 'commentsTitle')}
                  className={`min-h-[36px] px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    commentsOpen
                      ? 'bg-blue-600 text-white'
                      : 'bg-white/15 hover:bg-white/25 text-white'
                  }`}
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span className="font-mono-tabular">{comments.length}</span>
                </motion.button>
              </div>
            </div>

            {/* Quick Reaction Breakdown Bar */}
            {reactionSummary.length > 0 && (
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {reactionSummary.slice(0, 4).map(([emoji, count]) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setLikesOpen(true)}
                    className="px-2 py-0.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs flex items-center gap-1 transition-colors"
                  >
                    <span>{emoji}</span>
                    <span className="font-mono-tabular text-[11px]">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Slide-Up Reactions / Likes Popover Sheet */}
          <AnimatePresence>
            {likesOpen && (
              <motion.div
                initial={{ y: '100%', opacity: 0.5 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '100%', opacity: 0.5 }}
                transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                className="absolute inset-x-0 bottom-0 z-30 max-h-[60%] bg-white dark:bg-slate-900 rounded-t-3xl border-t border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
              >
                <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {t(props.lang, 'reactionsCount')} ({displayedReactions.length})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLikesOpen(false)}
                    aria-label="Close reactions"
                    className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                  {displayedReactions.length === 0 ? (
                    <p className="text-xs text-center text-slate-500 dark:text-slate-400 py-6">
                      {t(props.lang, 'noReactionsYet')}
                    </p>
                  ) : (
                    displayedReactions.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-3 p-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {r.photoUrl ? (
                            <img
                              src={r.photoUrl}
                              alt={r.displayName}
                              referrerPolicy="no-referrer"
                              className="w-8 h-8 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-blue-600/15 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold shrink-0">
                              {r.displayName.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                            {r.displayName}
                          </span>
                        </div>
                        <span className="text-lg shrink-0">{r.emoji}</span>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Slide-Up Comments Drawer */}
          <AnimatePresence>
            {commentsOpen && (
              <motion.div
                initial={{ y: '100%', opacity: 0.6 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '100%', opacity: 0.6 }}
                transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                className="absolute inset-x-0 bottom-0 z-30 h-[68%] bg-white dark:bg-slate-900 rounded-t-3xl border-t border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
              >
                <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {t(props.lang, 'commentsTitle')} ({comments.length})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCommentsOpen(false)}
                    aria-label="Close comments"
                    className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {comments.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center px-4">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t(props.lang, 'noCommentsYet')}
                      </p>
                    </div>
                  ) : (
                    comments.map((c) => {
                      const canDelete = c.uid === props.currentUser.uid || isOwn;
                      return (
                        <motion.div
                          key={c.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.18 }}
                          className="flex items-start gap-2.5 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800"
                        >
                          {c.photoUrl ? (
                            <img
                              src={c.photoUrl}
                              alt={c.displayName}
                              referrerPolicy="no-referrer"
                              className="w-8 h-8 rounded-full object-cover shrink-0 mt-0.5"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-blue-600/15 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                              {c.displayName.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                {c.displayName}
                              </span>
                              <span className="text-[11px] text-slate-400 font-mono-tabular shrink-0">
                                {formatRelativeTime(c.createdAt)}
                              </span>
                            </div>
                            <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5 break-words">
                              {c.text}
                            </p>
                          </div>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteComment(c.id)}
                              aria-label="Delete comment"
                              className="min-h-[28px] min-w-[28px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </motion.div>
                      );
                    })
                  )}
                </div>

                <form
                  onSubmit={handlePostComment}
                  className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2 shrink-0"
                >
                  <input
                    type="text"
                    maxLength={280}
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                    placeholder={t(props.lang, 'commentPlaceholder')}
                    className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <motion.button
                    type="submit"
                    whileTap={{ scale: 0.92 }}
                    disabled={!commentInput.trim() || sendingComment}
                    className="min-h-[42px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {sendingComment ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>{t(props.lang, 'postComment')}</span>
                  </motion.button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    );
  }

  // Create Mode
  const handlePickPhoto = async (file: File) => {
    setError('');
    setPreparingImg(true);
    try {
      const compressed = await prepareStatusImage(file);
      setImageData(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process photo.');
    } finally {
      setPreparingImg(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await createUserStatus({
        user: props.currentUser,
        mediaType,
        text,
        bgGradient,
        imageData,
      });
      props.onCreated?.();
      props.onClose();
    } catch (err) {
      setError(formatFriendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xl flex flex-col max-h-[90vh]"
      >
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {t(props.lang, 'addStatus')}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {/* Text vs Photo Tab */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setMediaType('text')}
              className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                mediaType === 'text'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Type className="w-3.5 h-3.5" />
              {t(props.lang, 'statusTextTab')}
            </button>
            <button
              type="button"
              onClick={() => setMediaType('image')}
              className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                mediaType === 'image'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <ImagePlus className="w-3.5 h-3.5" />
              {t(props.lang, 'statusPhotoTab')}
            </button>
          </div>

          {mediaType === 'text' ? (
            <>
              <div
                className={`rounded-2xl p-6 min-h-[180px] flex items-center justify-center shadow-inner transition-colors ${STATUS_GRADIENTS[bgGradient]}`}
              >
                <textarea
                  rows={4}
                  maxLength={280}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t(props.lang, 'statusPlaceholder')}
                  className="w-full bg-transparent text-center text-lg font-bold text-white placeholder:text-white/65 resize-none focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-center gap-2.5">
                {GRADIENT_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setBgGradient(key)}
                    aria-label={`Theme ${key}`}
                    className={`w-8 h-8 rounded-full ${STATUS_GRADIENTS[key]} transition-transform ${
                      bgGradient === key
                        ? 'ring-2 ring-offset-2 ring-blue-600 dark:ring-offset-slate-900 scale-110'
                        : 'opacity-80 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handlePickPhoto(file);
                }}
              />
              {imageData ? (
                <div className="relative rounded-2xl overflow-hidden bg-black flex items-center justify-center max-h-60">
                  <img
                    src={imageData}
                    alt="Status preview"
                    referrerPolicy="no-referrer"
                    className="max-h-60 w-auto object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="absolute bottom-2.5 right-2.5 px-3 py-1.5 rounded-xl bg-black/70 text-white text-xs font-medium hover:bg-black/90"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={preparingImg}
                  onClick={() => photoInputRef.current?.click()}
                  className="w-full min-h-[160px] rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 flex flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400"
                >
                  {preparingImg ? (
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  ) : (
                    <>
                      <ImagePlus className="w-7 h-7 text-blue-600 dark:text-blue-400" />
                      <span className="text-xs font-medium">{t(props.lang, 'uploadImage')}</span>
                    </>
                  )}
                </button>
              )}

              <input
                type="text"
                maxLength={200}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t(props.lang, 'statusPhotoCaption')}
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <motion.button
            type="submit"
            whileTap={{ scale: 0.98 }}
            disabled={
              submitting ||
              preparingImg ||
              (mediaType === 'text' ? !text.trim() : !imageData)
            }
            className="w-full min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-sm font-semibold transition-colors"
          >
            {submitting ? t(props.lang, 'postingStatus') : t(props.lang, 'postStatusBtn')}
          </motion.button>
        </form>
      </motion.div>
    </div>
  );
};
