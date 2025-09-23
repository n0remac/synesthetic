import type { EffectModule, EffectParams } from './protocol'


export class AudioEngine {
    ctx: AudioContext
    master: GainNode
    analyser: AnalyserNode
    mounted?: { update?: (p: EffectParams) => void; dispose?: () => void; output?: AudioNode }


    constructor() {
        this.ctx = new AudioContext()
        this.master = new GainNode(this.ctx, { gain: 1 })
        this.analyser = new AnalyserNode(this.ctx, { fftSize: 2048, smoothingTimeConstant: 0.0 })
        this.master.connect(this.ctx.destination)
        this.master.connect(this.analyser)
    }


    private ensureCtx(): AudioContext {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
                latencyHint: 'interactive'
            });
        }
        return this.ctx;
    }

    async resume(): Promise<void> {
        const ctx = this.ensureCtx();
        if (ctx.state === 'suspended') {
            await ctx.resume();
        }
        // iOS Safari sometimes needs a short silent tick to fully unlock
        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0;
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.01);
        } catch { }
    }

    get context(): AudioContext {
        return this.ensureCtx();
    }

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