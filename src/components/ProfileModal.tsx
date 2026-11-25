import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Ban,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  CornerDownLeft,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Moon,
  Scale,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  AppLockConfig,
  AutoLockDelayMinutes,
  disableAppLockPin,
  enableAppLockPin,
  getAppLockConfig,
  updateAppLockDelay,
} from '../lib/appLock';
import { formatFriendlyError, updateUserSettings } from '../lib/chatService';
import { t } from '../lib/i18n';
import {
  AppLanguage,
  AppTheme,
  CURRENT_POLICY_VERSION,
  UserPrivateInfo,
  UserPublicProfile,
} from '../types/chat';
import { PolicyTab } from './LegalPolicyModal';
import { UserAvatar } from './UserAvatar';

interface Props {
  isOpen: boolean;
  initialTab?: 'profile' | 'settings' | 'account';
  lang: AppLanguage;
  themeMode: AppTheme;
  soundOn: boolean;
  notifPermission: NotificationPermission | 'unsupported';
  enterToSend: boolean;
  publicProfile: UserPublicProfile;
  privateInfo: UserPrivateInfo;
  peerProfiles: Record<string, UserPublicProfile>;
  onClose: () => void;
  onUpdated: (updates: {
    displayName: string;
    bio: string;
    language: AppLanguage;
    showOnlineStatus: boolean;
    searchable: boolean;
    readReceiptsEnabled: boolean;
  }) => void;
  onChangeTheme: (mode: AppTheme) => void;
  onToggleSound: () => void;
  onRequestBgNotifications: () => void;
  onToggleEnterToSend: (val: boolean) => void;
  onUnblockUser: (targetUid: string) => Promise<void>;
  onOpenLegalModal: (tab: PolicyTab) => void;
  onExportData: () => void;
  onLockAppNow: () => void;
  onAppLockChanged: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
}

const BIO_PRESETS_EN = [
  'Available on KothaLink',
  'Busy right now',
  'At work',
  'In a meeting',
  'Let’s chat!',
];

const BIO_PRESETS_BN = [
  'KothaLink-এ আছি',
  'এখন ব্যস্ত আছি',
  'কাজে আছি',
  'মিটিংয়ে আছি',
  'চলুন কথা বলি!',
];

interface AnimatedSwitchProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
}

