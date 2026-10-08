import type { StageLayout } from '../scene/StageProps';
import { applyCalibration, type CalibrationStore } from '../tracking/Calibration';
import { copyFeatures, deriveFeatures, emptyFeatures, extractHandFeatures } from '../tracking/HandFeatures';
import { HandFeatureFilter } from '../tracking/TrackingFilters';
import { FINGER_NAMES, type FingerMap, type FingerName, type HandDetection, type HandFeatures, type PuppetRig, type Side } from '../types';
import { approach, clamp, smoothstep } from '../utils/math';
import { Locomotion } from './Locomotion';
import { followerParams, stepSpring, zeros, type SpringParams } from './MotionFollowers';
import { articulateFromHand, idleRig, palmMapping, stagePosition, type ControlGains, type MappingContext } from './PuppetMapping';
import { blendRig, CONTROL_KEYS, copyRig, emptyRig, facing, type ControlKey } from './PuppetRig';

/**
 * Pickup: the hand's pose takes over exponentially at this rate (1/s), so
 * the very first frame with a hand already carries the puppet about 40 % of
 * the way and it is fully in hand after ~100 ms. Letting go is slow and soft.
 */
const ATTACK_RATE = 32;
const RELEASE_RATE = 1.5;

/**
 * Palm prediction hides part of the camera + inference latency by carrying
 * the filtered palm forward along its velocity: a small lead on arrival, then
 * on until the next result is due. It is short, clamped, palm-only, and
 * switched off just after pickup or when the hand reverses.
 */
const PREDICT_LEAD_MS = 8;
const PREDICT_MAX_MS = 25;
const PREDICT_WARMUP_MS = 120;
const PREDICT_MAX_SHIFT = 0.03;

/**
 * Everything above is tuned for a tracker that delivers 30 results a second
 * or more. A webcam in dim light may deliver 15: then results are 67 ms
 * apart, and followers that settle in 30 ms would move, stop, and move again.
 * Below 30 Hz the palm is therefore carried forward for longer between
 * results, and the followers are eased just enough to spread a step over the
 * gap. At 30 Hz and above nothing changes.
 */
const NOMINAL_INTERVAL_MS = 1000 / 30;
const PREDICT_LIMIT_MS = 55;

/**
 * Secondary physics: a little follow-through added on top of the controlled
 * pose while the puppet travels. Kept small and well damped: it must read as
 * weight, never as lag, and it never feeds back into what the hand controls.
 */
const SECONDARY: SpringParams = { frequency: 16, damping: 0.7 };
const CLOTH: SpringParams = { frequency: 9, damping: 0.4 };
const SECONDARY_KEYS = ['trail', 'fling', 'lean', 'nod', 'cloth', 'fan', 'blade'] as const;

/** Everything the controller needs from the outside world; rebuilt only when a setting or the layout changes. */
export interface ControlEnvironment {
  layout: StageLayout;
  gains: ControlGains;
  fingerMap: FingerMap;
  /** 0..1 */
  smoothing: number;
  invertY: boolean;
  /** Keep the last tracked pose this long after a hand drops out, so brief misses never flicker. */
  holdMs: number;
  calibration: CalibrationStore;
}

/**
 * Owns one puppet's motion. Each hand gets its own controller, so its
 * filters, velocity and followers are fully independent of the other hand.
 *
 *   landmarks → features (calibrated, then filtered once per channel) → target pose
 *     → stiff followers (display rate) → + legs and slight follow-through → rendered rig
 */
export class PuppetController {
  readonly side: Side;
  /** The rendered pose: controlled pose plus legs and secondary physics. */
  readonly rig: PuppetRig;
  /** This frame's pose target (what the followers chase). */
  readonly target = emptyRig();
  /** Latest filtered features; null until a hand has been seen. */
  features: HandFeatures | null = null;
  /** The unfiltered, uncalibrated features of the same frame. */
  readonly measured = emptyFeatures();
  /** Filtered palm velocity, normalized view units per second. */
  readonly palmVelocity = { x: 0, y: 0 };
  /** How much each finger is moving right now, 0..1 (drives the overlay highlight). */
  readonly fingerActivity: Record<FingerName, number> = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
  /** How far the rendered root trails its target: stage units, and the same expressed as time. */
  readonly follow = { distance: 0, lagMs: 0 };
  /** Speed of the rendered root, stage units per second. */
  readonly rootVelocity = { x: 0, y: 0 };
  /** Height of the soles above the ground, stage units. */
  lift = 0;
  /** True while something other than a hand (the stage agent) is driving the puppet. */
  agentDriven = false;

