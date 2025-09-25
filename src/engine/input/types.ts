// src/engine/input/types.ts
export type NoteOn = { type: 'noteon'; midi: number; velocity: number; t: number; src: string };
export type NoteOff = { type: 'noteoff'; midi: number; t: number; src: string };
export type InputEvent = NoteOn | NoteOff;

export type NoteSnapshot = {
  // currently-held notes (dedup by midi); multi-source allowed
  held: Array<{ midi: number; velocity: number; tOn: number; sources: Set<string> }>;
  byMidi: Map<number, { velocity: number; tOn: number; sources: Set<string> }>;
  t: number;
};
