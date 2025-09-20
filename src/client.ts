// src/client.ts
import { buildControls } from './ui/controls'
import type { EffectParams, MsgToWorker } from './engine/protocol'
import { AudioEngine } from './engine/audio'
import effectModule from './app' // main (audio+schema) module — main thread ONLY

const startBtn   = document.getElementById('start')  as HTMLButtonElement
const effectSel  = document.getElementById('effect') as HTMLSelectElement
const canvasEl   = document.getElementById('view')   as HTMLCanvasElement

// ---- Single-effect: populate (or hide) selector --------------------------------
effectSel.innerHTML = ''
{
  const opt = document.createElement('option')
  opt.value = effectModule.info.id
  opt.textContent = effectModule.info.label
  effectSel.appendChild(opt)
  effectSel.value = effectModule.info.id
  // optional: hide the dropdown since there’s only one
  effectSel.disabled = true
  effectSel.style.display = 'none'
}

// ---- Worker & engine state ------------------------------------------------------
const worker = new Worker('/src/engine/visual.worker.ts', { type: 'module' })
let engine: AudioEngine | null = null
let params: EffectParams = {}

function post(msg: MsgToWorker, transfer?: Transferable[]) {
  worker.postMessage(msg as any, transfer ?? [])
}

// ---- Canvas sizing before Offscreen transfer -----------------------------------
function setCanvasSize() {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  const rect = canvasEl.getBoundingClientRect()
  canvasEl.width  = Math.max(1, Math.floor(rect.width  * dpr))
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
  // Important: set size BEFORE transfer so the OffscreenCanvas inherits it
  setCanvasSize()
  const off = (canvasEl as any).transferControlToOffscreen()
  post({ type: 'initCanvas', canvas: off }, [off])
}

// If your worker later handles 'resize', you can uncomment this and send size updates.
// window.addEventListener('resize', () => {
//   if (!supportsOffscreen()) return
//   // You can't re-transfer; instead, let worker resize its OffscreenCanvas if supported.
//   // Example (if your worker implements it): post({ type: 'resize', width: canvasEl.width, height: canvasEl.height })
// })

// ---- Mount the (single) effect -------------------------------------------------
function mountEffect() {
  const mod = effectModule

  // UI
  params = buildControls(
    mod.schema,
    (k, v) => {
      params[k] = v as any
      engine?.updateParams(params)
      post({ type: 'params', patch: { [k]: v } })
    },
    mod.info.uiSections
  )

  // Audio
  engine?.mountEffect(mod, params)

  // Visual (worker builds visual internally from visualEngine; no import of ../index in worker)
  post({ type: 'selectEffect', id: mod.info.id, schema: mod.schema, params, needs: mod.info.needs })
}

// ---- Main loop -----------------------------------------------------------------
function tick() {
  if (!engine) return
  const payload = engine.capture(effectModule.info.needs)
  post({ type: 'audioFrame', ...payload })
  requestAnimationFrame(tick)
}

// ---- Start button --------------------------------------------------------------
startBtn.onclick = async () => {
  if (!engine) engine = new AudioEngine()
  await engine.resume()
  initWorkerCanvas()
  mountEffect()
  tick()
}
