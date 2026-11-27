// 100% Free Built-In WebSocket Live Voice Relay (16kHz Int16 PCM fallback when strict NAT/firewalls block WebRTC P2P)

export interface VoiceRelaySession {
  setMuted: (muted: boolean) => void;
  setPaused: (paused: boolean) => void;
  setSpeakerMode: (speakerOn: boolean) => void;
  sendHoldState: (onHold: boolean) => void;
  resumePlayback: () => Promise<boolean>;
  stop: () => void;
}

export interface StartVoiceRelayParams {
  callId: string;
  uid: string;
  localStream: MediaStream;
  initiallyMuted?: boolean;
  initiallySpeakerOn?: boolean;
  onPeerStateChange?: (peerJoined: boolean) => void;
  onPeerHoldChange?: (peerOnHold: boolean) => void;
  onReceivingAudio?: () => void;
  onAudioLevel?: (level: number) => void;
  onPlaybackBlocked?: (blocked: boolean) => void;
  onRelayError?: () => void;
}

const TARGET_SAMPLE_RATE = 16000;

function downsampleToInt16(input: Float32Array, inputRate: number, outputRate: number): Int16Array {
  if (inputRate === outputRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 32768 : s * 32767;
    }
    return out;
  }

  const ratio = inputRate / outputRate;
  const newLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    const interpolated = s0 + (s1 - s0) * frac;
    const clamped = Math.max(-1, Math.min(1, interpolated));
    out[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }

  return out;
}

