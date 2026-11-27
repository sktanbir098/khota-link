import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

interface Props {
  variant?: 'hero' | 'compact' | 'splash';
  className?: string;
}

const EASE_FLUID = [0.22, 1, 0.36, 1] as const;

/**
 * Painterly brush-stroke "O" app icon shared across compact headers, hero lockup, and splash.
 */
const BrushRingMark: React.FC<{
  animated?: boolean;
  className?: string;
}> = ({ animated = false, className = 'w-6 h-6' }) => {
  const shouldReduceMotion = useReducedMotion();
  const runDraw = animated && !shouldReduceMotion;

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ll-stroke-grad" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="65%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
        <linearGradient id="ll-accent-grad" x1="12" y1="10" x2="54" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>

      {/* Primary sweeping painterly Enso brush circle */}
      <motion.path
        d="M34.5 11.5C46.8 12.6 54.5 22.4 53.2 34.4C51.9 46.4 42.1 54.2 30.2 53.2C18.2 52.2 10.2 42.4 11.4 30.2C12.6 18.8 21.4 11.2 33 11.5C36.4 11.6 39.8 12.5 42.6 14"
        stroke="url(#ll-stroke-grad)"
        strokeWidth="5.4"
        strokeLinecap="round"
        initial={runDraw ? { pathLength: 0, opacity: 0.25 } : false}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.42, delay: 0.05, ease: EASE_FLUID }}
      />

      {/* Inner dry-brush bristle texture */}
      <motion.path
        d="M28.5 15.2C18.8 17.2 13.4 25.8 14.6 35.6C15.8 44.8 23.8 51.2 33.8 50.6C43.4 50 50.4 42.2 50 32.2C49.8 28 48.4 24.4 46 21.6"
        stroke="#ffffff"
        strokeOpacity="0.88"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeDasharray="28 3.5 13 2.5 19 3"
        initial={runDraw ? { pathLength: 0, opacity: 0 } : false}
        animate={{ pathLength: 1, opacity: 0.88 }}
        transition={{ duration: 0.44, delay: 0.12, ease: EASE_FLUID }}
      />

      {/* Top/outer cyan-blue accent brush flare */}
      <motion.path
        d="M16.2 17.8C22.4 11.2 33.8 9.6 43.2 14C49.8 17.2 53.6 24.2 53 32"
        stroke="url(#ll-accent-grad)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeDasharray="20 3 9 2.5 11"
        initial={runDraw ? { pathLength: 0, opacity: 0 } : false}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.38, delay: 0.18, ease: EASE_FLUID }}
      />

      {/* Bottom dry-brush taper flick */}
      <motion.path
        d="M15.2 43.6C21 51.4 31.8 54.8 41.4 51.2C46.5 49.2 50.4 45.2 52.4 40.4"
        stroke="#ffffff"
        strokeOpacity="0.72"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="14 2.5 8 2 6"
        initial={runDraw ? { pathLength: 0, opacity: 0 } : false}
        animate={{ pathLength: 1, opacity: 0.72 }}
        transition={{ duration: 0.36, delay: 0.22, ease: EASE_FLUID }}
      />
    </svg>
  );
};

export const LaunchSplash: React.FC<{ visible: boolean; onDismiss?: () => void }> = ({
  visible,
  onDismiss,
}) => (
  <AnimatePresence>
    {visible && (
      <motion.div
        key="looply-launch-splash"
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, scale: 1.015 }}
        transition={{ duration: 0.28, ease: EASE_FLUID }}
        onClick={onDismiss}
        role="presentation"
        className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 select-none"
      >
        <LoopLyLogo variant="splash" />
      </motion.div>
    )}
  </AnimatePresence>
);

export const LoopLyLogo: React.FC<Props> = ({ variant = 'compact', className = '' }) => {
  const shouldReduceMotion = useReducedMotion();

  if (variant === 'hero' || variant === 'splash') {
    const isSplash = variant === 'splash';
    return (
      <div className={`relative inline-flex items-center justify-center select-none ${className}`}>
        <div className="relative flex items-center">
          {/* Phase 1: Brush-O App Icon lands cleanly on top (z-20) */}
          <motion.div
            initial={shouldReduceMotion ? false : { scale: 0.68, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.38, ease: EASE_FLUID }}
            className={`relative z-20 ${
              isSplash ? 'w-16 h-16' : 'w-14 h-14'
            } flex items-center justify-center shrink-0`}
          >
            {/* Subtle crisp halo */}
            <motion.div
              initial={shouldReduceMotion ? false : { scale: 0.85, opacity: 0 }}
              animate={{ scale: [0.92, 1.14, 1], opacity: [0, 0.24, 0.14] }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="absolute inset-0 rounded-2xl bg-sky-500/30 dark:bg-sky-400/25"
            />

            <motion.div
              initial={shouldReduceMotion ? false : { rotate: -14, scale: 0.86 }}
              animate={{ rotate: 0, scale: 1 }}
              whileHover={isSplash ? undefined : { rotate: -6, scale: 1.05 }}
              transition={{ duration: 0.44, ease: EASE_FLUID }}
              className={`relative ${
                isSplash ? 'w-15 h-15 rounded-[19px]' : 'w-13 h-13 rounded-2xl'
              } bg-slate-950 dark:bg-slate-900 border border-slate-800 dark:border-slate-700 shadow-xl shadow-slate-900/20 dark:shadow-black/45 flex items-center justify-center overflow-hidden`}
            >
              <BrushRingMark animated className={isSplash ? 'w-11 h-11' : 'w-9 h-9'} />
            </motion.div>
          </motion.div>

          {/* Phase 2: "LoopLy" wordmark slides smoothly out FROM BEHIND the z-20 App Icon */}
          <motion.div
            initial={shouldReduceMotion ? false : { maxWidth: 0, opacity: 0 }}
            animate={{ maxWidth: 260, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.28, ease: EASE_FLUID }}
            className="relative z-10 overflow-hidden flex items-center -ml-2.5"
          >
            <div className="pl-5 pr-1 flex flex-col whitespace-nowrap">
              <motion.span
                initial={shouldReduceMotion ? false : { x: -120, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.52, delay: 0.3, ease: EASE_FLUID }}
                className={`font-display font-bold tracking-tight leading-none ${
                  isSplash ? 'text-[32px] sm:text-[36px]' : 'text-[26px] sm:text-[28px]'
                }`}
              >
                <span className="text-slate-900 dark:text-white">Loop</span>
                <span className="text-blue-600 dark:text-sky-400">Ly</span>
              </motion.span>
              <motion.span
                initial={shouldReduceMotion ? false : { x: -64, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.38, delay: 0.48, ease: EASE_FLUID }}
                className={`${
                  isSplash ? 'text-xs mt-1.5' : 'text-[11px] mt-1'
                } font-medium text-slate-500 dark:text-slate-400 tracking-wide`}
              >
                Instant · Direct · Secure
              </motion.span>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <motion.span
        whileHover={{ scale: 1.06, rotate: -6 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        className="w-8 h-8 rounded-xl bg-slate-950 dark:bg-slate-900 border border-slate-800 dark:border-slate-700 shadow-sm flex items-center justify-center shrink-0"
      >
        <BrushRingMark className="w-6 h-6" />
      </motion.span>
      <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap">
        <span className="text-slate-900 dark:text-white">Loop</span>
        <span className="text-blue-600 dark:text-sky-400">Ly</span>
      </span>
    </span>
  );
};
