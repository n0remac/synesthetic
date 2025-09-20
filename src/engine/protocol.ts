export type NumParam = {
  kind: 'number'
  label: string
  min: number
  max: number
  step?: number
  default: number
  ui?: { section?: string };
}


export type EnumParam<T extends string = string> = {
  kind: 'enum'
  label: string
  options: readonly T[]
  default: T
  ui?: { section?: string };
}

export type ToggleParam = {
  kind: 'toggle';
  label: string;
  default: boolean;
  ui?: { section?: string };
};


export type ParamSchema = Record<string, NumParam | EnumParam<string> | ToggleParam>;
export type EffectParams = Record<string, number | string | boolean>;

export type UiSection = { id: string; label: string; color: string; enabledParam?: string };

export type EffectInfo = {
  id: string
  label: string
  needs?: { fft?: boolean; time?: boolean }
  uiSections?: UiSection[];
}


export type AudioEffect = {
  mount(ctx: AudioContext): {
    input?: AudioNode
    output?: AudioNode
    analyser?: AnalyserNode
    update?: (params: EffectParams) => void
    dispose?: () => void
  }
}


export type VisualEffect = {
  init(ctx: OffscreenCanvasRenderingContext2D, dims: { w: number; h: number }): void
  frame(args: {
    ctx: OffscreenCanvasRenderingContext2D
    time?: Uint8Array
    freq?: Uint8Array
    params: EffectParams
    dt: number
  }): void
  resize?: (w: number, h: number) => void
  dispose?: () => void
}


export type EffectModule = {
  info: EffectInfo
  schema: ParamSchema
  audio?: AudioEffect
  visual?: VisualEffect
}


// Worker protocol
export type MsgToWorker =
  | { type: 'initCanvas'; canvas: OffscreenCanvas }
  | { type: 'selectEffect'; id: string; schema: ParamSchema; params: EffectParams; needs?: EffectInfo['needs'] }
  | { type: 'params'; patch: Partial<EffectParams> }
  | { type: 'audioFrame'; time?: Uint8Array; freq?: Uint8Array }


export type MsgFromWorker = { type: 'ready' } | { type: 'resize'; w: number; h: number }
