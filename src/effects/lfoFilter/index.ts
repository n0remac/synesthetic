import type { EffectModule, VisualEffect } from '../../engine/protocol';

const info = { id: 'lfoFilter', label: 'LFO → Lowpass', needs: { time: true, fft: true } } as const;

const schema = {
  'amp.gain':        { kind: 'number', label: 'Master Gain', min: 0, max: 1, step: 0.001, default: 0.2 },
  'osc.type':        { kind: 'enum',   label: 'Wave', options: ['sine','square','triangle','sawtooth'] as const, default: 'sine' },
  'osc.freq':        { kind: 'number', label: 'Frequency', min: 50, max: 1200, step: 1, default: 220 },
  'filter.cutoff':   { kind: 'number', label: 'LPF Cutoff', min: 100, max: 8000, step: 1, default: 2000 },
  'filter.q':        { kind: 'number', label: 'Resonance (Q)', min: 0.1, max: 20, step: 0.1, default: 1 },
  'lfo.rate':        { kind: 'number', label: 'LFO Rate (Hz)', min: 0.05, max: 15, step: 0.01, default: 2 },
  'mod.lfoToCutoff': { kind: 'number', label: 'LFO → Cutoff', min: 0, max: 4000, step: 1, default: 0 },
  'vis.feedback':    { kind: 'number', label: 'Feedback', min: 0.8, max: 0.999, step: 0.001, default: 0.96 },
  'vis.gain':        { kind: 'number', label: 'Visual Gain', min: 0, max: 4, step: 0.01, default: 1 },
} as const;

const audio = {
  mount(ctx: AudioContext) {
    const osc = new OscillatorNode(ctx);
    const filt = new BiquadFilterNode(ctx, { type: 'lowpass' });
    const lfo = new OscillatorNode(ctx, { type: 'sine' });
    const lfoGain = new GainNode(ctx);
    const gain = new GainNode(ctx);

    lfo.connect(lfoGain);
    lfoGain.connect(filt.frequency);
    osc.connect(filt);
    filt.connect(gain);
    gain.connect(ctx.destination);

    osc.start(); lfo.start();

    return {
      output: gain,
      update(params: Record<string, number | string>) {
        osc.type = params['osc.type'] as OscillatorType;
        osc.frequency.setTargetAtTime(Number(params['osc.freq']), ctx.currentTime, 0.01);
        gain.gain.setTargetAtTime(Number(params['amp.gain']), ctx.currentTime, 0.01);
        filt.frequency.setTargetAtTime(Number(params['filter.cutoff']), ctx.currentTime, 0.01);
        filt.Q.setTargetAtTime(Number(params['filter.q']), ctx.currentTime, 0.01);
        lfo.frequency.setTargetAtTime(Number(params['lfo.rate']), ctx.currentTime, 0.01);
        lfoGain.gain.setTargetAtTime(Number(params['mod.lfoToCutoff']), ctx.currentTime, 0.01);
      },
      dispose() {
        try { osc.stop(); lfo.stop(); } catch {}
        osc.disconnect(); lfo.disconnect(); lfoGain.disconnect(); filt.disconnect(); gain.disconnect();
      },
    };
  },
};

// ✅ Conform to VisualEffect: optional time/freq + required dt
const visual: VisualEffect = {
  init(ctx, { w, h }) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  },
  frame({ ctx, freq, time, params /*, dt*/ }) {
    const w = (ctx.canvas as OffscreenCanvas).width;
    const h = (ctx.canvas as OffscreenCanvas).height;

    // feedback fade
    const fb = 1 - Number(params['vis.feedback']);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0,0,0,${fb})`;
    ctx.fillRect(0, 0, w, h);

    // radial spectrum (guard for optional freq)
    if (freq && freq.length) {
      const step = Math.floor(freq.length / 64) || 1;
      const cx = w / 2, cy = h / 2;
      ctx.strokeStyle = 'hsl(180,80%,70%)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 64; i++) {
        const v = (freq[i * step] / 255) * Number(params['vis.gain']);
        const ang = (i / 64) * Math.PI * 2;
        const r = 120 + v * 240;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // optional: draw waveform ring if time is available
    if (time && time.length) {
      const cx = w / 2, cy = h / 2;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < time.length; i++) {
        const t = (time[i] - 128) / 128; // -1..1
        const ang = (i / time.length) * Math.PI * 2;
        const r = 200 + t * 40;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  },
};

export default { info, schema, audio, visual } satisfies EffectModule;
