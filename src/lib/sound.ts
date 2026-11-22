const SOUND_STORAGE_KEY = 'kl_sound';

let audioCtx: AudioContext | null = null;
let fallbackAudioEl: HTMLAudioElement | null = null;
let cachedWavUrl: string | null = null;
let swRegistration: ServiceWorkerRegistration | null = null;
let listenersBound = false;

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(SOUND_STORAGE_KEY) !== 'off';
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'on' : 'off');
}

// Build a warm 3-note WAV chime in memory so HTMLAudioElement can play even when Web Audio is suspended in background tabs
function buildChimeWavDataUrl(): string {
  if (cachedWavUrl) return cachedWavUrl;
  const sampleRate = 22050;
  const durationSec = 0.44;
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  const notes = [
    { freq: 587.33, start: 0.0, dur: 0.16, amp: 0.36 },
    { freq: 880.0, start: 0.085, dur: 0.2, amp: 0.34 },
    { freq: 1174.66, start: 0.17, dur: 0.24, amp: 0.24 },
  ];

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (const n of notes) {
      if (t >= n.start && t <= n.start + n.dur) {
        const localT = t - n.start;
        const attack = Math.min(1, localT / 0.012);
        const decay = Math.exp(-localT * 10);
        sample += Math.sin(2 * Math.PI * n.freq * localT) * n.amp * attack * decay;
      }
    }
    const clamped = Math.max(-0.95, Math.min(0.95, sample));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  cachedWavUrl = `data:audio/wav;base64,${btoa(binary)}`;
  return cachedWavUrl;
}

function getOrCreateFallbackAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!fallbackAudioEl) {
    fallbackAudioEl = new Audio(buildChimeWavDataUrl());
    fallbackAudioEl.preload = 'auto';
  }
  return fallbackAudioEl;
}

function getOrCreateContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  return audioCtx;
}

async function ensureRunningContext(): Promise<AudioContext | null> {
  const ctx = getOrCreateContext();
  if (!ctx) return null;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return null;
    }
  }
  return ctx.state === 'running' ? ctx : null;
}

export function unlockAudioNow(): void {
  const ctx = getOrCreateContext();
  if (ctx) {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // Ignore unlock fallback errors
    }
  }

  // Also prime HTMLAudioElement for background playback
  const audioEl = getOrCreateFallbackAudio();
  if (audioEl) {
    try {
      audioEl.volume = 0;
      const p = audioEl.play();
      if (p) {
        p.then(() => {
          audioEl.pause();
          audioEl.currentTime = 0;
          audioEl.volume = 0.85;
        }).catch(() => {
          audioEl.volume = 0.85;
        });
      }
    } catch {
      audioEl.volume = 0.85;
    }
  }
}

export function initAudioUnlock(): void {
  if (typeof window === 'undefined' || listenersBound) return;
  listenersBound = true;
  const unlock = () => {
    unlockAudioNow();
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('touchend', unlock, { passive: true });
  window.addEventListener('click', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

export async function playIncomingTone(): Promise<void> {
  if (!isSoundEnabled()) return;

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([110, 55, 130]);
    } catch {
      // Ignore if vibration blocked
    }
  }

  // Prefer Web Audio when active & foregrounded; use HTMLAudioElement when backgrounded or if Web Audio fails
  const useFallback = typeof document !== 'undefined' && document.hidden;
  if (!useFallback) {
    const ctx = await ensureRunningContext();
    if (ctx) {
      try {
        const now = ctx.currentTime;

        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now);
        gain1.gain.setValueAtTime(0.0001, now);
        gain1.gain.exponentialRampToValueAtTime(0.2, now + 0.015);
        gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.18);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(880, now + 0.085);
        gain2.gain.setValueAtTime(0.0001, now + 0.085);
        gain2.gain.exponentialRampToValueAtTime(0.19, now + 0.1);
        gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.085);
        osc2.stop(now + 0.3);

        const osc3 = ctx.createOscillator();
        const gain3 = ctx.createGain();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(1174.66, now + 0.165);
        gain3.gain.setValueAtTime(0.0001, now + 0.165);
        gain3.gain.exponentialRampToValueAtTime(0.12, now + 0.18);
        gain3.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
        osc3.connect(gain3);
        gain3.connect(ctx.destination);
        osc3.start(now + 0.165);
        osc3.stop(now + 0.4);
        return;
      } catch {
        // Fall through to HTMLAudioElement
      }
    }
  }

  const audioEl = getOrCreateFallbackAudio();
  if (audioEl) {
    try {
      audioEl.volume = 0.9;
      audioEl.currentTime = 0;
      await audioEl.play();
    } catch {
      // Autoplay blocked prior to interaction
    }
  }
}

