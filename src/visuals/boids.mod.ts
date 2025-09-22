// src/visuals/boids.mod.ts
import { BaseController } from './base'
import type { FramePacket } from '../engine/protocol'

type Boid = { x: number; y: number; vx: number; vy: number }

type AttractorPoint = {
  ox: number; oy: number; // offset from stream center
  w: number;              // local weight
}

type StreamState = {
  x: number; y: number;
  heading: number;
  strength: number;
  radius: number;
  ttl: number;
  turnVel: number;
  pts: AttractorPoint[];
}

export class Boids extends BaseController {
  private boids: Boid[] = []
  private inited = false

  // Envelope tracking
  private env = 0
  private envPrev = 0
  private envRise = 0

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

  // Stream (bug swarm container) + motion
  private stream: StreamState = {
    x: 0, y: 0,
    heading: Math.PI * 0.25,
    strength: 0,
    radius: 100,
    ttl: 0,
    turnVel: 0,
    pts: [],
  }

  // Tunables (kept from your last version)
  private STREAM_BASE_SPEED = 55
  private STREAM_RADIUS_MIN = 60
  private STREAM_RADIUS_MAX = 140
  private STREAM_TTL_MAX = 1.25
  private STREAM_V_GATE = 30
  private STREAM_FADE_RATE = 1.1
  private STREAM_JITTER = 0.6
  private STREAM_EDGE_STEER = 2.5

  // Edge avoidance
  private EDGE_MARGIN = 90
  private EDGE_PUSH_FLOCK = 220
  private EDGE_PUSH_STREAM = 140

  // Separation nudge (rising edge)
  private kAtk = 10

  // Attraction controls + display
  private attrDistMul = 3.0
  private attrStrength = 180
  private showSphere = true

  // NEW: bug swarm controls
  private bugCount = 6        // number of micro-attractors
  private bugTightness = 0.5      // 0..1 (0 = full disk, 1 = tight near center)
  private bugFocus = 1.2      // 0..3 how strongly boids “lock on” while held

  protected onInit(): void {
    this.stream.x = this.w * 0.5
    this.stream.y = this.h * 0.5
    this.regenBugPoints()
  }

  private wrapDelta(dx: number, span: number) {
    if (dx > span * 0.5) dx -= span
    else if (dx < -span * 0.5) dx += span
    return dx
  }

  private edgeRepelForBoid(x: number, y: number) {
    let fx = 0, fy = 0
    const m = this.EDGE_MARGIN
    if (x < m) fx += this.EDGE_PUSH_FLOCK * (1 - x / m) ** 2
    else if (x > this.w - m) fx -= this.EDGE_PUSH_FLOCK * (1 - (this.w - x) / m) ** 2
    if (y < m) fy += this.EDGE_PUSH_FLOCK * (1 - y / m) ** 2
    else if (y > this.h - m) fy -= this.EDGE_PUSH_FLOCK * (1 - (this.h - y) / m) ** 2
    return { fx, fy }
  }

  private ensureBoids() {
    const desired = this.count | 0;
    const cur = this.boids.length;

    if (!this.inited) {
      // first init
      this.boids = new Array(desired).fill(0).map(() => {
        const x = this.rand01() * this.w;
        const y = this.rand01() * this.h;
        const a = this.rand01() * Math.PI * 2;
        const s = this.maxSpeed * (0.25 + 0.25 * this.rand01());
        return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s };
      });
      this.inited = true;
      return;
    }

