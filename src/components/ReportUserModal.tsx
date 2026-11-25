import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, CheckCircle2, Flag, Loader2, X } from 'lucide-react';
import { t } from '../lib/i18n';
import { AppLanguage, LIMITS, ReportReason } from '../types/chat';

interface Props {
  isOpen: boolean;
  lang: AppLanguage;
  targetName: string;
  isAlreadyBlocked: boolean;
  onSubmitReport: (params: {
    reason: ReportReason;
    details: string;
    alsoBlock: boolean;
  }) => Promise<void>;
  onClose: () => void;
}

const REPORT_REASONS: Array<{ id: ReportReason; en: string; bn: string }> = [
  { id: 'spam', en: 'Spam or unwanted promotions', bn: 'স্প্যাম বা অযাচিত প্রচার' },
  { id: 'harassment', en: 'Harassment, threats, or bullying', bn: 'হয়রানি বা হুমকি' },
  { id: 'scam', en: 'Scam, fraud, or phishing', bn: 'প্রতারণা বা ফিশিং' },
  { id: 'impersonation', en: 'Fake identity / impersonation', bn: 'ভুয়া পরিচয় বা ছদ্মবেশ' },
  { id: 'inappropriate', en: 'Inappropriate content', bn: 'অনুপযুক্ত কনটেন্ট' },
  { id: 'other', en: 'Other safety concern', bn: 'অন্যান্য নিরাপত্তা সমস্যা' },
];

export const ReportUserModal: React.FC<Props> = ({
  isOpen,
  lang,
  targetName,
  isAlreadyBlocked,
  onSubmitReport,
  onClose,
}) => {
  const [reason, setReason] = useState<ReportReason>('spam');
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(!isAlreadyBlocked);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmitReport({ reason, details: details.trim(), alsoBlock });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={() => !submitting && onClose()}
      className="fixed inset-0 z-[60] bg-black/65 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 14 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92dvh] flex flex-col mobile-sheet-safe"
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-0.5 shrink-0">
          <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              aria-label={t(lang, 'backBtn')}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
                {t(lang, 'reportModalTitle')}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {targetName}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Close"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {submitted ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {t(lang, 'reportSubmittedMsg')}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
            >
              OK
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="p-5 sm:p-6 space-y-4 overflow-y-auto">
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {t(lang, 'reportModalDesc')}
            </p>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t(lang, 'reportReasonLabel')}
              </label>
              <div className="space-y-1.5">
                {REPORT_REASONS.map((item) => {
                  const selected = reason === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setReason(item.id)}
                      className={`w-full min-h-[42px] px-3.5 py-2 rounded-xl border text-left text-xs font-medium flex items-center justify-between gap-2 transition-colors ${
                        selected
                          ? 'bg-red-50 dark:bg-red-950/40 border-red-400 dark:border-red-700 text-red-700 dark:text-red-300'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{lang === 'bn' ? item.bn : item.en}</span>
                      <span
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                          selected
                            ? 'border-red-600 bg-red-600'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <textarea
                rows={3}
                maxLength={LIMITS.REPORT_DETAILS_MAX}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={t(lang, 'reportDetailsPlaceholder')}
                className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              />
            </div>

            {!isAlreadyBlocked && (
              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alsoBlock}
                  onChange={(e) => setAlsoBlock(e.target.checked)}
                  className="w-4 h-4 rounded text-red-600 focus:ring-red-500"
                />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  {t(lang, 'reportAndBlockLabel')}
                </span>
              </label>
            )}

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {t(lang, 'cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Flag className="w-4 h-4" />
                )}
                <span>{submitting ? t(lang, 'submittingReport') : t(lang, 'submitReportBtn')}</span>
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
};
