import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Droplets,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  Moon,
  RotateCcw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { formatFriendlyError, updateUserSettings } from '../lib/chatService';
import { t } from '../lib/i18n';
import { AppLanguage, AppTheme, UserPrivateInfo, UserPublicProfile } from '../types/chat';
import { UserAvatar } from './UserAvatar';

interface Props {
  isOpen: boolean;
  initialTab?: 'profile' | 'settings' | 'account';
  lang: AppLanguage;
  themeMode: AppTheme;
  glassBlur: number;
  glassSaturation: number;
  soundOn: boolean;
  notifPermission: NotificationPermission | 'unsupported';
  enterToSend: boolean;
  publicProfile: UserPublicProfile;
  privateInfo: UserPrivateInfo;
  onClose: () => void;
  onUpdated: (updates: {
    displayName: string;
    bio: string;
    language: AppLanguage;
    showOnlineStatus: boolean;
  }) => void;
  onChangeTheme: (mode: AppTheme) => void;
  onChangeGlassBlur: (blur: number) => void;
  onChangeGlassSaturation: (saturation: number) => void;
  onResetGlass: () => void;
  onToggleSound: () => void;
  onRequestBgNotifications: () => void;
  onToggleEnterToSend: (val: boolean) => void;
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
  glassBlur,
  glassSaturation,
  soundOn,
  notifPermission,
  enterToSend,
  publicProfile,
  privateInfo,
  onClose,
  onUpdated,
  onChangeTheme,
  onChangeGlassBlur,
  onChangeGlassSaturation,
  onResetGlass,
  onToggleSound,
  onRequestBgNotifications,
  onToggleEnterToSend,
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
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [error, setError] = useState('');
  const [glassTunerCollapsed, setGlassTunerCollapsed] = useState(false);
  const [isDraggingGlass, setIsDraggingGlass] = useState(false);
  const [glassLivePeek, setGlassLivePeek] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setGlassLivePeek(false);
      setIsDraggingGlass(false);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const isPreviewClear = activeTab === 'settings' && (isDraggingGlass || glassLivePeek);
  const isDefaultGlass = glassBlur === 14 && glassSaturation === 205;

