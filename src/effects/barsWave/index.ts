// effects/barsWave/index.ts
import type { EffectModule, VisualEffect } from '../../engine/protocol';

const info = { id: 'barsWave', label: 'Bars + Wave', needs: { fft: true, time: true } } as const;

const schema = {
  'amp.gain':     { kind: 'number', label: 'Master Gain', min: 0, max: 1, step: 0.001, default: 0.2 },
  'osc.type':     { kind: 'enum',   label: 'Wave', options: ['sine','square','triangle','sawtooth'] as const, default: 'sine' },
  'osc.freq':     { kind: 'number', label: 'Frequency', min: 50, max: 1200, step: 1, default: 220 },
  'vis.feedback': { kind: 'number', label: 'Feedback', min: 0.8, max: 0.999, step: 0.001, default: 0.96 },
  'vis.gain':     { kind: 'number', label: 'Visual Gain', min: 0, max: 4, step: 0.01, default: 1 },
} as const;

const audio = {
  mount(ctx: AudioContext) {
    const osc = new OscillatorNode(ctx);
    const gain = new GainNode(ctx);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    return {
      output: gain,
      update(params: Record<string, number | string>) {
        osc.type = params['osc.type'] as OscillatorType;
        osc.frequency.setTargetAtTime(Number(params['osc.freq']), ctx.currentTime, 0.01);
        gain.gain.setTargetAtTime(Number(params['amp.gain']), ctx.currentTime, 0.01);
      },
      dispose() { try { osc.stop(); } catch {} osc.disconnect(); gain.disconnect(); },
    };
  },
};

// ✅ Explicitly type as VisualEffect and accept optional time/freq + required dt
const visual: VisualEffect = {
  init(ctx, { w, h }) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  },
  frame({ ctx, time, freq, params /*, dt*/ }) {
    const w = (ctx.canvas as OffscreenCanvas).width;
    const h = (ctx.canvas as OffscreenCanvas).height;

    // feedback fade
    const fb = 1 - Number(params['vis.feedback']);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0,0,0,${fb})`;
    ctx.fillRect(0, 0, w, h);

    // bars (guard for optional freq)
    if (freq && freq.length) {
      const N = 128;
      const step = Math.max(1, Math.floor(freq.length / N));
      const barW = w / N;
      for (let i = 0; i < N; i++) {
        const v = freq[i * step] / 255;
        const amp = v * v * Number(params['vis.gain']);
        ctx.fillStyle = `hsl(${Math.floor(200 + 160 * v)},80%,${Math.floor(50 + 40 * v)}%)`;
        ctx.fillRect(i * barW, h - amp * h, barW - 1, amp * h);
      }
    }

    // waveform (guard for optional time)
    if (time && time.length) {
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < time.length; i++) {
        const x = (i / (time.length - 1)) * w;
        const y = (time[i] / 255) * h;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
};

export default { info, schema, audio, visual } satisfies EffectModule;
