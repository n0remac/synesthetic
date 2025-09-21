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
  tryStartAudioNonBlocking()   // fire-and-forget
  initWorkerCanvas()           // proceed immediately
  mountEffect()
  if (!ticking) {
    ticking = true
    tick()
  }
}

// Auto-start on load
startApp()

// Optional: resize support (only if you also handle resize in worker)
// window.addEventListener('resize', () => { setCanvasSize() /* post resize if supported */ })