// src/visuals/circleLine/index.ts
import { BaseController } from './base';
import type { FramePacket } from '../engine/protocol';

export class CircleLine extends BaseController {
  private freq?: Uint8Array;
  private time?: Uint8Array;
  private params: Record<string, number | string | boolean> = {};

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
    const blueGain  = Number(this.params['vis.blueGain']  ?? 1) * visGainGlobal;
    const whiteGain = Number(this.params['vis.whiteGain'] ?? 1) * visGainGlobal;
    const shape     = clamp01(Number(this.params['vis.shape'] ?? 1)); // 0=line, 1=ring

    const ANGLE0 = -Math.PI / 2;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    // line baseline gap morph
    const baseGap = 48;
    const extraGap = 120;
    const gap = baseGap + extraGap * (1 - shape);

    const archK = 40 * shape; // curvature while straightening
    const xFromT = (tNorm: number) => lerp(w * 0.12, w * 0.88, tNorm);

    const drawMorphPath = ({
      N,
      sampleAt,
      ringBaseR,
      ringScale,
      lineY,
      stroke,
      width,
    }: {
      N: number;
      sampleAt: (i: number) => number;
      ringBaseR: number;
      ringScale: number;
      lineY: number;
      stroke: string;
      width: number;
    }) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;

      const halves: Array<{ i0: number; i1: number }> = [
        { i0: 0, i1: Math.floor(N / 2) },
        { i0: Math.floor(N / 2), i1: N - 1 },
      ];

      for (const { i0, i1 } of halves) {
        ctx.beginPath();
        const dir = i1 >= i0 ? 1 : -1;
        for (let i = i0; dir > 0 ? i <= i1 : i >= i1; i += dir) {
          const tNorm = i / (N - 1);
          const ang = ANGLE0 + tNorm * Math.PI * 2;

          const a = sampleAt(i);

          const rRing = ringBaseR + a * ringScale;
          const xRing = cx + Math.cos(ang) * rRing;
          const yRing = cy + Math.sin(ang) * rRing;

          const xLine = xFromT((i - i0) / (i1 - i0 || 1));
          const arch = archK * Math.cos(((i - i0) / (i1 - i0 || 1)) * Math.PI);
          const yLine = lineY + a * ringScale * 0.25 + arch;

          const x = lerp(xLine, xRing, shape);
          const y = lerp(yLine, yRing, shape);

          if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
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
        ringBaseR: 130,
        ringScale: 140,
        lineY: cy - gap,
        stroke: 'hsl(200,80%,70%)',
        width: 2,
      });
      drawMorphPath({
        N, sampleAt,
        ringBaseR: 130,
        ringScale: 140,
        lineY: cy + gap,
        stroke: 'hsl(200,80%,70%)',
        width: 2,
      });
    }

    // White (time-domain)
    if (this.time && this.time.length) {
      const N = this.time.length;
      const sampleAt = (i: number) => ((this.time![i] - 128) / 128) * whiteGain * 2;

      drawMorphPath({
        N, sampleAt,
        ringBaseR: 210,
        ringScale: 40,
        lineY: cy - gap * 0.6,
        stroke: 'white',
        width: 1,
      });
      drawMorphPath({
        N, sampleAt,
        ringBaseR: 210,
        ringScale: 40,
        lineY: cy + gap * 0.6,
        stroke: 'white',
        width: 1,
      });
    }
  }
}
