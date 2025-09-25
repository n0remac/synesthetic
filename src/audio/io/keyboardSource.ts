// src/input/keyboard.ts
import {
  codeToMidi,
  OCTAVE_DOWN_CODES, OCTAVE_UP_CODES,
  incOctave, decOctave,
  getOctaveOffset
} from "../util/notes";
import type { NoteHub } from "../../engine/input/noteHub";

function isTextEditable(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || el.isContentEditable) return true;
  if (tag === "input") {
    const type = (el.getAttribute("type") || "").toLowerCase();
    return ["text", "search", "email", "url", "number", "password", "tel"].includes(type);
  }
  return false;
}

export type KeyboardToHubOptions = {
  sourceId?: string;
  velocity?: number;
  onOctaveChange?: (oct: number) => void;

  // NEW: raw code passthrough (for existing code-based consumers)
  onCodeDown?: (code: string) => void;
  onCodeUp?: (code: string) => void;
};

/**
 * Attach computer keyboard as a NoteHub source (in MIDI space).
 * Returns a detach() function.
 */
export function attachKeyboardToHub(hub: NoteHub, ctx: AudioContext, opts: KeyboardToHubOptions = {}) {
  const sourceId = opts.sourceId ?? 'kbd';
  const velocity = Math.max(0, Math.min(1, opts.velocity ?? 0.9));

  // Track currently pressed physical keys
  const downCodes = new Set<string>();
  // Map physical key code -> midi used on keydown (so keyup turns off the same note)
  const codeToMidiDown = new Map<string, number>();

  const allUp = () => {
    // turn off any sounding notes from this source
    const now = ctx.currentTime;
    for (const [code, midi] of codeToMidiDown) {
      hub.noteOff(midi, now, sourceId);
    }
    codeToMidiDown.clear();
    downCodes.clear();
  };

  const keydown = (ev: KeyboardEvent) => {
    if (isTextEditable(ev.target)) return;

    const code = ev.code;

    // Handle octave controls (no MIDI emission)
    if (OCTAVE_DOWN_CODES.has(code)) {
      ev.preventDefault();
      if (!downCodes.has(code)) {
        downCodes.add(code);
        decOctave();
        opts.onOctaveChange?.(getOctaveOffset());
      }
      return;
    }
    if (OCTAVE_UP_CODES.has(code)) {
      ev.preventDefault();
      if (!downCodes.has(code)) {
        downCodes.add(code);
        incOctave();
        opts.onOctaveChange?.(getOctaveOffset());
      }
      return;
    }

    // Ignore  key repeat and non-musical keys
    if (ev.repeat) return;
    const midi = codeToMidi(code);
    if (midi === undefined) return;

    ev.preventDefault();
    if (downCodes.has(code)) return; // already down

    // Register as down and emit to hub
    downCodes.add(code);
    codeToMidiDown.set(code, midi);

    const now = ctx.currentTime;
    hub.noteOn(midi, velocity, now, sourceId);
    opts.onCodeDown?.(code);
  };

  const keyup = (ev: KeyboardEvent) => {
    const code = ev.code;

    // release octave controls
    if (OCTAVE_DOWN_CODES.has(code) || OCTAVE_UP_CODES.has(code)) {
      ev.preventDefault();
      if (!downCodes.has(code)) return;
      downCodes.delete(code);
      return;
    }

    // Look up the exact midi that was started on keydown
    const midi = codeToMidiDown.get(code);
    if (midi === undefined) return;

    ev.preventDefault();
    if (!downCodes.has(code)) return;

    downCodes.delete(code);
    codeToMidiDown.delete(code);

    const now = ctx.currentTime;
    hub.noteOff(midi, now, sourceId);
    opts.onCodeUp?.(code);
  };

  // Safety: all notes off when focus/visibility changes
  const blur = () => allUp();
  const visibility = () => { if (document.hidden) allUp(); };

  window.addEventListener("keydown", keydown, { capture: true });
  window.addEventListener("keyup", keyup, { capture: true });
  window.addEventListener("blur", blur);
  document.addEventListener("visibilitychange", visibility);

  // Optional: panic on Escape
  const panic = (ev: KeyboardEvent) => {
    if (ev.code === 'Escape') {
      ev.preventDefault();
      allUp();
    }
  };
  window.addEventListener("keydown", panic, { capture: true });

  return () => {
    window.removeEventListener("keydown", keydown, { capture: true } as any);
    window.removeEventListener("keyup", keyup, { capture: true } as any);
    window.removeEventListener("blur", blur);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("keydown", panic, { capture: true } as any);
    allUp();
  };
}
