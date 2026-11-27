import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { WebSocket, WebSocketServer } from 'ws';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_MODELS = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

const ROLE_INSTRUCTIONS: Record<string, string> = {
  assistant:
    'You are LoopLy Gemini AI — a super-fast, warm, and crisp bilingual companion fluent in English, Bangla (বাংলা), and Banglish. Reply directly, clearly, and concisely without unnecessary filler.',
  translator:
    'You are LoopLy Translator & Reply Helper. Translate or polish messages naturally between English, Bangla (বাংলা), and Banglish immediately with natural, ready-to-send phrasing.',
  tutor:
    'You are LoopLy Study & Tech Tutor. Explain concepts clearly and quickly step-by-step with practical examples in English, Bangla, or Banglish matching the user’s language.',
};

function getAiClient(): GoogleGenAI | null {
  const rawKey = process.env.GEMINI_API_KEY;
  const apiKey =
    typeof rawKey === 'string' ? rawKey.trim().replace(/^["']|["']$/g, '') : '';
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractGeminiError(err: unknown): { status: number; message: string } {
  const fallbackStatus =
    typeof (err as { status?: number })?.status === 'number'
      ? (err as { status: number }).status
      : 500;
  const status = fallbackStatus >= 400 && fallbackStatus < 600 ? fallbackStatus : 500;
  const rawMessage = err instanceof Error ? err.message : 'Gemini request failed.';

  let parsedMsg = rawMessage;
  let reason = '';

  const checkJson = (text: string) => {
    try {
      const obj = JSON.parse(text) as {
        error?: {
          message?: string;
          status?: string;
          details?: Array<{ reason?: string }>;
        };
      };
      if (obj?.error?.message) {
        if (obj.error.message.trim().startsWith('{')) {
          checkJson(obj.error.message);
        } else {
          parsedMsg = obj.error.message;
        }
      }
      const foundReason = obj?.error?.details?.find((d) => d?.reason)?.reason;
      if (foundReason) reason = foundReason;
      if (!reason && obj?.error?.status) reason = obj.error.status;
    } catch {
      // Not JSON
    }
  };

  if (rawMessage.trim().startsWith('{')) {
    checkJson(rawMessage);
  }

  if (
    reason === 'API_KEY_INVALID' ||
    reason === 'PERMISSION_DENIED' ||
    parsedMsg.toLowerCase().includes('api key not valid') ||
    status === 403
  ) {
    return {
      status,
      message:
        'Gemini API key is missing or invalid. Please check or select a valid GEMINI_API_KEY in Settings > Secrets.',
    };
  }

  if (status === 429 || reason === 'RESOURCE_EXHAUSTED') {
    return {
      status: 429,
      message:
        'Gemini rate limit reached. Please wait a moment and try again, or switch to a paid key in Settings > Secrets.',
    };
  }

  return { status, message: parsedMsg || 'Gemini request failed.' };
}

function parseGeminiPayload(body: unknown): {
  trimmedMessage: string;
  model: string;
  systemInstruction: string;
  formattedHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
} {
  const { message, history, rolePreset, modelChoice } = (body || {}) as {
    message?: string;
    history?: Array<{ role: 'user' | 'model'; text: string }>;
    rolePreset?: string;
    modelChoice?: string;
  };

  const trimmedMessage = typeof message === 'string' ? message.trim().slice(0, 4000) : '';
  const model =
    typeof modelChoice === 'string' && ALLOWED_MODELS.has(modelChoice)
      ? modelChoice
      : 'gemini-3.1-flash-lite';

  const systemInstruction =
    ROLE_INSTRUCTIONS[typeof rolePreset === 'string' ? rolePreset : 'assistant'] ||
    ROLE_INSTRUCTIONS.assistant;

  const formattedHistory = Array.isArray(history)
    ? history
        .filter(
          (turn) =>
            turn &&
            (turn.role === 'user' || turn.role === 'model') &&
            typeof turn.text === 'string' &&
            turn.text.trim().length > 0
        )
        .slice(-24)
        .map((turn) => ({
          role: turn.role,
          parts: [{ text: turn.text }],
        }))
    : [];

  return { trimmedMessage, model, systemInstruction, formattedHistory };
}

function buildFastConfig(model: string, systemInstruction: string) {
  return {
    systemInstruction,
    thinkingConfig: {
      thinkingLevel:
        model === 'gemini-3.1-flash-lite' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW,
    },
  };
}

function readCliArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag && args[i + 1]) {
      return args[i + 1];
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

function resolveServerPort(isProd: boolean): number {
  const cliPort = Number(readCliArg('--port'));
  if (Number.isInteger(cliPort) && cliPort > 0) {
    return cliPort;
  }

  const defaultPort = Number(process.env.DEFAULT_APP_PORT) || 3000;
  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);

  // In AI Studio containers, nginx owns NGINX_PORT (typically 8080) and proxies to port 3000.
  if (envPort > 0 && envPort === nginxPort) {
    return defaultPort;
  }

  if (!isProd) {
    return defaultPort;
  }

  return envPort > 0 ? envPort : defaultPort;
}

type RateBucket = { timestamps: number[] };
const rateLimitStore = new Map<string, RateBucket>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const bucket = rateLimitStore.get(key) || { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
  if (bucket.timestamps.length >= maxRequests) {
    const oldest = bucket.timestamps[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    rateLimitStore.set(key, bucket);
    return { allowed: false, retryAfterSec };
  }
  bucket.timestamps.push(now);
  rateLimitStore.set(key, bucket);
  if (rateLimitStore.size > 2000) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (v.timestamps.length === 0 || (v.timestamps[v.timestamps.length - 1] ?? 0) <= cutoff) {
        rateLimitStore.delete(k);
      }
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

function sanitizeSingleLine(input: string, maxLen: number): string {
  return input.replace(/[\r\n\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function sanitizeHttpUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'https://looply.app';
    }
    if (parsed.username || parsed.password) {
      return 'https://looply.app';
    }
    return parsed.toString().slice(0, 400);
  } catch {
    return 'https://looply.app';
  }
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Baseline security headers (iframe-compatible for AI Studio preview, COOP allows Google Auth popup)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const getFirebaseApiKey = (): string => {
    if (process.env.FIREBASE_WEB_API_KEY) return process.env.FIREBASE_WEB_API_KEY;
    try {
      const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { apiKey?: string };
      return typeof parsed.apiKey === 'string' ? parsed.apiKey : '';
    } catch {
      return '';
    }
  };

  const escapeHtml = (input: string): string =>
    input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const isServerMailerConfigured = (): boolean => {
    const hasSmtp = Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
    const hasResend = Boolean(process.env.RESEND_API_KEY?.trim());
    return hasSmtp || hasResend;
  };

  app.get('/api/mail-status', (_req, res) => {
    res.json({ configured: isServerMailerConfigured() });
  });

  app.post('/api/send-offline-alert', async (req, res) => {
    if (!isServerMailerConfigured()) {
      res.status(503).json({
        ok: false,
        configured: false,
        error: 'Official server mailer is not configured yet.',
      });
      return;
    }

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!idToken) {
      res.status(401).json({ ok: false, error: 'Missing authentication token.' });
      return;
    }

    const fbApiKey = getFirebaseApiKey();
    if (!fbApiKey) {
      res.status(500).json({ ok: false, error: 'Firebase configuration missing on server.' });
      return;
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ipLimit = checkRateLimit(`mail:ip:${ip}`, 20, 10 * 60 * 1000);
    if (!ipLimit.allowed) {
      res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
      res.status(429).json({ ok: false, configured: true, error: 'Too many alert requests. Please wait a few minutes.' });
      return;
    }

    let verifiedEmail = '';
    let verifiedUid = '';
    try {
      const lookupRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(fbApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );
      if (!lookupRes.ok) {
        res.status(401).json({ ok: false, error: 'Invalid or expired login session.' });
        return;
      }
      const lookupData = (await lookupRes.json()) as {
        users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
      };
      const fbUser = lookupData?.users?.[0];
      if (!fbUser?.localId || fbUser.emailVerified === false) {
        res.status(401).json({ ok: false, error: 'Unauthorized or unverified account.' });
        return;
      }
      verifiedUid = fbUser.localId;
      verifiedEmail = typeof fbUser.email === 'string' ? fbUser.email : '';
    } catch {
      res.status(401).json({ ok: false, error: 'Could not verify login session.' });
      return;
    }

    const uidLimit = checkRateLimit(`mail:uid:${verifiedUid}`, 12, 10 * 60 * 1000);
    if (!uidLimit.allowed) {
      res.setHeader('Retry-After', String(uidLimit.retryAfterSec));
      res.status(429).json({ ok: false, configured: true, error: 'Email alert limit reached. Please wait a few minutes.' });
      return;
    }

    const body = (req.body || {}) as {
      to?: string;
      senderName?: string;
      messagePreview?: string;
      chatUrl?: string;
      isBangla?: boolean;
    };

    const toEmail = typeof body.to === 'string' ? sanitizeSingleLine(body.to, 120).toLowerCase() : '';
    if (!toEmail || toEmail.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      res.status(400).json({ ok: false, error: 'Invalid recipient Gmail address.' });
      return;
    }

    const senderName =
      typeof body.senderName === 'string' && sanitizeSingleLine(body.senderName, 80)
        ? sanitizeSingleLine(body.senderName, 80)
        : 'LoopLy User';
    const preview =
      typeof body.messagePreview === 'string' && body.messagePreview.trim()
        ? body.messagePreview.trim().slice(0, 260)
        : body.isBangla
        ? 'নতুন মেসেজ পাঠিয়েছেন'
        : 'Sent you a new message';
    const rawChatUrl = typeof body.chatUrl === 'string' ? body.chatUrl.trim() : '';
    const safeChatUrl = sanitizeHttpUrl(rawChatUrl);

    const subject = body.isBangla
      ? `LoopLy অ্যালার্ট: ${senderName} আপনাকে মেসেজ করেছেন`
      : `LoopLy Alert: ${senderName} sent you a message`;

    const textContent = body.isBangla
      ? `হ্যালো,\n\n${senderName} LoopLy-এ আপনাকে একটি মেসেজ করেছেন:\n"${preview}"\n\nচ্যাটে জয়েন ও রিপ্লাই দিন:\n${safeChatUrl}\n\n— LoopLy Official`
      : `Hi,\n\n${senderName} sent you a message on LoopLy while you were offline:\n"${preview}"\n\nJoin Chat & Reply directly in LoopLy:\n${safeChatUrl}\n\n— LoopLy Official`;

    const safeSenderHtml = escapeHtml(senderName);
    const senderInitial = escapeHtml((senderName.trim().charAt(0) || 'L').toUpperCase());
    const safePreviewHtml = escapeHtml(preview);
    const safeUrlHtml = escapeHtml(safeChatUrl);
    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f1f5f9; padding:16px 12px; color:#0f172a;">
        <div style="max-width:480px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:20px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.06);">
          <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%); padding:20px 22px; color:#ffffff;">
            <div style="font-size:18px; font-weight:700; letter-spacing:-0.01em;">Loop<span style="color:#38bdf8;">Ly</span></div>
            <div style="font-size:12px; opacity:0.9; margin-top:3px;">${body.isBangla ? 'অফিশিয়াল মেসেজ অ্যালার্ট' : 'Official Message Alert'}</div>
          </div>
          <div style="padding:22px;">
            <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%; margin-bottom:14px;">
              <tr>
                <td style="width:40px; vertical-align:middle;">
                  <div style="width:36px; height:36px; border-radius:12px; background:#dbeafe; color:#1d4ed8; font-weight:700; font-size:15px; line-height:36px; text-align:center;">${senderInitial}</div>
                </td>
                <td style="padding-left:10px; vertical-align:middle; font-size:14px; line-height:1.45; color:#334155;">
                  <strong style="color:#0f172a;">${safeSenderHtml}</strong> ${
                    body.isBangla
                      ? 'আপনাকে একটি মেসেজ করেছেন (আপনি তখন অফলাইনে ছিলেন):'
                      : 'sent you a message while you were offline:'
                  }
                </td>
              </tr>
            </table>
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:14px; padding:14px 16px; font-size:14px; line-height:1.55; color:#0f172a; margin:0 0 18px;">
              “${safePreviewHtml}”
            </div>
            <a href="${safeUrlHtml}" style="display:block; text-align:center; background:#2563eb; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px; padding:13px 20px; border-radius:12px;">
              ${body.isBangla ? 'চ্যাটে জয়েন ও রিপ্লাই দিন →' : 'Join Chat & Reply →'}
            </a>
            <p style="margin:14px 0 0; font-size:12px; color:#475569; word-break:break-all; text-align:center;">
              <a href="${safeUrlHtml}" style="color:#2563eb; text-decoration:underline;">${safeUrlHtml}</a>
            </p>
            <p style="margin:14px 0 0; font-size:11px; color:#64748b; text-align:center;">
              ${body.isBangla ? 'এই মেসেজটি LoopLy অফিশিয়াল অ্যালার্ট সিস্টেম থেকে পাঠানো হয়েছে।' : 'Sent via LoopLy Official Alert System.'}
            </p>
          </div>
        </div>
      </div>
    `;

    try {
      const smtpUser = process.env.SMTP_USER?.trim();
      const smtpPass = process.env.SMTP_PASS?.trim();
      if (smtpUser && smtpPass) {
        const smtpHost = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
        const smtpPort = Number(process.env.SMTP_PORT) || 465;
        const fromLabel = process.env.SMTP_FROM?.trim() || 'LoopLy Alerts';
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
        });
        await transporter.sendMail({
          from: `${fromLabel} <${smtpUser}>`,
          to: toEmail,
          ...(verifiedEmail ? { replyTo: `${senderName} <${verifiedEmail}>` } : {}),
          subject,
          text: textContent,
          html: htmlContent,
        });
        res.json({ ok: true, mode: 'official-smtp' });
        return;
      }

      const resendKey = process.env.RESEND_API_KEY?.trim();
      if (resendKey) {
        const fromAddr = process.env.SMTP_FROM?.trim() || 'LoopLy Alerts <onboarding@resend.dev>';
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromAddr,
            to: [toEmail],
            ...(verifiedEmail ? { reply_to: verifiedEmail } : {}),
            subject,
            text: textContent,
            html: htmlContent,
          }),
        });
        if (!resendRes.ok) {
          const errData = await resendRes.json().catch(() => ({}));
          throw new Error(
            (errData as { message?: string })?.message || `Resend failed (HTTP ${resendRes.status}).`
          );
        }
        res.json({ ok: true, mode: 'official-resend' });
        return;
      }

      res.status(503).json({ ok: false, configured: false, error: 'No mailer configured.' });
    } catch (err) {
      res.status(500).json({
        ok: false,
        configured: true,
        error: err instanceof Error ? err.message : 'Failed to send official email.',
      });
    }
  });

  app.post('/api/gemini/stream', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const aiLimit = checkRateLimit(`gemini:ip:${ip}`, 45, 5 * 60 * 1000);
    if (!aiLimit.allowed) {
      res.setHeader('Retry-After', String(aiLimit.retryAfterSec));
      res.status(429).json({ error: 'Too many AI requests. Please wait a moment and try again.' });
      return;
    }
    const ai = getAiClient();
    if (!ai) {
      res.status(500).json({
        error:
          'GEMINI_API_KEY is not configured. Please check your key in the Settings > Secrets panel.',
      });
      return;
    }

    const { trimmedMessage, model, systemInstruction, formattedHistory } = parseGeminiPayload(
      req.body
    );
    if (!trimmedMessage) {
      res.status(400).json({ error: 'Message cannot be empty.' });
      return;
    }

    let responseAborted = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        responseAborted = true;
      }
    });

    try {
      const chat = ai.chats.create({
        model,
        config: buildFastConfig(model, systemInstruction),
        history: formattedHistory,
      });

      const stream = await chat.sendMessageStream({ message: trimmedMessage });
      if (responseAborted) return;

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      for await (const chunk of stream) {
        if (responseAborted) break;
        const delta = chunk.text ?? '';
        if (delta) {
          res.write(`data: ${JSON.stringify({ delta, model })}\n\n`);
        }
      }
      if (!responseAborted) {
        res.write(`data: ${JSON.stringify({ done: true, model })}\n\n`);
        res.end();
      }
    } catch (err: unknown) {
      const clean = extractGeminiError(err);
      if (res.headersSent) {
        if (!responseAborted && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: clean.message })}\n\n`);
          res.end();
        }
      } else {
        res.status(clean.status).json({ error: clean.message });
      }
    }
  });

  app.post('/api/gemini/chat', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const aiLimit = checkRateLimit(`gemini:ip:${ip}`, 45, 5 * 60 * 1000);
    if (!aiLimit.allowed) {
      res.setHeader('Retry-After', String(aiLimit.retryAfterSec));
      res.status(429).json({ error: 'Too many AI requests. Please wait a moment and try again.' });
      return;
    }
    const ai = getAiClient();
    if (!ai) {
      res.status(500).json({
        error:
          'GEMINI_API_KEY is not configured. Please check your key in the Settings > Secrets panel.',
      });
      return;
    }

    const { trimmedMessage, model, systemInstruction, formattedHistory } = parseGeminiPayload(
      req.body
    );
    if (!trimmedMessage) {
      res.status(400).json({ error: 'Message cannot be empty.' });
      return;
    }

    try {
      const chat = ai.chats.create({
        model,
        config: buildFastConfig(model, systemInstruction),
        history: formattedHistory,
      });

      const response = await chat.sendMessage({ message: trimmedMessage });
      const replyText = (response.text ?? '').trim();

      res.json({
        reply: replyText || 'I could not generate a response for that message.',
        model,
      });
    } catch (err: unknown) {
      const clean = extractGeminiError(err);
      res.status(clean.status).json({
        error: clean.message,
      });
    }
  });

  const uiTranslationCache = new Map<string, Record<string, string>>();

  app.post('/api/translate-ui', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const limitRes = checkRateLimit(`i18n:ip:${ip}`, 30, 10 * 60 * 1000);
    if (!limitRes.allowed) {
      res.setHeader('Retry-After', String(limitRes.retryAfterSec));
      res.status(429).json({ error: 'Too many language requests. Please wait a moment.' });
      return;
    }

    const body = (req.body || {}) as {
      targetLangCode?: string;
      targetLangName?: string;
      entries?: Record<string, string>;
    };
    const rawCode = typeof body.targetLangCode === 'string' ? body.targetLangCode.trim() : '';
    if (!rawCode || rawCode.length < 2 || rawCode.length > 16 || !/^[a-zA-Z\-]+$/.test(rawCode)) {
      res.status(400).json({ error: 'Invalid target language code.' });
      return;
    }
    const langCode = rawCode.toLowerCase();
    const cached = uiTranslationCache.get(langCode);
    if (cached) {
      res.json({ ok: true, code: langCode, translations: cached });
      return;
    }

    const rawEntries =
      body.entries && typeof body.entries === 'object' && !Array.isArray(body.entries)
        ? body.entries
        : {};
    const keys = Object.keys(rawEntries).slice(0, 320);
    if (keys.length === 0) {
      res.status(400).json({ error: 'No translation entries provided.' });
      return;
    }

    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({ error: 'Translation service unavailable right now.' });
      return;
    }

    const safeInput: Record<string, string> = {};
    for (const k of keys) {
      const val = rawEntries[k];
      if (typeof val === 'string' && val.length <= 280) {
        safeInput[k] = val;
      }
    }

    const targetName =
      typeof body.targetLangName === 'string' && body.targetLangName.trim()
        ? sanitizeSingleLine(body.targetLangName, 60)
        : langCode;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: `Translate the JSON values (keep every key identical) into natural, concise, everyday UI text for language "${targetName}" (${langCode}). Keep brand names "LoopLy", "Gmail", "Bluetooth", "QR", "Web Bluetooth", "JSON", and "PIN" untranslated or cleanly preserved. Return ONLY a valid JSON object mapping each key to its translated string.\n\n${JSON.stringify(safeInput)}`,
        config: {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      const cleaned: Record<string, string> = {};
      for (const k of Object.keys(safeInput)) {
        const v = parsed[k];
        if (typeof v === 'string' && v.trim()) {
          cleaned[k] = v.trim();
        }
      }
      if (Object.keys(cleaned).length > 0) {
        uiTranslationCache.set(langCode, cleaned);
      }
      res.json({ ok: true, code: langCode, translations: cleaned });
    } catch (err: unknown) {
      const clean = extractGeminiError(err);
      res.status(clean.status).json({ error: clean.message });
    }
  });

  app.get('/api/rtc-config', (_req, res) => {
    res.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:openrelay.metered.ca:80' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:openrelay.metered.ca:80?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turns:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
    });
  });

  const distDir = path.resolve(__dirname, 'dist');
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd && fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: 'index.html' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // 100% Free Built-In WebSocket Live Voice Relay (/ws/call) for NAT/firewall fallback
  const server = http.createServer(app);
  const callRelayWss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
  const callRooms = new Map<string, Map<string, WebSocket>>();

  const notifyRoomPeerCount = (room: Map<string, WebSocket>) => {
    const payload = JSON.stringify({ type: 'peers', count: room.size });
    for (const peerWs of room.values()) {
      if (peerWs.readyState === WebSocket.OPEN) {
        peerWs.send(payload);
      }
    }
  };

  server.on('upgrade', (request, socket, head) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(request.url || '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (parsedUrl.pathname !== '/ws/call') {
      socket.destroy();
      return;
    }

    const callId = (parsedUrl.searchParams.get('callId') || '').trim();
    const uid = (parsedUrl.searchParams.get('uid') || '').trim();
    const idRe = /^[a-zA-Z0-9_-]{4,128}$/;
    const uidRe = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!idRe.test(callId) || !uidRe.test(uid)) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const existingRoom = callRooms.get(callId);
    if (existingRoom && !existingRoom.has(uid) && existingRoom.size >= 2) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    callRelayWss.handleUpgrade(request, socket, head, (ws) => {
      let room = callRooms.get(callId);
      if (!room) {
        room = new Map<string, WebSocket>();
        callRooms.set(callId, room);
      }

      const prevWs = room.get(uid);
      if (prevWs && prevWs !== ws) {
        try {
          prevWs.close(1000, 'Replaced by newer connection');
        } catch {
          // Ignore
        }
      }
      room.set(uid, ws);
      notifyRoomPeerCount(room);

      let isAlive = true;
      let windowStart = Date.now();
      let frameCount = 0;

      ws.on('pong', () => {
        isAlive = true;
      });

      const heartbeat = setInterval(() => {
        if (!isAlive) {
          ws.terminate();
          return;
        }
        isAlive = false;
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 25_000);

      ws.on('message', (data, isBinary) => {
        const now = Date.now();
        if (now - windowStart >= 1000) {
          windowStart = now;
          frameCount = 0;
        }
        frameCount += 1;
        if (frameCount > 180) return;

        const currentRoom = callRooms.get(callId);
        if (!currentRoom) return;
        for (const [peerUid, peerWs] of currentRoom.entries()) {
          if (peerUid !== uid && peerWs.readyState === WebSocket.OPEN) {
            peerWs.send(data, { binary: isBinary });
          }
        }
      });

      const cleanupPeer = () => {
        clearInterval(heartbeat);
        const currentRoom = callRooms.get(callId);
        if (!currentRoom) return;
        if (currentRoom.get(uid) === ws) {
          currentRoom.delete(uid);
          if (currentRoom.size === 0) {
            callRooms.delete(callId);
          } else {
            notifyRoomPeerCount(currentRoom);
          }
        }
      };

      ws.on('close', cleanupPeer);
      ws.on('error', cleanupPeer);
    });
  });

  const PORT = resolveServerPort(isProd);
  const HOST = readCliArg('--host') || '0.0.0.0';
  server.listen(PORT, HOST, () => {
    console.log(`LoopLy server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
