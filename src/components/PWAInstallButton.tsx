import React, { useState } from 'react';
import { Download, PlusSquare, Share, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWA';
import { t } from '../lib/i18n';
import { AppLanguage } from '../types/chat';

interface InstallBtnProps {
  lang: AppLanguage;
  variant?: 'compact' | 'card';
  className?: string;
}

export const PWAInstallButton: React.FC<InstallBtnProps> = ({
  lang,
  variant = 'compact',
  className = '',
}) => {
  const { canPromptInstall, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);

  if (isInstalled) return null;
  if (!canPromptInstall && !isIOS && variant === 'compact') {
    return null;
  }

  const handleClick = async () => {
    if (canPromptInstall) {
      const outcome = await promptInstall();
      if (outcome === 'unavailable') {
        setShowInstructionsModal(true);
      }
    } else {
      setShowInstructionsModal(true);
    }
  };

  return (
    <>
      {variant === 'card' ? (
        <div
          className={`p-3.5 rounded-2xl bg-blue-50/90 dark:bg-blue-950/35 border border-blue-200 dark:border-blue-800/70 flex items-center justify-between gap-3 ${className}`}
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Download className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <span>{t(lang, 'installAppBtn')}</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">
              {t(lang, 'installAppHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleClick()}
            className="min-h-[38px] px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>{t(lang, 'installAppBtn')}</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void handleClick()}
          title={t(lang, 'installAppHint')}
          className={`min-h-[38px] px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${className}`}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>{t(lang, 'installAppBtn')}</span>
        </button>
      )}

      {showInstructionsModal && (
        <div
          onClick={() => setShowInstructionsModal(false)}
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t(lang, 'installAppBtn')}
              </h3>
              <button
                type="button"
                onClick={() => setShowInstructionsModal(false)}
                aria-label="Close"
                className="min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {isIOS ? (
              <ol className="space-y-3 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <li className="flex items-center gap-2.5">
                  <Share className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>
                    {lang === 'bn'
                      ? '১. Safari-এর নিচে Share বাটনে ট্যাপ করুন।'
                      : '1. Tap the Share icon at the bottom of Safari.'}
                  </span>
                </li>
                <li className="flex items-center gap-2.5">
                  <PlusSquare className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>
                    {lang === 'bn'
                      ? '২. "Add to Home Screen" সিলেক্ট করে Add দিন — এরপর ইন্টারনেট ছাড়াই খুলতে পারবেন!'
                      : '2. Choose "Add to Home Screen" and tap Add — LoopLy will launch offline!'}
                  </span>
                </li>
              </ol>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {lang === 'bn'
                  ? 'আপনার ব্রাউজারের মেনু (⋮) থেকে "Install app" বা "Add to Home screen" সিলেক্ট করলে LoopLy অফলাইনেও কাজ করবে।'
                  : 'Open your browser menu (⋮) and choose "Install app" or "Add to Home screen" to launch LoopLy offline anytime.'}
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowInstructionsModal(false)}
              className="w-full min-h-[40px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
            >
              {lang === 'bn' ? 'ঠিক আছে' : 'Got it'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

interface OfflineBannerProps {
  lang: AppLanguage;
  onOpenOfflineMode?: () => void;
  showAction?: boolean;
}

export const OfflineIndicator: React.FC<OfflineBannerProps> = ({
  lang,
  onOpenOfflineMode,
  showAction = true,
}) => {
  return (
    <div className="px-3 sm:px-5 py-2 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800/70 text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="font-medium truncate">{t(lang, 'offlineBannerText')}</span>
      </div>
      {showAction && onOpenOfflineMode && (
        <button
          type="button"
          onClick={onOpenOfflineMode}
          className="min-h-[30px] px-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors"
        >
          {t(lang, 'offlineOpenAction')}
        </button>
      )}
    </div>
  );
};
