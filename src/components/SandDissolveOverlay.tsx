import React, { useImperativeHandle, useRef } from 'react';

export interface SandDissolveHandle {
  triggerBurst: (rect: DOMRect, options?: { isMe?: boolean; isDark?: boolean }) => void;
}

interface SandGrain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
  delayMs: number;
  elapsedMs: number;
  lifeMs: number;
  phase: number;
  turbulence: number;
}

const DESERT_SAND_PALETTE = [
  '#f59e0b',
  '#fbbf24',
  '#fde68a',
  '#d97706',
  '#fef3c7',
  '#eab308',
];

const SELF_BUBBLE_TINTS = ['#3b82f6', '#60a5fa', '#93c5fd', '#2563eb'];
const PEER_LIGHT_TINTS = ['#e2e8f0', '#cbd5e1', '#f1f5f9'];
const PEER_DARK_TINTS = ['#334155', '#475569', '#64748b'];

export const SandDissolveOverlay = React.forwardRef<SandDissolveHandle>((_props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const grainsRef = useRef<SandGrain[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);

  const stopLoopIfEmpty = () => {
    if (grainsRef.current.length === 0 && rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const ensureCanvasSize = (canvas: HTMLCanvasElement) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    return dpr;
  };

  const startLoop = () => {
    if (rafRef.current !== null) return;
    lastTsRef.current = performance.now();

    const tick = (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        rafRef.current = null;
        return;
      }

      const dtMs = Math.min(34, Math.max(8, now - lastTsRef.current));
      lastTsRef.current = now;
      const dt = dtMs / 1000;

      const dpr = ensureCanvasSize(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafRef.current = null;
        return;
      }

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const remaining: SandGrain[] = [];
      const grains = grainsRef.current;

      for (let i = 0; i < grains.length; i++) {
        const g = grains[i];
        if (g.delayMs > 0) {
          g.delayMs -= dtMs;
          remaining.push(g);
          continue;
        }

        g.elapsedMs += dtMs;
        if (g.elapsedMs >= g.lifeMs) {
          continue;
        }

        const progress = g.elapsedMs / g.lifeMs;

        // Desert wind gust sweeps across and lifts fine sand grains into the breeze
        const windAccel = 220 + progress * 260;
        g.vx += windAccel * dt;
        g.vy += (-36 + Math.sin(g.elapsedMs * 0.014 + g.phase) * g.turbulence) * dt;

        g.x += g.vx * dt;
        g.y += g.vy * dt;

        const fade = progress < 0.15 ? progress / 0.15 : 1 - (progress - 0.15) / 0.85;
        const curAlpha = Math.max(0, Math.min(1, g.alpha * fade));
        const curRadius = Math.max(0.4, g.size * (1 - progress * 0.62));

        ctx.globalAlpha = curAlpha;
        ctx.fillStyle = g.color;
        ctx.beginPath();
        ctx.arc(g.x, g.y, curRadius, 0, Math.PI * 2);
        ctx.fill();

        remaining.push(g);
      }

      ctx.restore();
      grainsRef.current = remaining;

      if (remaining.length > 0) {
        rafRef.current = window.requestAnimationFrame(tick);
      } else {
        stopLoopIfEmpty();
      }
    };

    rafRef.current = window.requestAnimationFrame(tick);
  };

  useImperativeHandle(ref, () => ({
    triggerBurst: (rect, options) => {
      if (typeof window === 'undefined') return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (rect.width <= 0 || rect.height <= 0) return;

      const isMe = Boolean(options?.isMe);
      const isDark = Boolean(options?.isDark);
      const bubbleTints = isMe
        ? SELF_BUBBLE_TINTS
        : isDark
        ? PEER_DARK_TINTS
        : PEER_LIGHT_TINTS;

      const area = rect.width * rect.height;
      const count = Math.max(95, Math.min(175, Math.round(area / 70)));

      for (let i = 0; i < count; i++) {
        const rx = Math.random();
        const ry = Math.random();
        const px = rect.left + rx * rect.width;
        const py = rect.top + ry * rect.height;

        // Sweep wind wave left-to-right (or slight diagonal) so bubble dissolves into sand
        const sweepFraction = isMe ? rx : rx * 0.85 + ry * 0.15;
        const delayMs = sweepFraction * 200 + Math.random() * 55;
        const useSand = Math.random() < 0.68;
        const color = useSand
          ? DESERT_SAND_PALETTE[Math.floor(Math.random() * DESERT_SAND_PALETTE.length)]
          : bubbleTints[Math.floor(Math.random() * bubbleTints.length)];

        grainsRef.current.push({
          x: px,
          y: py,
          vx: 38 + Math.random() * 95,
          vy: -14 - Math.random() * 38 + (ry - 0.5) * 18,
          size: 1.3 + Math.random() * 2.1,
          alpha: 0.82 + Math.random() * 0.18,
          color,
          delayMs,
          elapsedMs: 0,
          lifeMs: 520 + Math.random() * 320,
          phase: Math.random() * Math.PI * 2,
          turbulence: 55 + Math.random() * 95,
        });
      }

      startLoop();
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 z-[75] pointer-events-none"
    />
  );
});

SandDissolveOverlay.displayName = 'SandDissolveOverlay';