  const bioPresets = selectedLang === 'bn' ? BIO_PRESETS_BN : BIO_PRESETS_EN;

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
      });
      onUpdated({
        displayName: displayName.trim() || publicProfile.displayName,
        bio: bio.trim(),
        language: selectedLang,
        showOnlineStatus,
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
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${
        isPreviewClear
          ? 'bg-black/5 backdrop-blur-none'
          : themeMode === 'glass'
          ? 'bg-slate-900/15 backdrop-blur-[2px]'
          : 'bg-black/55 backdrop-blur-sm'
      } ${activeTab === 'settings' && !glassTunerCollapsed ? 'pb-44 sm:pb-48' : ''}`}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{
          opacity: glassLivePeek && activeTab === 'settings' ? 0.14 : isDraggingGlass ? 0.45 : 1,
          scale: glassLivePeek && activeTab === 'settings' ? 0.97 : 1,
          y: 0,
        }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className={`w-full max-w-md bg-white dark:bg-slate-900 liquid-modal border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xl max-h-[82dvh] flex flex-col ${
          glassLivePeek && activeTab === 'settings' ? 'pointer-events-none' : ''
        }`}
      >
        {/* Header with Top-Left Back Button */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 liquid-divider flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onClose}
              aria-label={t(lang, 'backBtn')}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 liquid-control border border-transparent hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0 transition-colors"
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
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-950 liquid-control border border-slate-200 dark:border-slate-800">
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
                      transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                      className="absolute inset-0 rounded-lg bg-white dark:bg-slate-800 liquid-pill-active shadow-sm -z-10"
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
                  <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 liquid-control border border-slate-200 dark:border-slate-800">
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
                      className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 liquid-control border border-slate-200 dark:border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
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
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 liquid-control border border-slate-200 dark:border-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-600"
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
                        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-950 liquid-control rounded-xl border border-slate-200 dark:border-slate-800">
                          {(
                            [
                              { id: 'light' as const, label: t(lang, 'lightMode'), Icon: Sun },
                              { id: 'glass' as const, label: t(lang, 'glassMode'), Icon: Droplets },
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
                                className={`relative z-10 min-h-[38px] py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
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
                                        : 'bg-white dark:bg-slate-800 liquid-pill-active'
                                    }`}
                                  />
                                )}
                                <Icon className={`w-3.5 h-3.5 shrink-0 ${opt.id === 'glass' && active ? 'text-blue-600' : ''}`} />
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
                        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-950 liquid-control rounded-xl border border-slate-200 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => setSelectedLang('en')}
                            className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              selectedLang === 'en'
                                ? 'bg-white dark:bg-slate-800 liquid-pill-active text-slate-900 dark:text-white shadow-sm'
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
                                ? 'bg-white dark:bg-slate-800 liquid-pill-active text-slate-900 dark:text-white shadow-sm'
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

                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 liquid-control border border-slate-200 dark:border-slate-800 space-y-3.5">
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

                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 liquid-control border border-slate-200 dark:border-slate-800 space-y-3.5">
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

                      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 liquid-divider flex items-center justify-between gap-3">
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

                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    onClick={onSignOut}
                    className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 liquid-control hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-800 dark:text-slate-200 flex items-center justify-center gap-2 transition-colors"
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
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 liquid-surface liquid-divider flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 liquid-control text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
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

      {/* Floating Real-Time Liquid Glass Blur & Saturation Tuner (visible in Settings) */}
      <AnimatePresence>
        {activeTab === 'settings' && (
          <motion.div
            key="floating-glass-tuner"
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="fixed bottom-3 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-full sm:max-w-md z-[60] rounded-2xl bg-white/85 dark:bg-slate-900/90 liquid-modal border border-slate-200/90 dark:border-slate-700/80 shadow-[0_20px_54px_rgba(15,23,42,0.24)] backdrop-blur-2xl overflow-hidden"
          >
            {/* Floating Control Header */}
            <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 border-b border-slate-200/70 dark:border-slate-800/80 liquid-divider">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <Sparkles className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {t(lang, 'glassControlsTitle')}
                  </div>
                  <div className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 truncate">
                    {glassBlur}px · {glassSaturation}%
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {themeMode !== 'glass' ? (
                  <button
                    type="button"
                    onClick={() => onChangeTheme('glass')}
                    className="min-h-[34px] px-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold whitespace-nowrap transition-colors"
                  >
                    {t(lang, 'glassActivateBtn')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setGlassLivePeek((v) => !v)}
                    aria-pressed={glassLivePeek}
                    className={`min-h-[34px] px-2.5 rounded-xl text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition-colors ${
                      glassLivePeek
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 liquid-control border border-transparent text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {glassLivePeek ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{t(lang, 'glassPreviewPeek')}</span>
                  </button>
                )}

                {!isDefaultGlass && (
                  <button
                    type="button"
                    onClick={onResetGlass}
                    title={t(lang, 'glassResetBtn')}
                    aria-label={t(lang, 'glassResetBtn')}
                    className="min-h-[34px] min-w-[34px] px-2 rounded-xl bg-slate-100 dark:bg-slate-800 liquid-control border border-transparent hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-medium flex items-center justify-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setGlassTunerCollapsed((v) => !v)}
                  aria-label={glassTunerCollapsed ? 'Expand Glass controls' : 'Collapse Glass controls'}
                  className="min-h-[34px] min-w-[34px] rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors"
                >
                  {glassTunerCollapsed ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Sliders Body */}
            {!glassTunerCollapsed && (
              <div className="px-4 py-3 space-y-3">
                {themeMode !== 'glass' && (
                  <div className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                    {t(lang, 'glassSwitchHint')}
                  </div>
                )}

                {/* Blur Intensity Slider */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <label
                      htmlFor="glass-blur-slider"
                      className="font-medium text-slate-700 dark:text-slate-200"
                    >
                      {t(lang, 'glassBlurLabel')}
                    </label>
                    <span className="font-mono-tabular font-semibold text-blue-600 dark:text-blue-400">
                      {glassBlur}px
                    </span>
                  </div>
                  <input
                    id="glass-blur-slider"
                    type="range"
                    min={2}
                    max={48}
                    step={1}
                    value={glassBlur}
                    onPointerDown={() => setIsDraggingGlass(true)}
                    onPointerUp={() => setIsDraggingGlass(false)}
                    onPointerCancel={() => setIsDraggingGlass(false)}
                    onBlur={() => setIsDraggingGlass(false)}
                    onChange={(e) => {
                      if (themeMode !== 'glass') onChangeTheme('glass');
                      onChangeGlassBlur(Number(e.target.value));
                    }}
                    className="w-full glass-slider"
                  />
                </div>

                {/* Saturation Level Slider */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <label
                      htmlFor="glass-saturation-slider"
                      className="font-medium text-slate-700 dark:text-slate-200"
                    >
                      {t(lang, 'glassSaturationLabel')}
                    </label>
                    <span className="font-mono-tabular font-semibold text-blue-600 dark:text-blue-400">
                      {glassSaturation}%
                    </span>
                  </div>
                  <input
                    id="glass-saturation-slider"
                    type="range"
                    min={100}
                    max={260}
                    step={5}
                    value={glassSaturation}
                    onPointerDown={() => setIsDraggingGlass(true)}
                    onPointerUp={() => setIsDraggingGlass(false)}
                    onPointerCancel={() => setIsDraggingGlass(false)}
                    onBlur={() => setIsDraggingGlass(false)}
                    onChange={(e) => {
                      if (themeMode !== 'glass') onChangeTheme('glass');
                      onChangeGlassSaturation(Number(e.target.value));
                    }}
                    className="w-full glass-slider"
                  />
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
