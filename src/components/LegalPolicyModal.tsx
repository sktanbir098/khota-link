import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  FileCheck2,
  Lock,
  Scale,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { t } from '../lib/i18n';
import { AppLanguage, CURRENT_POLICY_VERSION } from '../types/chat';

export type PolicyTab = 'privacy' | 'terms' | 'safety' | 'security';

interface Props {
  isOpen: boolean;
  initialTab?: PolicyTab;
  lang: AppLanguage;
  isAuthenticated?: boolean;
  acceptedVersion?: string;
  onAcceptPolicy?: () => Promise<void>;
  onClose: () => void;
}

interface PolicySection {
  heading: string;
  body: string;
}

const POLICY_COPY: Record<AppLanguage, Record<PolicyTab, { title: string; subtitle: string; sections: PolicySection[] }>> = {
  en: {
    privacy: {
      title: 'Privacy Policy',
      subtitle: 'How KothaLink collects, isolates, and protects your personal information.',
      sections: [
        {
          heading: '1. Information You Provide',
          body: 'When you continue with Google Sign-In, we store your display name, profile photo URL, and verified email address. Your full email address is isolated inside an owner-only private document and is never exposed in public search results.',
        },
        {
          heading: '2. Masked Directory & Search Visibility',
          body: 'Public user discovery displays only your display name, optional bio, avatar, and a masked hint (first 2 characters of your email). You can turn off search discovery anytime inside Settings -> Privacy & Security.',
        },
        {
          heading: '3. Offline Gmail Alerts',
          body: 'Offline email alerts are only triggered when you explicitly confirm sending an alert or send via your own Gmail account. Email tokens are held strictly in volatile memory and never persisted to browser storage.',
        },
        {
          heading: '4. Your Rights & Data Deletion',
          body: 'You may export a copy of your account profile, privacy settings, and chat metadata as JSON at any time, or permanently delete your account, directory entries, and 24-hour statuses from Account Settings.',
        },
      ],
    },
    terms: {
      title: 'Terms of Service',
      subtitle: 'Clear ground rules for using KothaLink responsibly and securely.',
      sections: [
        {
          heading: '1. Eligibility & Account Integrity',
          body: 'You must use a valid, verified Google account to access persistent cloud chats. You are responsible for safeguarding your login session and any local 4-digit App PIN enabled on your device.',
        },
        {
          heading: '2. Messaging, Calls & Local P2P',
          body: 'KothaLink supports cloud-synced conversations, 1-on-1 WebRTC voice/video calls, and local Web Bluetooth / Nearby QR pairing. Availability of Web Bluetooth depends on browser and hardware permissions.',
        },
        {
          heading: '3. Fair Use & Service Limits',
          body: 'To keep the service fast and reliable for everyone, automated spamming, bulk unsolicited email alerts, and oversized payloads exceeding documented media limits are prohibited and rate-limited.',
        },
        {
          heading: '4. Enforcement',
          body: 'Accounts reported for fraud, harassment, or abuse may be restricted or removed. You may stop using the service and delete your account data at any time.',
        },
      ],
    },
    safety: {
      title: 'Safety & Community Guidelines',
      subtitle: 'Practical standards that keep conversations respectful and spam-free.',
      sections: [
        {
          heading: '1. Zero Tolerance for Abuse & Harassment',
          body: 'Harassment, hate speech, threats, impersonation, and phishing links are strictly prohibited on KothaLink.',
        },
        {
          heading: '2. Block & Report Tools',
          body: 'Open any contact profile to immediately Block a user (preventing messages and calls) or submit an immutable Safety Report with reason and context.',
        },
        {
          heading: '3. Safe Invite & File Practices',
          body: 'Only share 6-digit invite codes or Nearby QR rooms with trusted contacts, and verify unexpected file attachments before downloading.',
        },
      ],
    },
    security: {
      title: 'Security & Data Protection',
      subtitle: 'Defense-in-depth protections built into KothaLink.',
      sections: [
        {
          heading: '1. Strict PII Isolation & Hash Directories',
          body: 'Email lookups use irreversible SHA-256 hashes. Public profile cards never contain your raw email address or phone number.',
        },
        {
          heading: '2. Salted Local App PIN Lock',
          body: 'When enabled, your 4-digit App PIN is stored as a salted SHA-256 cryptographic digest with brute-force cooldown protection — plaintext PINs are never saved.',
        },
        {
          heading: '3. Transport, Rate Limiting & Rules Enforcement',
          body: 'All API endpoints enforce server-side session verification, rate limits, security headers, and strict per-field database schema validation.',
        },
      ],
    },
  },
  bn: {
    privacy: {
      title: 'গোপনীয়তা নীতি (Privacy Policy)',
      subtitle: 'KothaLink কীভাবে আপনার ব্যক্তিগত তথ্য সংগ্রহ, সংরক্ষণ এবং সুরক্ষিত রাখে।',
      sections: [
        {
          heading: '১. আমরা যে তথ্য সংগ্রহ করি',
          body: 'Google দিয়ে সাইন ইন করলে আপনার নাম, প্রোফাইল ছবি ও ভেরিফাইড ইমেইল সংরক্ষণ করা হয়। আপনার আসল ইমেইল কেবল আপনার নিজস্ব প্রাইভেট ডকুমেন্টে সুরক্ষিত থাকে এবং পাবলিক সার্চে দেখানো হয় না।',
        },
        {
          heading: '২. মাস্কড প্রোফাইল ও সার্চ নিয়ন্ত্রণ',
          body: 'পাবলিক সার্চে কেবল আপনার নাম, বায়ো এবং ইমেইলের প্রথম ২ অক্ষরের মাস্কড হিন্ট দেখা যায়। আপনি যেকোনো সময় Settings থেকে সার্চ ডিসকভারি বন্ধ করতে পারবেন।',
        },
        {
          heading: '৩. অফলাইন Gmail অ্যালার্ট',
          body: 'বন্ধু অফলাইনে থাকলে কেবল আপনার অনুমোদনেই ইমেইল অ্যালার্ট পাঠানো হয়। কোনো OAuth টোকেন কখনো ব্রাউজার স্টোরেজে সেভ করা হয় না।',
        },
        {
          heading: '৪. আপনার ডেটার অধিকার ও ডিলিট সুবিধা',
          body: 'আপনি যেকোনো সময় আপনার প্রোফাইল, সেটিংস ও চ্যাট তালিকা JSON হিসেবে ডাউনলোড করতে পারেন অথবা Account ট্যাব থেকে অ্যাকাউন্ট স্থায়ীভাবে ডিলিট করতে পারেন।',
        },
      ],
    },
    terms: {
      title: 'ব্যবহারের শর্তাবলি (Terms of Service)',
      subtitle: 'নিরাপদ ও দায়িত্বশীল ব্যবহারের জন্য পরিষ্কার নিয়মাবলি।',
      sections: [
        {
          heading: '১. অ্যাকাউন্ট সুরক্ষা',
          body: 'ক্লাউড চ্যাট ব্যবহারের জন্য একটি ভেরিফাইড Google অ্যাকাউন্ট প্রয়োজন। আপনার ডিভাইস এবং ৪-ডিজিটের অ্যাপ পিন সুরক্ষিত রাখার দায়িত্ব আপনার।',
        },
        {
          heading: '২. মেসেজিং, কল ও Nearby P2P',
          body: 'KothaLink রিয়েল-টাইম চ্যাট, ভয়েস/ভিডিও কল এবং Web Bluetooth / Nearby QR কানেকশন প্রদান করে। Bluetooth ফিচার ব্রাউজার ও ডিভাইসের পারমিশনের উপর নির্ভরশীল।',
        },
        {
          heading: '৩. স্প্যাম ও অপব্যবহার নিষিদ্ধ',
          body: 'অযাচিত স্প্যাম, ভুয়া পরিচয়, প্রতারণা বা অতিরিক্ত অটোমেটেড ইমেইল অ্যালার্ট পাঠানো কঠোরভাবে নিষিদ্ধ এবং রেট-লিমিট দ্বারা নিয়ন্ত্রিত।',
        },
      ],
    },
    safety: {
      title: 'নিরাপত্তা ও কমিউনিটি গাইডলাইন',
      subtitle: 'সবাইকে নিরাপদ ও সম্মানজনক চ্যাটিং অভিজ্ঞতা দিতে আমাদের মানদণ্ড।',
      sections: [
        {
          heading: '১. হয়রানি ও প্রতারণার বিরুদ্ধে জিরো টলারেন্স',
          body: 'যেকোনো ধরনের হুমকি, হয়রানি, স্প্যাম, ছদ্মবেশ বা ক্ষতিকর লিংক শেয়ার করা সম্পূর্ণ নিষিদ্ধ।',
        },
        {
          heading: '২. ব্লক ও রিপোর্ট সুবিধা',
          body: 'যেকোনো কন্টাক্টের প্রোফাইলে গিয়ে সাথে সাথে Block করতে পারেন অথবা কারণ উল্লেখ করে গোপনীয় Safety Report পাঠাতে পারেন।',
        },
        {
          heading: '৩. নিরাপদ ইনভাইট কোড ব্যবহার',
          body: 'আপনার ৬-ডিজিট ইনভাইট কোড বা Nearby রুম কোড কেবল বিশ্বস্ত মানুষের সাথে শেয়ার করুন এবং অচেনা ফাইল ডাউনলোডের আগে যাচাই করুন।',
        },
      ],
    },
    security: {
      title: 'নিরাপত্তা ও ডেটা সুরক্ষা',
      subtitle: 'KothaLink-এ যুক্ত বহুমুখী নিরাপত্তা ব্যবস্থা।',
      sections: [
        {
          heading: '১. SHA-256 হ্যাশ ডিরেক্টরি ও PII আইসোলেশন',
          body: 'ইমেইল সার্চ এনক্রিপ্টেড SHA-256 হ্যাশ ব্যবহার করে সম্পন্ন হয়, যাতে আপনার আসল ইমেইল পাবলিক ডিরেক্টরিতে প্রকাশ না পায়।',
        },
        {
          heading: '২. সল্টেড অ্যাপ পিন লক',
          body: 'অ্যাপ লক চালু করলে আপনার ৪-ডিজিটের পিন সল্টেড SHA-256 হ্যাশ আকারে সংরক্ষিত থাকে এবং বারবার ভুল পিন দিলে স্বয়ংক্রিয় কুলডাউন চালু হয়।',
        },
        {
          heading: '৩. সার্ভার ও ডাটাবেস নিরাপত্তা',
          body: 'সকল এপিআই রিকোয়েস্টে সেশন ভেরিফিকেশন, রেট লিমিট, সিকিউরিটি হেডার এবং কঠোর ডাটাবেস রুলস কার্যকর রয়েছে।',
        },
      ],
    },
  },
};

