// src/audio/dsp/arpHub.ts
import { applyPattern, stepLengthSec, type ArpPattern, type Div } from './arpCommon';
import { ChordCapturer, mergeEditOne } from './chordCapture';
import type { NoteHub } from '../../../engine/input/noteHub';

export type ArpParams = {
    on: boolean;
    hold: boolean;
    pattern: ArpPattern;
    sync: boolean;
    bpm: number;
    div: Div;
    rateHz: number;
    gate: number;       // 0..1
    velocity: number;   // 0..1
    octaves: number;    // 1..4
};

export type NoteGate = {
    noteOn: (midi: number, when: number, velocity: number) => void;
    noteOff: (midi: number, when: number) => void;
    now: () => number; // AudioContext.currentTime
};

const DEFAULTS: ArpParams = {
    on: false, hold: false, pattern: 'up',
    sync: true, bpm: 120, div: '1/8', rateHz: 8,
    gate: 0.6, velocity: 0.9, octaves: 1,
};

export class ArpFromHub {
    public lookahead = 0.08;

    private gate: NoteGate;
    private hub: NoteHub;
    private params: ArpParams = { ...DEFAULTS };

    private latched = new Set<number>();
    private order: number[] = [];
    private stepIdx = 0;
    private dir: 1 | -1 = 1;

    private timer: number | null = null;
    private intervalMs = 25;
    private nextStepTime = 0;

    private capturer: ChordCapturer;
    private unlisten?: () => void;

    constructor(gate: NoteGate, hub: NoteHub, captureOpts = {}) {
        this.gate = gate;
        this.hub = hub;
        this.capturer = new ChordCapturer(hub, captureOpts);

        // Listen to hub events to drive capture & live updates
        this.unlisten = hub.on((ev: any) => {
            const nowMs = performance.now();
            if (ev.type === 'noteon') {
                // start a new capture window on first note of a combo
                if (!this.capturer.active()) this.capturer.begin(nowMs);
                this.capturer.push(ev.midi, nowMs);

                // ensure running
                this.ensureRunning();
            } else if (ev.type === 'noteoff') {
                // If not holding, we may need to rebuild order when things are released
                if (!this.params.hold) this.rebuildFromSnapshot();
            }
        });
    }

    dispose() {
        this.panicAll();
        if (this.timer !== null) window.clearInterval(this.timer);
        this.timer = null;
        this.unlisten?.();
    }

    setParams(p: Partial<ArpParams>) {
        const wasOn = this.params.on;
        Object.assign(this.params, p);

        if (wasOn && p.on === false) {
            this.panicAll();
        }
        if (p.sync !== undefined || p.bpm !== undefined || p.div !== undefined || p.rateHz !== undefined) {
            this.retime();
        }
        if (p.pattern !== undefined || p.octaves !== undefined) {
            this.rebuildFromSnapshot();
        }
        if (p.hold !== undefined && !p.hold) {
            // turning hold off clears latch and snaps to what's currently held
            this.latched.clear();
            this.rebuildFromSnapshot();
        }
        this.ensureRunning();
    }

    /** Call this periodically from your UI tick, or right after capture timeout, to finalize a chord combo. */
    finalizeCaptureIfAny() {
        if (!this.capturer.active()) return;
        // The timer inside capturer simply marks a window; we finalize once per update/render loop.
        const recorded = this.capturer.finalize(); // ordered by combo timing (same-time low→high)
        this.applyRecorded(recorded);
    }

    // ---- internal ----
    private rebuildFromSnapshot() {
        const snap = this.hub.snapshot(this.gate.now());
        const held = new Set(snap.held.map(h => h.midi));
        const base = this.params.hold
            ? (this.latched.size ? Array.from(this.latched).sort((a, b) => a - b) : Array.from(held).sort((a, b) => a - b))
            : Array.from(held).sort((a, b) => a - b);

        const expanded = this.expandOctaves(base);
        this.order = applyPattern(expanded, this.params.pattern);
        if (this.stepIdx >= this.order.length) this.stepIdx = 0;
    }

