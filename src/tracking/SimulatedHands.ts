import type { HandDetection, HandFrame, Point, Side } from '../types';
import { clamp, mulberry32, smoothstep } from '../utils/math';

/**
 * `?simulate=1`: synthesizes 21 image and world landmarks for one or two
 * hands, so the whole pipeline from hand assignment onward (features,
 * filtering, gestures, mapping, followers, rendering) runs exactly as it does
 * with a camera, only without MediaPipe in front of it. Scripts cover the
 * acceptance tests: every finger on its own, the pinch, fast movement, a
 * still hand, tracking loss, two hands and crossing hands.
 */

/** Left hand seen palm-on in a mirrored preview; wrist at the origin, unit = palm length. */
const TEMPLATE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.28, -0.16], [0.48, -0.36], [0.62, -0.56], [0.74, -0.72],
  [0.3, -0.95], [0.34, -1.35], [0.36, -1.6], [0.38, -1.82],
  [0.05, -1.0], [0.05, -1.45], [0.05, -1.72], [0.05, -1.95],
  [-0.18, -0.95], [-0.22, -1.35], [-0.24, -1.58], [-0.26, -1.78],
  [-0.38, -0.85], [-0.45, -1.15], [-0.48, -1.33], [-0.5, -1.5],
];
const FINGER_CHAINS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
] as const;

export const SIM_ASPECT = 16 / 9;
const METERS_PER_UNIT = 0.085;

export interface HandPose {
  x: number;
  y: number;
  tilt: number;
  size: number;
  /** Extension per finger: thumb, index, middle, ring, pinky. */
  extension: readonly number[];
  /** 0..1: draws the thumb tip onto the index tip. */
  pinch: number;
}

/** Builds 21 image + world landmarks for a parametric hand (also used by tests). */
export function synthesizeHand(pose: HandPose, side: Side, aspect = SIM_ASPECT): HandDetection {
  const flip = side === 'left' ? 1 : -1;
  const local: Point[] = TEMPLATE.map(([x, y]) => ({ x: x * flip, y, z: 0 }));

  // Curl each finger toward the camera, joint by joint.
  FINGER_CHAINS.forEach((chain, finger) => {
    // Bend at every joint, up to ~92° for fingers (a full fist) and ~63° for the thumb.
    const joint = (1 - pose.extension[finger]) * (finger === 0 ? 1.1 : 1.6);
    let previous = local[chain[0]];
    for (let k = 1; k < chain.length; k++) {
      const [tx, ty] = TEMPLATE[chain[k]];
      const [px, py] = TEMPLATE[chain[k - 1]];
      const length = Math.hypot(tx - px, ty - py);
      const dirX = ((tx - px) / length) * flip;
      const dirY = (ty - py) / length;
      const a = joint * k;
      const point = {
        x: previous.x + dirX * length * Math.cos(a),
        y: previous.y + dirY * length * Math.cos(a),
        z: (previous.z ?? 0) - length * Math.sin(a),
      };
      local[chain[k]] = point;
      previous = point;
    }
  });

  // Pinch: the thumb and the index meet half-way, out in front of the palm.
  if (pose.pinch > 0) {
    const k = pose.pinch;
    const meet = { x: (local[4].x + local[8].x) / 2 + 0.06 * flip, y: (local[4].y + local[8].y) / 2 + 0.1, z: -0.34 };
    const toward = (from: Point, to: Point, amount: number): Point => ({
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
      z: (from.z ?? 0) + ((to.z ?? 0) - (from.z ?? 0)) * amount,
    });
    const thumbTip = toward(local[4], { x: meet.x + 0.035 * flip, y: meet.y + 0.03, z: meet.z }, k);
    const indexTip = toward(local[8], { x: meet.x - 0.035 * flip, y: meet.y - 0.03, z: meet.z }, k);
    local[3] = toward(local[3], { x: (local[2].x + thumbTip.x) / 2, y: (local[2].y + thumbTip.y) / 2, z: meet.z * 0.5 }, k);
    local[4] = thumbTip;
    local[7] = toward(local[7], { x: (local[6].x + indexTip.x) / 2, y: (local[6].y + indexTip.y) / 2 - 0.06, z: meet.z * 0.7 }, k);
    local[6] = toward(local[6], { x: local[6].x, y: local[6].y + 0.06, z: meet.z * 0.4 }, k);
    local[8] = indexTip;
  }

  const t = (pose.tilt * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const rotated = local.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos, z: p.z ?? 0 }));
  const palmIds = [0, 5, 9, 13, 17];
  const cx = palmIds.reduce((sum, i) => sum + rotated[i].x, 0) / palmIds.length;
  const cy = palmIds.reduce((sum, i) => sum + rotated[i].y, 0) / palmIds.length;

  return {
    landmarks: rotated.map((p) => ({
      x: pose.x + ((p.x - cx) * pose.size) / aspect,
      y: pose.y + (p.y - cy) * pose.size,
      z: p.z * pose.size,
    })),
    worldLandmarks: rotated.map((p) => ({
      x: (p.x - cx) * METERS_PER_UNIT,
      y: (p.y - cy) * METERS_PER_UNIT,
      z: p.z * METERS_PER_UNIT,
    })),
    handedness: side,
    naturalSide: side,
    handednessScore: 0.96,
  };
}

