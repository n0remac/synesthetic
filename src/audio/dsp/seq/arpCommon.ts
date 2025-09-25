// src/audio/dsp/arpCommon.ts
export type ArpPattern = 'up' | 'down' | 'updown' | 'random' | 'chord';
export type Div = '1/1' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32';

export const DIV_TO_BEATS: Record<Div, number> = {
  '1/1': 1, '1/2': 0.5, '1/4': 0.25, '1/8': 0.125, '1/16': 0.0625, '1/32': 0.03125,
};

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function stepLengthSec(opts: { sync: boolean; bpm: number; div: Div; rateHz: number }): number {
  if (opts.sync) {
    const beats = DIV_TO_BEATS[opts.div] ?? 0.25;
    const bps = opts.bpm / 60;
    return beats / bps;
  }
  return 1 / Math.max(0.0001, opts.rateHz);
}

export function applyPattern(base: number[], pattern: ArpPattern): number[] {
  if (base.length === 0) return [];
  switch (pattern) {
    case 'up':      return base;
    case 'down':    return base.slice().reverse();
    case 'updown':  return base.length === 1 ? base.slice() : base.concat(base.slice(1, -1).reverse());
    case 'random':  return shuffle(base.slice());
    case 'chord':   return base;
    default:        return base;
  }
}