    private applyRecorded(recorded: number[]) {
        const snap = this.hub.snapshot(this.gate.now());
        const held = new Set(snap.held.map(h => h.midi));

        if (this.params.hold) {
            // keep latched notes that are still physically held, then append new notes
            const kept = Array.from(this.latched).filter(m => held.has(m));
            const keptSet = new Set(kept);
            const additions = recorded.filter(m => !keptSet.has(m));
            const nextLatched = kept.concat(additions);
            this.latched = new Set(nextLatched);
            const expanded = this.expandOctaves(nextLatched);
            this.order = applyPattern(expanded, this.params.pattern);
            this.stepIdx = 0; this.dir = 1;
        } else {
            // non-hold: edit-one-note behavior
            const prev = this.order.slice();
            // base (without octaves) is what's physically held sorted low→high
            const baseHeld = Array.from(held).sort((a, b) => a - b);
            const merged = mergeEditOne(prev.filter((_, i) => true /* linear idx */), held, recorded);
            // If merged is empty but keys are down (first chord), fall back to current held
            const base = merged.length ? merged : baseHeld;
            const expanded = this.expandOctaves(base);
            this.order = applyPattern(expanded, this.params.pattern);
            this.stepIdx = 0; this.dir = 1;
        }
    }

    private expandOctaves(notes: number[]): number[] {
        const o = Math.max(1, this.params.octaves | 0);
        const out: number[] = [];
        for (let k = 0; k < o; k++) {
            const offs = 12 * k;
            for (const n of notes) out.push(n + offs);
        }
        return out;
    }

    private stepLen(): number {
        return stepLengthSec({
            sync: this.params.sync, bpm: this.params.bpm, div: this.params.div, rateHz: this.params.rateHz,
        });
    }

    private retime() {
        const now = this.gate.now();
        this.nextStepTime = Math.max(now, this.nextStepTime, now + 0.001);
    }

    private ensureRunning() {
        const need = this.params.on && (this.order.length > 0 || this.capturer.active());
        if (need && this.timer === null) {
            this.nextStepTime = Math.max(this.gate.now(), this.nextStepTime);
            this.timer = window.setInterval(() => this.schedulerTick(), this.intervalMs);
        } else if (!need && this.timer !== null) {
            window.clearInterval(this.timer);
            this.timer = null;
        }
    }

    private schedulerTick() {
        // finalize capture window if it elapsed
        this.finalizeCaptureIfAny();

        const now = this.gate.now();
        const ahead = now + this.lookahead;
        while (this.nextStepTime < ahead) {
            this.triggerStep(this.nextStepTime);
            this.nextStepTime += this.stepLen();
        }
    }

    private triggerStep(when: number) {
        if (this.order.length === 0) return;
        const stepDur = this.stepLen();
        const dur = Math.max(0.008, Math.min(stepDur * this.params.gate, stepDur - 0.012));
        const vel = this.params.velocity;

        if (this.params.pattern === 'chord') {
            for (const m of this.order) this.gate.noteOn(m, when, vel);
            for (const m of this.order) this.gate.noteOff(m, when + dur);
        } else {
            const m = this.order[this.stepIdx % this.order.length];
            this.gate.noteOn(m, when, vel);
            this.gate.noteOff(m, when + dur);

            if (this.params.pattern === 'updown' && this.order.length > 1) {
                if (this.dir === 1 && this.stepIdx >= this.order.length - 1) this.dir = -1;
                else if (this.dir === -1 && this.stepIdx <= 0) this.dir = 1;
                this.stepIdx += this.dir;
            } else {
                this.stepIdx = (this.stepIdx + 1) % this.order.length;
            }
        }
    }

    private panicAll() {
        const now = this.gate.now() + 0.001;

        // 1) Anything in current expanded order
        for (const m of this.order) this.gate.noteOff(m, now);

        // 2) Anything latched (base notes across octaves)
        if (this.latched.size > 0) {
            const base = Array.from(this.latched);
            const o = Math.max(1, this.params.octaves | 0);
            for (let k = 0; k < o; k++) {
                const offs = 12 * k;
                for (const n of base) this.gate.noteOff(n + offs, now);
            }
        }

        // 3) Anything physically held in the hub snapshot (defensive)
        const snap = this.hub.snapshot(now);
        for (const h of snap.held) this.gate.noteOff(h.midi, now);

        // Reset internal sequencing state
        this.order = [];
        this.latched.clear();
        this.stepIdx = 0;
        this.dir = 1;
        this.nextStepTime = now;
    }
}
