import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Bot, RotateCcw, Send, X } from 'lucide-react';
import { t } from '../lib/i18n';
import { playIncomingTone, playSentPop, unlockAudioNow } from '../lib/sound';
import { AppLanguage, GeminiChatTurn, ReactionEmoji } from '../types/chat';
import { AggregatedReaction, MessageBubble } from './MessageBubble';

interface Props {
  lang: AppLanguage;
  userName: string;
  onClose?: () => void;
}

type RolePreset = 'assistant' | 'translator' | 'tutor';
type ModelChoice = 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';

export const GeminiChatPanel: React.FC<Props> = ({ lang, userName, onClose }) => {
  const [rolePreset, setRolePreset] = useState<RolePreset>('assistant');
  const [modelChoice, setModelChoice] = useState<ModelChoice>('gemini-4-hydrogen');
  const [turns, setTurns] = useState<GeminiChatTurn[]>([
    {
      id: 'welcome',
      role: 'model',
      text:
        lang === 'bn'
          ? `হ্যালো ${userName}! আমি KothaLink Gemini Assistant। আপনি আমাকে মেসেজ লিখতে, বাংলা-ইংরেজি অনুবাদ করতে বা যেকোনো প্রশ্ন করতে পারেন।`
          : `Hi ${userName}! I'm your KothaLink Gemini Assistant. Ask me anything, draft messages in English or Bangla/Banglish, or pick a mode above.`,
      timestamp: Date.now(),
      model: 'gemini-4-hydrogen',
      reactions: {},
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sendPulseKey, setSendPulseKey] = useState(0);

  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, loading]);

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
      .filter((item) => item.id !== 'welcome')
      .map((item) => ({ role: item.role, text: item.text }));

    setTurns((prev) => [...prev, userTurn]);
    setSendPulseKey((k) => k + 1);
    playSentPop();
    setLoading(true);

    try {
      const res = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          history: historyPayload,
          rolePreset,
          modelChoice,
        }),
      });
      const data = (await res.json()) as { reply?: string; model?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Gemini request failed.');
      }

      const aiTurn: GeminiChatTurn = {
        id: `m_${Date.now()}`,
        role: 'model',
        text: data.reply || 'No response received.',
        timestamp: Date.now(),
        model: data.model || modelChoice,
        reactions: {},
      };
      setTurns((prev) => [...prev, aiTurn]);
      playIncomingTone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Gemini assistant.');
    } finally {
      setLoading(false);
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

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-slate-950 overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Back to chats"
              className="md:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="w-10 h-10 rounded-full bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
              Gemini Assistant
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Multi-turn AI · {modelChoice === 'gemini-4-hydrogen' ? 'Balanced' : 'Fast Lite'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            aria-label="Chatbot Role"
            value={rolePreset}
            onChange={(e) => setRolePreset(e.target.value as RolePreset)}
            className="min-h-[36px] px-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="assistant">General Assistant</option>
            <option value="translator">Bangla / English Helper</option>
            <option value="tutor">Study & Tech Tutor</option>
          </select>

          <select
            aria-label="Gemini Model"
            value={modelChoice}
            onChange={(e) => setModelChoice(e.target.value as ModelChoice)}
            className="min-h-[36px] px-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="gemini-4-hydrogen">Balanced (Hydrogen)</option>
            <option value="gemini-3.1-flash-lite">Fast (Flash Lite)</option>
          </select>

          <button
            type="button"
            onClick={resetChat}
            title="Reset conversation"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
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
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4 bg-slate-50/50 dark:bg-slate-950">
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
              senderName="Gemini"
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
            />
          );
        })}

        {/* Animated Typing Indicator while Gemini generates */}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.16 }}
              className="flex items-center gap-2"
            >
              <div className="px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Gemini is typing
                </span>
                <span className="flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                      transition={{
                        duration: 0.9,
                        repeat: Infinity,
                        delay: i * 0.15,
                      }}
                      className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400"
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
          {[
            'Write a polite message to my friend in Banglish',
            'Translate "I will reach in 10 minutes" to Bangla',
            'Suggest 3 ways to greet someone warmly',
          ].map((suggestion) => (
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
        <div className="px-4 sm:px-6 py-2 bg-red-50 dark:bg-red-950/40 border-t border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={(e) => handleSend(e)}
        className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center gap-2.5 shrink-0"
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
        <motion.button
          type="submit"
          whileTap={{ scale: 0.92 }}
          disabled={!input.trim() || loading}
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
      </form>
    </div>
  );
};
