// src/engine/visualEngine.ts
import type { FramePacket, ModeId, VisualController, VisualEffect } from './protocol'
import { CircleLine } from '../visuals/circleLine.mod'
import { Boids } from '../visuals/boids.mod'

export class VisualEngine {
  private ctx!: OffscreenCanvasRenderingContext2D
  private w = 0
  private h = 0

  private currentMode: ModeId = 'circleLine'
  private targetMode: ModeId = 'circleLine'
  private blend = 0
  private lastPerf?: number

  private controllers = new Map<ModeId, VisualController>()

  init(ctx: OffscreenCanvasRenderingContext2D, size: { w: number; h: number }) {
    this.ctx = ctx
    this.w = size.w
    this.h = size.h
    this.lastPerf = undefined

    this.ensureController(this.currentMode).init(this.ctx, this.w, this.h)
  }

  private ensureController(mode: ModeId): VisualController {
    let c = this.controllers.get(mode)
    if (!c) {
      switch (mode) {
        case 'boids':
          c = new Boids()
          break
        case 'circleLine':
        default:
          c = new CircleLine()
          break
      }
      c.init(this.ctx, this.w, this.h)
      this.controllers.set(mode, c)
    }
    return c
  }

  frame(args: {
    freq?: Uint8Array
    time?: Uint8Array
    params: Record<string, number | string | boolean>
    dt?: number
  }) {
    const { params } = args
    const now = performance.now() * 0.001
    const dt =
      typeof args.dt === 'number'
        ? Math.max(0.001, args.dt)
        : (() => {
            const prev = this.lastPerf ?? now - 1 / 60
            this.lastPerf = now
            return Math.max(0.001, now - prev)
          })()

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

    // prepare frame packet for controllers
    const pkt: FramePacket = {
      dt,
      w: this.w,
      h: this.h,
      params,
      freq: args.freq,
      time: args.time,
    }

    // clear the canvas each frame
    this.ctx.globalCompositeOperation = 'source-over'
    this.ctx.globalAlpha = 1
    this.ctx.fillStyle = '#000'
    this.ctx.fillRect(0, 0, this.w, this.h)

    // update & render visuals
    const A = this.ensureController(this.currentMode)
    const B = this.ensureController(this.targetMode)
    A.update(pkt)
    B.update(pkt)

    if (this.currentMode === this.targetMode) {
      this.ctx.globalAlpha = 1
      A.render(this.ctx)
    } else {
      const t = this.blend
      this.ctx.globalAlpha = 1 - t
      A.render(this.ctx)
      this.ctx.globalAlpha = t
      B.render(this.ctx)
    }

    this.ctx.globalAlpha = 1
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