export const LegalPolicyModal: React.FC<Props> = ({
  isOpen,
  initialTab = 'privacy',
  lang,
  isAuthenticated = false,
  acceptedVersion,
  onAcceptPolicy,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<PolicyTab>(initialTab);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const content = POLICY_COPY[lang][activeTab];
  const alreadyAccepted = acceptedVersion === CURRENT_POLICY_VERSION;

  const handleAccept = async () => {
    if (!onAcceptPolicy || accepting) return;
    setAccepting(true);
    try {
      await onAcceptPolicy();
      onClose();
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 14 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92dvh] flex flex-col mobile-sheet-safe"
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-0.5 shrink-0">
          <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onClose}
              aria-label={t(lang, 'backBtn')}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                {t(lang, 'legalSectionTitle')}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular truncate">
                {t(lang, 'policyEffectiveLabel')} v{CURRENT_POLICY_VERSION}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Policy Tabs */}
        <div className="px-4 sm:px-6 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
          {(
            [
              { id: 'privacy' as const, label: t(lang, 'privacyPolicyTitle'), Icon: Lock },
              { id: 'terms' as const, label: t(lang, 'termsOfServiceTitle'), Icon: Scale },
              { id: 'safety' as const, label: t(lang, 'safetyPolicyTitle'), Icon: ShieldAlert },
              { id: 'security' as const, label: t(lang, 'securityInfoTitle'), Icon: ShieldCheck },
            ] as const
          ).map((tab) => {
            const Icon = tab.Icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{content.title}</h3>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {content.subtitle}
            </p>
          </div>

          <div className="space-y-3">
            {content.sections.map((sec) => (
              <section
                key={sec.heading}
                className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5"
              >
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {sec.heading}
                </h4>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {sec.body}
                </p>
              </section>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <FileCheck2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              KothaLink Official · v{CURRENT_POLICY_VERSION}
              {alreadyAccepted ? ` · ${t(lang, 'policyAcceptedBadge')}` : ''}
            </span>
          </div>

          {isAuthenticated && onAcceptPolicy && !alreadyAccepted ? (
            <button
              type="button"
              disabled={accepting}
              onClick={() => void handleAccept()}
              className="min-h-[40px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Check className="w-4 h-4" />
              <span>{t(lang, 'acknowledgePolicyBtn')}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              OK
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};
