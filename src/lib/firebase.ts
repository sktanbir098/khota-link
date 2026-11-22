import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration: the client is offline.');
    }
  }
}

testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(rawPhone: string, defaultCountryCode = '+880'): string {
  const cleaned = rawPhone.replace(/[\s\-().]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) {
    return '+' + cleaned.slice(1).replace(/\D/g, '');
  }
  if (cleaned.startsWith('00')) {
    return '+' + cleaned.slice(2).replace(/\D/g, '');
  }
  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return '';
  // Handle local leading 0 (e.g. Bangladesh 017... with +880)
  if (digits.startsWith('0') && defaultCountryCode) {
    return defaultCountryCode + digits.slice(1);
  }
  return defaultCountryCode + digits;
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'Gmail user';
  const visible = user.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, Math.min(5, user.length - 2)))}@${domain}`;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 4)} ••• ${phone.slice(-4)}`;
}

const utf8Encoder = new TextEncoder();

export function sanitizeStr(value: string, maxBytes: number): string {
  const trimmed = value.trim();
  if (!trimmed || maxBytes <= 0) return '';
  if (utf8Encoder.encode(trimmed).length <= maxBytes) return trimmed;

  let out = '';
  let usedBytes = 0;
  for (const ch of Array.from(trimmed)) {
    const chBytes = utf8Encoder.encode(ch).length;
    if (usedBytes + chBytes > maxBytes) break;
    out += ch;
    usedBytes += chBytes;
  }
  return out.trimEnd();
}
