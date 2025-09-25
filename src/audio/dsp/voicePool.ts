// src/audio/dsp/voicePool.ts
import { codeToMidi, midiToHz } from "../util/notes";

export type Voice = { osc: OscillatorNode; env: GainNode; down: boolean };
export type VoicePool = {
  setOscType(type: OscillatorType): void;

  // existing code-based
  noteOn(code: string, t0: number, attack: (env: GainNode, t0: number) => void): void;
  noteOff(code: string, t0: number, release: (env: GainNode, t0: number) => void): void;

  // MIDI-based (arp)
  noteOnMidi(midi: number, t0: number, velocity: number, attack: (env: GainNode, t0: number) => void): void;
  noteOffMidi(midi: number, t0: number, release?: (env: GainNode, t0: number) => void): void;

  // NEW: emergency stop
  allOff(t0: number): void;

  dispose(): void;
};

export function createVoicePool(ctx: AudioContext, target: AudioNode): VoicePool {
  const voicesByCode = new Map<string, Voice>();
  const voicesByMidi = new Map<number, Voice>();
  let currentType: OscillatorType = "sine";

  function createVoice(): Voice {
    const osc = new OscillatorNode(ctx, { type: currentType, frequency: 440 });
    const env = new GainNode(ctx, { gain: 0.0 });
    osc.connect(env);
    env.connect(target);
    osc.start();
    return { osc, env, down: false };
  }

  function safeRelease(env: GainNode, t0: number) {
    // Gentle release then a hard floor to guarantee silence.
    try {
      env.gain.cancelAndHoldAtTime(t0);
    } catch {}
    env.gain.setTargetAtTime(0, t0, 0.02);
    // hard zero (prevents asymptotic tails or lost events from hanging)
    env.gain.setValueAtTime(0, t0 + 0.25);
  }

  return {
    setOscType(type) {
      currentType = type;
      for (const v of voicesByCode.values()) v.osc.type = type;
      for (const v of voicesByMidi.values()) v.osc.type = type;
    },

    // ---------- code-based ----------
    noteOn(code, t0, attack) {
      const midi = codeToMidi(code);
      if (midi === undefined) return;
      let v = voicesByCode.get(code);
      if (!v) { v = createVoice(); voicesByCode.set(code, v); }
      v.down = true;
      v.osc.frequency.setValueAtTime(midiToHz(midi), t0);
      attack(v.env, t0);
    },

    noteOff(code, t0, release) {
      const v = voicesByCode.get(code);
      if (!v) return;
      v.down = false;
      release(v.env, t0);
    },

    // ---------- MIDI-based ----------
    noteOnMidi(midi, t0, _velocity, attack) {
      let v = voicesByMidi.get(midi);
      if (!v) { v = createVoice(); voicesByMidi.set(midi, v); }
      v.down = true;
      v.osc.frequency.setValueAtTime(midiToHz(midi), t0);
      attack(v.env, t0);
    },

    noteOffMidi(midi, t0, release) {
      const v = voicesByMidi.get(midi);
      if (!v) return;
      v.down = false;
      if (release) release(v.env, t0);
      else safeRelease(v.env, t0);
    },

    allOff(t0) {
      for (const v of voicesByCode.values()) { v.down = false; safeRelease(v.env, t0); }
      for (const v of voicesByMidi.values()) { v.down = false; safeRelease(v.env, t0); }
    },

    dispose() {
      for (const v of voicesByCode.values()) { try { v.osc.stop(); } catch {} try { v.osc.disconnect(); } catch {} try { v.env.disconnect(); } catch {} }
      for (const v of voicesByMidi.values()) { try { v.osc.stop(); } catch {} try { v.osc.disconnect(); } catch {} try { v.env.disconnect(); } catch {} }
      voicesByCode.clear();
      voicesByMidi.clear();
    },
  };
}