  private readonly control: PuppetRig;
  private readonly idle = emptyRig();
  private readonly tracked = emptyRig();
  private readonly agentPose = emptyRig();
  private readonly scratch = emptyFeatures();
  private readonly position = { x: 0, y: 0 };
  private readonly palm = { x: 0.5, y: 0.5, t: 0, seenAt: 0 };
  private readonly lastCurl: Record<FingerName, number> = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
  private readonly controlVelocity = zeros(CONTROL_KEYS);
  private readonly secondary = zeros(SECONDARY_KEYS);
  private readonly secondaryVelocity = zeros(SECONDARY_KEYS);
  private readonly drive = zeros(SECONDARY_KEYS);
  private readonly filter = new HandFeatureFilter();
  private readonly legs = new Locomotion();
  private readonly mapping: MappingContext;
  private hasHand = false;
  private lastSeen = -Infinity;
  private acquiredAt = -Infinity;
  private engagement = 0;
  private agentEngagement = 0;
  private holding = false;
  private reversing = false;
  private holdMs = 300;
  private springSmoothing = -1;
  private springRate = 1;
  private springs: Record<ControlKey, SpringParams> = followerParams(0.3);
  /** Time between tracking results, smoothed, ms. */
  private resultIntervalMs = NOMINAL_INTERVAL_MS;

  constructor(side: Side, env: ControlEnvironment) {
    this.side = side;
    this.mapping = { side, layout: env.layout, gains: env.gains, fingerMap: env.fingerMap, palm: palmMapping(side, null), invertY: env.invertY };
    this.rig = idleRig(side, 0, 1, env.layout);
    this.control = copyRig(this.rig, emptyRig());
    copyRig(this.rig, this.target);
    this.configure(env);
  }

  /** Applies settings and layout. Cheap; call whenever either changes. */
  configure(env: ControlEnvironment) {
    const m = this.mapping;
    m.layout = env.layout;
    m.gains = env.gains;
    m.fingerMap = env.fingerMap;
    m.invertY = env.invertY;
    m.palm = palmMapping(this.side, env.calibration[this.side]?.palm);
    this.holdMs = env.holdMs;
    if (env.smoothing !== this.springSmoothing) {
      this.springSmoothing = env.smoothing;
      this.rebuildFollowers();
    }
  }

  /** Followers for the current smoothing setting, eased for the measured tracking rate. */
  private rebuildFollowers() {
    const base = followerParams(this.springSmoothing < 0 ? 0.3 : this.springSmoothing);
    for (const key of CONTROL_KEYS) base[key] = { frequency: base[key].frequency * this.springRate, damping: base[key].damping };
    this.springs = base;
  }

  /** True while a hand is on the puppet, including the short hold after it drops out. */
  isTracking(now: number) {
    return this.hasHand && now - this.lastSeen < this.holdMs;
  }

  /** Milliseconds since the hand was last seen; Infinity if it never was. */
  sinceSeen(now: number) {
    return this.hasHand ? now - this.lastSeen : Infinity;
  }

  /** True from the moment tracking is lost until the puppet has settled back to rest. */
  isRecovering(now: number) {
    return this.hasHand && !this.isTracking(now) && this.engagement > 0.02;
  }

  /** 0 at rest, 1 when fully held (by a hand or by the agent). */
  get presence() {
    return Math.max(smoothstep(this.engagement), smoothstep(this.agentEngagement));
  }

  /** 0..1: how much of the pose currently comes from a human hand. */
  get handPresence() {
    return smoothstep(this.engagement);
  }

  /** Where the palm is believed to be right now, in view coordinates (for the camera overlay). */
  get palmPosition(): Readonly<{ x: number; y: number }> {
    return this.palm;
  }

