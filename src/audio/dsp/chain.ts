export type Chain = {
  filter: BiquadFilterNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  master: GainNode;

  fbDelay: DelayNode;
  fbGain: GainNode;
  fbWet: GainNode;
  dry: GainNode;
};

export function createChain(ctx: AudioContext): Chain {
  const filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 2000, Q: 1 });
  const lfo = new OscillatorNode(ctx, { type: "sine", frequency: 2 });
  const lfoGain = new GainNode(ctx, { gain: 0 });
  const master = new GainNode(ctx, { gain: 0.25 });

  // --- feedback loop ---
  const fbDelay = new DelayNode(ctx, { maxDelayTime: 2.0, delayTime: 0.24 }); // 240ms default
  const fbGain  = new GainNode(ctx, { gain: 0.6 });   // loop gain (maps from fb.length)
  const fbWet   = new GainNode(ctx, { gain: 0.25 });  // wet mix
  const dry     = new GainNode(ctx, { gain: 1.0 });   // dry mix

  // LFO → cutoff
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start();

  // Voice sum goes into filter (the pool connects voices → filter)
  // Split to dry and feedback paths
  filter.connect(dry);

  // Feedback path: filter → delay → fbGain → (back into delay) and also to wet mix
  filter.connect(fbDelay);
  fbDelay.connect(fbGain);
  fbGain.connect(fbDelay);     // feedback loop
  fbDelay.connect(fbWet);      // wet out

  // Mix to master
  dry.connect(master);
  fbWet.connect(master);

  master.connect(ctx.destination);

  return { filter, lfo, lfoGain, master, fbDelay, fbGain, fbWet, dry };
}

export function disconnectChain(c: Chain) {
  try { c.lfo.stop(); } catch {}
  c.lfo.disconnect(); c.lfoGain.disconnect();
  c.fbDelay.disconnect(); c.fbGain.disconnect(); c.fbWet.disconnect(); c.dry.disconnect();
  c.filter.disconnect(); c.master.disconnect();
}