const AnimatedSwitch: React.FC<AnimatedSwitchProps> = ({ checked, onToggle, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={onToggle}
    className={`relative w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
      checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
    }`}
  >
    <motion.span
      layout
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      className={`block w-5 h-5 rounded-full bg-white shadow-sm ${
        checked ? 'ml-auto' : 'mr-auto'
      }`}
    />
  </button>
);

export const ProfileModal: React.FC<Props> = ({
  isOpen,
  initialTab = 'profile',
  lang,
  themeMode,
  soundOn,
  notifPermission,
  enterToSend,
  publicProfile,
  privateInfo,
  peerProfiles,
  onClose,
  onUpdated,
  onChangeTheme,
  onToggleSound,
  onRequestBgNotifications,
  onToggleEnterToSend,
  onUnblockUser,
  onOpenLegalModal,
  onExportData,
  onLockAppNow,
  onAppLockChanged,
  onSignOut,
  onDeleteAccount,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'settings' | 'account'>(initialTab);
  const [displayName, setDisplayName] = useState(publicProfile.displayName);
  const [bio, setBio] = useState(publicProfile.bio || '');
  const [selectedLang, setSelectedLang] = useState<AppLanguage>(lang);
  const [showOnlineStatus, setShowOnlineStatus] = useState<boolean>(
    publicProfile.showOnlineStatus !== false
  );
  const [searchable, setSearchable] = useState<boolean>(
    publicProfile.searchable !== false
  );
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState<boolean>(
    privateInfo.readReceiptsEnabled !== false
  );
  const [appLockConfig, setAppLockConfig] = useState<AppLockConfig | null>(() =>
    getAppLockConfig(publicProfile.uid)
  );
  const [showPinEditor, setShowPinEditor] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError, setPinError] = useState('');
  const [autoLockMinutes, setAutoLockMinutes] = useState<AutoLockDelayMinutes>(
    () => getAppLockConfig(publicProfile.uid)?.autoLockMinutes ?? 1
  );
  const [unblockingUid, setUnblockingUid] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      const cfg = getAppLockConfig(publicProfile.uid);
      setAppLockConfig(cfg);
      setAutoLockMinutes(cfg?.autoLockMinutes ?? 1);
      setShowPinEditor(false);
      setPinDraft('');
      setPinError('');
    }
  }, [isOpen, initialTab, publicProfile.uid]);

  if (!isOpen) return null;

  const bioPresets = selectedLang === 'bn' ? BIO_PRESETS_BN : BIO_PRESETS_EN;
  const blockedUids = privateInfo.blockedUids || [];

  const handleSavePin = async () => {
    if (!/^\d{4}$/.test(pinDraft)) {
      setPinError(lang === 'bn' ? 'অবশ্যই ৪টি সংখ্যা (0-9) দিন।' : 'Please enter exactly 4 digits (0-9).');
      return;
    }
    setPinError('');
    setPinSaving(true);
    try {
      const next = await enableAppLockPin(publicProfile.uid, pinDraft, autoLockMinutes);
      setAppLockConfig(next);
      setShowPinEditor(false);
      setPinDraft('');
      onAppLockChanged();
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Failed to save PIN.');
    } finally {
      setPinSaving(false);
    }
  };

  const handleDisablePin = () => {
    disableAppLockPin(publicProfile.uid);
    setAppLockConfig(null);
    setShowPinEditor(false);
    setPinDraft('');
    setPinError('');
    onAppLockChanged();
  };

  const handleDelayChange = (delay: AutoLockDelayMinutes) => {
    setAutoLockMinutes(delay);
    if (appLockConfig?.enabled) {
      updateAppLockDelay(publicProfile.uid, delay);
      setAppLockConfig(getAppLockConfig(publicProfile.uid));
      onAppLockChanged();
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await updateUserSettings({
        uid: publicProfile.uid,
        email: privateInfo.email,
        displayName,
        bio,
        photoUrl: publicProfile.photoUrl,
        language: selectedLang,
        showOnlineStatus,
        searchable,
        readReceiptsEnabled,
      });
      onUpdated({
        displayName: displayName.trim() || publicProfile.displayName,
        bio: bio.trim(),
        language: selectedLang,
        showOnlineStatus,
        searchable,
        readReceiptsEnabled,
      });
      setSavedToast(true);
      window.setTimeout(() => {
        setSavedToast(false);
        onClose();
      }, 420);
    } catch (err) {
      setError(formatFriendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccountClick = async () => {
    if (!confirmDeleteAccount) {
      setConfirmDeleteAccount(true);
      return;
    }
    setError('');
    setDeletingAccount(true);
    try {
      await onDeleteAccount();
      onClose();
    } catch (err) {
      setError(formatFriendlyError(err));
      setDeletingAccount(false);
    }
  };

  const tabs = [
    { id: 'profile' as const, label: t(lang, 'profileTab'), icon: User },
    { id: 'settings' as const, label: t(lang, 'settingsTab'), icon: SlidersHorizontal },
    { id: 'account' as const, label: t(lang, 'accountTab'), icon: Settings },
  ];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 transition-opacity duration-150"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 14 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[90dvh] sm:max-h-[85dvh] flex flex-col mobile-sheet-safe"
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-0.5 shrink-0">
          <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>
        {/* Header with Top-Left Back Button */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onClose}
              aria-label={t(lang, 'backBtn')}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 border border-transparent hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
              {t(lang, 'profileSettings')}
            </h2>
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

        {/* Animated 3-Tab Switcher */}
        <div className="px-6 pt-4 shrink-0">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative min-h-[38px] px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap z-10 ${
                    active
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="profileModalTabIndicator"
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 rounded-lg bg-white dark:bg-slate-800 shadow-sm -z-10"
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <AnimatePresence mode="wait">
              {activeTab === 'profile' && (
                <motion.div
                  key="tab-profile"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-4"
                >
                  {/* Profile Avatar & Bio Card */}
                  <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <UserAvatar
                      name={displayName.trim() || publicProfile.displayName}
                      photoUrl={publicProfile.photoUrl}
                      size="lg"
                      isOnline={showOnlineStatus}
                      ringColorClass="ring-white dark:ring-slate-950"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {displayName.trim() || publicProfile.displayName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {privateInfo.email}
                      </div>
                      <div className="text-xs text-blue-600 dark:text-blue-400 truncate mt-0.5 font-medium">
                        {bio.trim() || t(lang, 'noBioYet')}
                      </div>
                    </div>
                  </div>

                  {/* Display Name */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                      {t(lang, 'displayNameLabel')}
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  {/* Bio / About with Quick Presets */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                        {t(lang, 'bioLabel')}
                      </label>
                      <span className="text-[11px] text-slate-400 font-mono-tabular">
                        {bio.length}/160
                      </span>
                    </div>
                    <textarea
                      rows={2}
                      maxLength={160}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder={t(lang, 'bioPlaceholder')}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <div className="space-y-1">
                      <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {t(lang, 'bioPresetsLabel')}:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {bioPresets.map((preset) => (
                          <motion.button
                            key={preset}
                            type="button"
                            whileTap={{ scale: 0.94 }}
                            onClick={() => setBio(preset)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                              bio === preset
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-blue-500'
                            }`}
                          >
                            {preset}
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'settings' && (
                <motion.div
                  key="tab-settings"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-5"
                >
                  {/* Appearance & Language */}
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {t(lang, 'appearanceSection')}
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                          {t(lang, 'themeLabel')}
                        </label>
                        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                          {(
                            [
                              { id: 'light' as const, label: t(lang, 'lightMode'), Icon: Sun },
                              { id: 'dark' as const, label: t(lang, 'darkMode'), Icon: Moon },
                            ] as const
                          ).map((opt) => {
                            const active = themeMode === opt.id;
                            const Icon = opt.Icon;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => onChangeTheme(opt.id)}
                                className={`relative z-10 min-h-[38px] py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                                  active
                                    ? opt.id === 'dark'
                                      ? 'text-white'
                                      : 'text-slate-900 dark:text-white'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                              >
                                {active && (
                                  <motion.span
                                    layoutId="profileThemeIndicator"
                                    transition={{ type: 'spring', stiffness: 460, damping: 32 }}
                                    className={`absolute inset-0 rounded-lg -z-10 shadow-sm ${
                                      opt.id === 'dark'
                                        ? 'bg-slate-800'
                                        : 'bg-white dark:bg-slate-800'
                                    }`}
                                  />
                                )}
                                <Icon className={`w-3.5 h-3.5 shrink-0 ${opt.id === 'light' && active ? 'text-amber-500' : ''}`} />
                                <span>{opt.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                          {t(lang, 'languageLabel')}
                        </label>
                        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => setSelectedLang('en')}
                            className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              selectedLang === 'en'
                                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            EN
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedLang('bn')}
                            className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              selectedLang === 'bn'
                                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            বাংলা
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sound & Alerts */}
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {t(lang, 'notificationsSection')}
                    </div>

                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {soundOn ? (
                            <Volume2 className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                          ) : (
                            <VolumeX className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                              {t(lang, 'soundSettingLabel')}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {t(lang, 'soundSettingHint')}
                            </div>
                          </div>
                        </div>
                        <AnimatedSwitch
                          checked={soundOn}
                          onToggle={onToggleSound}
                          label={t(lang, 'soundSettingLabel')}
                        />
                      </div>

                      {notifPermission !== 'unsupported' && (
                        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0">
                            {notifPermission === 'granted' ? (
                              <BellRing className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                            ) : (
                              <Bell className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                {t(lang, 'alertsSettingLabel')}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {notifPermission === 'granted'
                                  ? t(lang, 'bgAlertsActive')
                                  : notifPermission === 'denied'
                                  ? t(lang, 'bgAlertsBlocked')
                                  : t(lang, 'enableBgAlerts')}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={notifPermission === 'granted' || notifPermission === 'denied'}
                            onClick={onRequestBgNotifications}
                            className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                              notifPermission === 'granted'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                : notifPermission === 'denied'
                                ? 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                          >
                            {notifPermission === 'granted'
                              ? t(lang, 'alertsActiveBtn')
                              : notifPermission === 'denied'
                              ? t(lang, 'alertsBlockedBtn')
                              : t(lang, 'enableAlertsBtn')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Privacy & Chat Behavior */}
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {t(lang, 'privacySection')}
                    </div>

                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {showOnlineStatus ? (
                            <Eye className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                          ) : (
                            <EyeOff className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                              {t(lang, 'showOnlineLabel')}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {t(lang, 'showOnlineHint')}
                            </div>
                          </div>
                        </div>
                        <AnimatedSwitch
                          checked={showOnlineStatus}
                          onToggle={() => setShowOnlineStatus((v) => !v)}
                          label={t(lang, 'showOnlineLabel')}
                        />
                      </div>

                      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <CheckCheck
                            className={`w-4 h-4 mt-0.5 shrink-0 ${
                              readReceiptsEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                              {t(lang, 'readReceiptsLabel')}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {t(lang, 'readReceiptsHint')}
                            </div>
                          </div>
                        </div>
                        <AnimatedSwitch
                          checked={readReceiptsEnabled}
                          onToggle={() => setReadReceiptsEnabled((v) => !v)}
                          label={t(lang, 'readReceiptsLabel')}
                        />
                      </div>

                      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <Search
                            className={`w-4 h-4 mt-0.5 shrink-0 ${
                              searchable ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                              {t(lang, 'searchableLabel')}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {t(lang, 'searchableHint')}
                            </div>
                          </div>
                        </div>
                        <AnimatedSwitch
                          checked={searchable}
                          onToggle={() => setSearchable((v) => !v)}
                          label={t(lang, 'searchableLabel')}
                        />
                      </div>

                      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <CornerDownLeft className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                              {t(lang, 'enterToSendLabel')}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {t(lang, 'enterToSendHint')}
                            </div>
                          </div>
                        </div>
                        <AnimatedSwitch
                          checked={enterToSend}
                          onToggle={() => onToggleEnterToSend(!enterToSend)}
                          label={t(lang, 'enterToSendLabel')}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Security & App Lock (4-Digit PIN) */}
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {t(lang, 'securitySectionTitle')}
                    </div>

                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <KeyRound
                            className={`w-4 h-4 mt-0.5 shrink-0 ${
                              appLockConfig?.enabled
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-400'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                              {t(lang, 'appLockLabel')}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {t(lang, 'appLockHint')}
                            </div>
                          </div>
                        </div>
                        {!showPinEditor && !appLockConfig?.enabled && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowPinEditor(true);
                              setPinError('');
                            }}
                            className="min-h-[34px] px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
                          >
                            {t(lang, 'appLockSetBtn')}
                          </button>
                        )}
                      </div>

                      {appLockConfig?.enabled && !showPinEditor && (
                        <div className="space-y-2.5 pt-2.5 border-t border-slate-200 dark:border-slate-800">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onLockAppNow();
                              }}
                              className="min-h-[36px] px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>{t(lang, 'appLockNowBtn')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowPinEditor(true);
                                setPinDraft('');
                                setPinError('');
                              }}
                              className="min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold whitespace-nowrap"
                            >
                              {t(lang, 'appLockChangeBtn')}
                            </button>
                            <button
                              type="button"
                              onClick={handleDisablePin}
                              className="min-h-[36px] px-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 text-xs font-semibold whitespace-nowrap"
                            >
                              {t(lang, 'appLockDisableBtn')}
                            </button>
                          </div>

                          <div className="space-y-1.5">
                            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              {t(lang, 'appLockAutoDelayLabel')}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                              {(
                                [
                                  { val: 0 as const, key: 'autoLockImmediate' },
                                  { val: 1 as const, key: 'autoLock1m' },
                                  { val: 5 as const, key: 'autoLock5m' },
                                  { val: 15 as const, key: 'autoLock15m' },
                                ] as const
                              ).map((opt) => (
                                <button
                                  key={opt.val}
                                  type="button"
                                  onClick={() => handleDelayChange(opt.val)}
                                  className={`min-h-[34px] px-2 rounded-lg text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                                    autoLockMinutes === opt.val
                                      ? 'bg-blue-600 text-white border-blue-600'
                                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  {t(lang, opt.key)}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {showPinEditor && (
                        <div className="space-y-2.5 pt-2.5 border-t border-slate-200 dark:border-slate-800">
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {t(lang, 'enterNewPinTitle')}
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              inputMode="numeric"
                              maxLength={4}
                              value={pinDraft}
                              onChange={(e) => {
                                setPinDraft(e.target.value.replace(/\D/g, '').slice(0, 4));
                                setPinError('');
                              }}
                              placeholder={t(lang, 'confirmNewPinPlaceholder')}
                              className="flex-1 min-w-0 min-h-[40px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-mono-tabular tracking-widest text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                            />
                            <button
                              type="button"
                              disabled={pinSaving || pinDraft.length !== 4}
                              onClick={() => void handleSavePin()}
                              className="min-h-[40px] px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                            >
                              {pinSaving ? t(lang, 'saving') : t(lang, 'savePinBtn')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowPinEditor(false);
                                setPinDraft('');
                                setPinError('');
                              }}
                              className="min-h-[40px] px-2.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400"
                            >
                              {t(lang, 'cancel')}
                            </button>
                          </div>
                          {pinError && (
                            <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
                              {pinError}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Blocked Contacts */}
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {t(lang, 'blockedUsersTitle')}
                    </div>

                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                      {blockedUids.length === 0 ? (
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <Ban className="w-4 h-4 shrink-0 text-slate-400" />
                          <span>{t(lang, 'noBlockedUsers')}</span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {blockedUids.map((bUid) => {
                            const prof = peerProfiles[bUid];
                            return (
                              <div
                                key={bUid}
                                className="flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <UserAvatar
                                    name={prof?.displayName || 'User'}
                                    photoUrl={prof?.photoUrl}
                                    size="sm"
                                    ringColorClass="ring-white dark:ring-slate-900"
                                  />
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                      {prof?.displayName || `${bUid.slice(0, 10)}...`}
                                    </div>
                                    {prof?.maskedEmail && (
                                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-mono-tabular">
                                        {prof.maskedEmail}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={unblockingUid === bUid}
                                  onClick={async () => {
                                    setUnblockingUid(bUid);
                                    try {
                                      await onUnblockUser(bUid);
                                    } finally {
                                      setUnblockingUid(null);
                                    }
                                  }}
                                  className="min-h-[34px] px-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
                                >
                                  {unblockingUid === bUid ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    t(lang, 'unblockUserBtn')
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Legal & Policies */}
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {t(lang, 'legalSectionTitle')}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { id: 'privacy' as const, label: t(lang, 'privacyPolicyTitle'), Icon: ShieldCheck },
                          { id: 'terms' as const, label: t(lang, 'termsOfServiceTitle'), Icon: Scale },
                          { id: 'safety' as const, label: t(lang, 'safetyPolicyTitle'), Icon: ShieldAlert },
                          { id: 'security' as const, label: t(lang, 'securityInfoTitle'), Icon: Lock },
                        ] as const
                      ).map((item) => {
                        const Icon = item.Icon;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => onOpenLegalModal(item.id)}
                            className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 text-left flex items-center gap-2 transition-colors"
                          >
                            <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight line-clamp-2">
                              {item.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'account' && (
                <motion.div
                  key="tab-account"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-4"
                >
                  <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    <div className="space-y-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {privateInfo.email}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {t(lang, 'unifiedChatNote')}
                      </p>
                    </div>
                  </div>

                  {/* Account Security Status & Policy Compliance */}
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {t(lang, 'securityStatusCardTitle')}
                      </span>
                      <button
                        type="button"
                        onClick={() => onOpenLegalModal('security')}
                        className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                      >
                        <FileCheck2 className="w-3.5 h-3.5" />
                        <span>v{CURRENT_POLICY_VERSION}</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
                        <Check className="w-3.5 h-3.5" />
                        {t(lang, 'verifiedGoogleBadge')}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/12 text-blue-700 dark:text-blue-400">
                        <Lock className="w-3.5 h-3.5" />
                        {t(lang, 'strictIsolationBadge')}
                      </span>
                      {privateInfo.acceptedPolicyVersion === CURRENT_POLICY_VERSION && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          <FileCheck2 className="w-3.5 h-3.5" />
                          {t(lang, 'policyAcceptedBadge')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Export My Data (JSON) */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {t(lang, 'exportDataBtn')}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {t(lang, 'exportDataHint')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onExportData}
                      className="min-h-[38px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>JSON</span>
                    </button>
                  </div>

                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    onClick={onSignOut}
                    className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-800 dark:text-slate-200 flex items-center justify-center gap-2 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    {t(lang, 'signOut')}
                  </motion.button>

                  {/* Delete Account Danger Zone */}
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    {confirmDeleteAccount ? (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 space-y-3"
                      >
                        <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
                          {t(lang, 'deleteAccountWarn')}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={deletingAccount}
                            onClick={() => setConfirmDeleteAccount(false)}
                            className="min-h-[38px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300"
                          >
                            {t(lang, 'cancel')}
                          </button>
                          <button
                            type="button"
                            disabled={deletingAccount}
                            onClick={handleDeleteAccountClick}
                            className="flex-1 min-h-[38px] px-3 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                          >
                            {deletingAccount ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                            {deletingAccount ? t(lang, 'deletingAccount') : t(lang, 'confirmDeleteAccount')}
                          </button>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.98 }}
                        onClick={handleDeleteAccountClick}
                        className="w-full min-h-[44px] px-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 text-xs font-semibold text-red-600 dark:text-red-400 flex items-center justify-center gap-2 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        {t(lang, 'deleteAccount')}
                      </motion.button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
          </div>

          {/* Sticky Footer Save Action */}
          {activeTab !== 'account' && (
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {t(lang, 'cancel')}
              </button>
              <motion.button
                type="submit"
                whileTap={{ scale: 0.97 }}
                disabled={saving || deletingAccount}
                className="min-h-[42px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                {savedToast ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{t(lang, 'copied').replace('!', '')}</span>
                  </>
                ) : saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t(lang, 'saving')}</span>
                  </>
                ) : (
                  <span>{t(lang, 'saveProfile')}</span>
                )}
              </motion.button>
            </div>
          )}
        </form>
      </motion.div>
    </div>
  );
};
