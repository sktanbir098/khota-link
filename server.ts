import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_MODELS = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

const ROLE_INSTRUCTIONS: Record<string, string> = {
  assistant:
    'You are KothaLink Assistant, a warm, concise, and helpful bilingual AI companion fluent in English, Bangla (Bengali), and Banglish. Help users draft clear messages, answer everyday questions, and explain things simply.',
  translator:
    'You are KothaLink Translator & Reply Helper. Help users translate or polish messages naturally between English, Bangla (বাংলা), and Banglish. Provide natural phrasing options without unnecessary filler.',
  tutor:
    'You are KothaLink Study & Tech Tutor. Explain concepts clearly step-by-step with practical examples in English or Bangla/Banglish matching the user’s language.',
};

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/gemini/chat', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(500).json({
        error:
          'GEMINI_API_KEY is not configured. Please check your key in the Settings > Secrets panel.',
      });
      return;
    }

    const { message, history, rolePreset, modelChoice } = req.body as {
      message?: string;
      history?: Array<{ role: 'user' | 'model'; text: string }>;
      rolePreset?: string;
      modelChoice?: string;
    };

    const trimmedMessage = typeof message === 'string' ? message.trim() : '';
    if (!trimmedMessage) {
      res.status(400).json({ error: 'Message cannot be empty.' });
      return;
    }

    const model =
      typeof modelChoice === 'string' && ALLOWED_MODELS.has(modelChoice)
        ? modelChoice
        : 'gemini-4-hydrogen';

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
          .slice(-30)
          .map((turn) => ({
            role: turn.role,
            parts: [{ text: turn.text }],
          }))
      : [];

    try {
      const chat = ai.chats.create({
        model,
        config: {
          systemInstruction,
        },
        history: formattedHistory,
      });

      const response = await chat.sendMessage({ message: trimmedMessage });
      const replyText = (response.text ?? '').trim();

      res.json({
        reply: replyText || 'I could not generate a response for that message.',
        model,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gemini request failed.';
      const status =
        typeof (err as { status?: number })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
      res.status(status >= 400 && status < 600 ? status : 500).json({
        error: msg,
      });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KothaLink server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
