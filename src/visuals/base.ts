// src/visuals/base.ts
import type { FramePacket, VisualController } from '../engine/protocol';

export abstract class BaseController implements VisualController {
  protected w = 0; protected h = 0;
  protected initialized = false;

  init(_ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): void {
    this.w = w; this.h = h;
    this.onInit();
    this.initialized = true;
  }

  protected onInit(): void {}

  abstract update(pkt: FramePacket): void;
  abstract render(ctx: OffscreenCanvasRenderingContext2D): void;
}
