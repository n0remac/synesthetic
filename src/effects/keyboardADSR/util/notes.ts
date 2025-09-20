export const CODE_TO_MIDI: Record<string, number> = {
  KeyA: 60, KeyW: 61, KeyS: 62, KeyE: 63, KeyD: 64,
  KeyF: 65, KeyT: 66, KeyG: 67, KeyY: 68, KeyH: 69,
  KeyU: 70, KeyJ: 71, KeyK: 72, KeyO: 73, KeyL: 74,
  KeyP: 75, Semicolon: 76, Quote: 77, BracketRight: 78,
};

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
