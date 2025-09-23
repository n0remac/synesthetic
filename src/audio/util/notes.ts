// src/util/notes.ts

export type KeyBinding = { code: string; semitone: number }; // semitone offset from C within the octave [0..11]

const DEFAULT_BINDINGS: KeyBinding[] = [
  { code: 'KeyA', semitone: 0 },  // C
  { code: 'KeyW', semitone: 1 },  // C#
  { code: 'KeyS', semitone: 2 },  // D
  { code: 'KeyE', semitone: 3 },  // D#
  { code: 'KeyD', semitone: 4 },  // E
  { code: 'KeyF', semitone: 5 },  // F
  { code: 'KeyT', semitone: 6 },  // F#
  { code: 'KeyG', semitone: 7 },  // G
  { code: 'KeyY', semitone: 8 },  // G#
  { code: 'KeyH', semitone: 9 },  // A
  { code: 'KeyU', semitone: 10 }, // A#
  { code: 'KeyJ', semitone: 11 }, // B
  { code: 'KeyK', semitone: 12 }, // C
  { code: 'KeyO', semitone: 13 }, // C#
  { code: 'KeyL', semitone: 14 }, // D
  { code: 'KeyP', semitone: 15 }, // D#
  { code: 'Semicolon', semitone: 16 }, // E
  { code: 'Quote', semitone: 17 },     // F
  { code: 'BracketRight', semitone: 18 },  // F#
  { code: 'Enter', semitone: 19 }, // G
];

// Special desktop controls for octave:
export const OCTAVE_DOWN_CODES = new Set(['Digit1']); // '1'
export const OCTAVE_UP_CODES = new Set(['Digit2']); // '2'

// State
let octaveOffset = 0;      // in octaves, relative to base C4
let baseCMidi = 60;        // C4
let bindings: KeyBinding[] = [...DEFAULT_BINDINGS];

export type OctaveChangeDetail = { octave: number };
declare global {
  interface WindowEventMap {
    'octavechange': CustomEvent<OctaveChangeDetail>;
  }
}
function emitOctave() {
  window.dispatchEvent(new CustomEvent<OctaveChangeDetail>('octavechange', {
    detail: { octave: octaveOffset }
  }));
}

// Public helpers
export function getOctaveOffset() { return offset(); }
export function setOctaveOffset(n: number) { octaveOffset = clamp(n, -4, +4); emitOctave(); }
export function incOctave() { setOctaveOffset(octaveOffset + 1); }
export function decOctave() { setOctaveOffset(octaveOffset - 1); }
export function setBaseCMidi(midiC: number) { baseCMidi = midiC | 0; }

export function setBindings(next: KeyBinding[]) { bindings = [...next]; }
export function addBindings(extra: KeyBinding[]) { bindings.push(...extra); }

export function codeToMidi(code: string): number | undefined {
  const b = bindings.find(b => b.code === code);
  if (!b) return undefined;
  return baseCMidi + octaveOffset * 12 + b.semitone;
}

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// small utils
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
// alias to avoid inlining in getters
const offset = () => octaveOffset;