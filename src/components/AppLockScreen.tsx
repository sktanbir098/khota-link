import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Delete, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { verifyAppLockPin } from '../lib/appLock';
import { t } from '../lib/i18n';
import { AppLanguage } from '../types/chat';

interface Props {
  uid: string;
  displayName: string;
  lang: AppLanguage;
  onUnlocked: () => void;
  onSignOut: () => Promise<void>;
}

export const AppLockScreen: React.FC<Props> = ({
  uid,
  displayName,
  lang,
  onUnlocked,
  onSignOut,
}) => {
  const [digits, setDigits] = useState('');
  const [errorText, setErrorText] = useState('');
  const [cooldownSec, setCooldownSec] = useState(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const id = window.setInterval(() => {
      setCooldownSec((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldownSec]);

  const submitPin = useCallback(
    async (candidate: string) => {
      if (checking || cooldownSec > 0 || candidate.length !== 4) return;
      setChecking(true);
      setErrorText('');
      try {
        const res = await verifyAppLockPin(uid, candidate);
        if (res.ok) {
          setDigits('');
          onUnlocked();
        } else if (res.remainingWaitSec > 0) {
          setCooldownSec(res.remainingWaitSec);
          setDigits('');
          setErrorText(`${t(lang, 'pinCooldownMsg')} ${res.remainingWaitSec}s`);
        } else {
          setDigits('');
          setErrorText(t(lang, 'wrongPinMsg'));
        }
      } finally {
        setChecking(false);
      }
    },
    [checking, cooldownSec, lang, onUnlocked, uid]
  );

  const pushDigit = useCallback(
    (d: string) => {
      if (checking || cooldownSec > 0) return;
      setErrorText('');
      setDigits((prev) => {
        if (prev.length >= 4) return prev;
        const next = prev + d;
        if (next.length === 4) {
          void submitPin(next);
        }
        return next;
      });
    },
    [checking, cooldownSec, submitPin]
  );

  const popDigit = useCallback(() => {
    if (checking) return;
    setErrorText('');
    setDigits((prev) => prev.slice(0, -1));
  }, [checking]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pushDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        popDigit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pushDigit, popDigit]);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-5">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 text-center"
      >
        <div className="space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-blue-600/12 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            {t(lang, 'appLockedTitle')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {displayName} · {t(lang, 'appLockedSubtitle')}
          </p>
        </div>

        {/* 4-dot PIN indicator */}
        <div className="flex items-center justify-center gap-3.5 py-1" aria-live="polite">
          {[0, 1, 2, 3].map((idx) => {
            const filled = idx < digits.length;
            return (
              <span
                key={idx}
                className={`w-3.5 h-3.5 rounded-full transition-all ${
                  filled
                    ? 'bg-blue-600 scale-110'
                    : 'border-2 border-slate-300 dark:border-slate-700 bg-transparent'
                }`}
              />
            );
          })}
        </div>

        {errorText && (
          <p className="text-xs font-medium text-red-600 dark:text-red-400 min-h-[18px]">
            {cooldownSec > 0 ? `${t(lang, 'pinCooldownMsg')} ${cooldownSec}s` : errorText}
          </p>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              type="button"
              disabled={checking || cooldownSec > 0}
              onClick={() => pushDigit(num)}
              className="min-h-[52px] rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 disabled:opacity-45 text-lg font-bold font-mono-tabular text-slate-900 dark:text-white transition-all"
            >
              {num}
            </button>
          ))}
          <div className="flex items-center justify-center text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <button
            type="button"
            disabled={checking || cooldownSec > 0}
            onClick={() => pushDigit('0')}
            className="min-h-[52px] rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 disabled:opacity-45 text-lg font-bold font-mono-tabular text-slate-900 dark:text-white transition-all"
          >
            0
          </button>
          <button
            type="button"
            disabled={checking || digits.length === 0}
            onClick={popDigit}
            aria-label="Delete digit"
            className="min-h-[52px] rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 disabled:opacity-40 text-slate-700 dark:text-slate-200 flex items-center justify-center transition-all"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => void onSignOut()}
          className="w-full min-h-[40px] px-3 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>{t(lang, 'unlockSwitchAccount')}</span>
        </button>
      </motion.div>
    </div>
  );
};
