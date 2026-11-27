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

// Build a warm, glassy two-tone marimba WAV chime in memory for background/locked fallback playback
function buildChimeWavDataUrl(): string {
  if (cachedWavUrl) return cachedWavUrl;
  const sampleRate = 22050;
  const durationSec = 0.46;
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

  // E5 -> B5 warm harmonic bell interval with subtle octave shimmer
  const notes = [
    { freq: 659.25, harmonic: 1318.5, start: 0.0, dur: 0.22, amp: 0.3, hAmp: 0.06, decay: 11 },
    { freq: 987.77, harmonic: 1975.53, start: 0.085, dur: 0.32, amp: 0.34, hAmp: 0.07, decay: 8.5 },
  ];

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (const n of notes) {
      if (t >= n.start && t <= n.start + n.dur) {
        const localT = t - n.start;
        const attack = Math.min(1, localT / 0.01);
        const decay = Math.exp(-localT * n.decay);
        const fundamental = Math.sin(2 * Math.PI * n.freq * localT) * n.amp;
        const overtone = Math.sin(2 * Math.PI * n.harmonic * localT) * n.hAmp * Math.exp(-localT * 18);
        sample += (fundamental + overtone) * attack * decay;
      }
    }
    const clamped = Math.max(-0.92, Math.min(0.92, sample));
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
      navigator.vibrate([70, 45, 90]);
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
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3400, now);
        filter.connect(ctx.destination);

        const triggerBell = (freq: number, startOffset: number, dur: number, peakAmp: number) => {
          const osc = ctx.createOscillator();
          const overtone = ctx.createOscillator();
          const gain = ctx.createGain();
          const overGain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + startOffset);

          overtone.type = 'sine';
          overtone.frequency.setValueAtTime(freq * 2, now + startOffset);

          gain.gain.setValueAtTime(0.0001, now + startOffset);
          gain.gain.exponentialRampToValueAtTime(peakAmp, now + startOffset + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + dur);

          overGain.gain.setValueAtTime(0.0001, now + startOffset);
          overGain.gain.exponentialRampToValueAtTime(peakAmp * 0.2, now + startOffset + 0.008);
          overGain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + dur * 0.45);

          osc.connect(gain);
          overtone.connect(overGain);
          gain.connect(filter);
          overGain.connect(filter);

          osc.start(now + startOffset);
          overtone.start(now + startOffset);
          osc.stop(now + startOffset + dur + 0.02);
          overtone.stop(now + startOffset + dur + 0.02);
        };

        // Warm glassy marimba two-step: E5 -> B5
        triggerBell(659.25, 0, 0.22, 0.16);
        triggerBell(987.77, 0.085, 0.32, 0.19);
        return;
      } catch {
        // Fall through to HTMLAudioElement
      }
    }
  }

  const audioEl = getOrCreateFallbackAudio();
  if (audioEl) {
    try {
      audioEl.volume = 0.85;
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
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.connect(ctx.destination);

    // Subtle crisp waterdrop upward pluck
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(860, now + 0.055);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.085, now + 0.009);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

    osc.connect(gain);
    gain.connect(filter);
    osc.start(now);
    osc.stop(now + 0.085);
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
  if (fallbackAudioEl) {
    try {
      fallbackAudioEl.pause();
      fallbackAudioEl.currentTime = 0;
    } catch {
      // Ignore
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(0);
    } catch {
      // Ignore
    }
  }
}

export function suspendAudioForCall(): void {
  stopRingtone();
  if (audioCtx && audioCtx.state === 'running') {
    audioCtx.suspend().catch(() => {});
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

export async function playCallPickupTone(): Promise<void> {
  if (!isSoundEnabled()) return;
  const ctx = await ensureRunningContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const notes = [
      { freq: 523.25, start: 0, dur: 0.14 },
      { freq: 783.99, start: 0.07, dur: 0.22 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      gain.gain.setValueAtTime(0.0001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(0.14, now + n.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.02);
    }
  } catch {
    // Ignore audio errors
  }
}

export async function playCallHangupTone(): Promise<void> {
  if (!isSoundEnabled()) return;
  const ctx = await ensureRunningContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const notes = [
      { freq: 587.33, start: 0, dur: 0.14 },
      { freq: 392.0, start: 0.08, dur: 0.24 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      gain.gain.setValueAtTime(0.0001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(0.13, now + n.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.02);
    }
  } catch {
    // Ignore audio errors
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) {
      swRegistration = existing;
      return existing;
    }
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    return swRegistration;
  } catch {
    try {
      swRegistration = await navigator.serviceWorker.ready;
      return swRegistration;
    } catch {
      return null;
    }
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
    tag: `looply-${params.chatId}`,
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
      tag: `looply-${params.chatId}`,
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
