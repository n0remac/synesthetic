import type { EffectModule, VisualEffect } from '../../engine/protocol';
import { createChain, disconnectChain } from './dsp/chain';
import { createVoicePool } from './dsp/voicePool';
import { defaultADSR, scheduleAttackDecay, scheduleRelease, type ADSR } from './dsp/envelope';
import { attachKeyboard } from './io/keyboard';

const info = {
  id: 'keyboardADSR',
  label: 'Keyboard + ADSR',
  needs: { time: true, fft: true },
  uiSections: [
    { id: 'osc', label: 'Oscillator', color: '#16202a', enabledParam: 'osc.on' },
    { id: 'filt', label: 'Filter', color: '#1f1426', enabledParam: 'filt.on' },
    { id: 'lfo', label: 'LFO / Mod', color: '#1b2616', enabledParam: 'lfo.on' },
    { id: 'env', label: 'Envelope', color: '#261c16', enabledParam: 'env.on' },
    { id: 'fb', label: 'Feedback', color: '#262012', enabledParam: 'fb.on' },
    { id: 'vis', label: 'Visuals', color: '#121a1a', enabledParam: 'vis.on' },
  ],
};

const schema = {
  // toggles (one per section)
  'osc.on': { kind: 'toggle', label: 'Enable', default: true, ui: { section: 'osc' } },
  'filt.on': { kind: 'toggle', label: 'Enable', default: true, ui: { section: 'filt' } },
  'lfo.on': { kind: 'toggle', label: 'Enable', default: true, ui: { section: 'lfo' } },
  'env.on': { kind: 'toggle', label: 'Enable', default: true, ui: { section: 'env' } },
  'fb.on': { kind: 'toggle', label: 'Enable', default: true, ui: { section: 'fb' } },
  'vis.on': { kind: 'toggle', label: 'Enable', default: true, ui: { section: 'vis' } },

  // Osc
  'osc.type': { kind: 'enum', label: 'Wave', options: ['sine', 'square', 'triangle', 'sawtooth'] as const, default: 'sine', ui: { section: 'osc' } },

  // Filter
  'filter.cutoff': { kind: 'number', label: 'LPF Cutoff', min: 100, max: 8000, step: 1, default: 2000, ui: { section: 'filt' } },
  'filter.q': { kind: 'number', label: 'Resonance (Q)', min: 0.1, max: 20, step: 0.1, default: 1, ui: { section: 'filt' } },

  // LFO / Mod
  'lfo.rate': { kind: 'number', label: 'LFO Rate (Hz)', min: 0.05, max: 15, step: 0.01, default: 2, ui: { section: 'lfo' } },
  'mod.lfoToCutoff': { kind: 'number', label: 'LFO → Cutoff', min: 0, max: 4000, step: 1, default: 0, ui: { section: 'lfo' } },

  // Envelope
  'env.attack': { kind: 'number', label: 'Attack (s)', min: 0, max: 2, step: 0.001, default: 0.01, ui: { section: 'env' } },
  'env.decay': { kind: 'number', label: 'Decay (s)', min: 0, max: 2, step: 0.001, default: 0.10, ui: { section: 'env' } },
  'env.sustain': { kind: 'number', label: 'Sustain', min: 0, max: 1, step: 0.001, default: 0.7, ui: { section: 'env' } },
  'env.release': { kind: 'number', label: 'Release (s)', min: 0, max: 4, step: 0.001, default: 0.3, ui: { section: 'env' } },

  // Feedback (shared audio/visual)
  'fb.time': { kind: 'number', label: 'FB Time (ms)', min: 1, max: 1000, step: 1, default: 240, ui: { section: 'fb' } },
  'fb.length': { kind: 'number', label: 'FB Length', min: 0, max: 1, step: 0.01, default: 0.6, ui: { section: 'fb' } },
  'fb.amount': { kind: 'number', label: 'FB Amount (mix)', min: 0, max: 1, step: 0.01, default: 0.25, ui: { section: 'fb' } },

  // Visual
  'vis.blueGain': { kind: 'number', label: 'Blue Gain', min: 0, max: 4, step: 0.01, default: 1, ui: { section: 'vis' } },
  'vis.whiteGain': { kind: 'number', label: 'White Gain', min: 0, max: 4, step: 0.01, default: 1, ui: { section: 'vis' } },
  'vis.shape': { kind: 'number', label: 'Shape (Line↔Ring)', min: 0, max: 1, step: 0.001, default: 1, ui: { section: 'vis' } },
} as const;


