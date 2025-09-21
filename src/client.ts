// src/client.ts
import { buildControls } from './ui/controls'
import type { EffectParams, MsgToWorker } from './engine/protocol'
import { AudioEngine } from './engine/audio'
import effectModule from './app' // your main (audio+schema) module — main thread ONLY

const canvasEl = document.getElementById('view') as HTMLCanvasElement
const controlsForm = document.getElementById('controls') as HTMLFormElement

// Worker & engine state
const worker = new Worker(
  new URL('./engine/visual.worker.ts', import.meta.url),
  { type: 'module' }
);
const engine = new AudioEngine()
let params: EffectParams = {}
let ticking = false

let audioUnlocked = false;

async function ensureAudioUnlocked() {
  if (audioUnlocked) return;
  try {
    await engine.resume();
    audioUnlocked = true;
    document.documentElement.classList.add('audio-on');
    const gate = document.getElementById('audio-unlock');
    if (gate) gate.remove();
  } catch (e) {
    console.warn('Audio resume failed, will retry on next gesture', e);
  }
}

function wireAudioUnlockGestures() {
  const once = { once: true, passive: true, capture: true } as const;
  // The “big four” are usually enough
  window.addEventListener('pointerdown', ensureAudioUnlocked, once);
  window.addEventListener('keydown', ensureAudioUnlocked, once);
  window.addEventListener('touchstart', ensureAudioUnlocked, once);
  window.addEventListener('mousedown', ensureAudioUnlocked, once);
  // Safety: if page regains focus/visibility, try again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureAudioUnlocked();
  });
}

function synthKeyEvent(type: 'keydown' | 'keyup', code: string) {
  // Some browsers ignore synthetic KeyboardEvent for audio-start policies; but
  // your audio context is already resumed by a gesture, so this is fine.
  const ev = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
  document.dispatchEvent(ev);
}

function initMobilePiano() {
  const bar = document.getElementById('piano');
  if (!bar || (bar as any)._wired) return;
  (bar as any)._wired = true;

  // Accept either <button> or <div class="key"> elements
  type KeyEl = HTMLButtonElement | HTMLDivElement;

  const qKey = (el: Element | null) =>
    (el?.closest('#piano button, #piano .key') as KeyEl | null) ?? null;

  const keyFromPoint = (x: number, y: number): KeyEl | null => {
    const el = document.elementFromPoint(x, y);
    return qKey(el);
  };

  const active = new Map<number, KeyEl>();

  const press = (btn: KeyEl, pid: number) => {
    // Only trigger on entering a new key
    if (active.get(pid) !== btn) {

      const prev = active.get(pid);
      if (prev && prev !== btn) release(prev, pid);

      btn.classList.add('active');
      const code = (btn as HTMLElement).dataset.code!;
      synthKeyEvent('keydown', code);
      active.set(pid, btn);
    }
  };

  const release = (btn: KeyEl, pid: number) => {
    if (active.get(pid) !== btn) return;
    btn.classList.remove('active');
    const code = (btn as HTMLElement).dataset.code!;
    synthKeyEvent('keyup', code);
    active.delete(pid);
  };

  const releaseAll = () => {
    for (const [, btn] of active) {
      btn.classList.remove('active');
      const code = (btn as HTMLElement).dataset.code!;
      synthKeyEvent('keyup', code);
    }
    active.clear();
  };

  // ---- Pointer handlers (non-passive so preventDefault works) ----
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();                 // blocks long-press gesture start
    ensureAudioUnlocked?.();

    const btn = qKey(e.target as Element);
    if (btn) press(btn, e.pointerId);

    bar.addEventListener('pointermove', onPointerMove, { passive: false });
  };

  const onPointerMove = (e: PointerEvent) => {
    e.preventDefault();                 // smooth gliss; no scroll/zoom
    const btn = keyFromPoint(e.clientX, e.clientY);
    if (btn) {
      press(btn, e.pointerId);
    } else {
      // finger left all keys: release current note for this pointer
      const prev = active.get(e.pointerId);
      if (prev) release(prev, e.pointerId);
    }
  };

  const onPointerUpOrCancel = (e: PointerEvent) => {
    e.preventDefault();
    const btn = active.get(e.pointerId);
    if (btn) release(btn, e.pointerId);
    bar.removeEventListener('pointermove', onPointerMove);
  };

  bar.addEventListener('pointerdown', onPointerDown, { passive: false });
  bar.addEventListener('pointerup', onPointerUpOrCancel, { passive: false });
  bar.addEventListener('pointercancel', onPointerUpOrCancel, { passive: false });
  bar.addEventListener('pointerleave', onPointerUpOrCancel, { passive: false });

  // ---- Kill OS long-press behaviors (stops Android haptic on long tap) ----
  bar.addEventListener('contextmenu', e => e.preventDefault());
  bar.addEventListener('selectstart', e => e.preventDefault());
  bar.addEventListener('dragstart', e => e.preventDefault());
  // Some browsers still emit touch events alongside pointer events:
  bar.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  bar.addEventListener('touchend', e => e.preventDefault(), { passive: false });
  bar.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  // Safety: release all notes when app is hidden or loses focus
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') releaseAll();
  });
}

function syncPianoHeightVar() {
  const piano = document.getElementById('piano') as HTMLElement | null;
  if (!piano) return;
  const h = piano.offsetHeight || 120;
  document.documentElement.style.setProperty('--piano-h', `${h}px`);
}

