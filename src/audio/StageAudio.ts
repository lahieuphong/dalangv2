import type { CueKind } from '../scene/SceneController';
import type { Side } from '../types';

/** Approximate slendro tuning (Hz): five near-equal steps per octave. */
const SLENDRO = [268, 309, 356, 409, 471, 536, 618];
/** Inharmonic partials of a bronze keyed metallophone, as [ratio, gain]. */
const BAR_PARTIALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2.76, 0.22],
  [5.4, 0.06],
];

/**
 * A quiet, generated gamelan-like ambience: a soft drone, the occasional gong,
 * a sparse wandering metallophone line, a wooden knock when a puppet is
 * picked up, and short percussive cues for what happens on stage (paddle,
 * table, a swatted fly). Everything is synthesized, so no audio assets are
 * needed. Only ever started from a user gesture.
 */
export class StageAudio {
  static isSupported() {
    return typeof window !== 'undefined' && 'AudioContext' in window;
  }

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: GainNode | null = null;
  private droneNodes: AudioScheduledSourceNode[] = [];
  private timers: number[] = [];
  private running = false;
  private noteIndex = 2;

  async start() {
    if (this.running) return;
    this.running = true;
    const ctx = this.ensureContext();
    await ctx.resume();
    if (!this.running || !this.master) return;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.55, now + 2.5);
    this.startDrone(ctx);
    this.scheduleNotes(1800);
    this.scheduleGong(900);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.8);
    const drone = this.droneNodes;
    this.droneNodes = [];
    for (const node of drone) node.stop(now + 0.9);
  }

  /** The dalang's cempala knock, panned toward the puppet. */
  knock(side: Side) {
    const ctx = this.ctx;
    if (!this.running || !ctx || !this.master) return;
    const now = ctx.currentTime;
    const pan = new StereoPannerNode(ctx, { pan: side === 'left' ? -0.45 : 0.45 });
    pan.connect(this.master);

    const body = new OscillatorNode(ctx, { type: 'triangle', frequency: 820 });
    body.frequency.setValueAtTime(820, now);
    body.frequency.exponentialRampToValueAtTime(420, now + 0.08);
    const bodyGain = new GainNode(ctx, { gain: 0 });
    bodyGain.gain.setValueAtTime(0, now);
    bodyGain.gain.linearRampToValueAtTime(0.22, now + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    body.connect(bodyGain).connect(pan);
    body.start(now);
    body.stop(now + 0.2);

    const noise = new AudioBufferSourceNode(ctx, { buffer: this.noiseBuffer(ctx, 0.06) });
    const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2100, Q: 3 });
    const noiseGain = new GainNode(ctx, { gain: 0.16 });
    noiseGain.gain.setValueAtTime(0.16, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    noise.connect(band).connect(noiseGain).connect(pan);
    noise.start(now);
  }

  /** A short percussive cue for a stage event, panned to where it happened. */
  cue(kind: CueKind, pan: number, strength: number) {
    const ctx = this.ctx;
    if (!this.running || !ctx || !this.master) return;
    const now = ctx.currentTime;
    const out = new StereoPannerNode(ctx, { pan: Math.max(-0.8, Math.min(0.8, pan * 0.7)) });
    out.connect(this.master);
    const level = 0.08 + 0.2 * Math.max(0, Math.min(1, strength));

    // [start Hz, end Hz, seconds, noise share]
    const voice: Record<CueKind, readonly [number, number, number, number]> = {
      hit: [640, 360, 0.11, 0.35],
      bounce: [980, 720, 0.07, 0.15],
      swat: [300, 140, 0.14, 0.8],
      serve: [520, 660, 0.12, 0.05],
      miss: [170, 90, 0.26, 0.2],
      grab: [1200, 900, 0.05, 0.1],
    };
    const [from, to, seconds, noisy] = voice[kind];

    const tone = new OscillatorNode(ctx, { type: 'triangle', frequency: from });
    tone.frequency.setValueAtTime(from, now);
    tone.frequency.exponentialRampToValueAtTime(to, now + seconds);
    const toneGain = new GainNode(ctx, { gain: 0 });
    toneGain.gain.setValueAtTime(0, now);
    toneGain.gain.linearRampToValueAtTime(level * (1 - noisy), now + 0.003);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    tone.connect(toneGain).connect(out);
    tone.start(now);
    tone.stop(now + seconds + 0.03);

    if (noisy > 0.04) {
      const noise = new AudioBufferSourceNode(ctx, { buffer: this.noiseBuffer(ctx, seconds) });
      const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: from * 2.4, Q: 1.6 });
      const noiseGain = new GainNode(ctx, { gain: level * noisy });
      noiseGain.gain.setValueAtTime(level * noisy, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      noise.connect(band).connect(noiseGain).connect(out);
      noise.start(now);
    }
  }

  dispose() {
    this.stop();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.reverb = null;
    if (ctx) window.setTimeout(() => void ctx.close().catch(() => undefined), 1000);
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    const master = new GainNode(ctx, { gain: 0 });
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -18, ratio: 6, attack: 0.01, release: 0.4 });
    master.connect(limiter).connect(ctx.destination);

    const convolver = new ConvolverNode(ctx, { buffer: this.impulse(ctx, 3.2) });
    const wet = new GainNode(ctx, { gain: 0.42 });
    convolver.connect(wet).connect(master);
    const reverbSend = new GainNode(ctx, { gain: 1 });
    reverbSend.connect(convolver);
    reverbSend.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.reverb = reverbSend;
    return ctx;
  }

  private startDrone(ctx: AudioContext) {
    if (!this.reverb) return;
    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 520, Q: 0.4 });
    const gain = new GainNode(ctx, { gain: 0.035 });
    filter.connect(gain).connect(this.reverb);
    const lfo = new OscillatorNode(ctx, { frequency: 0.07 });
    const lfoDepth = new GainNode(ctx, { gain: 0.012 });
    lfo.connect(lfoDepth).connect(gain.gain);
    lfo.start();
    this.droneNodes.push(lfo);
    for (const [frequency, type] of [
      [67, 'sine'],
      [67.45, 'sine'],
      [134.2, 'triangle'],
    ] as const) {
      const osc = new OscillatorNode(ctx, { type, frequency });
      osc.connect(filter);
      osc.start();
      this.droneNodes.push(osc);
    }
  }

  private scheduleNotes(delay: number) {
    this.timers.push(
      window.setTimeout(() => {
        if (!this.running) return;
        // A gentle random walk through the scale, sometimes resting.
        if (Math.random() > 0.2) {
          this.noteIndex = Math.min(SLENDRO.length - 1, Math.max(0, this.noteIndex + Math.round((Math.random() - 0.5) * 3)));
          this.strike(SLENDRO[this.noteIndex], 0.05 + Math.random() * 0.02, 2.4);
        }
        this.scheduleNotes(1600 + Math.random() * 2600);
      }, delay),
    );
  }

  private scheduleGong(delay: number) {
    this.timers.push(
      window.setTimeout(() => {
        if (!this.running) return;
        this.strike(58, 0.16, 7, 0.9);
        this.scheduleGong(15000 + Math.random() * 7000);
      }, delay),
    );
  }

  private strike(frequency: number, level: number, decay: number, beat = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.reverb) return;
    const now = ctx.currentTime;
    const envelope = new GainNode(ctx, { gain: 0 });
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(level, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    envelope.connect(this.reverb);
    for (const [ratio, gain] of BAR_PARTIALS) {
      const partialGain = new GainNode(ctx, { gain });
      partialGain.connect(envelope);
      // A slightly detuned twin gives the shimmering "ombak" beat of paired gamelan instruments.
      for (const detune of beat ? [0, beat] : [0]) {
        const osc = new OscillatorNode(ctx, { frequency: frequency * ratio + detune });
        osc.connect(partialGain);
        osc.start(now);
        osc.stop(now + decay + 0.1);
      }
    }
  }

  private noiseBuffer(ctx: AudioContext, seconds: number) {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private impulse(ctx: AudioContext, seconds: number) {
    const length = Math.ceil(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
    }
    return buffer;
  }
}
