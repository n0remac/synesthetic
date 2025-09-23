import { BaseController } from './base';
import type { FramePacket } from '../engine/protocol';

export class CircleLine extends BaseController {
  private freq?: Uint8Array;
  private time?: Uint8Array;
  private params: Record<string, number | string | boolean> = {};

  private lastStart: number = 0;
  private lastLockTime = 0;

  private prevWave?: Float32Array;    // previous normalized time buffer
  private lastPhaseCorr = 0;          // smoothed inter-frame phase shift (samples)

  update(pkt: FramePacket): void {
    this.freq = pkt.freq;
    this.time = pkt.time;
    this.params = pkt.params;
  }

  render(ctx: OffscreenCanvasRenderingContext2D): void {
    const w = this.w, h = this.h;
    const cx = w / 2, cy = h / 2;

    const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
    const visGainGlobal = Number(this.params['vis.gain'] ?? 1);
    const blueGain = Number(this.params['vis.blueGain'] ?? 1) * visGainGlobal;
    const whiteGain = Number(this.params['vis.whiteGain'] ?? 1) * visGainGlobal;
    const shape = clamp01(Number(this.params['vis.shape'] ?? 1)); // 0=line, 1=ring

    const scopeLock = this.params['vis.lock'] !== false; // default true
    const eps = Math.max(0, Math.min(0.2, Number(this.params['vis.lockEps'] ?? 0.01)));
    const holdMs = Math.max(0, Number(this.params['vis.lockHoldMs'] ?? 40)); // don't relock too often
    const smoothAlpha = clamp01(Number(this.params['vis.lockSmooth'] ?? 0.35));   // 0..1; higher = more smoothing

    const ANGLE0 = -Math.PI / 2;
    const TAU = Math.PI * 2;                         // NEW
    const deg = (d: number) => d * Math.PI / 180;    // NEW
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const wrapAngle = (a: number) => {               // NEW
      a %= TAU; return a < 0 ? a + TAU : a;
    };

    // Optional UI param: rotate ring by N degrees (applies to both blue/white)
    const angleOffsetRad = deg(Number(this.params['vis.angleDeg'] ?? 0)); // NEW

    // line baseline gap morph
    const baseGap = 48;
    const extraGap = 120;
    const gap = baseGap + extraGap * (1 - shape);

    const archK = 40 * shape; // curvature while straightening
    const xFromT = (tNorm: number) => lerp(w * 0.12, w * 0.88, tNorm);

    // Visual polish
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // --- helpers (replace your findTriggerStart & add frac sampler) -------------
    const norm = (b: number) => (b - 128) / 128;

    // Return fractional index of first upward zero-crossing with hysteresis.
    // If none, fall back to the strongest upward slope (also fractional).
    const findTriggerStartFrac = (arr: Uint8Array, hysteresis = 0.01, prefer: number): number => {
      const N = arr.length;
      if (N < 2) return 0;
      const sweep = Math.max(2, Math.floor(N * 0.08));
      for (let k = -sweep; k <= sweep; k++) {
        const i = (prefer + k + N) % N;
        const im1 = (i - 1 + N) % N;
        const p = norm(arr[im1]), c = norm(arr[i]);
        if (p <= -hysteresis && c >= +hysteresis) {
          const frac = (-p) / (c - p + 1e-9);  // 0..1 between im1→i
          return (im1 + frac + N) % N;
        }
      }
      let bestI = 1, bestSlope = -Infinity;
      for (let i = 1; i < N; i++) {
        const p = norm(arr[i - 1]), c = norm(arr[i]);
        const slope = c - p;
        if (slope > bestSlope) { bestSlope = slope; bestI = i; }
      }
      const p = norm(arr[bestI - 1]), c = norm(arr[bestI]);
      const frac = (-p) / (c - p + 1e-9);
      return (bestI - 1 + frac + N) % N;
    };

    // Fractional circular sampler with linear interpolation
    const sampleFrac = (arr: Uint8Array, s: number): number => {
      const N = arr.length;
      const i0 = Math.floor(s);
      const t = s - i0;
      const i1 = (i0 + 1) % N;
      const v0 = norm(arr[i0 % N]);
      const v1 = norm(arr[i1]);
      return v0 + (v1 - v0) * t;
    };

    // Convert Uint8 -> normalized Float32 once
    const toFloat = (u8: Uint8Array): Float32Array => {
      const out = new Float32Array(u8.length);
      for (let i = 0; i < u8.length; i++) out[i] = (u8[i] - 128) / 128;
      return out;
    };

    // Estimate circular shift between prev and cur using a short template.
    const estimateCircularShift = (
      prev: Float32Array, cur: Float32Array,
      searchRange: number, templateLen: number
    ): number => {
      const N = prev.length;
      if (N !== cur.length || N < templateLen + 2) return 0;
      const start = Math.floor((N - templateLen) / 2);
      let bestOffset = 0, bestScore = -Infinity;
      let tplE = 0;
      for (let i = 0; i < templateLen; i++) tplE += prev[start + i] * prev[start + i];
      tplE = Math.sqrt(tplE) + 1e-9;
      for (let off = -searchRange; off <= searchRange; off++) {
        let dot = 0, curE = 0;
        for (let i = 0; i < templateLen; i++) {
          const j = (start + i + off + N) % N;
          const v = cur[j];
          dot += prev[start + i] * v;
          curE += v * v;
        }
        const score = dot / (tplE * (Math.sqrt(curE) + 1e-9));
        if (score > bestScore) { bestScore = score; bestOffset = off; }
      }
      return bestOffset;
    };

    // Single continuous path (no halves) — FFT & generic use
    const drawMorphPath = ({
      N, sampleAt, ringBaseR, ringScale, lineY, stroke, width, closeRing = false,
      angleOffsetRad: angleOff = 0,   // NEW
    }: {
      N: number;
      sampleAt: (i: number) => number;
      ringBaseR: number;
      ringScale: number;
      lineY: number;
      stroke: string;
      width: number;
      closeRing?: boolean;
      angleOffsetRad?: number;        // NEW
    }) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();

      for (let i = 0; i < N; i++) {
        const tNorm = i / (N - 1);
        // NEW: add angle offset to ring angle
        const ang = wrapAngle(ANGLE0 + tNorm * TAU + angleOff);

        const a = sampleAt(i);

        const rRing = ringBaseR + a * ringScale;
        const xRing = cx + Math.cos(ang) * rRing;
        const yRing = cy + Math.sin(ang) * rRing;

        const xLine = xFromT(tNorm);
        const arch = archK * Math.cos(tNorm * Math.PI);
        const yLine = lineY + a * ringScale * 0.25 + arch;

        const x = lerp(xLine, xRing, shape);
        const y = lerp(yLine, yRing, shape);

        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }

      if (closeRing && shape > 0.999) ctx.closePath();
      ctx.stroke();
    };