    if (desired > cur) {
      // add new boids near the stream center so they blend in
      const add = desired - cur;
      for (let i = 0; i < add; i++) {
        const jitterR = (this.stream.radius * 0.5) * this.rand01();
        const ang = this.rand01() * Math.PI * 2;
        const x = this.stream.x + Math.cos(ang) * jitterR;
        const y = this.stream.y + Math.sin(ang) * jitterR;
        const dir = this.rand01() * Math.PI * 2;
        const s = this.maxSpeed * (0.25 + 0.25 * this.rand01());
        this.boids.push({ x, y, vx: Math.cos(dir) * s, vy: Math.sin(dir) * s });
      }
    } else if (desired < cur) {
      // remove a few from the end (cheap)
      this.boids.length = desired;
    }
  }


  private computeEnvelope(time?: Uint8Array, dt?: number) {
    if (!time || !time.length) {
      const decay = 0.98
      this.env *= decay
      this.envRise = (this.env - this.envPrev) / Math.max(1e-3, dt ?? 1 / 60)
      this.envPrev = this.env
      return
    }
    let sum = 0
    for (let i = 0; i < time.length; i++) {
      const s = (time[i] - 128) / 128
      sum += s * s
    }
    const rms = Math.sqrt(sum / time.length)
    const atk = 0.35, rel = 0.12
    const k = rms > this.env ? atk : rel
    this.env = this.env + (rms - this.env) * k
    const dten = Math.max(1e-3, dt ?? 1 / 60)
    this.envRise = (this.env - this.envPrev) / dten
    this.envPrev = this.env
  }

  /** Regenerate bug points anywhere in the circle, biased by bugTightness. */
  private regenBugPoints() {
    const pts: AttractorPoint[] = []
    const outer = this.stream.radius * this.attrDistMul // visible circle radius
    const N = Math.max(1, Math.floor(this.bugCount))

    // tightness ∈ [0..1]: 0 = full spread, 1 = very tight near center
    const spread = 1 - Math.max(0, Math.min(1, this.bugTightness)) // 0..1
    for (let i = 0; i < N; i++) {
      const ang = this.rand01() * Math.PI * 2
      // sqrt(rand) gives uniform area; multiply by "spread" to compress toward center as tightness↑
      const r = outer * spread * Math.sqrt(this.rand01())
      const w = 0.7 + 0.6 * this.rand01() // 0.7..1.3 (varied pull per bug)
      pts.push({ ox: Math.cos(ang) * r, oy: Math.sin(ang) * r, w })
    }
    this.stream.pts = pts
  }

  private energizeStream(amount: number) {
    this.stream.ttl = this.STREAM_TTL_MAX
    this.stream.strength = Math.min(1, this.stream.strength + amount * 0.6)

    // size breathes with current level
    const lvl = Math.max(0, Math.min(1, this.env))
    this.stream.radius =
      this.STREAM_RADIUS_MIN +
      (this.STREAM_RADIUS_MAX - this.STREAM_RADIUS_MIN) * (0.35 + 0.4 * lvl)

    this.stream.turnVel += (this.rand01() - 0.5) * this.STREAM_JITTER

    // NEW: when a key is pressed (rising edge), make a NEW random bug set
    this.regenBugPoints()
  }

  private updateStream(dt: number, active: boolean) {
    if (!active) {
      if (this.stream.ttl > 0) this.stream.ttl = Math.max(0, this.stream.ttl - dt * 0.5)
      else this.stream.strength *= Math.exp(-this.STREAM_FADE_RATE * dt)
      this.stream.turnVel *= Math.exp(-dt * 2.0)
      return
    }

    this.stream.turnVel *= Math.exp(-dt * 1.6)

    // keep it inside bounds with a gentle steer toward center
    const m = this.EDGE_MARGIN
    let steerToCenter = 0
    if (this.stream.x < m || this.stream.x > this.w - m || this.stream.y < m || this.stream.y > this.h - m) {
      const cx = this.w * 0.5, cy = this.h * 0.5
      const dx = cx - this.stream.x
      const dy = cy - this.stream.y
      const desired = Math.atan2(dy, dx)
      let diff = desired - this.stream.heading
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      const maxTurn = this.STREAM_EDGE_STEER
      steerToCenter = Math.max(-maxTurn, Math.min(maxTurn, diff / Math.max(1e-3, dt)))
    }

    this.stream.heading += (this.stream.turnVel + steerToCenter) * dt

    const vx = Math.cos(this.stream.heading) * this.STREAM_BASE_SPEED
    const vy = Math.sin(this.stream.heading) * this.STREAM_BASE_SPEED

    let px = 0, py = 0
    if (this.stream.x < m) px += this.EDGE_PUSH_STREAM * (1 - this.stream.x / m)
    else if (this.stream.x > this.w - m) px -= this.EDGE_PUSH_STREAM * (1 - (this.w - this.stream.x) / m)
    if (this.stream.y < m) py += this.EDGE_PUSH_STREAM * (1 - this.stream.y / m)
    else if (this.stream.y > this.h - m) py -= this.EDGE_PUSH_STREAM * (1 - (this.h - this.stream.y) / m)

    this.stream.x += (vx + px) * dt
    this.stream.y += (vy + py) * dt

    // wrap (toroidal world)
    if (this.stream.x < 0) this.stream.x += this.w
    else if (this.stream.x >= this.w) this.stream.x -= this.w
    if (this.stream.y < 0) this.stream.y += this.h
    else if (this.stream.y >= this.h) this.stream.y -= this.h

    if (this.stream.ttl > 0) {
      this.stream.ttl -= dt
      if (this.stream.ttl < 0) this.stream.ttl = 0
    } else {
      this.stream.strength *= Math.exp(-this.STREAM_FADE_RATE * dt)
    }
  }

  update(pkt: FramePacket): void {
    const P = pkt.params
    const dt = Math.max(0.001, pkt.dt)

    this.STREAM_BASE_SPEED = Math.max(0, Number(P['boids.streamSpeed'] ?? 55))
    this.STREAM_EDGE_STEER = Math.max(0, Number(P['boids.turnGain'] ?? 2.5))

    // knobs
    this.count = Math.max(10, Math.floor(Number(P['boids.count'] ?? 350)))
    this.maxSpeed = Math.max(20, Number(P['boids.maxSpeed'] ?? 160))
    this.neighborR = Math.max(10, Number(P['boids.neighborR'] ?? 70))

    // existing controls
    this.kAtk = Math.max(0, Number(P['boids.kAtk'] ?? 10))
    this.attrDistMul = Math.max(0.5, Number(P['boids.attrDistMul'] ?? 3.0))
    this.attrStrength = Math.max(0, Number(P['boids.attrStrength'] ?? 180))
    this.showSphere = (P['boids.showSphere'] ?? true) !== false

    this.bugCount = Math.max(1, Math.floor(Number(P['boids.bugCount'] ?? 6)))
    this.bugTightness = Math.max(0, Math.min(1, Number(P['boids.bugTightness'] ?? 0.5)))
    this.bugFocus = Math.max(0, Math.min(3, Number(P['boids.bugFocus'] ?? 1.2)))

    if (!this.seeded) { this.seeded = true }
    this.ensureBoids()

    this.computeEnvelope(pkt.time, dt)

    // Rising edge spawns a NEW bug set; held notes keep current set
    const rising = Math.max(0, Math.tanh(this.envRise * 3))
    if (rising > 0.02) this.energizeStream(rising)

    const active = this.env > 0.02
    this.updateStream(dt, active)

    // Baseline boids weights + rising separation nudge
    const sepW = 0.6 + this.kAtk * rising
    const aliW = 0.35
    const cohW = 0.28

    const r2 = this.neighborR * this.neighborR

    for (let i = 0; i < this.boids.length; i++) {
      const b = this.boids[i]
      let cx = 0, cy = 0, count = 0
      let ax = 0, ay = 0
      let sx = 0, sy = 0

      // neighborhood
      for (let j = 0; j < this.boids.length; j++) {
        if (i === j) continue
        const o = this.boids[j]
        let dx = this.wrapDelta(o.x - b.x, this.w)
        let dy = this.wrapDelta(o.y - b.y, this.h)
        const d2 = dx * dx + dy * dy
        if (d2 > 0 && d2 < r2) {
          count++
          cx += o.x; cy += o.y
          ax += o.vx; ay += o.vy
          const inv = 1 / Math.max(1e-3, Math.sqrt(d2))
          sx -= dx * inv
          sy -= dy * inv
        }
      }

      // standard boids forces
      let fx = sx * sepW
      let fy = sy * sepW

      if (count > 0) {
        ax /= count; ay /= count
        fx += (ax - b.vx) * aliW
        fy += (ay - b.vy) * aliW

        cx /= count; cy /= count
        let tx = this.wrapDelta(cx - b.x, this.w)
        let ty = this.wrapDelta(cy - b.y, this.h)
        fx += tx * cohW
        fy += ty * cohW
      }

      // edge avoidance
      {
        const e = this.edgeRepelForBoid(b.x, b.y)
        fx += e.fx; fy += e.fy
      }

      // --------- Multi-point bug attraction ----------
      if (this.stream.strength > 1e-3 && this.stream.pts.length) {
        const outer = Math.max(1, this.stream.radius * this.attrDistMul)
        const gate = this.STREAM_V_GATE
        const share = 1 / this.stream.pts.length

        // While a key is HELD, bias the approach so even tangential paths curve in.
        // bugFocus sets how much "awareness" rises during key hold.
        const baselineBias = active ? Math.min(0.6, 0.18 * this.bugFocus) : 0.0

        for (const p of this.stream.pts) {
          const px = this.stream.x + p.ox
          const py = this.stream.y + p.oy

          let dx = this.wrapDelta(px - b.x, this.w)
          let dy = this.wrapDelta(py - b.y, this.h)
          const dist = Math.hypot(dx, dy)
          if (dist < outer && dist > 1e-4) {
            const nx = dx / dist, ny = dy / dist

            const approach = -(b.vx * nx + b.vy * ny)
            let g = approach / gate
            g = Math.max(0, Math.min(1, g))
            // Blend in baseline awareness so they always tend to curve toward bugs while held.
            const gApproach = baselineBias + (1 - baselineBias) * g

            // radial falloff
            const t = 1 - (dist / outer)
            const fall = t * t

            const activeBoost = active ? (1 + 0.6 * this.bugFocus) : 1
            const mag = this.attrStrength * this.stream.strength * fall * gApproach * p.w * share * activeBoost
            fx += nx * mag
            fy += ny * mag
          }
        }
      }
      // -----------------------------------------------

      // integrate velocity
      b.vx += fx * dt
      b.vy += fy * dt

      // clamp speed (with floor)
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

    if (this.showSphere && this.stream.strength > 0.001) {
      const outer = this.stream.radius * this.attrDistMul

      // outer influence
      ctx.globalAlpha = 0.08
      ctx.fillStyle = '#4cf'
      ctx.beginPath()
      ctx.arc(this.stream.x, this.stream.y, outer, 0, Math.PI * 2)
      ctx.fill()

      // bug points
      ctx.globalAlpha = 0.85
      ctx.fillStyle = '#9df'
      for (const p of this.stream.pts) {
        const px = this.stream.x + p.ox
        const py = this.stream.y + p.oy
        ctx.beginPath()
        ctx.arc(px, py, 2.5 + 2 * p.w, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    ctx.restore()
  }
}
