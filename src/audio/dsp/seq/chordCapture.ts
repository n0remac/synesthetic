// src/audio/dsp/chordCapture.ts
import type { NoteHub } from '../../../engine/input/noteHub';

export type CaptureOpts = {
  captureMs?: number;  // default 90
  groupMs?: number;    // default 20 (same-time grouping)
};

export class ChordCapturer {
  private hub: NoteHub;
  private timer: number | null = null;
  private startMs = 0;
  private events: Array<{ midi: number; tms: number }> = [];
  private captureMs: number;
  private groupMs: number;

  constructor(hub: NoteHub, opts: CaptureOpts = {}) {
    this.hub = hub;
    this.captureMs = opts.captureMs ?? 90;
    this.groupMs = opts.groupMs ?? 20;
  }

  begin(nowMs: number) {
    this.cancel();
    this.events = [];
    this.startMs = nowMs;
    this.timer = window.setTimeout(() => { this.timer = null; }, this.captureMs) as unknown as number;
  }

  // Call on each noteon from hub during the window
  push(midi: number, tms: number) {
    this.events.push({ midi, tms });
  }

  // Finalize into deterministic order: by time bucket, same-time low→high MIDI
  finalize(): number[] {
    if (this.events.length === 0) return [];
    const buckets = new Map<number, number[]>();
    for (const e of this.events) {
      const b = Math.floor((e.tms - this.startMs) / this.groupMs);
      const arr = buckets.get(b) ?? [];
      arr.push(e.midi);
      buckets.set(b, arr);
    }
    const ordered: number[] = [];
    const seen = new Set<number>();
    for (const b of Array.from(buckets.keys()).sort((a, z) => a - z)) {
      const arr = buckets.get(b)!;
      arr.sort((a, z) => a - z);
      for (const m of arr) if (!seen.has(m)) { seen.add(m); ordered.push(m); }
    }
    return ordered;
  }

  active(): boolean { return this.timer != null; }
  cancel() { if (this.timer != null) { clearTimeout(this.timer); this.timer = null; } }
}

// Edit-one-note merge (non-hold):
export function mergeEditOne(prevOrder: number[], currentlyHeld: Set<number>, additions: number[]): number[] {
  const kept = prevOrder.filter(m => currentlyHeld.has(m));
  const add = additions.filter(m => currentlyHeld.has(m) && !kept.includes(m));

  // indices in prev that were removed
  const removed: Array<{ idx: number; midi: number }> = [];
  for (let i = 0; i < prevOrder.length; i++) if (!currentlyHeld.has(prevOrder[i])) removed.push({ idx: i, midi: prevOrder[i] });

  // greedy nearest-pitch assignment
  const assigned = new Map<number, number>(); // idx -> midi
  const used = new Set<number>();
  for (const m of add) {
    let best = -1, dist = Infinity;
    for (let i = 0; i < removed.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(m - removed[i].midi);
      if (d < dist) { dist = d; best = i; }
    }
    if (best >= 0) { used.add(best); assigned.set(removed[best].idx, m); }
  }

  // rebuild in-place
  const keptSet = new Set(kept);
  const next: number[] = [];
  for (let i = 0; i < prevOrder.length; i++) {
    const m = prevOrder[i];
    if (keptSet.has(m)) next.push(m);
    else if (assigned.has(i)) next.push(assigned.get(i)!);
  }

  // append leftovers (more additions than removed slots)
  const assignedNotes = new Set(assigned.values());
  for (const m of add) if (!assignedNotes.has(m)) next.push(m);

  // dedupe & keep only currently held
  const seen = new Set<number>();
  return next.filter(m => currentlyHeld.has(m) && !seen.has(m) && (seen.add(m), true));
}
