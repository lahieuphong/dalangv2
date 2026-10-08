import type { Point } from '../types';

export const RAD = Math.PI / 180;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Maps value from [sourceMin, sourceMax] to [0, 1], clamped. */
export const normalize = (value: number, sourceMin: number, sourceMax: number) =>
  clamp((value - sourceMin) / (sourceMax - sourceMin), 0, 1);

export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/**
 * Monotonic 0..1 → 0..1 curve whose slope at 0 is `gain`: above 1 it
 * amplifies small inputs. It always ends exactly at 1 and never goes flat, so
 * extra gain costs no travel at the far end.
 */
export const boost = (t: number, gain: number) => {
  const x = clamp(t, 0, 1);
  return (x * gain) / (1 + (gain - 1) * x);
};

const RESPONSE = 1.8;

/**
 * Response curve for 0..1 control signals: small inputs are amplified
 * (0.1 → 0.17, 0.2 → 0.31, 0.5 → 0.64 at gain 1) while 0 and 1 stay where
 * they are, so a slight movement of a finger is already visible on the
 * puppet. `gain` scales the low end further.
 */
export const respond = (t: number, gain = 1) => boost(t, RESPONSE * gain);

/**
 * Clamps to [min, max], but eases into each limit over the last `knee` units
 * instead of stopping dead, so there is always a little travel left.
 */
export function softClamp(value: number, min: number, max: number, knee: number) {
  if (value > max - knee) return max - knee + knee * Math.tanh((value - (max - knee)) / knee);
  if (value < min + knee) return min + knee - knee * Math.tanh((min + knee - value) / knee);
  return value;
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

export const distance2D = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Direction of a→b in degrees measured from straight up, positive leaning toward +x.
 * `aspect` corrects normalized image coordinates for non-square frames.
 */
export const angleFromVertical = (a: Point, b: Point, aspect = 1) =>
  (Math.atan2((b.x - a.x) * aspect, -(b.y - a.y)) * 180) / Math.PI;

export const wrapDegrees = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Frame-rate independent blend factor for "approach the target at `rate` per second". */
export const approach = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Running average that starts at the first sample instead of at zero. */
export const average = (current: number, value: number, weight = 0.1) => (current ? current + (value - current) * weight : value);

/** Small deterministic generator, so procedural artwork looks the same on every paint. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
