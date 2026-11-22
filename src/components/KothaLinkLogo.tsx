import React from 'react';
import { motion } from 'motion/react';

interface Props {
  variant?: 'hero' | 'compact';
  className?: string;
}

export const KothaLinkLogo: React.FC<Props> = ({ variant = 'compact', className = '' }) => {
  if (variant === 'hero') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
        className={`relative inline-flex items-center gap-3.5 select-none ${className}`}
      >
        <div className="relative w-14 h-14 flex items-center justify-center">
          {/* Soft breathing ring */}
          <motion.div
            animate={{ scale: [1, 1.16, 1], opacity: [0.32, 0.08, 0.32] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-0 rounded-2xl bg-blue-500/20 dark:bg-blue-400/20"
          />

          {/* Primary logo squircle */}
          <motion.div
            initial={{ rotate: -10, scale: 0.82 }}
            animate={{ rotate: 0, scale: 1 }}
            whileHover={{ rotate: -4, scale: 1.05 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-12 h-12 rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/25 flex items-center justify-center overflow-hidden"
          >
            <svg
              viewBox="0 0 40 40"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-8 h-8"
              aria-hidden="true"
            >
              {/* Left chat bubble silhouette */}
              <motion.path
                d="M10 13.5C10 11.567 11.567 10 13.5 10H23.5C25.433 10 27 11.567 27 13.5V19.5C27 21.433 25.433 23 23.5 23H16L11.5 26.5V22.7C10.58 22.05 10 20.99 10 19.5V13.5Z"
                stroke="white"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0.35 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1.35, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
              />
              {/* Emerald signal bridge wave */}
              <motion.path
                d="M21 27.5C24.8 27.5 28.5 25.4 29.8 21.2C30.3 19.6 30.2 17.8 29.5 16.4"
                stroke="#34D399"
                strokeWidth="2.6"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1.25, delay: 0.95, ease: [0.22, 1, 0.36, 1] }}
              />
              {/* Animated connection node */}
              <motion.circle
                cx="18.5"
                cy="16.5"
                r="2"
                fill="#34D399"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: [0, 1.45, 1], opacity: [0, 1, 1] }}
                transition={{ duration: 0.75, delay: 1.95, ease: 'easeOut' }}
              />
            </svg>
          </motion.div>
        </div>

        <div className="flex flex-col">
          <motion.span
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.85, delay: 1.15, ease: [0.16, 1, 0.3, 1] }}
            className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white leading-none"
          >
            KothaLink
          </motion.span>
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 1.95, ease: [0.16, 1, 0.3, 1] }}
            className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1"
          >
            Instant · Direct · Secure
          </motion.span>
        </div>
      </motion.div>
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