const LOOKAHEAD = 0.012;

const audio = {
  mount(ctx: AudioContext) {
    const chain = createChain(ctx);
    const pool = createVoicePool(ctx, chain.filter);

    let oscType: OscillatorType = 'sine';
    let env: ADSR = { ...defaultADSR };

    pool.setOscType(oscType);

    const detachKb = attachKeyboard({
      onDown: (code) => {
        const t0 = ctx.currentTime + LOOKAHEAD;
        pool.noteOn(code, t0, (envNode, t) => scheduleAttackDecay(envNode, t, env));
      },
      onUp: (code) => {
        const t0 = ctx.currentTime + LOOKAHEAD;
        pool.noteOff(code, t0, (envNode, t) => scheduleRelease(envNode, t, env));
      },
    });

    return {
      output: chain.master,

      update(params: Record<string, number | string | boolean>) {
        const t = ctx.currentTime;

        // --- section toggles ---
        const oscOn = !!params['osc.on'];
        const filtOn = !!params['filt.on'];
        const lfoOn = !!params['lfo.on'];
        const envOn = !!params['env.on'];
        const fbOn = !!params['fb.on'];

        // --- OSC toggle ---
        // We handle “don’t start new notes” at the keyboard layer typically.
        // If you also want a hard mute when off, uncomment:
        if (!oscOn) { /* optionally: iterate voices and ramp env.gain to 0 quickly */ }

        // --- FILTER (bypass by neutralizing when off) ---
        if (!filtOn) {
          chain.filter.frequency.setTargetAtTime(20000, t, 0.01);
          chain.filter.Q.setTargetAtTime(0.0001, t, 0.01);
        } else {
          if (typeof params['filter.cutoff'] === 'number') {
            chain.filter.frequency.setTargetAtTime(params['filter.cutoff'] as number, t, 0.01);
          }
          if (typeof params['filter.q'] === 'number') {
            chain.filter.Q.setTargetAtTime(params['filter.q'] as number, t, 0.01);
          }
        }

        // --- LFO (bypass by zeroing depth when off) ---
        if (!lfoOn) {
          chain.lfoGain.gain.setTargetAtTime(0, t, 0.01);
        } else {
          if (typeof params['lfo.rate'] === 'number') {
            chain.lfo.frequency.setTargetAtTime(params['lfo.rate'] as number, t, 0.01);
          }
          if (typeof params['mod.lfoToCutoff'] === 'number') {
            chain.lfoGain.gain.setTargetAtTime(params['mod.lfoToCutoff'] as number, t, 0.01);
          }
        }

        // --- FEEDBACK (bypass by zeroing wet + loop gain when off) ---
        if (fbOn) {
          if (typeof params['fb.time'] === 'number') {
            const sec = Math.min(2.0, Math.max(0.001, (params['fb.time'] as number) / 1000));
            chain.fbDelay.delayTime.setTargetAtTime(sec, t, 0.01);
          }
          if (typeof params['fb.length'] === 'number') {
            const len = Math.min(1, Math.max(0, params['fb.length'] as number));
            const fb = Math.min(0.95, Math.pow(len, 0.6) * 0.95);
            chain.fbGain.gain.setTargetAtTime(fb, t, 0.01);
          }
          if (typeof params['fb.amount'] === 'number') {
            const amt = Math.min(1, Math.max(0, params['fb.amount'] as number));
            chain.fbWet.gain.setTargetAtTime(amt, t, 0.01);
          }
        } else {
          chain.fbWet.gain.setTargetAtTime(0, t, 0.01);   // no wet
          chain.fbGain.gain.setTargetAtTime(0, t, 0.01);  // break loop
          // Optional: shrink delay time to clear residual a bit faster
          // chain.fbDelay.delayTime.setTargetAtTime(0.01, t, 0.01);
        }

        // --- MASTER ---
        if (typeof params['amp.gain'] === 'number') {
          chain.master.gain.setTargetAtTime(params['amp.gain'] as number, t, 0.01);
        }

        // --- OSC TYPE (affects new/existing pooled voices immediately) ---
        if (typeof params['osc.type'] === 'string') {
          oscType = params['osc.type'] as OscillatorType;
          pool.setOscType(oscType);
        }

        // --- ENVELOPE (when off, gate future notes fully open/instant) ---
        if (!envOn) {
          env.A = 0; env.D = 0; env.S = 1; env.R = 0;
        } else {
          if (typeof params['env.attack'] === 'number') env.A = Math.max(0, params['env.attack'] as number);
          if (typeof params['env.decay'] === 'number') env.D = Math.max(0, params['env.decay'] as number);
          if (typeof params['env.sustain'] === 'number') env.S = Math.min(1, Math.max(0, params['env.sustain'] as number));
          if (typeof params['env.release'] === 'number') env.R = Math.max(0, params['env.release'] as number);
        }
      },

      dispose() {
        detachKb();
        pool.dispose();
        disconnectChain(chain);
      },
    };
  },
};


