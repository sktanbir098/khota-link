import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore, initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const firestoreDatabaseId =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-2cdc5e94-3259-4c61-9dd7-75f694782264';

function createFirestoreInstance() {
  try {
    return initializeFirestore(
      app,
      { experimentalAutoDetectLongPolling: true },
      firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firestoreDatabaseId);
  }
}

export const db = createFirestoreInstance();
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

export function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  return {
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
}

export function logFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo = logFirestoreError(error, operationType, path);
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

export function normalizePhone(rawPhone: string, defaultCountryCode = '+91'): string {
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
  if (defaultCountryCode === '+91' && digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
    return '+' + digits;
  }
  if (defaultCountryCode === '+880' && digits.length === 13 && digits.startsWith('880')) {
    return '+' + digits;
  }
  // Handle local leading 0 (e.g. India 09876... or Bangladesh 017...)
  if (digits.startsWith('0') && defaultCountryCode) {
    return defaultCountryCode + digits.slice(1);
  }
  return defaultCountryCode + digits;
}

export function isValidIndianMobile(e164Phone: string): boolean {
  return /^\+91[6-9]\d{9}$/.test(e164Phone);
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'Gmail user';
  const visible = user.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, Math.min(5, user.length - 2)))}@${domain}`;
}

export function resolvePeerMaskedHint(params: {
  targetHint?: string;
  channel?: string;
  peerMaskedEmail?: string;
  peerEmail?: string;
  viewerEmail?: string;
  lang?: 'en' | 'bn';
}): string {
  const cleanPeerEmail = (params.peerEmail || '').trim().toLowerCase();
  if (cleanPeerEmail && cleanPeerEmail.includes('@')) {
    return maskEmail(cleanPeerEmail);
  }
  if (params.peerMaskedEmail && params.peerMaskedEmail.trim()) {
    return params.peerMaskedEmail.trim();
  }
  const rawHint = (params.targetHint || '').trim();
  const cleanViewerEmail = (params.viewerEmail || '').trim().toLowerCase();
  const viewerMasked =
    cleanViewerEmail && cleanViewerEmail.includes('@') ? maskEmail(cleanViewerEmail) : '';
  if (rawHint && rawHint !== viewerMasked) {
    return rawHint;
  }
  if (params.channel === 'gmail') {
    return params.lang === 'bn'
      ? 'অফলাইন Gmail ইউজার (পরবর্তী লগইনে অটো সিঙ্ক হবে)'
      : 'Offline Gmail user (syncs on next login)';
  }
  if (params.channel === 'phone') return 'Invite Code Chat';
  return 'Direct Encrypted Room';
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

// --- Google Workspace Gmail Send Integration (Client-Side In-Memory Token Only) ---
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

// Kept strictly in memory (never localStorage/sessionStorage) per security requirements
let cachedGmailAccessToken: string | null = null;

export function clearGmailAccessToken(): void {
  cachedGmailAccessToken = null;
}

export function hasGmailAccessToken(): boolean {
  return Boolean(cachedGmailAccessToken);
}

export function captureGmailTokenFromCredential(
  credential: { accessToken?: string } | null | undefined
): void {
  if (credential?.accessToken) {
    cachedGmailAccessToken = credential.accessToken;
  }
}

export async function authorizeGmailSend(): Promise<string> {
  if (cachedGmailAccessToken) {
    return cachedGmailAccessToken;
  }
  const provider = new GoogleAuthProvider();
  provider.addScope(GMAIL_SEND_SCOPE);
  provider.setCustomParameters({ prompt: 'select_account consent' });
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Gmail send permission from Google.');
    }
    cachedGmailAccessToken = credential.accessToken;
    return cachedGmailAccessToken;
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (code === 'auth/popup-closed-by-user' || rawMsg.includes('popup-closed-by-user')) {
      throw new Error('Google permission popup was closed before completing.');
    }
    if (
      code === 'auth/access-denied' ||
      rawMsg.includes('access_denied') ||
      rawMsg.includes('redirect_uri_mismatch') ||
      rawMsg.includes('invalid_request')
    ) {
      throw new Error(
        'Google blocked Gmail API permission because this Gmail is not listed as an OAuth Test User yet. Use "Open in Gmail" below to send immediately.'
      );
    }
    throw err;
  }
}

function toBase64UrlUtf8(input: string): string {
  const bytes = utf8Encoder.encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeRfc2047Header(text: string): string {
  const bytes = utf8Encoder.encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

export function buildGmailAlertContent(params: {
  senderName: string;
  messagePreview: string;
  appUrl: string;
  isBangla?: boolean;
}): { subject: string; body: string } {
  const subject = params.isBangla
    ? `KothaLink: ${params.senderName} আপনাকে মেসেজ করেছেন`
    : `KothaLink: ${params.senderName} sent you a message`;

  const snippet = params.messagePreview.trim()
    ? params.messagePreview.trim().slice(0, 220)
    : params.isBangla
    ? 'নতুন মেসেজ বা ফাইল পাঠিয়েছেন'
    : 'Sent you a new message';

  const bodyLines = params.isBangla
    ? [
        `হ্যালো,`,
        ``,
        `${params.senderName} KothaLink অ্যাপে আপনাকে একটি মেসেজ করেছেন (আপনি অফলাইনে থাকায় এই অ্যালার্ট পাঠানো হয়েছে):`,
        ``,
        `"${snippet}"`,
        ``,
        `চ্যাটে জয়েন করতে ও রিপ্লাই দিতে নিচের অফিশিয়াল KothaLink লিংকে ক্লিক করুন:`,
        params.appUrl,
        ``,
        `— KothaLink Official`,
      ]
    : [
        `Hi there,`,
        ``,
        `${params.senderName} sent you a message on KothaLink while you were offline:`,
        ``,
        `"${snippet}"`,
        ``,
        `Join Chat & Reply directly in KothaLink:`,
        params.appUrl,
        ``,
        `— KothaLink Official`,
      ];

  return { subject, body: bodyLines.join('\r\n') };
}

export function buildGmailWebComposeUrl(params: {
  to: string;
  senderName: string;
  messagePreview: string;
  appUrl: string;
  isBangla?: boolean;
}): string {
  const { subject, body } = buildGmailAlertContent(params);
  const query = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: params.to.trim(),
    su: subject,
    body: body.replace(/\r\n/g, '\n'),
  });
  return `https://mail.google.com/mail/?${query.toString()}`;
}

