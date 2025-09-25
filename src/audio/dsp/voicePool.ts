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
    const p = env.gain;
    const FLOOR = 0.0005;
    try { p.cancelAndHoldAtTime(Math.max(0, t0 - 1e-4)); } catch { }
    // head smoothly to a tiny floor; do NOT jump to 0 soon after
    p.setValueAtTime(Math.max(FLOOR, p.value), t0);
    p.setTargetAtTime(FLOOR, t0, 0.02 / 4);
    // very late tidy zero (far away so it’s inaudible; will be canceled by next noteOn)
    p.setValueAtTime(0, t0 + 1.0);
  }


  function setFreqWithGlide(osc: OscillatorNode, hz: number, t0: number, glideSec = 0.003) {
    const p = osc.frequency;
    const EPS = 1e-4;

    try { p.cancelAndHoldAtTime(Math.max(0, t0 - EPS)); } catch { }
    // Start from “where we are” at t0, then glide to target
    p.setValueAtTime(p.value, t0);
    p.linearRampToValueAtTime(hz, t0 + Math.max(0.001, glideSec));
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

      const hz = midiToHz(midi);
      setFreqWithGlide(v.osc, hz, t0, 0.003);   // ~3ms glide
      attack(v.env, t0);
    },

    noteOff(code, t0, release) {
      const v = voicesByCode.get(code);
      if (!v) return;
      v.down = false;
      try { v.env.gain.cancelAndHoldAtTime(Math.max(0, t0 - 1e-4)); } catch { }
      release(v.env, t0);
    },

    // ---------- MIDI-based ----------
    noteOnMidi(midi, t0, _velocity, attack) {
      let v = voicesByMidi.get(midi);
      if (!v) { v = createVoice(); voicesByMidi.set(midi, v); }
      v.down = true;

      const hz = midiToHz(midi);
      setFreqWithGlide(v.osc, hz, t0, 0.003);   // ~3ms glide
      attack(v.env, t0);
    },

    noteOffMidi(midi, t0, release) {
      const v = voicesByMidi.get(midi);
      if (!v) return;
      v.down = false;

      try { v.env.gain.cancelAndHoldAtTime(Math.max(0, t0 - 1e-4)); } catch { }
      if (release) release(v.env, t0);              // <-- uses scheduleRelease above
      // no immediate setValueAtTime(0) or similar here
    },

    allOff(t0) {
      for (const v of voicesByCode.values()) { v.down = false; safeRelease(v.env, t0); }
      for (const v of voicesByMidi.values()) { v.down = false; safeRelease(v.env, t0); }
    },

    dispose() {
      for (const v of voicesByCode.values()) { try { v.osc.stop(); } catch { } try { v.osc.disconnect(); } catch { } try { v.env.disconnect(); } catch { } }
      for (const v of voicesByMidi.values()) { try { v.osc.stop(); } catch { } try { v.osc.disconnect(); } catch { } try { v.env.disconnect(); } catch { } }
      voicesByCode.clear();
      voicesByMidi.clear();
    },
  };
}
