import type { EffectModule, EffectParams } from './protocol'


export class AudioEngine {
    ctx: AudioContext
    master: GainNode
    analyser: AnalyserNode
    mounted?: { update?: (p: EffectParams) => void; dispose?: () => void; output?: AudioNode }


    constructor() {
        this.ctx = new AudioContext()
        this.master = new GainNode(this.ctx, { gain: 1 })
        this.analyser = new AnalyserNode(this.ctx, { fftSize: 1024, smoothingTimeConstant: 0.5 })
        this.master.connect(this.ctx.destination)
        this.master.connect(this.analyser)
    }


    async resume() { await this.ctx.resume() }


    mountEffect(mod: EffectModule, params: EffectParams) {
        this.unmount()
        if (!mod.audio) return
        const { output, update, dispose } = mod.audio.mount(this.ctx)
        if (output) {
            output.connect(this.master)
        }
        this.mounted = { update, dispose, output }
        this.updateParams(params)
    }


    updateParams(patch: EffectParams) {
        this.mounted?.update?.(patch)
    }


    unmount() {
        if (this.mounted) {
            try { this.mounted.output?.disconnect() } catch { }
            this.mounted.dispose?.()
            this.mounted = undefined
        }
    }


    capture(needs?: { fft?: boolean; time?: boolean }) {
        const out: { time?: Uint8Array; freq?: Uint8Array } = {}
        if (needs?.fft) {
            const f = new Uint8Array(this.analyser.frequencyBinCount)
            this.analyser.getByteFrequencyData(f)
            out.freq = f
        }
        if (needs?.time) {
            const t = new Uint8Array(this.analyser.fftSize)
            this.analyser.getByteTimeDomainData(t)
            out.time = t
        }
        return out
    }
}