export function startVoiceRelay(params: StartVoiceRelayParams): VoiceRelaySession {
  let stopped = false;
  let muted = Boolean(params.initiallyMuted);
  let paused = false;
  let speakerGainValue = params.initiallySpeakerOn === false ? 0.65 : 1.4;
  let peerJoined = false;
  let ws: WebSocket | null = null;
  let ctx: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let silentGain: GainNode | null = null;
  let outputGain: GainNode | null = null;
  let nextPlayTime = 0;
  let activeSources: AudioBufferSourceNode[] = [];

  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  const ensureAudioContext = async (): Promise<AudioContext | null> => {
    if (!Ctx || stopped) return null;
    if (!ctx) {
      try {
        ctx = new Ctx();
      } catch {
        return null;
      }
    }
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Autoplay restriction until user gesture
      }
    }
    if (ctx.state !== 'running') {
      params.onPlaybackBlocked?.(true);
    } else {
      params.onPlaybackBlocked?.(false);
    }
    return ctx;
  };

  const setupCapturePipeline = async () => {
    const audioCtx = await ensureAudioContext();
    if (!audioCtx || stopped) return;

    try {
      const audioTracks = params.localStream.getAudioTracks();
      if (audioTracks.length === 0) return;

      const micOnlyStream = new MediaStream(audioTracks);
      sourceNode = audioCtx.createMediaStreamSource(micOnlyStream);
      processor = audioCtx.createScriptProcessor(2048, 1, 1);
      silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;

      outputGain = audioCtx.createGain();
      outputGain.gain.value = speakerGainValue;
      outputGain.connect(audioCtx.destination);

      processor.onaudioprocess = (ev) => {
        if (stopped || paused || muted || !peerJoined) return;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const input = ev.inputBuffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < input.length; i += 4) {
          const abs = Math.abs(input[i]);
          if (abs > peak) peak = abs;
        }
        if (peak > 0.008) {
          params.onAudioLevel?.(Math.min(1, peak * 2.5));
        }

        // Skip sending pure digital silence to save mobile bandwidth
        if (peak < 0.0008) return;

        const pcm16 = downsampleToInt16(input, audioCtx.sampleRate, TARGET_SAMPLE_RATE);
        try {
          ws.send(pcm16.buffer as ArrayBuffer);
        } catch {
          // Ignore transient send failures
        }
      };

      sourceNode.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);
    } catch {
      params.onRelayError?.();
    }
  };

  const scheduleIncomingPcm = async (buffer: ArrayBuffer) => {
    if (stopped || paused) return;
    const audioCtx = await ensureAudioContext();
    if (!audioCtx || stopped || paused) return;

    if (!outputGain) {
      outputGain = audioCtx.createGain();
      outputGain.gain.value = speakerGainValue;
      outputGain.connect(audioCtx.destination);
    }

    const int16 = new Int16Array(buffer);
    if (int16.length === 0) return;

    const float32 = new Float32Array(int16.length);
    let peak = 0;
    for (let i = 0; i < int16.length; i++) {
      const f = int16[i] / 32768;
      float32[i] = f;
      const abs = Math.abs(f);
      if (abs > peak) peak = abs;
    }

    if (peak > 0.008) {
      params.onAudioLevel?.(Math.min(1, peak * 2.6));
    }
    params.onReceivingAudio?.();

    const audioBuffer = audioCtx.createBuffer(1, float32.length, TARGET_SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    const src = audioCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(outputGain);

    const now = audioCtx.currentTime;
    if (nextPlayTime < now + 0.015) {
      nextPlayTime = now + 0.055; // 55ms jitter cushion
    } else if (nextPlayTime > now + 0.35) {
      nextPlayTime = now + 0.07; // Clamp latency drift
    }

    src.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;
    activeSources.push(src);
    src.onended = () => {
      activeSources = activeSources.filter((s) => s !== src);
    };
  };

  const connectWs = () => {
    if (stopped || typeof window === 'undefined') return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/call?callId=${encodeURIComponent(
      params.callId
    )}&uid=${encodeURIComponent(params.uid)}`;

    try {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
    } catch {
      params.onRelayError?.();
      return;
    }

    ws.onmessage = (event) => {
      if (stopped) return;
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as {
            type?: string;
            count?: number;
            onHold?: boolean;
          };
          if (msg.type === 'peers') {
            peerJoined = Number(msg.count || 0) >= 2;
            params.onPeerStateChange?.(peerJoined);
          } else if (msg.type === 'hold') {
            params.onPeerHoldChange?.(Boolean(msg.onHold));
          }
        } catch {
          // Ignore invalid JSON control frame
        }
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        void scheduleIncomingPcm(event.data);
      } else if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buf) => scheduleIncomingPcm(buf));
      }
    };

    ws.onerror = () => {
      params.onRelayError?.();
    };
  };

  void setupCapturePipeline();
  connectWs();

  return {
    setMuted: (nextMuted: boolean) => {
      muted = nextMuted;
    },
    setSpeakerMode: (speakerOn: boolean) => {
      speakerGainValue = speakerOn ? 1.4 : 0.65;
      if (outputGain) {
        outputGain.gain.value = speakerGainValue;
      }
    },
    sendHoldState: (onHold: boolean) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'hold', onHold }));
        } catch {
          // Ignore transient send error
        }
      }
    },
    setPaused: (nextPaused: boolean) => {
      paused = nextPaused;
      if (paused) {
        nextPlayTime = 0;
        activeSources.forEach((s) => {
          try {
            s.stop();
          } catch {
            // Ignore
          }
        });
        activeSources = [];
      }
    },
    resumePlayback: async () => {
      const audioCtx = await ensureAudioContext();
      return Boolean(audioCtx && audioCtx.state === 'running');
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      activeSources.forEach((s) => {
        try {
          s.stop();
        } catch {
          // Ignore
        }
      });
      activeSources = [];
      if (processor) {
        processor.onaudioprocess = null;
        try {
          processor.disconnect();
        } catch {
          // Ignore
        }
        processor = null;
      }
      if (sourceNode) {
        try {
          sourceNode.disconnect();
        } catch {
          // Ignore
        }
        sourceNode = null;
      }
      if (silentGain) {
        try {
          silentGain.disconnect();
        } catch {
          // Ignore
        }
        silentGain = null;
      }
      if (outputGain) {
        try {
          outputGain.disconnect();
        } catch {
          // Ignore
        }
        outputGain = null;
      }
      if (ws) {
        try {
          ws.close(1000, 'Call ended');
        } catch {
          // Ignore
        }
        ws = null;
      }
      if (ctx) {
        ctx.close().catch(() => {});
        ctx = null;
      }
    },
  };
}
