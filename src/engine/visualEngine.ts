// src/engine/visualEngine.ts
import type { FramePacket, ModeId, VisualController, VisualEffect } from './protocol'
import { CircleLine } from '../visuals/circleLine.mod'
import { Boids } from '../visuals/boids.mod'


export class VisualEngine {
  private ctx!: OffscreenCanvasRenderingContext2D
  private w = 0; private h = 0
  private trail!: OffscreenCanvas
  private tctx!: OffscreenCanvasRenderingContext2D

  private currentMode: ModeId = 'circleLine'
  private targetMode: ModeId = 'circleLine'
  private blend = 0
  private lastPerf?: number

  private controllers = new Map<ModeId, VisualController>()

  init(ctx: OffscreenCanvasRenderingContext2D, size: { w: number; h: number }) {
    this.ctx = ctx
    this.w = size.w; this.h = size.h

    this.trail = new OffscreenCanvas(this.w, this.h)
    const tctx = this.trail.getContext('2d')
    if (!tctx) throw new Error('Failed to get 2D for trail')
    this.tctx = tctx
    this.tctx.fillStyle = '#000'
    this.tctx.fillRect(0, 0, this.w, this.h)

    this.lastPerf = undefined

    this.ensureController(this.currentMode).init(this.ctx, this.w, this.h)
  }

  private ensureController(mode: ModeId): VisualController {
    let c = this.controllers.get(mode)
    if (!c) {
      switch (mode) {
        case 'boids': c = new Boids(); break
        case 'circleLine':
        default: c = new CircleLine(); break
      }
      c.init(this.ctx, this.w, this.h)
      this.controllers.set(mode, c)
    }
    return c
  }

  frame(args: { freq?: Uint8Array; time?: Uint8Array; params: Record<string, number | string | boolean>; dt?: number }) {
    const { params } = args
    const now = performance.now() * 0.001
    const dt = typeof args.dt === 'number' ? Math.max(0.001, args.dt) : (() => {
      const prev = this.lastPerf ?? (now - 1 / 60)
      this.lastPerf = now
      return Math.max(0.001, now - prev)
    })()

    const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
    const fbOn = params['fb.on'] !== false
    const amt = clamp01(Number(params['fb.amount'] ?? 0.25))
    const len = clamp01(Number(params['fb.length'] ?? 0.6))
    const timeS = Math.max(0.001, Math.min(2.0, Number(params['fb.time'] ?? 240) / 1000))
    const morphSpeed = Math.max(0.05, Number(params['morph.speed'] ?? 1.5))

    const targetParam = (params['vis.mode'] ?? 'circleLine') as ModeId
    if (targetParam !== this.targetMode) this.targetMode = targetParam

    if (this.currentMode !== this.targetMode) {
      this.blend = Math.min(1, this.blend + dt / morphSpeed)
      if (this.blend >= 1) {
        this.currentMode = this.targetMode
        this.blend = 0
      }
    }

    const pkt: FramePacket = { dt, w: this.w, h: this.h, params, freq: args.freq, time: args.time }

    const g = Math.min(0.95, Math.pow(len, 0.6) * 0.95)
    const f = Math.pow(g, Math.max(0.001, dt) / Math.max(0.001, timeS))
    const decayAlpha = 1 - f

    if (fbOn) {
      this.tctx.globalCompositeOperation = 'source-over'
      this.tctx.globalAlpha = 1
      this.tctx.fillStyle = `rgba(0,0,0,${decayAlpha})`
      this.tctx.fillRect(0, 0, this.w, this.h)
    } else {
      this.tctx.globalCompositeOperation = 'source-over'
      this.tctx.globalAlpha = 1
      this.tctx.fillStyle = '#000'
      this.tctx.fillRect(0, 0, this.w, this.h)
    }

    this.ctx.globalCompositeOperation = 'source-over'
    this.ctx.globalAlpha = 1
    this.ctx.fillStyle = '#000'
    this.ctx.fillRect(0, 0, this.w, this.h)

    const A = this.ensureController(this.currentMode)
    const B = this.ensureController(this.targetMode)
    A.update(pkt)
    B.update(pkt)

    if (this.currentMode === this.targetMode) {
      this.ctx.globalAlpha = 1
      A.render(this.ctx)
      this.ctx.globalAlpha = 1
    } else {
      const t = this.blend
      this.ctx.globalAlpha = 1 - t
      A.render(this.ctx)
      this.ctx.globalAlpha = t
      B.render(this.ctx)
      this.ctx.globalAlpha = 1
    }

    if (fbOn && amt > 0) {
      this.tctx.save()
      this.tctx.globalCompositeOperation = 'source-over'
      this.tctx.globalAlpha = amt
      this.tctx.filter = 'blur(0.6px)'
      this.tctx.drawImage(this.ctx.canvas as any as CanvasImageSource, 0, 0)
      this.tctx.filter = 'none'
      this.tctx.restore()
    }

    if (fbOn) {
      this.ctx.globalCompositeOperation = 'source-over'
      this.ctx.globalAlpha = 1
      this.ctx.drawImage(this.trail, 0, 0)
    }
  }
}

export function makeVisualEffect(): VisualEffect {
  const engine = new VisualEngine()
  return {
    init: (ctx, size) => engine.init(ctx, size),
    frame: ({ freq, time, params, dt }) => {
      engine.frame({ freq, time, params, dt })
    },
  }
}