export async function playSentPop(): Promise<void> {
  if (!isSoundEnabled()) return;
  const ctx = await ensureRunningContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(460, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.06);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.085, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch {
    // Ignore audio errors
  }
}

let ringtoneTimer: number | null = null;

async function playRingBurst(kind: 'incoming' | 'ringback'): Promise<void> {
  if (!isSoundEnabled()) return;

  if (kind === 'incoming' && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([260, 140, 260]);
    } catch {
      // Ignore vibration errors
    }
  }

  const ctx = await ensureRunningContext();
  if (!ctx) {
    if (kind === 'incoming') {
      const audioEl = getOrCreateFallbackAudio();
      if (audioEl) {
        try {
          audioEl.volume = 0.85;
          audioEl.currentTime = 0;
          await audioEl.play();
        } catch {
          // Autoplay blocked
        }
      }
    }
    return;
  }

  try {
    const now = ctx.currentTime;
    if (kind === 'incoming') {
      const notes = [
        { freq: 659.25, offset: 0, dur: 0.24 },
        { freq: 830.61, offset: 0.14, dur: 0.28 },
        { freq: 987.77, offset: 0.3, dur: 0.36 },
      ];
      for (const n of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.freq, now + n.offset);
        gain.gain.setValueAtTime(0.0001, now + n.offset);
        gain.gain.exponentialRampToValueAtTime(0.18, now + n.offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.offset + n.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + n.offset);
        osc.stop(now + n.offset + n.dur + 0.02);
      }
    } else {
      // Soft outgoing ringback tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.58);
    }
  } catch {
    // Ignore audio context errors
  }
}

export function stopRingtone(): void {
  if (ringtoneTimer !== null && typeof window !== 'undefined') {
    window.clearInterval(ringtoneTimer);
    ringtoneTimer = null;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(0);
    } catch {
      // Ignore
    }
  }
}

export function startRingtone(kind: 'incoming' | 'ringback'): void {
  stopRingtone();
  if (typeof window === 'undefined' || !isSoundEnabled()) return;
  void playRingBurst(kind);
  const periodMs = kind === 'incoming' ? 1900 : 2600;
  ringtoneTimer = window.setInterval(() => {
    void playRingBurst(kind);
  }, periodMs);
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    return swRegistration;
  } catch {
    return null;
  }
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      await registerServiceWorker();
    }
    return result;
  } catch {
    return Notification.permission;
  }
}

export async function showBackgroundNotification(params: {
  title: string;
  body: string;
  chatId: string;
}): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: params.body,
    tag: `kothalink-${params.chatId}`,
    renotify: true,
    silent: false,
    vibrate: [120, 60, 120],
    data: { chatId: params.chatId },
  };

  try {
    if (!swRegistration && 'serviceWorker' in navigator) {
      swRegistration = await navigator.serviceWorker.ready;
    }
    if (swRegistration && typeof swRegistration.showNotification === 'function') {
      await swRegistration.showNotification(params.title, options);
      return;
    }
  } catch {
    // Fallback to Window Notification
  }

  try {
    const n = new Notification(params.title, {
      body: params.body,
      tag: `kothalink-${params.chatId}`,
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some mobile browsers require ServiceWorkerRegistration.showNotification
  }
}
