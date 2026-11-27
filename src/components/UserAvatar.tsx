import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAP: Record<
  AvatarSize,
  { container: string; text: string; dot: string; unread: string; ringInset: string }
> = {
  xs: {
    container: 'w-8 h-8',
    text: 'text-xs',
    dot: 'w-2 h-2',
    unread: 'w-2.5 h-2.5',
    ringInset: '-inset-0.5',
  },
  sm: {
    container: 'w-9 h-9',
    text: 'text-sm',
    dot: 'w-2.5 h-2.5',
    unread: 'w-2.5 h-2.5',
    ringInset: '-inset-[3px]',
  },
  md: {
    container: 'w-10 h-10',
    text: 'text-sm',
    dot: 'w-2.5 h-2.5',
    unread: 'w-3 h-3',
    ringInset: '-inset-[3px]',
  },
  lg: {
    container: 'w-11 h-11',
    text: 'text-sm',
    dot: 'w-3 h-3',
    unread: 'w-3 h-3',
    ringInset: '-inset-[3px]',
  },
  xl: {
    container: 'w-20 h-20',
    text: 'text-2xl',
    dot: 'w-4 h-4',
    unread: 'w-4 h-4',
    ringInset: '-inset-1',
  },
};

interface Props {
  name: string;
  photoUrl?: string | null;
  size?: AvatarSize;
  isOnline?: boolean;
  hasUnread?: boolean;
  presenceTitle?: string;
  className?: string;
  ringColorClass?: string;
}

export const UserAvatar: React.FC<Props> = ({
  name,
  photoUrl,
  size = 'md',
  isOnline,
  hasUnread = false,
  presenceTitle,
  className = '',
  ringColorClass = 'ring-white dark:ring-slate-950',
}) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [photoUrl]);

  const sz = SIZE_MAP[size];
  const initial = (name || 'U').trim().slice(0, 1).toUpperCase();
  const showImage = Boolean(photoUrl && !imgError);

  return (
    <div className={`relative ${sz.container} shrink-0 ${className}`}>
      {/* Blinking Green Online Ring Light (GPU-composited transform + opacity only) */}
      {isOnline === true && (
        <motion.span
          aria-hidden="true"
          animate={{
            scale: [1, 1.14, 1],
            opacity: [0.85, 0.2, 0.85],
          }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className={`pointer-events-none absolute ${sz.ringInset} rounded-full border-2 border-emerald-500`}
        />
      )}

      {/* Avatar Surface */}
      <div
        className={`relative w-full h-full rounded-full overflow-hidden flex items-center justify-center font-bold ${sz.text} ${
          isOnline === true
            ? 'ring-2 ring-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'bg-blue-600/12 text-blue-600 dark:text-blue-400 border border-slate-200/80 dark:border-slate-700/80'
        }`}
      >
        {showImage ? (
          <img
            src={photoUrl!}
            alt={name}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span>{initial}</span>
        )}
      </div>

      {/* Online (Green) / Offline (Red) Status Dot */}
      {isOnline !== undefined && (
        <span
          title={presenceTitle}
          aria-label={presenceTitle}
          className={`absolute bottom-0 right-0 ${sz.dot} rounded-full ring-2 ${ringColorClass} ${
            isOnline ? 'bg-emerald-500' : 'bg-red-500'
          }`}
        />
      )}

      {/* Blinking Yellow Unread New Message Dot */}
      {hasUnread && (
        <span
          aria-label="New message"
          className={`absolute -top-0.5 -right-0.5 ${sz.unread} flex items-center justify-center`}
        >
          <motion.span
            aria-hidden="true"
            animate={{
              scale: [1, 1.8, 1],
              opacity: [0.9, 0, 0.9],
            }}
            transition={{
              duration: 1.35,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="absolute inset-0 rounded-full bg-amber-400"
          />
          <span
            className={`relative w-full h-full rounded-full bg-amber-400 ring-2 ${ringColorClass}`}
          />
        </span>
      )}
    </div>
  );
};
