import { CODE_TO_MIDI, midiToHz } from "../util/notes";

export type Voice = { osc: OscillatorNode; env: GainNode; down: boolean };
export type VoicePool = {
  setOscType(type: OscillatorType): void;
  noteOn(code: string, t0: number, attack: (env: GainNode, t0: number) => void): void;
  noteOff(code: string, t0: number, release: (env: GainNode, t0: number) => void): void;
  dispose(): void;
};

export function createVoicePool(ctx: AudioContext, target: AudioNode): VoicePool {
  const voices = new Map<string, Voice>();

  // Pre-create one running voice per key
  for (const code of Object.keys(CODE_TO_MIDI)) {
    const osc = new OscillatorNode(ctx, { type: "sine", frequency: midiToHz(CODE_TO_MIDI[code]) });
    const env = new GainNode(ctx, { gain: 0 });
    osc.connect(env); env.connect(target);
    osc.start();
    voices.set(code, { osc, env, down: false });
  }

  return {
    setOscType(type) {
      for (const v of voices.values()) v.osc.type = type;
    },
    noteOn(code, t0, attack) {
      const v = voices.get(code); if (!v || v.down) return;
      v.down = true;
      v.osc.frequency.setValueAtTime(midiToHz(CODE_TO_MIDI[code]!), t0);
      attack(v.env, t0);
    },
    noteOff(code, t0, release) {
      const v = voices.get(code); if (!v || !v.down) return;
      v.down = false;
      release(v.env, t0);
    },
    dispose() {
      for (const v of voices.values()) {
        try { v.osc.stop(); } catch {}
        v.osc.disconnect(); v.env.disconnect();
      }
      voices.clear();
    }
  };
}
