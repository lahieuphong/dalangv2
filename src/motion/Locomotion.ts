import type { PuppetRig } from '../types';
import { approach, clamp, RAD, smoothstep } from '../utils/math';
import { stepSpring, zeros, type SpringParams } from './MotionFollowers';
import { PUPPET } from './PuppetRig';

/** Ground distance covered by one full stride, in artwork units. */
const STRIDE = 150;
/** Root speed (stage units / s) at which the walk is at full swing. */
const WALK_SPEED = 55;
const HIP_SWING = 21;
const KNEE_LIFT = 34;
/** Feet this far off the ground hang freely. */
const AIRBORNE_AT = 22;

const DANGLE: SpringParams = { frequency: 9, damping: 0.45 };
const LANDING: SpringParams = { frequency: 22, damping: 0.42 };
const KEYS = ['front', 'back', 'landing'] as const;

/**
 * Everything below the belt. The legs are never driven by a finger: they walk
 * while the puppet travels along the ground, fold when it is pressed down,
 * and hang and swing when it is lifted, so they follow the root the hand
 * controls without ever holding it back.
 */
export class Locomotion {
  private phase = 0;
  private walk = 0;
  private wasAirborne = false;
  private readonly value = zeros(KEYS);
  private readonly velocity = zeros(KEYS);

  /**
   * @param vx        root speed toward the way the puppet faces, stage units / s
   * @param vy        root speed downward, stage units / s
   * @param lift      height of the soles above the ground, stage units (0 on the ground)
   * @param crouch    how far the root is pressed below the ground line, stage units
   * @returns extra sink of the root from the landing squash, stage units
   */
  update(rig: PuppetRig, vx: number, vy: number, lift: number, crouch: number, dt: number): number {
    const air = smoothstep(lift / AIRBORNE_AT);
    const airborne = lift > 3;

    // Walk: the stride advances with ground travel, so the feet never skate ahead of the body.
    const grounded = 1 - air;
    this.phase += ((vx * dt) / (STRIDE * rig.scale)) * 2 * Math.PI * grounded;
    const pace = clamp(Math.abs(vx) / WALK_SPEED, 0, 1) * grounded;
    this.walk += (pace - this.walk) * approach(pace > this.walk ? 14 : 5, dt);

    // Touching down after a drop squashes the knees for a moment.
    if (this.wasAirborne && !airborne && vy > 40) this.velocity.landing += clamp(vy * 0.35, 0, 140);
    this.wasAirborne = airborne;
    const squash = Math.max(0, stepSpring(this.value.landing, 0, this.velocity, 'landing', LANDING, dt));
    this.value.landing = squash;

    // In the air the legs trail the motion like pendulums.
    const trail = clamp(-vx * 0.09, -26, 26);
    const drop = clamp(vy * 0.03, -10, 12);
    this.value.front = stepSpring(this.value.front, (trail + 8 - drop) * air, this.velocity, 'front', DANGLE, dt);
    this.value.back = stepSpring(this.value.back, (trail - 10 + drop) * air, this.velocity, 'back', DANGLE, dt);

    const fold = (crouch + squash) / rig.scale;
    this.solveLeg(rig, 'hipAngle', 'kneeAngle', 'footAngle', this.phase, this.value.front, fold, air);
    this.solveLeg(rig, 'backHipAngle', 'backKneeAngle', 'backFootAngle', this.phase + Math.PI, this.value.back, fold, air);
    return squash;
  }

  private solveLeg(
    rig: PuppetRig,
    hipKey: 'hipAngle' | 'backHipAngle',
    kneeKey: 'kneeAngle' | 'backKneeAngle',
    footKey: 'footAngle' | 'backFootAngle',
    phase: number,
    dangle: number,
    fold: number,
    air: number,
  ) {
    // Crouch: fold hip and knee so the sole stays on the ground while the body sinks by `fold`.
    const { thigh, shin } = PUPPET;
    const reach = clamp(thigh + shin - fold, Math.abs(thigh - shin) + 6, thigh + shin);
    const alpha = Math.acos(clamp((thigh * thigh + reach * reach - shin * shin) / (2 * thigh * reach), -1, 1)) / RAD;
    const gamma = Math.acos(clamp((shin * shin + reach * reach - thigh * thigh) / (2 * shin * reach), -1, 1)) / RAD;

    const swing = Math.sin(phase) * HIP_SWING * this.walk;
    // The knee lifts while the leg swings forward, in whichever direction the puppet walks.
    const lift = Math.max(0, Math.cos(phase)) * KNEE_LIFT * this.walk;
    const hip = alpha + swing + dangle;
    const knee = alpha + gamma + lift + (10 + Math.abs(dangle) * 0.5) * air;
    rig[hipKey] = hip;
    rig[kneeKey] = knee;
    // On the ground the sole stays level; in the air the foot hangs with the shin.
    rig[footKey] = (hip - knee) * (1 - air) + 14 * air;
  }
}
