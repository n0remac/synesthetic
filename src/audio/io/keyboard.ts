import { CODE_TO_MIDI } from "../util/notes";

export type KeyboardHandlers = {
  onDown: (code: string) => void;
  onUp: (code: string) => void;
};

function isTextEditable(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || el.isContentEditable) return true;
  if (tag === "input") {
    const type = (el.getAttribute("type") || "").toLowerCase();
    return ["text","search","email","url","number","password","tel"].includes(type);
  }
  return false;
}

export function attachKeyboard({ onDown, onUp }: KeyboardHandlers) {
  const down = new Set<string>();

  const allUp = () => { for (const c of Array.from(down)) { onUp(c); } down.clear(); };

  const keydown = (ev: KeyboardEvent) => {
    if (isTextEditable(ev.target)) return;
    const code = ev.code;
    if (!(code in CODE_TO_MIDI) || ev.repeat) return;
    ev.preventDefault();
    if (down.has(code)) return;
    down.add(code);
    onDown(code);
  };

  const keyup = (ev: KeyboardEvent) => {
    const code = ev.code;
    if (!(code in CODE_TO_MIDI)) return;
    ev.preventDefault();
    if (!down.has(code)) return;
    down.delete(code);
    onUp(code);
  };

  const blur = () => allUp();
  const visibility = () => { if (document.hidden) allUp(); };

  window.addEventListener("keydown", keydown, { capture: true });
  window.addEventListener("keyup", keyup, { capture: true });
  window.addEventListener("blur", blur);
  document.addEventListener("visibilitychange", visibility);

  return () => {
    window.removeEventListener("keydown", keydown, { capture: true } as any);
    window.removeEventListener("keyup", keyup, { capture: true } as any);
    window.removeEventListener("blur", blur);
    document.removeEventListener("visibilitychange", visibility);
    allUp();
  };
}
