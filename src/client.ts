import { listEffects, getEffect } from './engine/registry'
import { buildControls } from './ui/controls'
import type { EffectParams, MsgToWorker } from './engine/protocol'
import { AudioEngine } from './engine/audio'


const startBtn = document.getElementById('start') as HTMLButtonElement
const effectSelect = document.getElementById('effect') as HTMLSelectElement
const canvasEl = document.getElementById('view') as HTMLCanvasElement


// Populate effect selector
const effects = listEffects()
for (const fx of effects) {
  const opt = document.createElement('option')
  opt.value = fx.id; opt.textContent = fx.label
  effectSelect.appendChild(opt)
}


const worker = new Worker('/src/engine/visual.worker.ts', { type: 'module' })
let engine: AudioEngine | null = null
let params: EffectParams = {}
let currentEffectId = effects[0]?.id ?? ''


effectSelect.value = currentEffectId


function post(msg: MsgToWorker, transfer?: Transferable[]) { worker.postMessage(msg as any, transfer ?? []) }


function supportsOffscreen() {
  return typeof (canvasEl as any).transferControlToOffscreen === 'function' && typeof (window as any).OffscreenCanvas !== 'undefined'
}


function initWorkerCanvas() {
  if (!supportsOffscreen()) {
    console.warn('OffscreenCanvas not supported; visuals require a modern browser.')
    return
  }
  const off = (canvasEl as any).transferControlToOffscreen()
  post({ type: 'initCanvas', canvas: off }, [off])
}


function mountEffect(id: string) {
  const mod = getEffect(id)
  if (!mod) return
  // UI
  params = buildControls(mod.schema, (k, v) => {
    params[k] = v as any;
    engine?.updateParams(params);
    post({ type: 'params', patch: { [k]: v } });
  }, mod.info.uiSections);
  // Audio
  engine?.mountEffect(mod, params)
  // Visual
  post({ type: 'selectEffect', id, schema: mod.schema, params, needs: mod.info.needs })
}


startBtn.onclick = async () => {
  if (!engine) engine = new AudioEngine()
  await engine.resume()
  initWorkerCanvas()
  mountEffect(currentEffectId)
  tick()
}


effectSelect.addEventListener('change', () => {
  currentEffectId = effectSelect.value
  if (!engine) return
  mountEffect(currentEffectId)
})


function tick() {
  if (!engine) return
  const mod = getEffect(currentEffectId)
  const payload = engine.capture(mod?.info.needs)
  post({ type: 'audioFrame', ...payload })
  requestAnimationFrame(tick)
}