export function getApiBaseUrl(): string {
  const raw = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL || '';
  return raw.trim().replace(/\/+$/, '');
}

export async function sendGmailAlertEmail(params: {
  to: string;
  senderName: string;
  senderEmail?: string;
  messagePreview: string;
  appUrl: string;
  isBangla?: boolean;
}): Promise<{ mode: 'official' | 'gmail-oauth' }> {
  const toEmail = params.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    throw new Error('Please enter a valid Gmail address for this recipient.');
  }

  // 1. Try 1-click Official Server / Netlify Function Alert Mailer first
  if (auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const apiBase = getApiBaseUrl();
      const apiRes = await fetch(`${apiBase}/api/send-offline-alert`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: toEmail,
          senderName: params.senderName,
          messagePreview: params.messagePreview,
          chatUrl: params.appUrl,
          isBangla: Boolean(params.isBangla),
        }),
      });
      if (apiRes.ok) {
        return { mode: 'official' };
      }
      const apiJson = (await apiRes.json().catch(() => ({}))) as {
        configured?: boolean;
        error?: string;
      };
      // If server mailer IS configured but failed for another reason (e.g. bad recipient), surface it
      if (apiJson.configured === true && apiRes.status >= 400 && apiRes.status !== 404) {
        throw new Error(apiJson.error || 'Unable to send official email alert.');
      }
      // If configured === false or 404 (static Netlify Drop), fall through to client Gmail API below
    } catch (err) {
      if (
        err instanceof Error &&
        err.message &&
        !err.message.includes('Failed to fetch') &&
        !err.message.includes('NetworkError') &&
        !err.message.includes('not configured')
      ) {
        // Re-throw explicit server error when server was reached and configured
        if (err.message.includes('Invalid recipient') || err.message.includes('Unable to send official')) {
          throw err;
        }
      }
    }
  }

  // 2. Fallback: Client-side Google Workspace Gmail API
  let token = await authorizeGmailSend();

  const { subject, body } = buildGmailAlertContent(params);

  const headers = [
    `To: ${toEmail}`,
    ...(params.senderEmail ? [`Reply-To: ${params.senderEmail}`] : []),
    `Subject: ${encodeRfc2047Header(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ];

  const raw = toBase64UrlUtf8(headers.join('\r\n'));

  let res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (res.status === 401 || res.status === 403) {
    cachedGmailAccessToken = null;
    token = await authorizeGmailSend();
    res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg =
      (errBody as { error?: { message?: string } })?.error?.message ||
      `Gmail send failed (HTTP ${res.status}).`;
    throw new Error(msg);
  }

  return { mode: 'gmail-oauth' };
}