export function mountDesktopPianoToggleIntoControls() {
  // Only on desktop
  if (!window.matchMedia('(min-width: 769px)').matches) return;

  const form = document.getElementById('controls') as HTMLFormElement | null;
  if (!form) return;

  // Avoid duplicates on rebuilds
  if (form.querySelector('[data-ui="desktop-piano-toggle"]')) return;

  // Prefer the Visuals section body
  const target =
    (form.querySelector('[data-section="vis"] .sec-body') as HTMLElement | null) ?? form;

  // Build a row like your other controls
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.ui = 'desktop-piano-toggle';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'On-screen Keyboard (desktop)';

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.name = 'ui.desktopPiano';
  // Default OFF unless user enabled it previously
  const saved = localStorage.getItem('desktopPiano') === '1';
  box.checked = saved;
  document.documentElement.classList.toggle('show-desktop-piano', saved);

  box.addEventListener('input', () => {
    const on = box.checked;
    document.documentElement.classList.toggle('show-desktop-piano', on);
    localStorage.setItem('desktopPiano', on ? '1' : '0');
    requestAnimationFrame(syncPianoHeightVar);
  });

  row.appendChild(label);
  row.appendChild(box);
  target.appendChild(row);

  // First measure in case the piano is shown from saved state
  requestAnimationFrame(syncPianoHeightVar);
}

function initDesktopHelp() {
  const root = document.documentElement;
  const dontShowKey = 'desktopHelpDontShow';
  const dontShow = localStorage.getItem(dontShowKey) === '1';

  const help = document.getElementById('desktop-help');
  const btn = document.getElementById('dismiss-help') as HTMLButtonElement | null;
  const cb = document.getElementById('help-dont-show') as HTMLInputElement | null;

  // If user previously chose "Don't show again", hide on load
  if (dontShow) {
    root.classList.add('help-dismissed');
  } else {
    root.classList.remove('help-dismissed');
  }

  // Reflect persisted state in the checkbox
  if (cb) cb.checked = dontShow;

  // Dismiss: hide for THIS session; persist only if checkbox checked
  btn?.addEventListener('click', () => {
    if (cb?.checked) {
      localStorage.setItem(dontShowKey, '1');   // persist hide
    }
    root.classList.add('help-dismissed');       // hide now (session)
  });

  // If user unchecks the box later (while tip is visible), remove persistence
  cb?.addEventListener('change', () => {
    if (!cb.checked) localStorage.removeItem(dontShowKey);
  });
}


function post(msg: MsgToWorker, transfer?: Transferable[]) {
  worker.postMessage(msg as any, transfer ?? [])
}

function setCanvasSize() {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  const rect = canvasEl.getBoundingClientRect()
  canvasEl.width = Math.max(1, Math.floor(rect.width * dpr))
  canvasEl.height = Math.max(1, Math.floor(rect.height * dpr))
}

function supportsOffscreen() {
  return typeof (canvasEl as any).transferControlToOffscreen === 'function'
    && typeof (window as any).OffscreenCanvas !== 'undefined'
}

function initWorkerCanvas() {
  if (!supportsOffscreen()) {
    console.warn('OffscreenCanvas not supported; visuals require a modern browser.')
    return
  }
  setCanvasSize() // size BEFORE transfer
  const off = (canvasEl as any).transferControlToOffscreen()
  post({ type: 'initCanvas', canvas: off }, [off])
}

function applyModePanelVisibility(mode: string) {
  const sections = document.querySelectorAll<HTMLElement>('[data-section]')
  sections.forEach((el) => {
    const id = el.dataset.section || ''
    if (id === 'circle') {
      el.style.display = (mode === 'circleLine') ? '' : 'none'
    } else if (id === 'boids') {
      el.style.display = (mode === 'boids') ? '' : 'none'
    } else if (id === 'vis') {
      el.style.display = '' // Always show Visuals (mode selector)
    } else {
      // Non-visual sections always visible
      el.style.display = ''
    }
  })
}

function mountEffect() {
  const mod = effectModule

  // Build UI immediately (don’t wait for audio)
  params = buildControls(
    mod.schema,
    (k, v) => {
      params[k] = v as any
      engine.updateParams(params)
      post({ type: 'params', patch: { [k]: v } })
      // react to mode changes
      if (k === 'vis.mode') applyModePanelVisibility(String(v))
    },
    mod.info.uiSections
  )

  applyModePanelVisibility(String(params['vis.mode'] ?? 'boids'))

  // Mount audio graph (safe even if context still suspended)
  engine.mountEffect(mod, params)

  // Visuals
  post({ type: 'selectEffect', id: mod.info.id, schema: mod.schema, params, needs: mod.info.needs })
}

function tick() {
  if (!ticking) return
  const payload = engine.capture(effectModule.info.needs)
  post({ type: 'audioFrame', ...payload })
  requestAnimationFrame(tick)
}

// NEW: don't await; try to resume and fall back to user gesture, but keep going
function tryStartAudioNonBlocking() {
  engine.resume().catch(() => { /* ignore */ })
  const onGesture = async () => {
    await engine.resume().catch(() => { })
    window.removeEventListener('pointerdown', onGesture)
    window.removeEventListener('keydown', onGesture)
  }
  window.addEventListener('pointerdown', onGesture, { once: true })
  window.addEventListener('keydown', onGesture, { once: true })
}

function startApp() {
  wireAudioUnlockGestures();
  tryStartAudioNonBlocking();
  initWorkerCanvas();
  mountEffect();
  initMobilePiano();
  mountDesktopPianoToggleIntoControls();
  initDesktopHelp();
  if (!ticking) { ticking = true; tick(); }
}


// Auto-start on load
startApp()

// Optional: resize support (only if you also handle resize in worker)
// window.addEventListener('resize', () => { setCanvasSize() /* post resize if supported */ })