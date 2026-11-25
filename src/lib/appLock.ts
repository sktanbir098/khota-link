import { sha256Hex } from './firebase';

export type AutoLockDelayMinutes = 0 | 1 | 5 | 15;

export interface AppLockConfig {
  enabled: boolean;
  salt: string;
  pinHash: string;
  autoLockMinutes: AutoLockDelayMinutes;
  failedAttempts: number;
  lockedUntilMs: number;
}

const STORAGE_PREFIX = 'kl_applock_v1_';
const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 30_000;

function generateRandomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function derivePinHash(uid: string, salt: string, pin: string): Promise<string> {
  return sha256Hex(`kl_pin_v1:${uid}:${salt}:${pin}`);
}

export function getAppLockConfig(uid: string): AppLockConfig | null {
  if (typeof window === 'undefined' || !uid) return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppLockConfig>;
    if (!parsed || !parsed.enabled || !parsed.salt || !parsed.pinHash) return null;
    const delay =
      parsed.autoLockMinutes === 0 ||
      parsed.autoLockMinutes === 1 ||
      parsed.autoLockMinutes === 5 ||
      parsed.autoLockMinutes === 15
        ? parsed.autoLockMinutes
        : 1;
    return {
      enabled: true,
      salt: parsed.salt,
      pinHash: parsed.pinHash,
      autoLockMinutes: delay,
      failedAttempts: typeof parsed.failedAttempts === 'number' ? parsed.failedAttempts : 0,
      lockedUntilMs: typeof parsed.lockedUntilMs === 'number' ? parsed.lockedUntilMs : 0,
    };
  } catch {
    return null;
  }
}

export function isAppLockEnabled(uid: string): boolean {
  return Boolean(getAppLockConfig(uid)?.enabled);
}

export async function enableAppLockPin(
  uid: string,
  pin: string,
  autoLockMinutes: AutoLockDelayMinutes = 1
): Promise<AppLockConfig> {
  if (!uid) throw new Error('User ID is required.');
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be exactly 4 digits.');
  }
  const salt = generateRandomSalt();
  const pinHash = await derivePinHash(uid, salt, pin);
  const config: AppLockConfig = {
    enabled: true,
    salt,
    pinHash,
    autoLockMinutes,
    failedAttempts: 0,
    lockedUntilMs: 0,
  };
  localStorage.setItem(`${STORAGE_PREFIX}${uid}`, JSON.stringify(config));
  return config;
}

export function updateAppLockDelay(uid: string, autoLockMinutes: AutoLockDelayMinutes): void {
  const existing = getAppLockConfig(uid);
  if (!existing) return;
  localStorage.setItem(
    `${STORAGE_PREFIX}${uid}`,
    JSON.stringify({ ...existing, autoLockMinutes })
  );
}

export function disableAppLockPin(uid: string): void {
  if (typeof window === 'undefined' || !uid) return;
  localStorage.removeItem(`${STORAGE_PREFIX}${uid}`);
}

export async function verifyAppLockPin(
  uid: string,
  pin: string
): Promise<{ ok: boolean; remainingWaitSec: number; failedAttempts: number }> {
  const config = getAppLockConfig(uid);
  if (!config) {
    return { ok: true, remainingWaitSec: 0, failedAttempts: 0 };
  }
  const now = Date.now();
  if (config.lockedUntilMs > now) {
    return {
      ok: false,
      remainingWaitSec: Math.ceil((config.lockedUntilMs - now) / 1000),
      failedAttempts: config.failedAttempts,
    };
  }
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, remainingWaitSec: 0, failedAttempts: config.failedAttempts };
  }

  const candidateHash = await derivePinHash(uid, config.salt, pin);
  if (candidateHash === config.pinHash) {
    localStorage.setItem(
      `${STORAGE_PREFIX}${uid}`,
      JSON.stringify({ ...config, failedAttempts: 0, lockedUntilMs: 0 })
    );
    return { ok: true, remainingWaitSec: 0, failedAttempts: 0 };
  }

  const nextAttempts = config.failedAttempts + 1;
  const shouldCooldown = nextAttempts >= MAX_ATTEMPTS_BEFORE_COOLDOWN;
  const lockedUntilMs = shouldCooldown ? now + COOLDOWN_MS : 0;
  localStorage.setItem(
    `${STORAGE_PREFIX}${uid}`,
    JSON.stringify({
      ...config,
      failedAttempts: shouldCooldown ? 0 : nextAttempts,
      lockedUntilMs,
    })
  );

  return {
    ok: false,
    remainingWaitSec: shouldCooldown ? Math.ceil(COOLDOWN_MS / 1000) : 0,
    failedAttempts: nextAttempts,
  };
}
