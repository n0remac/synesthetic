// src/engine/visual.worker.ts
import { type MsgToWorker, type EffectParams, type VisualEffect } from './protocol';
import { makeVisualEffect } from './visualEngine';

let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null

let visual: VisualEffect | null = null
let params: EffectParams = {}
let needs: { fft?: boolean; time?: boolean } | undefined
let lastTime = 0

function ensureCtx() {
    if (!canvas) return null
    if (!ctx) ctx = canvas.getContext('2d')
    return ctx
}

function onAudioFrame(payload: { time?: Uint8Array; freq?: Uint8Array }) {
    const c = ensureCtx()
    if (!c || !visual) return
    const now = performance.now()
    const dt = (now - lastTime) / 1000
    lastTime = now
    visual.frame({ ctx: c, params, dt, time: payload.time, freq: payload.freq })
}

self.onmessage = (e: MessageEvent<MsgToWorker>) => {
    const msg = e.data
    switch (msg.type) {
        case 'initCanvas': {
            canvas = msg.canvas
            ctx = canvas.getContext('2d')
            break
        }

        case 'selectEffect': {
            // dispose previous visual if present
            (visual as any)?.dispose?.();

            params = msg.params;
            needs = msg.needs;

            const c = ensureCtx();
            if (!c || !canvas) { visual = null; break; }

            // build a fresh visual right here; do NOT import ../index in the worker
            visual = makeVisualEffect();
            visual.init(c, { w: canvas.width, h: canvas.height });
            break;
        }


        case 'params': {
            params = {
                ...params,
                ...Object.fromEntries(
                    Object.entries(msg.patch)
                        .filter(([_, v]) => v !== undefined)
                        .map(([k, v]) => [k, v as string | number])
                )
            }
            break
        }

        case 'audioFrame': {
            onAudioFrame({ time: msg.time, freq: msg.freq })
            break
        }
    }
}