  /**
   * Feeds a newly assigned hand. Every valid result updates the target at
   * once, with no debouncing; `captureTime` (ms) is when the camera took the
   * frame. Returns true when this picks the puppet up from rest.
   */
  observe(hand: HandDetection | null, aspect: number, now: number, env: ControlEnvironment, captureTime: number): boolean {
    if (!hand) return false;
    const fresh = !this.isTracking(now);
    if (fresh) {
      this.filter.reset();
      this.acquiredAt = now;
      this.palmVelocity.x = 0;
      this.palmVelocity.y = 0;
      this.reversing = false;
    }

    // Raw sensor data → normalized features → calibration → one filter per channel.
    const measured = extractHandFeatures(hand, aspect, this.measured);
    const calibrated = this.scratch;
    copyFeatures(measured, calibrated);
    applyCalibration(calibrated, env.calibration[this.side]);
    deriveFeatures(calibrated);
    const features = this.filter.filter(calibrated, captureTime / 1000, env.smoothing);

    const dt = fresh ? 0 : (captureTime - this.palm.t) / 1000;
    if (dt > 0.004 && dt < 0.25) {
      this.resultIntervalMs += (dt * 1000 - this.resultIntervalMs) * 0.2;
      const rate = Math.round(clamp(Math.sqrt(NOMINAL_INTERVAL_MS / this.resultIntervalMs), 0.7, 1) * 20) / 20;
      if (rate !== this.springRate) {
        this.springRate = rate;
        this.rebuildFollowers();
      }
    }
    if (dt > 0.004) {
      const vx = (features.palmX - this.palm.x) / dt;
      const vy = (features.palmY - this.palm.y) / dt;
      this.reversing = vx * this.palmVelocity.x + vy * this.palmVelocity.y < 0;
      this.palmVelocity.x += (vx - this.palmVelocity.x) * 0.5;
      this.palmVelocity.y += (vy - this.palmVelocity.y) * 0.5;
      // Finger activity: how fast each curl is changing, with a short memory.
      const fade = Math.exp(-dt / 0.22);
      for (const finger of FINGER_NAMES) {
        const speed = Math.abs(features[finger].curl - this.lastCurl[finger]) / dt;
        this.fingerActivity[finger] = Math.max(this.fingerActivity[finger] * fade, clamp(speed / 1.2, 0, 1));
      }
    }
    for (const finger of FINGER_NAMES) this.lastCurl[finger] = features[finger].curl;
    this.palm.x = features.palmX;
    this.palm.y = features.palmY;
    this.palm.t = captureTime;
    this.palm.seenAt = now;

    this.features = features;
    articulateFromHand(features, this.mapping, this.tracked);
    this.lastSeen = now;
    this.hasHand = true;

    const pickedUp = !this.holding;
    // Coming back while the puppet was still settling: carry on from where the release had got to.
    if (pickedUp) this.engagement = smoothstep(this.engagement);
    this.holding = true;
    return pickedUp;
  }

  /** The calibrated but unfiltered features of the latest frame ("raw" in the debug view). */
  get rawFeatures(): HandFeatures {
    return this.filter.raw;
  }

  /**
   * First half of a frame: this frame's target pose. `agentRig` is what the
   * stage agent would like this puppet to do; a human hand always wins.
   */
  prepareTarget(now: number, dt: number, idleAmplitude: number, agentRig: PuppetRig | null): PuppetRig {
    const tracking = this.isTracking(now);
    if (tracking) {
      this.engagement += (1 - this.engagement) * approach(ATTACK_RATE, dt);
    } else {
      this.holding = false;
      this.engagement = Math.max(0, this.engagement - RELEASE_RATE * dt);
      const decay = Math.exp(-dt / 0.22);
      for (const finger of FINGER_NAMES) this.fingerActivity[finger] *= decay;
    }
    const agent = agentRig !== null && !tracking && this.engagement <= 0;
    this.agentDriven = agent;
    this.agentEngagement = clamp(this.agentEngagement + (agent ? 2.2 : -3) * dt, 0, 1);

    idleRig(this.side, now / 1000, idleAmplitude, this.mapping.layout, this.idle);
    const target = this.target;
    if (this.hasHand && this.engagement > 0) {
      // The palm is carried along its velocity until the next result is due: 25 ms at 30 Hz, longer when results are sparse.
      const reach = clamp(this.resultIntervalMs * 0.75, PREDICT_MAX_MS, PREDICT_LIMIT_MS);
      const shift = PREDICT_MAX_SHIFT * (reach / PREDICT_MAX_MS);
      let horizon = clamp(now - this.palm.seenAt + PREDICT_LEAD_MS, 0, reach) / 1000;
      if (!tracking || now - this.acquiredAt < PREDICT_WARMUP_MS || this.reversing) horizon = 0;
      const px = this.palm.x + clamp(this.palmVelocity.x * horizon, -shift, shift);
      const py = this.palm.y + clamp(this.palmVelocity.y * horizon, -shift, shift);
      stagePosition(px, py, this.mapping, this.position);
      this.tracked.x = this.position.x;
      this.tracked.y = this.position.y;
      // Grabbing takes over directly (fast attack); letting go eases out.
      blendRig(this.idle, this.tracked, tracking ? this.engagement : smoothstep(this.engagement), target);
    } else if (this.agentEngagement > 0) {
      // The agent's last pose is kept, so it lets go as softly as a hand does.
      if (agentRig) copyRig(agentRig, this.agentPose);
      blendRig(this.idle, this.agentPose, smoothstep(this.agentEngagement), target);
    } else {
      copyRig(this.idle, target);
    }

    // Hanging arms partly resist the lean, as gravity would.
    target.shoulderAngle += target.bodyRotation * 0.4;
    target.backShoulderAngle += target.bodyRotation * 0.4;
    return target;
  }

