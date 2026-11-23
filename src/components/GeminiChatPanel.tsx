import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, RotateCcw, Send, Square, X, Zap } from 'lucide-react';
import { useFloatingBadgeClearance } from '../lib/floatingBadge';
import { t } from '../lib/i18n';
import { playIncomingTone, playSentPop, unlockAudioNow } from '../lib/sound';
import { AppLanguage, GeminiChatTurn, ReactionEmoji } from '../types/chat';
import { GeminiLogo } from './GeminiLogo';
import { AggregatedReaction, MessageBubble } from './MessageBubble';

interface Props {
  lang: AppLanguage;
  userName: string;
  onClose?: () => void;
}

type RolePreset = 'assistant' | 'translator' | 'tutor';
type ModelChoice = 'gemini-3.1-flash-lite' | 'gemini-4-hydrogen';

export const GeminiChatPanel: React.FC<Props> = ({ lang, userName, onClose }) => {
  const [rolePreset, setRolePreset] = useState<RolePreset>('assistant');
  const [modelChoice, setModelChoice] = useState<ModelChoice>('gemini-3.1-flash-lite');
  const [turns, setTurns] = useState<GeminiChatTurn[]>([
    {
      id: 'welcome',
      role: 'model',
      text:
        lang === 'bn'
          ? `হ্যালো ${userName}! আমি KothaLink Gemini AI। এখন আগের চেয়ে অনেক দ্রুত রিয়েল-টাইমে উত্তর দেই — মেসেজ লেখা, বাংলা/ইংরেজি অনুবাদ বা যেকোনো প্রশ্ন করুন।`
          : `Hi ${userName}! I'm KothaLink Gemini AI with real-time fast streaming. Ask me anything, translate Bangla/English/Banglish, or polish a message instantly.`,
      timestamp: Date.now(),
      model: 'gemini-3.1-flash-lite',
      reactions: {},
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingTurnId, setStreamingTurnId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sendPulseKey, setSendPulseKey] = useState(0);
  const hasNetlifyBadge = useFloatingBadgeClearance();

  const endRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, loading]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const stopGeneration = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
    setStreamingTurnId(null);
  };

  const handleSend = async (e?: React.FormEvent, overrideText?: string) => {
    e?.preventDefault();
    unlockAudioNow();
    const prompt = (overrideText ?? input).trim();
    if (!prompt || loading) return;

    setError('');
    if (!overrideText) setInput('');

    const userTurn: GeminiChatTurn = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: prompt,
      timestamp: Date.now(),
      reactions: {},
    };

    const historyPayload = turns
      .filter((item) => item.id !== 'welcome' && item.text.trim().length > 0)
      .map((item) => ({ role: item.role, text: item.text }));

    const aiTurnId = `m_${Date.now() + 1}`;
    setTurns((prev) => [...prev, userTurn]);
    setSendPulseKey((k) => k + 1);
    void playSentPop();
    setLoading(true);
    setStreamingTurnId(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/gemini/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          history: historyPayload,
          rolePreset,
          modelChoice,
        }),
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error(
          lang === 'bn'
            ? 'এই হোস্টিং-এ ব্যাকএন্ড (/api/gemini) সক্রিয় নেই। AI চ্যাট চালাতে Cloud Run / App Hosting বা Shared App লিংক ব্যবহার করুন।'
            : 'Gemini backend (/api/gemini) is not active on static Firebase Hosting. Run via server.ts / Cloud Run or the Shared App URL.'
        );
      }
      if (!res.ok || !res.body || contentType.includes('application/json')) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; reply?: string };
        throw new Error(data.error || 'Gemini request failed.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let accumulated = '';
      let createdBubble = false;
      let resolvedModel = modelChoice;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          let parsed: { delta?: string; done?: boolean; error?: string; model?: string };
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.model) {
            resolvedModel = parsed.model as ModelChoice;
          }
          if (parsed.delta) {
            accumulated += parsed.delta;
            if (!createdBubble) {
              createdBubble = true;
              setStreamingTurnId(aiTurnId);
              const firstTurn: GeminiChatTurn = {
                id: aiTurnId,
                role: 'model',
                text: accumulated,
                timestamp: Date.now(),
                model: resolvedModel,
                reactions: {},
              };
              setTurns((prev) => [...prev, firstTurn]);
            } else {
              const latestText = accumulated;
              setTurns((prev) =>
                prev.map((turn) => (turn.id === aiTurnId ? { ...turn, text: latestText } : turn))
              );
            }
          }
        }
      }

      if (!createdBubble && !accumulated.trim()) {
        // Safety fallback to non-streaming endpoint if proxy stripped SSE chunks
        const fallbackRes = await fetch('/api/gemini/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: prompt,
            history: historyPayload,
            rolePreset,
            modelChoice,
          }),
          signal: controller.signal,
        });
        const fallbackData = (await fallbackRes.json().catch(() => ({}))) as {
          error?: string;
          reply?: string;
          model?: string;
        };
        if (!fallbackRes.ok) {
          throw new Error(fallbackData.error || 'Gemini request failed.');
        }
        const fallbackTurn: GeminiChatTurn = {
          id: aiTurnId,
          role: 'model',
          text: (fallbackData.reply || '').trim() || 'No response received.',
          timestamp: Date.now(),
          model: (fallbackData.model as ModelChoice) || resolvedModel,
          reactions: {},
        };
        setTurns((prev) => [...prev, fallbackTurn]);
      } else if (!createdBubble) {
        const fallbackTurn: GeminiChatTurn = {
          id: aiTurnId,
          role: 'model',
          text: accumulated.trim(),
          timestamp: Date.now(),
          model: resolvedModel,
          reactions: {},
        };
        setTurns((prev) => [...prev, fallbackTurn]);
      }

      void playIncomingTone();
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Unable to reach Gemini AI.');
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      setStreamingTurnId(null);
    }
  };

  const handleLocalReact = (turnId: string, emoji: ReactionEmoji) => {
    setTurns((prev) =>
      prev.map((turn) => {
        if (turn.id !== turnId) return turn;
        const next = { ...(turn.reactions || {}) };
        if (next[emoji]) {
          delete next[emoji];
        } else {
          next[emoji] = 1;
        }
        return { ...turn, reactions: next };
      })
    );
  };

  const resetChat = () => {
    stopGeneration();
    setError('');
    setTurns([
      {
        id: 'welcome',
        role: 'model',
        text:
          lang === 'bn'
            ? 'নতুন চ্যাট শুরু হয়েছে। কী বিষয়ে সাহায্য করতে পারি?'
            : 'Started a fresh conversation. How can I help you?',
        timestamp: Date.now(),
        model: modelChoice,
        reactions: {},
      },
    ]);
  };

  const suggestions =
    lang === 'bn'
      ? [
          'বন্ধুকে সুন্দর একটা মেসেজ লিখে দাও',
          '"আমি ১০ মিনিটে পৌঁছাব" ইংরেজিতে বলো',
          'সহজ ভাষায় AI কীভাবে কাজ করে বলো',
        ]
      : [
          'Write a polite message to my friend in Banglish',
          'Translate "I will reach in 10 minutes" to Bangla',
          'Suggest 3 warm ways to greet someone',
        ];

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-slate-950 liquid-app-bg overflow-hidden">
      {/* Header with Custom Animated Gemini Logo */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 liquid-surface liquid-divider flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t(lang, 'backBtn')}
              className="min-h-[40px] px-2.5 flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 liquid-control border border-transparent hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold shrink-0 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">{t(lang, 'backBtn')}</span>
            </button>
          )}
          <GeminiLogo variant="badge" size={22} animate={loading} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
                {t(lang, 'geminiAssistantTitle')}
              </h2>
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 text-[10px] font-semibold">
                <Zap className="w-2.5 h-2.5" />
                {t(lang, 'geminiFastTag')}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {modelChoice === 'gemini-3.1-flash-lite'
                ? 'Ultra-Fast Live Streaming'
                : 'Balanced Smart Streaming'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            aria-label="Chatbot Role"
            value={rolePreset}
            onChange={(e) => setRolePreset(e.target.value as RolePreset)}
            className="min-h-[36px] px-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 liquid-control border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="assistant">General Assistant</option>
            <option value="translator">Bangla / English Helper</option>
            <option value="tutor">Study & Tech Tutor</option>
          </select>

          <select
            aria-label="Gemini Model"
            value={modelChoice}
            onChange={(e) => setModelChoice(e.target.value as ModelChoice)}
            className="min-h-[36px] px-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 liquid-control border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="gemini-3.1-flash-lite">Ultra Fast (Flash Lite)</option>
            <option value="gemini-4-hydrogen">Balanced (Hydrogen)</option>
          </select>

          <button
            type="button"
            onClick={resetChat}
            title="Reset conversation"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 liquid-control text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Gemini panel"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Thread */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4 bg-slate-50/50 dark:bg-slate-950 liquid-panel">
        {turns.map((turn) => {
          const aggregated: AggregatedReaction[] = Object.entries(turn.reactions || {}).map(
            ([emoji, count]) => ({
              emoji: emoji as ReactionEmoji,
              count: count || 1,
              reactedByMe: true,
            })
          );
          return (
            <MessageBubble
              key={turn.id}
              id={turn.id}
              text={turn.text}
              senderName="Gemini AI"
              timestampText={new Date(turn.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
              isMe={turn.role === 'user'}
              justSent={turn.role === 'user' && Date.now() - turn.timestamp < 2000}
              justArrived={
                turn.role === 'model' &&
                turn.id !== 'welcome' &&
                Date.now() - turn.timestamp < 2500
              }
              reactions={aggregated}
              onReact={(emoji) => handleLocalReact(turn.id, emoji)}
              onCopy={
                turn.role === 'model'
                  ? () => {
                      void navigator.clipboard.writeText(turn.text);
                    }
                  : undefined
              }
            />
          );
        })}

        {/* Waiting dot before first token arrives (<200ms typical) */}
        <AnimatePresence>
          {loading && !streamingTurnId && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14 }}
              className="flex items-center gap-2"
            >
              <div className="px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
                <GeminiLogo variant="icon" size={16} animate />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'bn' ? 'উত্তর তৈরি হচ্ছে...' : 'Gemini is replying...'}
                </span>
                <span className="flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                      transition={{
                        duration: 0.75,
                        repeat: Infinity,
                        delay: i * 0.12,
                      }}
                      className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-cyan-400"
                    />
                  ))}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={endRef} />
      </div>

      {/* Quick Prompt Chips when fresh */}
      {turns.length <= 1 && (
        <div className="px-4 sm:px-6 pb-2 flex flex-wrap gap-2 bg-slate-50/50 dark:bg-slate-950">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => handleSend(undefined, suggestion)}
              className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500 text-xs text-slate-700 dark:text-slate-300 transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="px-4 sm:px-6 py-2.5 bg-red-50 dark:bg-red-950/40 border-t border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            className="font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Composer with Stop & Streaming Feedback */}
      <div
        className={`border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0 chat-composer-container${
          hasNetlifyBadge ? ' has-netlify-badge' : ''
        }`}
      >
        <form
          onSubmit={(e) => handleSend(e)}
          className={`p-3 sm:p-4 flex items-center gap-2.5 ${
            hasNetlifyBadge ? 'pr-[132px] sm:pr-[184px]' : 'pr-4 sm:pr-8'
          }`}
        >
          <input
            type="text"
            maxLength={2000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              lang === 'bn' ? 'Gemini কে যেকোনো প্রশ্ন করুন...' : 'Ask Gemini anything...'
            }
            className="flex-1 min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          {loading ? (
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={stopGeneration}
              className="min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span className="hidden sm:inline">{t(lang, 'stopGenerating')}</span>
            </motion.button>
          ) : (
            <motion.button
              type="submit"
              whileTap={{ scale: 0.92 }}
              disabled={!input.trim()}
              className="min-h-[44px] px-4 sm:px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <motion.span
                key={sendPulseKey}
                initial={sendPulseKey > 0 ? { x: -8, y: 8, scale: 0.7 } : false}
                animate={{ x: 0, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                className="inline-flex items-center"
              >
                <Send className="w-4 h-4" />
              </motion.span>
              <span className="hidden sm:inline">{t(lang, 'send')}</span>
            </motion.button>
          )}
        </form>
      </div>
    </div>
  );
};
