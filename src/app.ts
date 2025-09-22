// src/app.ts
import type { EffectModule, VisualEffect } from './engine/protocol';
import { createChain, disconnectChain } from './audio/dsp/chain';
import { createVoicePool } from './audio/dsp/voicePool';
import { defaultADSR, scheduleAttackDecay, scheduleRelease, type ADSR } from './audio/dsp/envelope';
import { attachKeyboard } from './audio/io/keyboard';
import { makeVisualEffect } from './engine/visualEngine';

const info = {
  id: 'keyboardADSR',
  label: 'Keyboard + ADSR',
  needs: { time: true, fft: true },
  uiSections: [
    { id: 'vis', label: 'Visuals', color: '#121a1a' },          // only mode + morph
    
    { id: 'osc', label: 'Oscillator', color: '#16202a', enabledParam: '' },
    { id: 'filt', label: 'Filter', color: '#1f1426', enabledParam: 'filt.on' },
    { id: 'lfo', label: 'LFO / Mod', color: '#1b2616', enabledParam: 'lfo.on' },
    { id: 'env', label: 'Envelope', color: '#261c16', enabledParam: 'env.on' },
    { id: 'fb', label: 'Feedback', color: '#262012', enabledParam: 'fb.on' },

    // Visuals groups
    { id: 'circle', label: 'Circle / Line', color: '#10121a' },          // circleLine-only
    { id: 'boids', label: 'Boids', color: '#0f1410' },          // boids-only (gated by controls.ts)
    { id: 'bugs', label: 'Bugs', color: '#0d1012' },          // bugs-only (gated by controls.ts)
  ],
};

const schema = {
  // toggles (one per section)
  // 'osc.on': { kind: 'toggle', label: 'Enable', default: true, ui: { section: 'osc' } },
  'filt.on': { kind: 'toggle', label: 'Enable', default: true, ui: { section: 'filt' } },
  'lfo.on': { kind: 'toggle', label: 'Enable', default: true, ui: { section: 'lfo' } },
  'env.on': { kind: 'toggle', label: 'Enable', default: true, ui: { section: 'env' } },
  'fb.on': { kind: 'toggle', label: 'Enable', default: true, ui: { section: 'fb' } },

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
  'fb.amount': { kind: 'number', label: 'FB Amount', min: 0, max: 1, step: 0.01, default: 0.25, ui: { section: 'fb' } },

  // Visuals — ONLY mode/morph live here now
  'vis.mode': { kind: 'enum', label: 'Visual Mode', options: ['circleLine', 'boids'] as const, default: 'boids', ui: { section: 'vis' } },
  'morph.speed': { kind: 'number', label: 'Morph Speed (s)', min: 0.05, max: 5, step: 0.01, default: 1.5, ui: { section: 'vis' } },

  // CircleLine-only
  'vis.blueGain': { kind: 'number', label: 'Blue Gain', min: 0, max: 4, step: 0.01, default: 1, ui: { section: 'circle' } },
  'vis.whiteGain': { kind: 'number', label: 'White Gain', min: 0, max: 4, step: 0.01, default: 1, ui: { section: 'circle' } },
  'vis.shape': { kind: 'number', label: 'Shape (Line↔Ring)', min: 0, max: 1, step: 0.001, default: 1, ui: { section: 'circle' } },

  // Boids-only (flock behavior knobs)
  'boids.count': { kind: 'number', label: 'Boid Count', min: 50, max: 1000, step: 10, default: 200, ui: { section: 'boids' } },
  'boids.kAtk': { kind: 'number', label: 'Attack → Separation', min: 0, max: 20, step: 0.1, default: 5, ui: { section: 'boids' } },
  'boids.attrDistMul': { kind: 'number', label: 'Attract Distance ×R', min: 0.5, max: 6, step: 0.1, default: 6, ui: { section: 'boids' } },
  'boids.attrStrength': { kind: 'number', label: 'Attract Strength', min: 0, max: 600, step: 1, default: 600, ui: { section: 'boids' } },
  'boids.maxSpeed': { kind: 'number', label: 'Max Speed', min: 40, max: 400, step: 1, default: 180, ui: { section: 'boids' } },
  'boids.neighborR': { kind: 'number', label: 'Neighbor Radius', min: 20, max: 200, step: 1, default: 70, ui: { section: 'boids' } },

  // Bugs-only (the “prey” swarm the boids chase)
  'boids.showSphere': { kind: 'toggle', label: 'Show Attractor Area', default: false, ui: { section: 'bugs' } },
  'boids.bugCount': { kind: 'number', label: 'Bug Count', min: 1, max: 30, step: 1, default: 6, ui: { section: 'bugs' } },
  'boids.bugTightness': { kind: 'number', label: 'Bug Tightness', min: 0, max: 1, step: 0.01, default: 0.34, ui: { section: 'bugs' } },
  'boids.bugFocus': { kind: 'number', label: 'Bug Focus', min: 0, max: 3, step: 0.05, default: 3, ui: { section: 'bugs' } },
  'boids.streamSpeed': { kind: 'number', label: 'Bug Stream Speed', min: 0, max: 300, step: 1, default: 55, ui: { section: 'bugs' } },
  'boids.turnGain': { kind: 'number', label: 'Bug Turn Gain', min: 0, max: 6, step: 0.05, default: 2.5, ui: { section: 'bugs' } },

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

        const oscOn = !!params['osc.on'];
        const filtOn = !!params['filt.on'];
        const lfoOn = !!params['lfo.on'];
        const envOn = !!params['env.on'];
        const fbOn = !!params['fb.on'];

        if (!oscOn) { /* optional hard mute per-voice */ }

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
          chain.fbWet.gain.setTargetAtTime(0, t, 0.01);
          chain.fbGain.gain.setTargetAtTime(0, t, 0.01);
        }

        if (typeof params['amp.gain'] === 'number') {
          chain.master.gain.setTargetAtTime(params['amp.gain'] as number, t, 0.01);
        }

        if (typeof params['osc.type'] === 'string') {
          oscType = params['osc.type'] as OscillatorType;
          pool.setOscType(oscType);
        }

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

// Visual
const visual: VisualEffect = makeVisualEffect();

export default { info, schema, audio, visual } satisfies EffectModule;