const visual: VisualEffect = {
  init(ctx, { w, h }) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Accumulation buffer for trails
    // @ts-expect-error
    ctx.__trail = new OffscreenCanvas(w, h);
    // @ts-expect-error
    ctx.__trailCtx = (ctx.__trail as OffscreenCanvas).getContext('2d');
    // @ts-expect-error
    ctx.__trailCtx!.fillStyle = '#000';
    // @ts-expect-error
    ctx.__trailCtx!.fillRect(0, 0, w, h);

    // @ts-expect-error
    ctx.__lastT = undefined;
  },

  frame({ ctx, freq, time, params, dt }) {
    if (params['vis.on'] === false) return;

    const w = (ctx.canvas as OffscreenCanvas).width;
    const h = (ctx.canvas as OffscreenCanvas).height;
    const cx = w / 2, cy = h / 2;

    // Acquire trail buffer
    // @ts-expect-error
    let trail: OffscreenCanvas = ctx.__trail;
    // @ts-expect-error
    let tctx: OffscreenCanvasRenderingContext2D | null = ctx.__trailCtx;
    if (!trail || !tctx) {
      trail = new OffscreenCanvas(w, h);
      tctx = trail.getContext('2d');
      if (!tctx) return;
      tctx.fillStyle = '#000';
      tctx.fillRect(0, 0, w, h);
      // @ts-expect-error
      ctx.__trail = trail;
      // @ts-expect-error
      ctx.__trailCtx = tctx;
    }
    if (trail.width !== w || trail.height !== h) {
      trail.width = w; trail.height = h;
    }

    // dt
    const nowPerf = performance.now() * 0.001;
    // @ts-expect-error
    const prevPerf = typeof ctx.__lastT === 'number' ? ctx.__lastT : nowPerf - (1 / 60);
    // @ts-expect-error
    ctx.__lastT = nowPerf;
    const DT = typeof dt === 'number' ? Math.max(0.001, dt) : Math.max(0.001, nowPerf - prevPerf);

    // Params
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
    const fbOn   = params['fb.on'] !== false;
    const amt    = clamp01(Number(params['fb.amount'] ?? 0.25));
    const len    = clamp01(Number(params['fb.length'] ?? 0.6));
    const timeS  = Math.max(0.001, Math.min(2.0, Number(params['fb.time'] ?? 240) / 1000));
    const visGainGlobal = Number(params['vis.gain'] ?? 1);
    const blueGain  = Number(params['vis.blueGain']  ?? 1) * visGainGlobal;
    const whiteGain = Number(params['vis.whiteGain'] ?? 1) * visGainGlobal;
    const shape     = clamp01(Number(params['vis.shape'] ?? 1)); // 0=line, 1=ring

    // Audio-matched decay
    const g = Math.min(0.95, Math.pow(len, 0.6) * 0.95);
    const f = Math.pow(g, Math.max(0.001, DT) / Math.max(0.001, timeS));
    const decayAlpha = 1 - f;

    // Trail handling
    if (fbOn) {
      tctx.globalCompositeOperation = 'source-over';
      tctx.globalAlpha = 1;
      tctx.fillStyle = `rgba(0,0,0,${decayAlpha})`;
      tctx.fillRect(0, 0, w, h);
    } else {
      tctx.globalCompositeOperation = 'source-over';
      tctx.globalAlpha = 1;
      tctx.fillStyle = '#000';
      tctx.fillRect(0, 0, w, h);
    }

    // 2) Fresh frame
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Morph helpers (start at top: angle offset = -90°)
    const ANGLE0 = -Math.PI / 2; // top
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    // line baselines (fold away as shape→0)
    const baseGap = 48;              // gap at full ring (small, for nice transition)
    const extraGap = 120;            // additional gap as it flattens
    const gap = baseGap + extraGap * (1 - shape); // separates the two lines

    // gentle arch while straightening (so it "curves up" in 2D)
    // arch magnitude fades out to 0 as shape→0 (at perfect lines)
    const archK = 40 * shape; // pixels of arc at mid

    // map a normalized 0..1 position to [left..right] x on the line
    const xFromT = (tNorm: number) => lerp(w * 0.12, w * 0.88, tNorm);

    // Draw a morphing path from half-ring → line
    function drawMorphPath({
      N,
      sampleAt,           // (i) -> amplitude [-1..1] or [0..1] scaled already
      ringBaseR,          // base ring radius
      ringScale,          // multiplier for amplitude on the ring radius
      lineY,              // baseline Y for line (upper or lower)
      stroke, width,
    }: {
      N: number;
      sampleAt: (i: number) => number;
      ringBaseR: number;
      ringScale: number;
      lineY: number;
      stroke: string;
      width: number;
    }) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;

      // We draw two independent paths (halves), so ends detach
      const halves: Array<{ i0: number; i1: number }> = [
        { i0: 0,      i1: Math.floor(N / 2) },      // top→bottom (first half)
        { i0: Math.floor(N / 2), i1: N - 1 },       // bottom→top (second half)
      ];

      for (const { i0, i1 } of halves) {
        ctx.beginPath();
        const dir = i1 >= i0 ? 1 : -1;
        for (let i = i0; dir > 0 ? i <= i1 : i >= i1; i += dir) {
          const tNorm = i / (N - 1);

          // Angle runs 0..2π with start at top
          const ang = ANGLE0 + tNorm * Math.PI * 2;

          // Sample (“amplitude”)
          const a = sampleAt(i); // already scaled by ringScale/line scale outside as needed

          // Ring coords
          const rRing = ringBaseR + a * ringScale;
          const xRing = cx + Math.cos(ang) * rRing;
          const yRing = cy + Math.sin(ang) * rRing;

          // Line coords
          const xLine = xFromT((i - i0) / (i1 - i0 || 1)); // 0..1 across half
          // arch along the half (cosine arch, peak in the middle)
          const arch = archK * Math.cos(((i - i0) / (i1 - i0 || 1)) * Math.PI);
          const yLine = lineY + a * ringScale * 0.25 + arch; // a slight amplitude on line too

          // Morph
          const x = lerp(xLine, xRing, shape);
          const y = lerp(yLine, yRing, shape);

          if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        // Do NOT close — keeps ends detached
        ctx.stroke();
      }
    }

    // ---- Blue (FFT) ----
    if (freq && freq.length) {
      const step = Math.max(1, Math.floor(freq.length / 128)); // finer sampling for smoother arcs
      const N = 128;
      const sampleAt = (i: number) => {
        const idx = Math.min(freq.length - 1, i * step);
        return (freq[idx] / 255) * blueGain; // 0..blueGain
      };

      // upper/lower halves fold away
      drawMorphPath({
        N,
        sampleAt,
        ringBaseR: 130,
        ringScale: 140,
        lineY: cy - gap,           // upper line
        stroke: 'hsl(200,80%,70%)',
        width: 2,
      });
      drawMorphPath({
        N,
        sampleAt,
        ringBaseR: 130,
        ringScale: 140,
        lineY: cy + gap,           // lower line
        stroke: 'hsl(200,80%,70%)',
        width: 2,
      });
    }

    // ---- White (time-domain) ----
    if (time && time.length) {
      const N = time.length;
      const sampleAt = (i: number) => ((time[i] - 128) / 128) * whiteGain * 2; // -whiteGain..+whiteGain

      drawMorphPath({
        N,
        sampleAt,
        ringBaseR: 210,
        ringScale: 40,
        lineY: cy - gap * 0.6,     // place near upper
        stroke: 'white',
        width: 1,
      });
      drawMorphPath({
        N,
        sampleAt,
        ringBaseR: 210,
        ringScale: 40,
        lineY: cy + gap * 0.6,     // and near lower
        stroke: 'white',
        width: 1,
      });
    }

    // 3) MIX into trail (only when feedback ON)
    if (fbOn && amt > 0) {
      tctx.save();
      tctx.globalCompositeOperation = 'source-over';
      tctx.globalAlpha = amt;
      tctx.filter = 'blur(0.6px)';   // subtle bloom
      tctx.drawImage((ctx.canvas as any) as CanvasImageSource, 0, 0);
      tctx.filter = 'none';
      tctx.restore();
    }

    // 4) COMPOSITE trail
    if (fbOn) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(trail, 0, 0);
    }
  },
};


export default { info, schema, audio, visual } satisfies EffectModule;