    // Blue (FFT)
    if (this.freq && this.freq.length) {
      const step = Math.max(1, Math.floor(this.freq.length / 128));
      const N = 128;
      const sampleAt = (i: number) => {
        const freqLength = this.freq?.length ?? 0;
        const idx = Math.min(freqLength - 1, i * step);
        return (this.freq ? this.freq[idx] : 0) / 255 * blueGain;
      };

      drawMorphPath({
        N, sampleAt,
        ringBaseR: 130, ringScale: 140,
        lineY: cy - gap,
        stroke: 'hsl(200,80%,70%)', width: 2,
        angleOffsetRad: angleOffsetRad,               // NEW
      });
      drawMorphPath({
        N, sampleAt,
        ringBaseR: 130, ringScale: 140,
        lineY: cy + gap,
        stroke: 'hsl(200,80%,70%)', width: 2,
        angleOffsetRad: angleOffsetRad,               // NEW
      });
    }

    // White (time-domain)
    if (this.time && this.time.length) {
      const N = this.time.length;

      // Build current normalized buffer
      const cur = toFloat(this.time);

      // Phase alignment between frames
      const doPhaseAlign = this.params['vis.phaseAlign'] !== false; // default on
      if (doPhaseAlign) {
        if (this.prevWave && this.prevWave.length === N) {
          const searchRange = Math.floor(N * 0.10);
          const templateLen = Math.min(256, Math.floor(N * 0.25));
          const delta = estimateCircularShift(this.prevWave, cur, searchRange, templateLen);
          const corrSmooth = clamp01(Number(this.params['vis.phaseAlignSmooth'] ?? 0.5));
          this.lastPhaseCorr = this.lastPhaseCorr * (1 - corrSmooth) + delta * corrSmooth;
        } else {
          this.lastPhaseCorr = 0;
        }
        this.prevWave = cur;
      } else {
        this.lastPhaseCorr = 0;
        this.prevWave = cur;
      }

      const now = performance.now();

      // fractional trigger near lastStart
      let startFrac = this.lastStart;
      if (scopeLock && (now - this.lastLockTime) >= holdMs) {
        const candidate = findTriggerStartFrac(this.time, eps, Math.round(this.lastStart) % N);
        const wrap = (x: number) => ((x % N) + N) % N;
        let delta = candidate - this.lastStart;
        if (delta > N / 2) delta -= N;
        if (delta < -N / 2) delta += N;
        startFrac = wrap(this.lastStart + delta * smoothAlpha);
        this.lastStart = startFrac;
        this.lastLockTime = now;
      }

      // fractional sampler aligned to startFrac
      const sampleAt = (i: number) => sampleFrac(this.time!, startFrac + i) * whiteGain * 2;

      // phase-align ring by trigger & inter-frame correction
      const phaseOffset01 = ((startFrac - this.lastPhaseCorr) / N) % 1;

      // Time-domain draw with angle offset support
      const drawMorphPathTD = ({
        N, sampleAt, ringBaseR, ringScale, lineY, stroke, width,
        angleOffsetRad: angleOff = 0,    // NEW
      }: any) => {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let i = 0; i < N - 1; i++) { // skip 2π endpoint
          const t01 = i / (N - 1);
          // rotate by phase (seam align) + explicit angle offset
          const ang = wrapAngle(ANGLE0 + ((t01 + phaseOffset01 + 1) % 1) * TAU + angleOff);

          const a = sampleAt(i);

          const rRing = ringBaseR + a * ringScale;
          const xRing = cx + Math.cos(ang) * rRing;
          const yRing = cy + Math.sin(ang) * rRing;

          const xLine = xFromT(t01);
          const arch = archK * Math.cos(t01 * Math.PI);
          const yLine = lineY + a * ringScale * 0.25 + arch;

          const x = lerp(xLine, xRing, shape);
          const y = lerp(yLine, yRing, shape);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };

      // draw top/bottom once each (white)
      drawMorphPathTD({
        N, sampleAt, ringBaseR: 210, ringScale: 40,
        lineY: cy - gap * 0.6, stroke: 'white', width: 1,
        angleOffsetRad: angleOffsetRad,                 // NEW
      });
      drawMorphPathTD({
        N, sampleAt, ringBaseR: 210, ringScale: 40,
        lineY: cy + gap * 0.6, stroke: 'white', width: 1,
        angleOffsetRad: angleOffsetRad,                 // NEW
      });
    }
  }
}
