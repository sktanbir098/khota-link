import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_MODELS = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

const ROLE_INSTRUCTIONS: Record<string, string> = {
  assistant:
    'You are KothaLink Gemini AI — a super-fast, warm, and crisp bilingual companion fluent in English, Bangla (বাংলা), and Banglish. Reply directly, clearly, and concisely without unnecessary filler.',
  translator:
    'You are KothaLink Translator & Reply Helper. Translate or polish messages naturally between English, Bangla (বাংলা), and Banglish immediately with natural, ready-to-send phrasing.',
  tutor:
    'You are KothaLink Study & Tech Tutor. Explain concepts clearly and quickly step-by-step with practical examples in English, Bangla, or Banglish matching the user’s language.',
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

  const trimmedMessage = typeof message === 'string' ? message.trim() : '';
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

async function startServer() {
  const app = express();
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

    let verifiedEmail = '';
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
        users?: Array<{ localId?: string; email?: string }>;
      };
      const fbUser = lookupData?.users?.[0];
      if (!fbUser?.localId) {
        res.status(401).json({ ok: false, error: 'Unauthorized user.' });
        return;
      }
      verifiedEmail = typeof fbUser.email === 'string' ? fbUser.email : '';
    } catch {
      res.status(401).json({ ok: false, error: 'Could not verify login session.' });
      return;
    }

    const body = (req.body || {}) as {
      to?: string;
      senderName?: string;
      messagePreview?: string;
      chatUrl?: string;
      isBangla?: boolean;
    };

    const toEmail = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
    if (!toEmail || toEmail.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      res.status(400).json({ ok: false, error: 'Invalid recipient Gmail address.' });
      return;
    }

    const senderName =
      typeof body.senderName === 'string' && body.senderName.trim()
        ? body.senderName.trim().slice(0, 80)
        : 'KothaLink User';
    const preview =
      typeof body.messagePreview === 'string' && body.messagePreview.trim()
        ? body.messagePreview.trim().slice(0, 260)
        : body.isBangla
        ? 'নতুন মেসেজ পাঠিয়েছেন'
        : 'Sent you a new message';
    const rawChatUrl = typeof body.chatUrl === 'string' ? body.chatUrl.trim() : '';
    const safeChatUrl =
      rawChatUrl.startsWith('https://') || rawChatUrl.startsWith('http://')
        ? rawChatUrl.slice(0, 400)
        : 'https://kothalink.app';

    const subject = body.isBangla
      ? `KothaLink অ্যালার্ট: ${senderName} আপনাকে মেসেজ করেছেন`
      : `KothaLink Alert: ${senderName} sent you a message`;

    const textContent = body.isBangla
      ? `হ্যালো,\n\n${senderName} KothaLink-এ আপনাকে একটি মেসেজ করেছেন:\n"${preview}"\n\nচ্যাটে জয়েন ও রিপ্লাই দিন:\n${safeChatUrl}\n\n— KothaLink Official`
      : `Hi,\n\n${senderName} sent you a message on KothaLink while you were offline:\n"${preview}"\n\nJoin Chat & Reply directly in KothaLink:\n${safeChatUrl}\n\n— KothaLink Official`;

    const safeSenderHtml = escapeHtml(senderName);
    const safePreviewHtml = escapeHtml(preview);
    const safeUrlHtml = escapeHtml(safeChatUrl);
    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f8fafc; padding:24px; color:#0f172a;">
        <div style="max-width:480px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; overflow:hidden;">
          <div style="background:#2563eb; padding:18px 22px; color:#ffffff;">
            <div style="font-size:16px; font-weight:700; letter-spacing:-0.01em;">KothaLink</div>
            <div style="font-size:12px; opacity:0.9; margin-top:2px;">Official Message Alert</div>
          </div>
          <div style="padding:22px;">
            <p style="margin:0 0 12px; font-size:14px; line-height:1.5; color:#334155;">
              <strong>${safeSenderHtml}</strong> ${
                body.isBangla
                  ? 'আপনাকে একটি মেসেজ করেছেন (আপনি তখন অফলাইনে ছিলেন):'
                  : 'sent you a message while you were offline:'
              }
            </p>
            <div style="background:#f1f5f9; border-left:3px solid #2563eb; border-radius:8px; padding:12px 14px; font-size:14px; color:#0f172a; margin:0 0 18px;">
              "${safePreviewHtml}"
            </div>
            <a href="${safeUrlHtml}" style="display:inline-block; background:#2563eb; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px; padding:12px 20px; border-radius:10px;">
              ${body.isBangla ? 'চ্যাটে জয়েন ও রিপ্লাই দিন' : 'Join Chat & Reply'}
            </a>
            <p style="margin:14px 0 0; font-size:12px; color:#475569; word-break:break-all;">
              <a href="${safeUrlHtml}" style="color:#2563eb; text-decoration:underline;">${safeUrlHtml}</a>
            </p>
            <p style="margin:14px 0 0; font-size:11px; color:#64748b;">
              ${body.isBangla ? 'এই মেসেজটি KothaLink অফিশিয়াল অ্যালার্ট সিস্টেম থেকে পাঠানো হয়েছে।' : 'Sent via KothaLink Official Alert System.'}
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
        const fromLabel = process.env.SMTP_FROM?.trim() || 'KothaLink Alerts';
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
        const fromAddr = process.env.SMTP_FROM?.trim() || 'KothaLink Alerts <onboarding@resend.dev>';
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

  const distDir = path.resolve(__dirname, 'dist');
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd && fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: 'index.html' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
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

  const PORT = resolveServerPort(isProd);
  const HOST = readCliArg('--host') || '0.0.0.0';
  app.listen(PORT, HOST, () => {
    console.log(`KothaLink server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
