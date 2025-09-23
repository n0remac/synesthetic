// src/pianoOctaveUI.ts
import { incOctave, decOctave, getOctaveOffset } from '../audio/util/notes';

function byId<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T | null;
}

function updateIndicator(ind: HTMLElement) {
  ind.textContent = `Oct ${getOctaveOffset()}`;
}

function measureAndSetBookendWidth(piano: HTMLElement) {
  const firstWhite = piano.querySelector<HTMLButtonElement>('.piano-stage .white-keys .white');
  if (!firstWhite) return;
  const w = firstWhite.offsetWidth;
  if (w > 0) piano.style.setProperty('--bookend-w', `${w-12}px`);
}

export function initPianoOctaveUI() {
  const piano = byId<HTMLElement>('piano');
  const ind   = byId<HTMLDivElement>('octave-indicator');

  if (!piano || !ind) {
    console.warn('[pianoOctaveUI] piano or indicator not found');
    return;
  }

  // --- Octave controls: robust delegation (pointer + click) ---
  const handleDown = (el: HTMLElement) => {
    if (el.id === 'octave-left')  { decOctave(); }
    if (el.id === 'octave-right') { incOctave(); }
  };

  // Pointer (fires immediately on touch) — best for mobile
  piano.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest<HTMLElement>('#octave-left, #octave-right');
    if (!btn) return;
    e.preventDefault();
    handleDown(btn);
  }, { capture: false });

  // Click fallback (desktop)
  piano.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest<HTMLElement>('#octave-left, #octave-right');
    if (!btn) return;
    e.preventDefault();
    handleDown(btn);
  }, { capture: false });

  // Keep indicator in sync regardless of source (buttons or keyboard 1/2)
  const onOctaveChange = () => updateIndicator(ind);
  window.addEventListener('octavechange', onOctaveChange as EventListener);
  updateIndicator(ind);

  // --- Match bookend width to a white key ---
  const measure = () => measureAndSetBookendWidth(piano);
  const firstWhite = piano.querySelector<HTMLElement>('.piano-stage .white-keys .white');
  requestAnimationFrame(measure);
  window.addEventListener('resize', measure);
  let ro: ResizeObserver | undefined;
  if (firstWhite && 'ResizeObserver' in window) {
    ro = new ResizeObserver(() => measure());
    ro.observe(firstWhite);
  }

  // --- Multi-touch key handling (reuse keyboard path) ---
  const active = new Set<HTMLElement>();

  const press = (el: HTMLElement) => {
    el.classList.add('active');
    const code = el.getAttribute('data-code');
    if (!code) return;
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    active.add(el);
  };
  const release = (el: HTMLElement) => {
    el.classList.remove('active');
    const code = el.getAttribute('data-code');
    if (!code) return;
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    active.delete(el);
  };

  piano.querySelectorAll('.piano-stage .white, .piano-stage .black').forEach((el) => {
    const btn = el as HTMLElement;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { btn.setPointerCapture((e as PointerEvent).pointerId); } catch {}
      press(btn);
    });
    btn.addEventListener('pointerup',     (e) => { e.preventDefault(); release(btn); });
    btn.addEventListener('pointercancel', (e) => { e.preventDefault(); release(btn); });
    btn.addEventListener('pointerleave',  (e) => { e.preventDefault(); release(btn); });
  });

  const onBlur = () => { active.forEach(release); active.clear(); };
  window.addEventListener('blur', onBlur);

  // Optional disposer (handy with HMR)
  (piano as any).__pianoDispose = () => {
    window.removeEventListener('octavechange', onOctaveChange as EventListener);
    window.removeEventListener('resize', measure);
    window.removeEventListener('blur', onBlur);
    ro?.disconnect();
  };
}
