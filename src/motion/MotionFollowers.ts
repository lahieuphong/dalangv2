import { clamp, lerp } from '../utils/math';
import type { ControlKey } from './PuppetRig';

export interface SpringParams {
  /** Natural frequency in rad/s. Higher = snappier. */
  frequency: number;
  /** 1 = critically damped (no overshoot), below 1 lets the value swing past its target a little. */
  damping: number;
}

/**
 * Advances a damped spring toward `target` and returns the new value. Velocity is
 * kept in `velocity[key]` so callers can read it for secondary motion.
 *
 * This is the exact solution for a target held still over `dt`, so it is
 * stable at any stiffness and frame rate: a very fast spring simply arrives,
 * it never rings or blows up the way a stepped integrator would.
 */
export function stepSpring<K extends string>(
  value: number,
  target: number,
  velocity: Record<K, number>,
  key: K,
  params: SpringParams,
  dt: number,
): number {
  if (dt <= 0) return value;
  const { frequency: w, damping: z } = params;
  const x0 = value - target;
  const v0 = velocity[key];

  if (z >= 1) {
    const decay = Math.exp(-w * dt);
    const c = v0 + w * x0;
    velocity[key] = (v0 - c * w * dt) * decay;
    return target + (x0 + c * dt) * decay;
  }

  const wd = w * Math.sqrt(1 - z * z);
  const decay = Math.exp(-z * w * dt);
  const cos = Math.cos(wd * dt);
  const sin = Math.sin(wd * dt);
  const b = (v0 + z * w * x0) / wd;
  velocity[key] = decay * (v0 * cos - (x0 * wd + z * w * b) * sin);
  return target + decay * (x0 * cos + b * sin);
}

/**
 * Followers between the tracker's rate and the display's. The features are
 * already filtered, so these are not a second smoothing stage: they only
 * carry the pose from one tracking result to the next without visible steps.
 * Primary control is critically damped and very stiff (a time constant of
 * about 10 ms, well under one display frame), so nothing overshoots and
 * nothing chases; only the body and head, which no finger drives directly,
 * are allowed to be a little softer.
 *
 *   fastest  wrist, grip (pinch, thumb)
 *   fast     root position, arm joints
 *   medium   body lean, head
 *   slow     depth and scale
 */
export function followerParams(smoothing: number): Record<ControlKey, SpringParams> {
  const k = lerp(1.35, 0.5, clamp(smoothing, 0, 1));
  const fingers = { frequency: 120 * k, damping: 1 };
  const joint = { frequency: 100 * k, damping: 1 };
  const root = { frequency: 110 * k, damping: 1 };
  const soft = { frequency: 12 * k, damping: 1 };
  return {
    x: root,
    y: root,
    scale: soft,
    depth: soft,
    bodyRotation: { frequency: 70 * k, damping: 0.9 },
    headRotation: { frequency: 36 * k, damping: 0.8 },
    shoulderAngle: joint,
    elbowAngle: joint,
    wristAngle: fingers,
    grip: fingers,
    backShoulderAngle: joint,
    backElbowAngle: joint,
    backWristAngle: joint,
  };
}

/** Builds a zeroed record for a list of keys (velocities, offsets). */
export const zeros = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
