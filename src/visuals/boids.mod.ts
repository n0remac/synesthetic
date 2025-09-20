// src/visuals/boids.mod.ts
import { BaseController } from './base'
import type { FramePacket } from '../engine/protocol'

type Boid = { x: number; y: number; vx: number; vy: number }

export class Boids extends BaseController {
  private boids: Boid[] = []
  private inited = false

  // Envelope tracking
  private env = 0
  private envPrev = 0
  private envRise = 0   // >0 when rising, <0 when falling

  // Flock params
  private count = 300
  private maxSpeed = 160
  private neighborR = 70

  // RNG
  private seeded = false
  private seed = 123456789
  private rand01() {
    let t = (this.seed += 0x9E3779B9)
    t ^= t << 13; t ^= t >>> 17; t ^= t << 5
    return ((t >>> 0) % 100000) / 100000
  }

  protected onInit(): void {}

  private ensureBoids() {
    if (this.inited && this.boids.length === this.count) return
    this.boids = new Array(this.count).fill(0).map(() => {
      const x = this.rand01() * this.w
      const y = this.rand01() * this.h
      const a = this.rand01() * Math.PI * 2
      const s = this.maxSpeed * (0.25 + 0.25 * this.rand01())
      return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s }
    })
    this.inited = true
  }

  private computeEnvelope(time?: Uint8Array, dt?: number) {
    if (!time || !time.length) {
      // idle decay
      const decay = 0.98
      this.env *= decay
      this.envRise = (this.env - this.envPrev) / Math.max(1e-3, dt ?? 1 / 60)
      this.envPrev = this.env
      return
    }
    // RMS envelope
    let sum = 0
    for (let i = 0; i < time.length; i++) {
      const s = (time[i] - 128) / 128
      sum += s * s
    }
    const rms = Math.sqrt(sum / time.length)
    // A/R smoothing
    const atk = 0.35, rel = 0.12
    const k = rms > this.env ? atk : rel
    this.env = this.env + (rms - this.env) * k
    const dten = Math.max(1e-3, dt ?? 1 / 60)
    this.envRise = (this.env - this.envPrev) / dten
    this.envPrev = this.env
  }

  update(pkt: FramePacket): void {
    const P = pkt.params
    const dt = Math.max(0.001, pkt.dt)

    // knobs (same names you had)
    this.count     = Math.max(10, Math.floor(Number(P['boids.count'] ?? 350)))
    this.maxSpeed  = Math.max(20, Number(P['boids.maxSpeed'] ?? 160))
    this.neighborR = Math.max(10, Number(P['boids.neighborR'] ?? 70))

    // ONLY slider we keep: attack → separation (0..20)
    const kAtk = Math.max(0, Number(P['boids.kAtk'] ?? 10))

    if (!this.seeded) { this.seeded = true }
    this.ensureBoids()

    this.computeEnvelope(pkt.time, dt)

    // Baseline rule weights
    const baseSep = 0.6
    const baseAli = 0.35
    const baseCoh = 0.28

    // Rising-edge boost only (falling/steady = no extra)
    const rising = Math.max(0, Math.tanh(this.envRise * 3))  // 0..~1
    const sepW = baseSep + kAtk * rising
    const aliW = baseAli
    const cohW = baseCoh

    const r2 = this.neighborR * this.neighborR

    for (let i = 0; i < this.boids.length; i++) {
      const b = this.boids[i]
      let cx = 0, cy = 0, count = 0
      let ax = 0, ay = 0
      let sx = 0, sy = 0

      for (let j = 0; j < this.boids.length; j++) {
        if (i === j) continue
        const o = this.boids[j]

        // toroidal shortest delta
        let dx = o.x - b.x
        let dy = o.y - b.y
        if (dx >  this.w * 0.5) dx -= this.w
        if (dx < -this.w * 0.5) dx += this.w
        if (dy >  this.h * 0.5) dy -= this.h
        if (dy < -this.h * 0.5) dy += this.h

        const d2 = dx*dx + dy*dy
        if (d2 > 0 && d2 < r2) {
          count++
          cx += o.x; cy += o.y
          ax += o.vx; ay += o.vy
          const inv = 1 / Math.max(1e-3, Math.sqrt(d2))
          sx -= dx * inv
          sy -= dy * inv
        }
      }

      // accumulate forces
      let fx = sx * sepW
      let fy = sy * sepW

      if (count > 0) {
        // alignment
        ax /= count; ay /= count
        fx += (ax - b.vx) * aliW
        fy += (ay - b.vy) * aliW

        // cohesion (wrap-aware)
        cx /= count; cy /= count
        let tx = cx - b.x
        let ty = cy - b.y
        if (tx >  this.w * 0.5) tx -= this.w
        if (tx < -this.w * 0.5) tx += this.w
        if (ty >  this.h * 0.5) ty -= this.h
        if (ty < -this.h * 0.5) ty += this.h
        fx += tx * cohW
        fy += ty * cohW
      }

      // integrate velocity
      b.vx += fx * dt
      b.vy += fy * dt

      // clamp speed with a small floor to keep motion alive
      const vmax = this.maxSpeed
      const sp = Math.hypot(b.vx, b.vy)
      const vmin = vmax * 0.25
      if (sp > vmax) {
        const s = vmax / sp
        b.vx *= s; b.vy *= s
      } else if (sp < vmin) {
        const s = (vmin + 1e-6) / Math.max(1e-6, sp)
        b.vx *= s; b.vy *= s
      }

      // integrate position + wrap
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (b.x < 0) b.x += this.w; else if (b.x >= this.w) b.x -= this.w
      if (b.y < 0) b.y += this.h; else if (b.y >= this.h) b.y -= this.h
    }
  }

  render(ctx: OffscreenCanvasRenderingContext2D): void {
    ctx.save()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'white'
    ctx.globalCompositeOperation = 'source-over'
    const len = 6
    for (const b of this.boids) {
      const sp = Math.hypot(b.vx, b.vy) + 1e-6
      const nx = b.vx / sp, ny = b.vy / sp
      ctx.beginPath()
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(b.x + nx * len, b.y + ny * len)
      ctx.stroke()
    }
    ctx.restore()
  }
}