/* ------------------------------------------------------------------ scripts */

export const SIM_SCRIPTS = [
  'show',
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
  'pinch',
  'lift',
  'fast',
  'still',
  'loss',
  'two',
  'cross',
] as const;

export type SimScript = (typeof SIM_SCRIPTS)[number];

export const isSimScript = (value: string | null): value is SimScript => SIM_SCRIPTS.includes(value as SimScript);

type Poses = Partial<Record<Side, HandPose>>;

const HOME_X: Record<Side, number> = { left: 0.3, right: 0.7 };
const OPEN = [0.96, 0.96, 0.96, 0.96, 0.96] as const;

const rest = (side: Side): HandPose => ({ x: HOME_X[side], y: 0.62, tilt: side === 'left' ? 4 : -4, size: 0.17, extension: OPEN, pinch: 0 });

const wave = (t: number, speed: number, phase = 0) => Math.sin(t * speed + phase);

/** 0 → 1 → 0 over one period, easing at both ends: one full curl and release. */
const pulse = (t: number, period: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);

/** Bends exactly one finger of the left hand while the other four stay put. */
function singleFinger(finger: number, t: number): Poses {
  const pose = rest('left');
  const extension: number[] = [...OPEN];
  extension[finger] = 0.96 - 0.94 * pulse(t, 2.6);
  return { left: { ...pose, extension } };
}

/** Both hands wandering, every finger on its own rhythm, the thumb pinching now and then. */
function freePlay(side: Side, t: number): HandPose {
  const p = side === 'left' ? 0 : 1.7;
  const finger = (speed: number, phase: number) => 0.55 + 0.45 * wave(t, speed, p + phase);
  return {
    x: HOME_X[side] + 0.07 * wave(t, 0.55, p) + (side === 'left' ? 0.04 : -0.04) * Math.max(0, wave(t, 0.3, 2)),
    y: 0.56 + 0.14 * wave(t, 0.83, p + 0.5),
    tilt: 14 * wave(t, 0.7, p),
    size: 0.17 + 0.03 * wave(t, 0.4, p),
    extension: [finger(0.9, 0.5), finger(1.1, 0), finger(1.3, 1), finger(0.95, 2), finger(1.5, 3)],
    pinch: Math.max(0, wave(t, 0.6, p + 2)) ** 2,
  };
}

