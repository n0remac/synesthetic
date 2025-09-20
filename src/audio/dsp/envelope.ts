export type ADSR = { A: number; D: number; S: number; R: number };
export const defaultADSR: ADSR = { A: 0.01, D: 0.10, S: 0.7, R: 0.3 };

export function scheduleAttackDecay(env: GainNode, t0: number, { A, D, S }: ADSR) {
  env.gain.cancelScheduledValues(t0);
  env.gain.setValueAtTime(env.gain.value, t0);
  env.gain.linearRampToValueAtTime(1.0, t0 + A);
  env.gain.linearRampToValueAtTime(S,   t0 + A + D);
}

export function scheduleRelease(env: GainNode, t0: number, { R }: ADSR) {
  env.gain.cancelScheduledValues(t0);
  env.gain.setValueAtTime(env.gain.value, t0);
  env.gain.linearRampToValueAtTime(0.0001, t0 + R);
}
