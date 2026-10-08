import { FINGER_NAMES, type FingerName, type HandFeatures } from '../types';
import { clamp, lerp } from '../utils/math';
import { copyFeatures, deriveFeatures, emptyFeatures } from './HandFeatures';
import { OneEuroFilter } from './OneEuroFilter';

/**
 * Per-channel filtering for one hand's features. This is the only place the
 * tracker's signal is smoothed; what follows it only upsamples to the display.
 *
 * Every channel has its own noise-aware One Euro filter, tuned to how that
 * signal behaves and how much the puppeteer cares about it:
 *
 *   fastest  pinch, finger curl      the puppeteer's fingers
 *   fast     palm position, roll     where the puppet stands and leans
 *   calm     pitch / yaw, depth      noisy and only decorative
 *
 * Each filter holds steady inside its channel's measured noise and lets go
 * as soon as a change is larger than that, so a deliberate movement shows on
 * the very frame it is seen while a resting hand does not shimmer. Nothing
 * here has a dead zone: changes smaller than the noise still get through,
 * just over a few frames instead of one.
 */

interface ChannelSpec {
  /** One Euro minimum cutoff (Hz) at smoothing scale 1: how firmly the channel is held while at rest. */
  minCutoff: number;
  /** One Euro speed coefficient, in the channel's units per second. */
  beta: number;
  /** Frame-to-frame noise (one standard deviation) of this channel with a decent camera. */
  noise: number;
  /** Largest believable change between two consecutive tracker frames. */
  jump: number;
}

const ROOT: ChannelSpec = { minCutoff: 2.5, beta: 40, noise: 0.0012, jump: 0.18 };
const ARTICULATION: ChannelSpec = { minCutoff: 1.5, beta: 6, noise: 0.015, jump: 0.6 };
const PINCH: ChannelSpec = { minCutoff: 2.5, beta: 8, noise: 0.02, jump: 0.7 };
const ORIENTATION: ChannelSpec = { minCutoff: 2.5, beta: 0.12, noise: 0.7, jump: 40 };
const DIRECTION: ChannelSpec = { minCutoff: 2.5, beta: 0.08, noise: 2, jump: 50 };
const SPREAD: ChannelSpec = { minCutoff: 1.5, beta: 2, noise: 0.07, jump: 0.7 };
const TILT: ChannelSpec = { minCutoff: 1.5, beta: 0.04, noise: 4, jump: 35 };
const DEPTH: ChannelSpec = { minCutoff: 1, beta: 2, noise: 0.003, jump: 0.06 };

/** How quickly the filters learn that the signal has started moving (Hz). */
const DERIVATIVE_CUTOFF = 3;

type FingerField = 'curl' | 'direction';
type ScalarKey =
  | 'palmX'
  | 'palmY'
  | 'roll'
  | 'pitch'
  | 'yaw'
  | 'size'
  | 'thumbSpread'
  | 'thumbOpposition'
  | 'pinchDistance'
  | 'spreadIndexMiddle'
  | 'spreadMiddleRing'
  | 'spreadRingPinky';

interface Channel {
  spec: ChannelSpec;
  /** Set for per-finger channels: the finger whose visibility gates the update. */
  finger: FingerName | null;
  get(f: HandFeatures): number;
  set(f: HandFeatures, value: number): void;
}

const scalar = (key: ScalarKey, spec: ChannelSpec): Channel => ({
  spec,
  finger: null,
  get: (f) => f[key],
  set: (f, v) => void (f[key] = v),
});

const perFinger = (finger: FingerName, field: FingerField, spec: ChannelSpec): Channel => ({
  spec,
  finger,
  get: (f) => f[finger][field],
  set: (f, v) => void (f[finger][field] = v),
});

/** Built once, so the per-frame loop never parses keys or allocates. */
const CHANNELS: readonly Channel[] = [
  scalar('palmX', ROOT),
  scalar('palmY', ROOT),
  scalar('roll', ORIENTATION),
  scalar('pitch', TILT),
  scalar('yaw', TILT),
  scalar('size', DEPTH),
  scalar('thumbSpread', SPREAD),
  scalar('thumbOpposition', SPREAD),
  scalar('pinchDistance', PINCH),
  scalar('spreadIndexMiddle', SPREAD),
  scalar('spreadMiddleRing', SPREAD),
  scalar('spreadRingPinky', SPREAD),
  ...FINGER_NAMES.flatMap((finger) => [perFinger(finger, 'curl', ARTICULATION), perFinger(finger, 'direction', DIRECTION)]),
];

/** Share of an implausibly large single-frame jump that is let through before it is confirmed. */
const UNCONFIRMED_PASS = 0.5;

/**
 * Tames single-frame tracker glitches without costing a frame of latency: an
 * implausibly large jump is followed half-way at once, and fully as soon as
 * the next frame keeps going the same way. A real fast gesture therefore
 * starts on the frame it is seen; a one-frame glitch is halved.
 */
export class SpikeGuard {
  private last: number | null = null;
  private pending = 0;

  reset() {
    this.last = null;
    this.pending = 0;
  }

  apply(value: number, jump: number): number {
    const last = this.last;
    if (last === null || Math.abs(value - last) <= jump) {
      this.pending = 0;
      this.last = value;
      return value;
    }
    const direction = Math.sign(value - last);
    if (this.pending === direction) {
      this.pending = 0;
      this.last = value;
      return value;
    }
    this.pending = direction;
    return last + (value - last) * UNCONFIRMED_PASS;
  }
}

export class HandFeatureFilter {
  /** The latest filtered features (reused object). */
  readonly value: HandFeatures = emptyFeatures();
  /** The unfiltered features of the same frame, kept for raw-versus-filtered comparison. */
  readonly raw: HandFeatures = emptyFeatures();

  private readonly filters = CHANNELS.map(({ spec }) => new OneEuroFilter(spec.minCutoff, spec.beta, DERIVATIVE_CUTOFF));
  private readonly guards = CHANNELS.map(() => new SpikeGuard());

  reset() {
    for (const filter of this.filters) filter.reset();
    for (const guard of this.guards) guard.reset();
  }

  /**
   * `time` is the capture time in seconds. `smoothing` (0..1) trades
   * responsiveness for stability: it lowers every channel's resting cutoff
   * and makes the filters more cautious about what counts as noise. It never
   * changes how far the puppet moves (that is sensitivity), and even at its
   * maximum a real movement still snaps through.
   */
  filter(raw: HandFeatures, time: number, smoothing: number): HandFeatures {
    const s = clamp(smoothing, 0, 1);
    const cutoffScale = lerp(1.6, 0.55, s);
    const caution = lerp(0.75, 1.6, s);
    copyFeatures(raw, this.raw);
    const out = this.value;
    for (let i = 0; i < CHANNELS.length; i++) {
      const channel = CHANNELS[i];
      const filter = this.filters[i];
      // A finger outside the camera frame is only guessed by the model: hold its last trusted value.
      if (channel.finger && !raw[channel.finger].inFrame && filter.current !== null) continue;
      const { spec } = channel;
      filter.minCutoff = spec.minCutoff * cutoffScale;
      filter.noise = spec.noise;
      filter.caution = caution;
      channel.set(out, filter.filter(this.guards[i].apply(channel.get(raw), spec.jump), time));
    }
    for (const finger of FINGER_NAMES) out[finger].inFrame = raw[finger].inFrame;
    // Derived signals come from the filtered channels, so they need no filter of their own.
    return deriveFeatures(out);
  }
}
