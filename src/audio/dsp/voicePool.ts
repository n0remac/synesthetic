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

  // One always-running oscillator per key, gated by env gain
  for (const code of Object.keys(CODE_TO_MIDI)) {
    const osc = new OscillatorNode(ctx, {
      type: "sine",
      frequency: midiToHz(CODE_TO_MIDI[code]!),
    });
    const env = new GainNode(ctx, { gain: 0.0 });
    osc.connect(env);
    env.connect(target);
    osc.start();
    voices.set(code, { osc, env, down: false });
  }

  return {
    setOscType(type) {
      // Changing osc.type while sounding can click on some browsers/waveforms.
      // This is kept simple for now; best practice is to crossfade two oscs per voice.
      // If you hear clicks here, consider deferring type change until note-off or implement crossfade.
      for (const v of voices.values()) {
        v.osc.type = type;
      }
    },

    noteOn(code, t0, attack) {
      const v = voices.get(code);
      if (!v) return;

      // If the key is already down, retrigger by re-applying attack from current env level.
      // (This avoids a snap-to-zero then up.)
      if (v.down) {
        attack(v.env, t0);
        return;
      }

      v.down = true;
      v.osc.frequency.setValueAtTime(midiToHz(CODE_TO_MIDI[code]!), t0);
      attack(v.env, t0);
    },

    noteOff(code, t0, release) {
      const v = voices.get(code);
      if (!v || !v.down) return;
      v.down = false;
      release(v.env, t0);
      // We **do not** stop the oscillator; it keeps running at env≈0.
      // This avoids hard cuts and makes subsequent attacks instant & click-free.
    },

    dispose() {
      for (const v of voices.values()) {
        try { v.osc.stop(); } catch { /* already stopped */ }
        try { v.osc.disconnect(); } catch {}
        try { v.env.disconnect(); } catch {}
      }
      voices.clear();
    },
  };
}
