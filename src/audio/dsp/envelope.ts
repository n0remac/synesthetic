// envelope.ts
export type ADSR = { A: number; D: number; S: number; R: number };
export const defaultADSR: ADSR = { A: 0.01, D: 0.10, S: 0.7, R: 0.3 };

// Minimum stage times (s)
const MIN_A = 0.003;
const MIN_D = 0.003;
const MIN_R = 0.015;

// Non-zero floors (avoid exact zero steps)
const FLOOR = 0.0005;
const START_FLOOR = 0.001;

// Cancel slightly before t0 so we never “snap to a future event”
const EPS = 1e-4;

export function scheduleAttackDecay(env: GainNode, t0: number, { A, D, S }: ADSR) {
  const a = Math.max(MIN_A, A);
  const d = Math.max(MIN_D, D);
  const s = Math.min(1, Math.max(0, S));

  const p = env.gain;
  try { p.cancelAndHoldAtTime(Math.max(0, t0 - EPS)); } catch { }

  const start = Math.max(START_FLOOR, p.value);
  p.setValueAtTime(start, t0);

  // Exponential-ish ramps (smoother near zero than linear)
  p.setTargetAtTime(1.0, t0, a / 4);
  p.setTargetAtTime(Math.max(FLOOR, s), t0 + a, d / 4);
}

export function scheduleRelease(env: GainNode, t0: number, { R }: ADSR) {
  const r = Math.max(MIN_R, R);
  const p = env.gain;

  try { p.cancelAndHoldAtTime(Math.max(0, t0 - EPS)); } catch { }

  const cur = Math.max(FLOOR, p.value);
  p.setValueAtTime(cur, t0);

  // Smoothly head to a tiny floor; no jump to 0 at the end.
  p.setTargetAtTime(FLOOR, t0, r / 4);

  // OPTIONAL (very late tidy-up, far away so it’s inaudible and always canceled by next note):
  // p.setTargetAtTime(0, t0 + Math.max(0.75, 4 * r), (4 * r));
}
