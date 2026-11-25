import React, { useEffect, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Copy,
  Download,
  FileText,
  Info,
  Loader2,
  Mic,
  Pause,
  Play,
  Plus,
  Reply,
  Send,
  Smile,
  Trash2,
} from 'lucide-react';
import { formatFileSize, triggerFileDownload } from '../lib/attachments';
import { t } from '../lib/i18n';
import {
  AppLanguage,
  AttachmentType,
  EXTRA_REACTION_EMOJIS,
  REACTION_EMOJIS,
  ReactionEmoji,
} from '../types/chat';

export interface AggregatedReaction {
  emoji: ReactionEmoji;
  count: number;
  reactedByMe: boolean;
}

interface Props {
  id: string;
  lang?: AppLanguage;
  text: string;
  senderName: string;
  timestampText: string;
  isMe: boolean;
  replyToText?: string;
  attachmentType?: AttachmentType;
  attachmentName?: string;
  attachmentMime?: string;
  attachmentSize?: number;
  attachmentData?: string;
  deliveredAt?: Timestamp | null;
  readAt?: Timestamp | null;
  optimistic?: boolean;
  justSent?: boolean;
  justArrived?: boolean;
  reactions: AggregatedReaction[];
  onReact: (emoji: ReactionEmoji) => void;
  onReply?: () => void;
  onCopy?: () => void;
  onShowInfo?: () => void;
  onDelete?: () => Promise<void> | void;
  onPreviewImage?: (dataUrl: string, name: string) => void;
  onResolveAttachment?: (messageId: string, marker: string) => Promise<string>;
  searchQuery?: string;
  isActiveSearchMatch?: boolean;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedText(
  content: string,
  query: string,
  isMe: boolean,
  isActiveMatch: boolean
): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed || !content) return content;
  const regex = new RegExp(`(${escapeRegExp(trimmed)})`, 'gi');
  const parts = content.split(regex);
  if (parts.length <= 1) return content;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        className={`rounded px-0.5 font-semibold ${
          isActiveMatch
            ? 'bg-amber-300 text-slate-950 ring-1 ring-amber-500/70'
            : isMe
            ? 'bg-amber-300/95 text-slate-950'
            : 'bg-amber-200 dark:bg-amber-400/90 text-slate-950'
        }`}
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

function formatAudioSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const MessageBubbleInner: React.FC<Props> = ({
  id,
  lang = 'en',
  text,
  senderName,
  timestampText,
  isMe,
  replyToText,
  attachmentType = 'none',
  attachmentName = '',
  attachmentMime = '',
  attachmentSize = 0,
  attachmentData = '',
  deliveredAt = null,
  readAt = null,
  optimistic = false,
  justSent = false,
  justArrived = false,
  reactions,
  onReact,
  onReply,
  onCopy,
  onShowInfo,
  onDelete,
  onPreviewImage,
  onResolveAttachment,
  searchQuery = '',
  isActiveSearchMatch = false,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showMoreEmojis, setShowMoreEmojis] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingMsg, setDeletingMsg] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string>(() =>
    attachmentData && !attachmentData.startsWith('chunked:') ? attachmentData : ''
  );
  const [downloadingFile, setDownloadingFile] = useState(false);
  const [loadingChunkedImage, setLoadingChunkedImage] = useState(false);

  // Voice message audio player state
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  const longPressTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const hasImage = attachmentType === 'image' && Boolean(attachmentData);
  const hasFile = attachmentType === 'file' && Boolean(attachmentData);
  const isAudioAttachment =
    hasFile &&
    (attachmentMime.startsWith('audio/') ||
      /\.(webm|ogg|mp3|wav|m4a|aac)$/i.test(attachmentName || '') ||
      /^voice\s*message/i.test(attachmentName || ''));
  const isVideoAttachment =
    hasFile &&
    !isAudioAttachment &&
    (attachmentMime.startsWith('video/') ||
      /\.(mp4|mov|m4v|ogv|avi|mkv)$/i.test(attachmentName || ''));

  const labelDurationMatch = attachmentName.match(/\((\d+:\d{2})\)/);
  const fallbackDurationLabel = labelDurationMatch ? labelDurationMatch[1] : '';

  useEffect(() => {
    if (!attachmentData) {
      setResolvedUrl('');
      return;
    }
    if (!attachmentData.startsWith('chunked:')) {
      setResolvedUrl(attachmentData);
      return;
    }
    if ((attachmentType === 'image' || isAudioAttachment || isVideoAttachment) && onResolveAttachment && !resolvedUrl) {
      let cancelled = false;
      if (attachmentType === 'image') setLoadingChunkedImage(true);
      onResolveAttachment(id, attachmentData)
        .then((url) => {
          if (!cancelled && url) setResolvedUrl(url);
        })
        .catch(() => {
          // Fallback to manual download/play trigger if preload fails
        })
        .finally(() => {
          if (!cancelled) setLoadingChunkedImage(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [id, attachmentData, attachmentType, isAudioAttachment, isVideoAttachment, onResolveAttachment, resolvedUrl]);

  useEffect(() => {
    if (!pickerOpen) {
      setShowMoreEmojis(false);
      setConfirmingDelete(false);
      return;
    }
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [pickerOpen]);

  const startLongPress = () => {
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      setPickerOpen(true);
    }, 420);
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleSelectEmoji = (emoji: ReactionEmoji) => {
    onReact(emoji);
    setPickerOpen(false);
  };

  const handleDeleteAction = async () => {
    if (!onDelete || deletingMsg) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeletingMsg(true);
    try {
      await onDelete();
      setPickerOpen(false);
    } finally {
      setDeletingMsg(false);
      setConfirmingDelete(false);
    }
  };

  const handleDownloadFile = async () => {
    if (downloadingFile) return;
    let url = resolvedUrl;
    if (!url && attachmentData && onResolveAttachment) {
      setDownloadingFile(true);
      try {
        url = await onResolveAttachment(id, attachmentData);
        if (url) setResolvedUrl(url);
      } finally {
        setDownloadingFile(false);
      }
    }
    if (url) {
      triggerFileDownload(url, attachmentName || 'file');
    }
  };

  const handleToggleAudio = async () => {
    let url = resolvedUrl;
    if (!url && attachmentData && onResolveAttachment) {
      setLoadingAudio(true);
      try {
        url = await onResolveAttachment(id, attachmentData);
        if (url) setResolvedUrl(url);
      } finally {
        setLoadingAudio(false);
      }
    }
    if (!url) return;

    const audio = audioRef.current;
    if (!audio) return;

    if (audio.src !== url) {
      audio.src = url;
    }

    if (isPlayingAudio) {
      audio.pause();
      setIsPlayingAudio(false);
    } else {
      try {
        await audio.play();
        setIsPlayingAudio(true);
      } catch {
        setIsPlayingAudio(false);
      }
    }
  };

  const animateArrival = justArrived && !isMe;
  const animateSend = justSent && isMe;

  const effectiveDuration = Number.isFinite(audioDuration) && audioDuration > 0 ? audioDuration : 0;
  const progressPercent =
    effectiveDuration > 0 ? Math.min(100, (audioCurrentTime / effectiveDuration) * 100) : 0;

  const bubbleBody = (
    <>
      {/* Floating Reaction + Long-Press Action Menu Popover */}
      <AnimatePresence>
        {pickerOpen && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className={`z-30 mb-1.5 p-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl flex flex-col gap-1.5 max-w-[calc(100vw-24px)] ${
              isMe ? 'self-end' : 'self-start'
            }`}
          >
            {/* Primary Quick Reactions + "+" More Emojis Button */}
            <div className="flex items-center gap-0.5 flex-wrap">
              {REACTION_EMOJIS.map((emoji) => (
                <motion.button
                  key={emoji}
                  type="button"
                  whileHover={{ scale: 1.22 }}
                  whileTap={{ scale: 0.88 }}
                  onClick={() => handleSelectEmoji(emoji)}
                  className="w-8 h-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-lg transition-colors"
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </motion.button>
              ))}
              <motion.button
                type="button"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowMoreEmojis((prev) => !prev)}
                aria-label={t(lang, 'msgMoreEmojisLabel')}
                title={t(lang, 'msgMoreEmojisLabel')}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
                  showMoreEmojis
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Plus className={`w-4 h-4 transition-transform duration-200 ${showMoreEmojis ? 'rotate-45' : ''}`} />
              </motion.button>
            </div>

            {/* Expandable Full Emoji Drawer */}
            <AnimatePresence initial={false}>
              {showMoreEmojis && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden border-t border-slate-100 dark:border-slate-800 pt-1.5"
                >
                  <div className="grid grid-cols-7 gap-0.5 max-h-36 overflow-y-auto">
                    {EXTRA_REACTION_EMOJIS.map((emoji) => (
                      <motion.button
                        key={emoji}
                        type="button"
                        whileHover={{ scale: 1.18 }}
                        whileTap={{ scale: 0.88 }}
                        onClick={() => handleSelectEmoji(emoji)}
                        className="w-8 h-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-lg transition-colors"
                        aria-label={`React with ${emoji}`}
                      >
                        {emoji}
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Long-Press Actions: Info, Reply, Copy, Delete */}
            {(onShowInfo || onReply || (onCopy && text) || onDelete) && (
              <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 flex-wrap">
                {onShowInfo && (
                  <button
                    type="button"
                    onClick={() => {
                      setPickerOpen(false);
                      onShowInfo();
                    }}
                    className="min-h-[36px] px-2.5 rounded-xl bg-slate-100/85 dark:bg-slate-800/85 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>{t(lang, 'msgInfoBtn')}</span>
                  </button>
                )}
                {onReply && (
                  <button
                    type="button"
                    onClick={() => {
                      setPickerOpen(false);
                      onReply();
                    }}
                    className="min-h-[36px] px-2.5 rounded-xl bg-slate-100/85 dark:bg-slate-800/85 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Reply className="w-3.5 h-3.5" />
                    <span>{t(lang, 'msgReplyBtn')}</span>
                  </button>
                )}
                {onCopy && text && (
                  <button
                    type="button"
                    onClick={() => {
                      onCopy();
                      setCopiedText(true);
                      window.setTimeout(() => setCopiedText(false), 1600);
                      setPickerOpen(false);
                    }}
                    className="min-h-[36px] px-2.5 rounded-xl bg-slate-100/85 dark:bg-slate-800/85 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{t(lang, 'msgCopyBtn')}</span>
                  </button>
                )}
                {onDelete && !optimistic && (
                  <button
                    type="button"
                    disabled={deletingMsg}
                    onClick={handleDeleteAction}
                    className={`min-h-[36px] px-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                      confirmingDelete
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-950/80 text-red-600 dark:text-red-400'
                    }`}
                  >
                    {deletingMsg ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {confirmingDelete ? t(lang, 'msgDeleteConfirmBtn') : t(lang, 'msgDeleteBtn')}
                    </span>
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`relative flex items-end gap-1.5 max-w-full ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Message Bubble (supports 420ms long-press on touch or mouse) */}
        <div
          onPointerDown={startLongPress}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onPointerMove={clearLongPress}
          onContextMenu={(e) => {
            e.preventDefault();
            setPickerOpen(true);
          }}
          className={`relative overflow-hidden select-text max-w-[82vw] sm:max-w-md lg:max-w-lg rounded-2xl transition-all duration-200 ease-out active:scale-[0.985] ${
            hasImage && !text && !replyToText ? 'p-1.5' : 'px-3.5 sm:px-4 py-2.5'
          } ${
            isMe
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
          } ${
            isActiveSearchMatch
              ? 'ring-2 ring-amber-400 dark:ring-amber-300 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-950'
              : ''
          }`}
        >
          {replyToText && (
            <div
              className={`mb-1.5 pb-1.5 border-b text-xs truncate ${
                isMe
                  ? 'border-white/20 text-blue-100'
                  : 'border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400'
              }`}
            >
              “{renderHighlightedText(replyToText, searchQuery, isMe, isActiveSearchMatch)}”
            </div>
          )}

          {hasImage && (
            resolvedUrl ? (
              <button
                type="button"
                onClick={() => onPreviewImage?.(resolvedUrl, attachmentName || 'image.jpg')}
                className={`block overflow-hidden rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                  text ? 'mb-2' : ''
                }`}
              >
                <img
                  src={resolvedUrl}
                  alt={attachmentName || 'Uploaded image'}
                  referrerPolicy="no-referrer"
                  className="max-h-64 w-auto max-w-full rounded-xl object-cover hover:opacity-95 transition-opacity cursor-zoom-in"
                />
              </button>
            ) : (
              <div
                className={`w-52 h-36 rounded-xl flex flex-col items-center justify-center gap-2 ${
                  text ? 'mb-2' : ''
                } ${
                  isMe ? 'bg-blue-700/50 text-blue-100' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                }`}
              >
                {loadingChunkedImage ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <button
                    type="button"
                    onClick={handleDownloadFile}
                    className="text-xs font-medium underline flex items-center gap-1"
                  >
                    <Download className="w-4 h-4" />
                    {attachmentName || 'Download image'}
                  </button>
                )}
              </div>
            )
          )}

          {hasFile && isAudioAttachment && (
            <div
              className={`min-w-[220px] sm:min-w-[260px] flex items-center gap-2.5 p-2 rounded-xl border ${
                text ? 'mb-2' : ''
              } ${
                isMe
                  ? 'bg-blue-700/50 border-white/25 text-white'
                  : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100'
              }`}
            >
              <audio
                ref={audioRef}
                preload="metadata"
                src={resolvedUrl || undefined}
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0) setAudioDuration(d);
                }}
                onTimeUpdate={(e) => {
                  setAudioCurrentTime(e.currentTarget.currentTime);
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0) setAudioDuration(d);
                }}
                onEnded={() => {
                  setIsPlayingAudio(false);
                  setAudioCurrentTime(0);
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={handleToggleAudio}
                disabled={loadingAudio}
                aria-label={isPlayingAudio ? 'Pause voice message' : 'Play voice message'}
                className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-92 ${
                  isMe
                    ? 'bg-white text-blue-600 hover:bg-blue-50'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {loadingAudio ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isPlayingAudio ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
                  <span className="inline-flex items-center gap-1 truncate">
                    <Mic className="w-3 h-3 shrink-0 opacity-85" />
                    <span className="truncate">Voice message</span>
                  </span>
                  <span className="font-mono-tabular shrink-0 opacity-90">
                    {isPlayingAudio || audioCurrentTime > 0
                      ? formatAudioSeconds(audioCurrentTime)
                      : effectiveDuration > 0
                      ? formatAudioSeconds(effectiveDuration)
                      : fallbackDurationLabel || '0:00'}
                  </span>
                </div>
                <div
                  className={`h-1.5 rounded-full overflow-hidden ${
                    isMe ? 'bg-white/25' : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                >
                  <div
                    className={`h-full rounded-full transition-all duration-150 ${
                      isMe ? 'bg-white' : 'bg-blue-600 dark:bg-blue-400'
                    }`}
                    style={{ width: `${isPlayingAudio && progressPercent === 0 ? 35 : progressPercent}%` }}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleDownloadFile}
                disabled={downloadingFile}
                aria-label="Download voice message"
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                  isMe
                    ? 'hover:bg-white/15 text-blue-100'
                    : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500'
                }`}
              >
                {downloadingFile ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          )}

          {hasFile && isVideoAttachment && (
            <div className={text ? 'mb-2' : ''}>
              {resolvedUrl ? (
                <video
                  src={resolvedUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-64 w-full max-w-[260px] sm:max-w-[320px] rounded-xl bg-black/90 object-contain"
                />
              ) : (
                <button
                  type="button"
                  onClick={handleDownloadFile}
                  disabled={downloadingFile}
                  className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl border text-xs font-medium ${
                    isMe
                      ? 'bg-blue-700/50 border-white/25 text-white'
                      : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {downloadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span className="truncate">{attachmentName || 'Download video'}</span>
                </button>
              )}
            </div>
          )}

          {hasFile && !isAudioAttachment && !isVideoAttachment && (
            <button
              type="button"
              onClick={handleDownloadFile}
              disabled={downloadingFile}
              className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-colors ${
                text ? 'mb-2' : ''
              } ${
                isMe
                  ? 'bg-blue-700/50 border-white/25 hover:bg-blue-700/70 text-white'
                  : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  isMe ? 'bg-white/15 text-white' : 'bg-blue-600/10 text-blue-600 dark:text-blue-400'
                }`}
              >
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-xs font-semibold truncate">
                  {renderHighlightedText(attachmentName || 'Attachment', searchQuery, isMe, isActiveSearchMatch)}
                </div>
                <div
                  className={`text-[11px] font-mono-tabular ${
                    isMe ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {formatFileSize(attachmentSize)}
                </div>
              </div>
              {downloadingFile ? (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
              ) : (
                <Download className="w-4 h-4 shrink-0 opacity-85" />
              )}
            </button>
          )}

          {text && (
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {renderHighlightedText(text, searchQuery, isMe, isActiveSearchMatch)}
            </p>
          )}

          <div
            className={`mt-1 flex items-center gap-1.5 text-[11px] font-mono-tabular ${
              hasImage && !text && !replyToText ? 'px-2 pb-1' : ''
            } ${
              isMe ? 'text-blue-100 justify-end' : 'text-slate-400 justify-start'
            }`}
          >
            <span>{isMe ? timestampText : `${senderName} · ${timestampText}`}</span>
            {isMe && (() => {
              const deliveryState = readAt ? 'seen' : deliveredAt ? 'delivered' : 'sent';
              const planeColorClass =
                deliveryState === 'seen'
                  ? 'text-emerald-300 fill-emerald-300/25'
                  : deliveryState === 'delivered'
                  ? 'text-amber-300 fill-amber-300/20'
                  : optimistic
                  ? 'text-white/70 animate-pulse'
                  : 'text-white/95';
              const statusLabel =
                deliveryState === 'seen'
                  ? t(lang, 'msgSeenLabel')
                  : deliveryState === 'delivered'
                  ? t(lang, 'msgDeliveredLabel')
                  : t(lang, 'msgSentLabel');
              return (
                <span title={statusLabel} className="inline-flex items-center">
                  <Send
                    className={`w-3.5 h-3.5 -rotate-12 transition-colors duration-150 ${planeColorClass}`}
                    strokeWidth={2.2}
                    aria-label={statusLabel}
                  />
                </span>
              );
            })()}
          </div>
        </div>

        {/* Inline Action Controls (mobile stays ultra-clean with quick react/menu dot; desktop shows full hover controls) */}
        <div className="flex items-center gap-0.5 opacity-75 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
          <button
            type="button"
            onClick={() => setPickerOpen((prev) => !prev)}
            aria-label="Message actions & reactions"
            className="min-h-[30px] min-w-[30px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
          >
            <Smile className="w-3.5 h-3.5" />
          </button>
          {onCopy && text && (
            <button
              type="button"
              onClick={() => {
                onCopy();
                setCopiedText(true);
                window.setTimeout(() => setCopiedText(false), 1600);
              }}
              aria-label="Copy message"
              className="hidden sm:flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
            >
              {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              aria-label="Reply"
              className="hidden sm:flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
            >
              <Reply className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Reaction Counts & Emoji Types next to Bubble */}
      {reactions.length > 0 && (
        <div
          className={`mt-1 flex flex-wrap items-center gap-1 ${
            isMe ? 'justify-end' : 'justify-start'
          }`}
        >
          {reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onReact(r.emoji)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs font-mono-tabular active:scale-95 transition-all ${
                r.reactedByMe
                  ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <span>{r.emoji}</span>
              <span>{r.count}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setPickerOpen(true);
              setShowMoreEmojis(true);
            }}
            aria-label={t(lang, 'msgMoreEmojisLabel')}
            title={t(lang, 'msgMoreEmojisLabel')}
            className="inline-flex items-center justify-center w-6 h-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition-all"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      )}
    </>
  );

  if (animateSend || animateArrival) {
    return (
      <motion.div
        ref={containerRef}
        data-msg-id={id}
        initial={
          animateSend
            ? { opacity: 0, y: 12, scale: 0.96 }
            : { opacity: 0, y: 8, x: -10, scale: 0.97 }
        }
        animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className={`group relative flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
      >
        {bubbleBody}
      </motion.div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-msg-id={id}
      className={`group relative flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
    >
      {bubbleBody}
    </div>
  );
};

export const MessageBubble = React.memo(MessageBubbleInner, (prev, next) => {
  if (
    prev.id !== next.id ||
    prev.lang !== next.lang ||
    prev.text !== next.text ||
    prev.senderName !== next.senderName ||
    prev.timestampText !== next.timestampText ||
    prev.isMe !== next.isMe ||
    prev.replyToText !== next.replyToText ||
    prev.attachmentType !== next.attachmentType ||
    prev.attachmentName !== next.attachmentName ||
    prev.attachmentData !== next.attachmentData ||
    prev.optimistic !== next.optimistic ||
    prev.justSent !== next.justSent ||
    prev.justArrived !== next.justArrived ||
    prev.searchQuery !== next.searchQuery ||
    prev.isActiveSearchMatch !== next.isActiveSearchMatch ||
    (prev.deliveredAt?.toMillis?.() ?? 0) !== (next.deliveredAt?.toMillis?.() ?? 0) ||
    (prev.readAt?.toMillis?.() ?? 0) !== (next.readAt?.toMillis?.() ?? 0)
  ) {
    return false;
  }
  if (prev.reactions.length !== next.reactions.length) return false;
  for (let i = 0; i < prev.reactions.length; i++) {
    const a = prev.reactions[i];
    const b = next.reactions[i];
    if (a.emoji !== b.emoji || a.count !== b.count || a.reactedByMe !== b.reactedByMe) {
      return false;
    }
  }
  return true;
});