const SCRIPTS: Record<Exclude<SimScript, 'show'>, (t: number) => Poses> = {
  thumb: (t) => singleFinger(0, t),
  index: (t) => singleFinger(1, t),
  middle: (t) => singleFinger(2, t),
  ring: (t) => singleFinger(3, t),
  pinky: (t) => singleFinger(4, t),
  pinch: (t) => ({ left: { ...rest('left'), pinch: pulse(t, 3) } }),
  lift: (t) => ({ left: { ...rest('left'), y: 0.62 - 0.32 * pulse(t, 3.2) } }),
  fast: (t) => ({
    left: { ...rest('left'), x: 0.3 + 0.15 * wave(t, 8.5), y: 0.52 + 0.16 * wave(t, 6.1, 1), tilt: 16 * wave(t, 8.5, 0.6) },
  }),
  still: () => ({ left: rest('left'), right: rest('right') }),
  loss: (t) => (t % 4.4 < 3 ? { left: rest('left'), right: freePlay('right', t) } : { right: freePlay('right', t) }),
  two: (t) => ({ left: freePlay('left', t), right: freePlay('right', t) }),
  cross: (t) => {
    // The hands slide past each other and back; each must keep its own puppet throughout.
    const k = smoothstep(pulse(t, 6));
    return {
      left: { ...rest('left'), x: 0.3 + 0.36 * k, y: 0.54 },
      right: { ...rest('right'), x: 0.7 - 0.36 * k, y: 0.66 },
    };
  },
};

/** The demo reel: each acceptance scenario in turn, then free play. */
const SHOW: readonly (readonly [script: Exclude<SimScript, 'show'>, seconds: number])[] = [
  ['still', 2.4],
  ['thumb', 2.6],
  ['index', 2.6],
  ['middle', 2.6],
  ['ring', 2.6],
  ['pinky', 2.6],
  ['pinch', 3],
  ['lift', 3.2],
  ['fast', 3],
  ['loss', 4.4],
  ['two', 16],
];
const SHOW_LENGTH = SHOW.reduce((sum, [, seconds]) => sum + seconds, 0);

export interface SimulatorOptions {
  script: SimScript;
  /** Landmark noise, one standard deviation in frame units. 0.0012 is a decent webcam in good light. */
  noise: number;
  /** Synthetic tracker rate. */
  fps: number;
}

export const DEFAULT_SIM_OPTIONS: SimulatorOptions = { script: 'show', noise: 0.0012, fps: 30 };

export class HandSimulator {
  /** Name of the scenario being played right now. */
  segment: string;
  /** Synthetic tracker rate, results per second. */
  readonly fps: number;

  private readonly options: SimulatorOptions;
  private readonly random = mulberry32(20261008);
  private lastFrameAt = -Infinity;
  private startedAt: number | null = null;

  constructor(options: Partial<SimulatorOptions> = {}) {
    this.options = { ...DEFAULT_SIM_OPTIONS, ...options };
    this.segment = this.options.script;
    this.fps = this.options.fps;
  }

  /** Returns a new frame when one is due, exactly like a tracker result; null otherwise. */
  next(now: number): HandFrame | null {
    if (now - this.lastFrameAt < 1000 / this.options.fps - 0.5) return null;
    this.lastFrameAt = now;
    this.startedAt ??= now;
    const poses = this.poses((now - this.startedAt) / 1000);
    const hands: HandDetection[] = [];
    for (const side of ['left', 'right'] as const) {
      const pose = poses[side];
      if (pose) hands.push(this.jitter(synthesizeHand(pose, side)));
    }
    return { hands, aspect: SIM_ASPECT, time: now, received: now };
  }

  private poses(t: number): Poses {
    const { script } = this.options;
    if (script !== 'show') return SCRIPTS[script](t);
    let local = t % SHOW_LENGTH;
    for (const [name, seconds] of SHOW) {
      if (local < seconds) {
        this.segment = name;
        return SCRIPTS[name](local);
      }
      local -= seconds;
    }
    return SCRIPTS.two(t);
  }

  /** Adds tracker-like noise to every landmark, so filtering and stillness can be judged honestly. */
  private jitter(hand: HandDetection): HandDetection {
    const sigma = this.options.noise;
    if (sigma <= 0) return hand;
    const world = (sigma / 0.17) * METERS_PER_UNIT;
    for (const p of hand.landmarks) {
      p.x = clamp(p.x + this.gaussian() * sigma, -0.2, 1.2);
      p.y = clamp(p.y + this.gaussian() * sigma, -0.2, 1.2);
    }
    for (const p of hand.worldLandmarks ?? []) {
      p.x += this.gaussian() * world;
      p.y += this.gaussian() * world;
      p.z = (p.z ?? 0) + this.gaussian() * world;
    }
    return hand;
  }

  private gaussian() {
    const u = Math.max(1e-9, this.random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.random());
  }
}
