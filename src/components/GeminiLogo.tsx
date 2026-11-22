import React, { useId } from 'react';
import { motion } from 'motion/react';

interface Props {
  variant?: 'badge' | 'icon';
  size?: number;
  animate?: boolean;
  className?: string;
}

export const GeminiLogo: React.FC<Props> = ({
  variant = 'icon',
  size = 20,
  animate = false,
  className = '',
}) => {
  const uid = useId().replace(/:/g, '');
  const gradMain = `gemini_main_${uid}`;
  const gradOrb = `gemini_orb_${uid}`;
  const gradAccent = `gemini_accent_${uid}`;

  const sparkleSvg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={variant === 'icon' ? className : undefined}
    >
      <defs>
        <linearGradient id={gradMain} x1="4" y1="4" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22D3EE" />
          <stop offset="48%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id={gradOrb} x1="6" y1="30" x2="30" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#A78BFA" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id={gradAccent} x1="23" y1="6" x2="31" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#22D3EE" />
        </linearGradient>
      </defs>

      {/* Subtle aurora backdrop diamond */}
      <circle cx="18" cy="18" r="15" fill={`url(#${gradOrb})`} />

      {/* Main sculpted 4-point Gemini aurora star */}
      <path
        d="M17.2 4.6C17.6 11.4 20.6 15.1 27.6 16.5C28.4 16.65 28.4 17.75 27.6 17.9C20.6 19.3 17.6 23 17.2 29.8C17.15 30.6 16.05 30.6 16 29.8C15.6 23 12.6 19.3 5.6 17.9C4.8 17.75 4.8 16.65 5.6 16.5C12.6 15.1 15.6 11.4 16 4.6C16.05 3.8 17.15 3.8 17.2 4.6Z"
        fill={`url(#${gradMain})`}
      />

      {/* Crisp inner highlight star */}
      <path
        d="M16.6 10.6C16.9 14.1 18.4 15.8 22 16.6C18.4 17.4 16.9 19.1 16.6 22.6C16.3 19.1 14.8 17.4 11.2 16.6C14.8 15.8 16.3 14.1 16.6 10.6Z"
        fill="white"
        fillOpacity="0.88"
      />

      {/* Secondary lightning micro-spark */}
      <path
        d="M27.5 6.4C27.7 8.1 28.5 8.9 30.2 9.1C28.5 9.3 27.7 10.1 27.5 11.8C27.3 10.1 26.5 9.3 24.8 9.1C26.5 8.9 27.3 8.1 27.5 6.4Z"
        fill={`url(#${gradAccent})`}
      />
    </svg>
  );

  if (variant === 'icon') {
    return animate ? (
      <motion.span
        animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.08, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        className={`inline-flex items-center justify-center shrink-0 ${className}`}
      >
        {sparkleSvg}
      </motion.span>
    ) : (
      <span className={`inline-flex items-center justify-center shrink-0 ${className}`}>
        {sparkleSvg}
      </span>
    );
  }

  return (
    <div className={`relative w-10 h-10 flex items-center justify-center shrink-0 ${className}`}>
      {animate && (
        <motion.div
          animate={{ scale: [1, 1.22, 1], opacity: [0.45, 0.12, 0.45] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-cyan-400/40 via-blue-500/35 to-violet-500/40 blur-[2px]"
        />
      )}
      <motion.div
        animate={animate ? { rotate: [0, 6, -6, 0], scale: [1, 1.05, 1] } : undefined}
        transition={animate ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : undefined}
        className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 dark:from-slate-900 dark:via-indigo-950 dark:to-slate-900 border border-cyan-400/30 shadow-md shadow-blue-600/20 flex items-center justify-center"
      >
        {sparkleSvg}
      </motion.div>
    </div>
  );
};
