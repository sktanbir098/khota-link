import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface Props {
  variant?: 'hero' | 'compact' | 'splash';
  className?: string;
}

const EASE_FLUID = [0.22, 1, 0.36, 1] as const;

export const LaunchSplash: React.FC<{ visible: boolean; onDismiss?: () => void }> = ({
  visible,
  onDismiss,
}) => (
  <AnimatePresence>
    {visible && (
      <motion.div
        key="kothalink-launch-splash"
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, scale: 1.02 }}
        transition={{ duration: 0.26, ease: EASE_FLUID }}
        onClick={onDismiss}
        role="presentation"
        className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 select-none"
      >
        <KothaLinkLogo variant="splash" />
      </motion.div>
    )}
  </AnimatePresence>
);

export const KothaLinkLogo: React.FC<Props> = ({ variant = 'compact', className = '' }) => {
  if (variant === 'hero' || variant === 'splash') {
    const isSplash = variant === 'splash';
    return (
      <div className={`relative inline-flex items-center justify-center select-none ${className}`}>
        <div className="relative flex items-center">
          {/* Logo Icon Container (slides smoothly left as wordmark emerges out of it) */}
          <motion.div
            initial={{ scale: 0.78, opacity: 0, x: 0 }}
            animate={{ scale: 1, opacity: 1, x: 0 }}
            transition={{ duration: 0.34, ease: EASE_FLUID }}
            className={`relative z-10 ${isSplash ? 'w-16 h-16' : 'w-14 h-14'} flex items-center justify-center shrink-0`}
          >
            {/* Soft ambient halo */}
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: [0.95, 1.16, 1], opacity: [0, 0.25, 0.14] }}
              transition={{ duration: 0.75, ease: 'easeOut' }}
              className="absolute inset-0 rounded-2xl bg-blue-500/25 dark:bg-blue-400/25 blur-sm"
            />

            {/* Primary logo squircle */}
            <motion.div
              initial={{ rotate: -6, scale: 0.88 }}
              animate={{ rotate: 0, scale: 1 }}
              whileHover={isSplash ? undefined : { rotate: -4, scale: 1.05 }}
              transition={{ duration: 0.38, ease: EASE_FLUID }}
              className={`relative ${
                isSplash ? 'w-14 h-14 rounded-[18px]' : 'w-12 h-12 rounded-2xl'
              } bg-blue-600 shadow-lg shadow-blue-600/30 flex items-center justify-center overflow-hidden`}
            >
              <svg
                viewBox="0 0 40 40"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={isSplash ? 'w-9 h-9' : 'w-8 h-8'}
                aria-hidden="true"
              >
                {/* Chat bubble stroke */}
                <motion.path
                  d="M10 13.5C10 11.567 11.567 10 13.5 10H23.5C25.433 10 27 11.567 27 13.5V19.5C27 21.433 25.433 23 23.5 23H16L11.5 26.5V22.7C10.58 22.05 10 20.99 10 19.5V13.5Z"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0, opacity: 0.35 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.38, delay: 0.04, ease: EASE_FLUID }}
                />
                {/* Emerald signal bridge */}
                <motion.path
                  d="M21 27.5C24.8 27.5 28.5 25.4 29.8 21.2C30.3 19.6 30.2 17.8 29.5 16.4"
                  stroke="#34D399"
                  strokeWidth="2.7"
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.34, delay: 0.16, ease: EASE_FLUID }}
                />
                {/* Connection pulse dot */}
                <motion.circle
                  cx="18.5"
                  cy="16.5"
                  r="2.1"
                  fill="#34D399"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: [0, 1.35, 1], opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.24, ease: 'easeOut' }}
                />
              </svg>
            </motion.div>
          </motion.div>

          {/* Clipped reveal container: "KothaLink" glides cleanly out from the right edge of the logo */}
          <motion.div
            initial={{ maxWidth: 0, opacity: 0 }}
            animate={{ maxWidth: 240, opacity: 1 }}
            transition={{ duration: 0.44, delay: 0.2, ease: EASE_FLUID }}
            className="overflow-hidden flex items-center"
          >
            <div className="pl-3 flex flex-col whitespace-nowrap">
              <motion.span
                initial={{ x: -34, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.42, delay: 0.24, ease: EASE_FLUID }}
                className={`font-display font-bold tracking-tight text-slate-900 dark:text-white leading-none ${
                  isSplash ? 'text-[30px] sm:text-[34px]' : 'text-2xl'
                }`}
              >
                Kotha<span className="text-blue-600 dark:text-blue-400">Link</span>
              </motion.span>
              <motion.span
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.34, delay: 0.38, ease: EASE_FLUID }}
                className={`${
                  isSplash ? 'text-xs mt-1.5' : 'text-xs mt-1'
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
    <span className={`inline-flex items-center gap-2 select-none ${className}`}>
      <motion.span
        whileHover={{ scale: 1.06, rotate: -3 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        className="w-8 h-8 rounded-xl bg-blue-600 shadow-sm shadow-blue-600/20 flex items-center justify-center shrink-0"
      >
        <svg
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-5 h-5"
          aria-hidden="true"
        >
          <path
            d="M10 13.5C10 11.567 11.567 10 13.5 10H23.5C25.433 10 27 11.567 27 13.5V19.5C27 21.433 25.433 23 23.5 23H16L11.5 26.5V22.7C10.58 22.05 10 20.99 10 19.5V13.5Z"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M21 27.5C24.8 27.5 28.5 25.4 29.8 21.2C30.3 19.6 30.2 17.8 29.5 16.4"
            stroke="#34D399"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <circle cx="18.5" cy="16.5" r="2.1" fill="#34D399" />
        </svg>
      </motion.span>
      <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
        KothaLink
      </span>
    </span>
  );
};
