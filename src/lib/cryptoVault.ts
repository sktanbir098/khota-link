// Real Web Crypto AES-256-GCM Local Vault & E2EE Encryption Helpers (Zero hardcoded secrets)

const IDB_NAME = 'looply_crypto_keystore';
const IDB_STORE = 'keys';
const DEVICE_KEY_ID = 'device_vault_aes256_v1';

interface EncryptedEnvelopeV1 {
  v: 1;
  iv: string;
  ct: string;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function openKeystoreDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let inMemoryFallbackKey: CryptoKey | null = null;
let keyPromise: Promise<CryptoKey | null> | null = null;

async function loadOrCreateDeviceKey(): Promise<CryptoKey | null> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    return null;
  }

  const db = await openKeystoreDb();
  if (db) {
    try {
      const existing = await new Promise<CryptoKey | null>((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const getReq = store.get(DEVICE_KEY_ID);
        getReq.onsuccess = () => {
          const val = getReq.result;
          resolve(val instanceof CryptoKey ? val : null);
        };
        getReq.onerror = () => resolve(null);
      });
      if (existing) {
        db.close();
        return existing;
      }
    } catch {
      // Proceed to generate a fresh non-extractable AES-256-GCM key
    }
  }

  try {
    const generated = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const store = tx.objectStore(IDB_STORE);
          const putReq = store.put(generated, DEVICE_KEY_ID);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
      db.close();
    } else {
      inMemoryFallbackKey = generated;
    }
    return generated;
  } catch {
    db?.close();
    return inMemoryFallbackKey;
  }
}

function getDeviceVaultKey(): Promise<CryptoKey | null> {
  if (!keyPromise) {
    keyPromise = loadOrCreateDeviceKey().then((k) => {
      if (!k) keyPromise = null;
      return k;
    });
  }
  return keyPromise;
}

export function isWebCryptoVaultAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.crypto?.subtle);
}

export async function encryptVaultJson(storageKey: string, value: unknown): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const key = await getDeviceVaultKey();
    if (!key) return false;

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = utf8Encoder.encode(JSON.stringify(value));
    const cipherBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );

    const envelope: EncryptedEnvelopeV1 = {
      v: 1,
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(cipherBuffer)),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export async function decryptVaultJson<T>(
  storageKey: string,
  legacyPlaintextKey?: string
): Promise<T | null> {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<EncryptedEnvelopeV1>;
      if (parsed && parsed.v === 1 && typeof parsed.iv === 'string' && typeof parsed.ct === 'string') {
        const key = await getDeviceVaultKey();
        if (key) {
          const iv = base64ToBytes(parsed.iv);
          const ct = base64ToBytes(parsed.ct);
          const plainBuffer = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv as BufferSource },
            key,
            ct as BufferSource
          );
          const decoded = utf8Decoder.decode(plainBuffer);
          return JSON.parse(decoded) as T;
        }
      }
    }
  } catch {
    // Key rotated or corrupted cipher; fall through safely
  }

  // Automatic one-time migration from legacy plaintext localStorage keys, then scrub plaintext
  if (legacyPlaintextKey) {
    try {
      const legacyRaw = window.localStorage.getItem(legacyPlaintextKey);
      if (legacyRaw) {
        const parsedLegacy = JSON.parse(legacyRaw) as T;
        await encryptVaultJson(storageKey, parsedLegacy);
        window.localStorage.removeItem(legacyPlaintextKey);
        return parsedLegacy;
      }
    } catch {
      window.localStorage.removeItem(legacyPlaintextKey);
    }
  }

  return null;
}

export function wipeVaultKey(storageKey: string, legacyPlaintextKey?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey);
    if (legacyPlaintextKey) {
      window.localStorage.removeItem(legacyPlaintextKey);
    }
  } catch {
    // Ignore storage removal errors
  }
}

// PBKDF2-SHA256 + AES-256-GCM envelope helpers for passphrase-protected E2EE payloads
async function derivePassphraseAesKey(
  passphrase: string,
  salt: Uint8Array,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    utf8Encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

export async function encryptWithPassphrase(plainText: string, passphrase: string): Promise<string> {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await derivePassphraseAesKey(passphrase, salt, ['encrypt']);
  const ctBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    utf8Encoder.encode(plainText)
  );
  return `ENC1:${bytesToBase64(salt)}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ctBuf))}`;
}

export async function decryptWithPassphrase(payload: string, passphrase: string): Promise<string> {
  if (!payload.startsWith('ENC1:')) return payload;
  const parts = payload.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted payload format.');
  const salt = base64ToBytes(parts[1]);
  const iv = base64ToBytes(parts[2]);
  const ct = base64ToBytes(parts[3]);
  const aesKey = await derivePassphraseAesKey(passphrase, salt, ['decrypt']);
  const plainBuf = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aesKey,
    ct as BufferSource
  );
  return utf8Decoder.decode(plainBuf);
}
