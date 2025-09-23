// src/audio/dsp/voicePool.ts
import { codeToMidi, midiToHz } from "../util/notes";

export type Voice = { osc: OscillatorNode; env: GainNode; down: boolean };
export type VoicePool = {
  setOscType(type: OscillatorType): void;
  noteOn(
    code: string,
    t0: number,
    attack: (env: GainNode, t0: number) => void
  ): void;
  noteOff(
    code: string,
    t0: number,
    release: (env: GainNode, t0: number) => void
  ): void;
  dispose(): void;
};

export function createVoicePool(ctx: AudioContext, target: AudioNode): VoicePool {
  const voices = new Map<string, Voice>();
  let currentType: OscillatorType = "sine";

  function createVoice(): Voice {
    const osc = new OscillatorNode(ctx, { type: currentType, frequency: 440 });
    const env = new GainNode(ctx, { gain: 0.0 });
    osc.connect(env);
    env.connect(target);
    osc.start();
    return { osc, env, down: false };
  }

  return {
    setOscType(type) {
      currentType = type;
      // NOTE: changing the type on a running oscillator can click on some browsers.
      // If you hear clicks, consider crossfading two oscs per voice.
      for (const v of voices.values()) v.osc.type = type;
    },

    noteOn(code, t0, attack) {
      const midi = codeToMidi(code);
      if (midi === undefined) return; // not a mapped note (could be octave keys, etc.)

      let v = voices.get(code);
      if (!v) {
        v = createVoice();
        voices.set(code, v);
      }

      // Retrigger if already down—re-run the attack from current level for smoothness.
      if (v.down) {
        attack(v.env, t0);
        return;
      }

      v.down = true;
      v.osc.frequency.setValueAtTime(midiToHz(midi), t0);
      attack(v.env, t0);
    },

    noteOff(code, t0, release) {
      const v = voices.get(code);
      if (!v || !v.down) return;
      v.down = false;
      release(v.env, t0);
      // Osc stays running at gain≈0 for click-free re-attacks.
    },

    dispose() {
      for (const v of voices.values()) {
        try { v.osc.stop(); } catch {}
        try { v.osc.disconnect(); } catch {}
        try { v.env.disconnect(); } catch {}
      }
      voices.clear();
    },
  };
}
