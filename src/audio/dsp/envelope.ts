export type ADSR = { A: number; D: number; S: number; R: number };
export const defaultADSR: ADSR = { A: 0.01, D: 0.10, S: 0.7, R: 0.3 };

// Tiny de-click guards (seconds)
const MIN_A = 0.003;   // >= ~3 ms
const MIN_D = 0.003;   // >= ~3 ms
const MIN_R = 0.010;   // >= ~10 ms

// Small non-zero floor to avoid "snap to absolute zero"
const FLOOR = 0.0005;

/**
 * Attack/Decay from the *current* gain value, with tiny minimum times.
 * Uses cancelAndHoldAtTime so there is no step when re-scheduling quickly.
 */
export function scheduleAttackDecay(env: GainNode, t0: number, { A, D, S }: ADSR) {
  const a = Math.max(MIN_A, A);
  const d = Math.max(MIN_D, D);
  const s = Math.min(1, Math.max(0, S));

  const p = env.gain;
  // hold the current trajectory/value at t0, then continue smoothly
  p.cancelAndHoldAtTime(t0);
  p.setValueAtTime(p.value, t0);

  // Fast & click-safe linear ramps for envelope stages
  p.linearRampToValueAtTime(1.0, t0 + a);
  p.linearRampToValueAtTime(s,   t0 + a + d);
}

/**
 * Release from the *current* gain value down to a tiny floor (not hard zero).
 */
export function scheduleRelease(env: GainNode, t0: number, { R }: ADSR) {
  const r = Math.max(MIN_R, R);

  const p = env.gain;
  p.cancelAndHoldAtTime(t0);
  p.setValueAtTime(p.value, t0);

  // Linear down to a small floor to avoid zero snap (and denormals)
  p.linearRampToValueAtTime(FLOOR, t0 + r);
}