  /** Second half of a frame: followers, then legs and the slight follow-through layered on top. */
  integrate(dt: number): PuppetRig {
    const control = this.control;
    const target = this.target;
    for (const key of CONTROL_KEYS) {
      control[key] = stepSpring(control[key], target[key], this.controlVelocity, key, this.springs[key], dt);
    }

    const behind = Math.hypot(target.x - control.x, target.y - control.y);
    const speed = Math.hypot(this.controlVelocity.x, this.controlVelocity.y);
    this.follow.distance += (behind - this.follow.distance) * 0.1;
    if (speed > 60) this.follow.lagMs += ((behind / speed) * 1000 - this.follow.lagMs) * 0.1;
    else this.follow.lagMs *= 0.98;
    this.rootVelocity.x = this.controlVelocity.x;
    this.rootVelocity.y = this.controlVelocity.y;

    // Follow-through is driven by how fast the controlled puppet travels:
    // the arms trail sideways moves a touch and lift a little on rises.
    const forwardSpeed = facing(this.side) * this.controlVelocity.x;
    const verticalSpeed = this.controlVelocity.y;
    const drive = this.drive;
    drive.trail = clamp(-forwardSpeed * 0.012, -8, 8);
    drive.fling = clamp(verticalSpeed * 0.01, -6, 6);
    drive.lean = clamp(forwardSpeed * 0.004, -2.5, 2.5);
    drive.nod = clamp(verticalSpeed * 0.005, -2.5, 2.5);
    drive.cloth = clamp(forwardSpeed * 0.035 - verticalSpeed * 0.012, -15, 15) + control.bodyRotation * 0.45;
    drive.fan = clamp(forwardSpeed * 0.02, -7, 7);
    drive.blade = clamp(forwardSpeed * 0.03 + verticalSpeed * 0.02, -14, 14);
    for (const key of SECONDARY_KEYS) {
      const params = key === 'cloth' || key === 'fan' || key === 'blade' ? CLOTH : SECONDARY;
      this.secondary[key] = stepSpring(this.secondary[key], drive[key], this.secondaryVelocity, key, params, dt);
    }

    const { trail, fling, lean, nod, cloth, fan, blade } = this.secondary;
    const rig = copyRig(control, this.rig);
    rig.shoulderAngle += trail * 0.8 + fling;
    rig.backShoulderAngle += trail + fling * 0.8;
    rig.elbowAngle += trail * 0.4 + fling * 0.5;
    rig.backElbowAngle += trail * 0.4 + fling * 0.5;
    rig.backWristAngle += blade;
    rig.bodyRotation += lean;
    rig.headRotation += nod;
    rig.clothSwing = cloth;
    rig.fanSway = fan;

    // The root the hand controls may dip below the ground line: that folds the knees instead of sinking the feet.
    const { groundY } = this.mapping.layout;
    this.lift = Math.max(0, groundY - control.y);
    const crouch = Math.max(0, control.y - groundY);
    rig.y += this.legs.update(rig, forwardSpeed, verticalSpeed, this.lift, crouch, dt);
    return rig;
  }
}
