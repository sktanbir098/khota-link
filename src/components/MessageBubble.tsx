import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Clock, Download, FileText, Loader2, Reply, Smile } from 'lucide-react';
import { formatFileSize, triggerFileDownload } from '../lib/attachments';
import { AttachmentType, REACTION_EMOJIS, ReactionEmoji } from '../types/chat';

export interface AggregatedReaction {
  emoji: ReactionEmoji;
  count: number;
  reactedByMe: boolean;
}

interface Props {
  id: string;
  text: string;
  senderName: string;
  timestampText: string;
  isMe: boolean;
  replyToText?: string;
  attachmentType?: AttachmentType;
  attachmentName?: string;
  attachmentSize?: number;
  attachmentData?: string;
  optimistic?: boolean;
  justSent?: boolean;
  justArrived?: boolean;
  reactions: AggregatedReaction[];
  onReact: (emoji: ReactionEmoji) => void;
  onReply?: () => void;
  onPreviewImage?: (dataUrl: string, name: string) => void;
  onResolveAttachment?: (messageId: string, marker: string) => Promise<string>;
}

export const MessageBubble: React.FC<Props> = ({
  id,
  text,
  senderName,
  timestampText,
  isMe,
  replyToText,
  attachmentType = 'none',
  attachmentName = '',
  attachmentSize = 0,
  attachmentData = '',
  optimistic = false,
  justSent = false,
  justArrived = false,
  reactions,
  onReact,
  onReply,
  onPreviewImage,
  onResolveAttachment,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string>(() =>
    attachmentData && !attachmentData.startsWith('chunked:') ? attachmentData : ''
  );
  const [downloadingFile, setDownloadingFile] = useState(false);
  const [loadingChunkedImage, setLoadingChunkedImage] = useState(false);

  const longPressTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!attachmentData) {
      setResolvedUrl('');
      return;
    }
    if (!attachmentData.startsWith('chunked:')) {
      setResolvedUrl(attachmentData);
      return;
    }
    if (attachmentType === 'image' && onResolveAttachment && !resolvedUrl) {
      let cancelled = false;
      setLoadingChunkedImage(true);
      onResolveAttachment(id, attachmentData)
        .then((url) => {
          if (!cancelled && url) setResolvedUrl(url);
        })
        .catch(() => {
          // Leave fallback clickable download button if chunk fails
        })
        .finally(() => {
          if (!cancelled) setLoadingChunkedImage(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [id, attachmentData, attachmentType, onResolveAttachment, resolvedUrl]);

  useEffect(() => {
    if (!pickerOpen) return;
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

  const hasImage = attachmentType === 'image' && Boolean(attachmentData);
  const hasFile = attachmentType === 'file' && Boolean(attachmentData);

  const animateArrival = justArrived && !isMe;
  const animateSend = justSent && isMe;

  return (
    <motion.div
      ref={containerRef}
      layout="position"
      initial={
        animateSend
          ? {
              opacity: 0,
              y: 24,
              x: 24,
              scale: 0.88,
            }
          : animateArrival
          ? {
              opacity: 0,
              x: -32,
              y: 12,
              scale: 0.94,
            }
          : false
      }
      animate={{
        opacity: 1,
        y: 0,
        x: 0,
        scale: 1,
      }}
      transition={
        animateSend
          ? {
              type: 'spring',
              stiffness: 340,
              damping: 24,
              mass: 0.8,
            }
          : animateArrival
          ? {
              type: 'spring',
              stiffness: 310,
              damping: 25,
              mass: 0.82,
            }
          : {
              duration: 0.14,
            }
      }
      className={`group relative flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
    >
      {/* Floating Reaction Picker Popover */}
      <AnimatePresence>
        {pickerOpen && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.94 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className={`z-20 mb-1.5 px-2 py-1.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg flex items-center gap-1 ${
              isMe ? 'self-end' : 'self-start'
            }`}
          >
            {REACTION_EMOJIS.map((emoji) => (
              <motion.button
                key={emoji}
                type="button"
                whileHover={{ scale: 1.22 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleSelectEmoji(emoji)}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-lg transition-colors"
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`flex items-end gap-1.5 max-w-full ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
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
          className={`relative overflow-hidden select-text max-w-[78vw] sm:max-w-md lg:max-w-lg rounded-2xl transition-transform active:scale-[0.99] ${
            hasImage && !text && !replyToText ? 'p-1.5' : 'px-4 py-2.5'
          } ${
            isMe
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
          }`}
        >
          {/* Send launch sheen sweep when outgoing message is sent */}
          {animateSend && (
            <motion.span
              aria-hidden="true"
              initial={{ x: '-120%', opacity: 0.65 }}
              animate={{ x: '220%', opacity: 0 }}
              transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none absolute inset-y-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/35 to-transparent"
            />
          )}
          {/* Subtle arrival shimmer sweep when a new incoming message arrives */}
          {animateArrival && (
            <motion.span
              aria-hidden="true"
              initial={{ x: '-120%', opacity: 0.6 }}
              animate={{ x: '220%', opacity: 0 }}
              transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none absolute inset-y-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-blue-400/25 dark:via-blue-300/20 to-transparent"
            />
          )}
          {replyToText && (
            <div
              className={`mb-1.5 pb-1.5 border-b text-xs truncate ${
                isMe
                  ? 'border-white/20 text-blue-100'
                  : 'border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400'
              }`}
            >
              “{replyToText}”
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

          {hasFile && (
            <button
              type="button"
              onClick={handleDownloadFile}
              disabled={downloadingFile}
              className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-colors ${
                text ? 'mb-2' : ''
              } ${
                isMe
                  ? 'bg-blue-700/60 border-blue-400/40 hover:bg-blue-700 text-white'
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
                <div className="text-xs font-semibold truncate">{attachmentName || 'Attachment'}</div>
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
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{text}</p>
          )}

          <div
            className={`mt-1 flex items-center gap-1 text-[11px] font-mono-tabular ${
              hasImage && !text && !replyToText ? 'px-2 pb-1' : ''
            } ${
              isMe ? 'text-blue-100 justify-end' : 'text-slate-400 justify-start'
            }`}
          >
            <span>{isMe ? timestampText : `${senderName} · ${timestampText}`}</span>
            {isMe && (
              <motion.span
                key={optimistic ? 'sending' : 'sent'}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.16 }}
                className="inline-flex items-center"
              >
                {optimistic ? (
                  <Clock className="w-3 h-3 opacity-80" aria-label="Sending" />
                ) : (
                  <Check className="w-3 h-3 opacity-95" aria-label="Sent" />
                )}
              </motion.span>
            )}
          </div>
        </div>

        {/* Inline Action Controls (Emoji React + Reply) */}
        <div className="flex items-center gap-0.5 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
          <button
            type="button"
            onClick={() => setPickerOpen((prev) => !prev)}
            aria-label="Add reaction"
            className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
          >
            <Smile className="w-3.5 h-3.5" />
          </button>
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              aria-label="Reply"
              className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
            >
              <Reply className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Reaction Counts & Emoji Types next to Bubble */}
      <AnimatePresence>
        {reactions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className={`mt-1 flex flex-wrap items-center gap-1 ${
              isMe ? 'justify-end' : 'justify-start'
            }`}
          >
            {reactions.map((r) => (
              <motion.button
                key={r.emoji}
                type="button"
                layout
                whileTap={{ scale: 0.9 }}
                onClick={() => onReact(r.emoji)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs font-mono-tabular transition-colors ${
                  r.reactedByMe
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span>{r.emoji}</span>
                <span>{r.count}</span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
