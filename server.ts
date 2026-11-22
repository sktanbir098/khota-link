import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
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
