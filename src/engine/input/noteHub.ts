// src/engine/input/noteHub.ts
import type { InputEvent, NoteSnapshot } from './types';

type Listener = (e: InputEvent) => void;

export class NoteHub {
  private byMidi = new Map<number, { velocity: number; tOn: number; sources: Set<string> }>();
  private listeners = new Set<Listener>();

  on(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  noteOn(midi: number, velocity: number, t: number, src = 'unknown') {
    const cur = this.byMidi.get(midi);
    if (!cur) this.byMidi.set(midi, { velocity, tOn: t, sources: new Set([src]) });
    else cur.sources.add(src);
    const ev = { type: 'noteon', midi, velocity, t, src } as const;
    this.listeners.forEach(fn => fn(ev));
  }

  noteOff(midi: number, t: number, src = 'unknown') {
    const cur = this.byMidi.get(midi);
    if (cur) {
      cur.sources.delete(src);
      if (cur.sources.size === 0) this.byMidi.delete(midi);
    }
    const ev = { type: 'noteoff', midi, t, src } as const;
    this.listeners.forEach(fn => fn(ev));
  }

  snapshot(now: number): NoteSnapshot {
    const held = Array.from(this.byMidi.entries())
      .map(([midi, v]) => ({ midi, velocity: v.velocity, tOn: v.tOn, sources: new Set(v.sources) }))
      .sort((a, b) => a.midi - b.midi);
    return { held, byMidi: new Map(this.byMidi), t: now };
  }
}
