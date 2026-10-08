import type { StageLayout } from '../scene/StageProps';
import type { PalmRange } from '../tracking/Calibration';
import type { FingerMap, FingerName, HandFeatures, JointChannel, PuppetRig, Side } from '../types';
import { boost, clamp, lerp, normalize, respond, softClamp } from '../utils/math';
import { emptyRig, facing } from './PuppetRig';

/**
 * Hand → puppet. Fully continuous: each finger drives its own joint through a
 * response curve, so a single finger moving changes only its own part of the
 * pose, and a slight bend already shows.
 *
 *   palm x / y   → where the puppet stands, how high it is lifted
 *   palm size    → depth: scale and shadow
 *   wrist roll   → lean of the body
 *   THUMB        → front wrist (and grip)
 *   INDEX        → front shoulder: straight raises the arm, bending lowers it, its direction aims it
 *   MIDDLE       → front elbow
 *   RING         → back shoulder: straight raises the arm behind
 *   PINKY        → back elbow: bending raises the keris
 *   thumb–index pinch → grip: the hand closes, the wrist cocks, the forearm draws in
 *
 * Which finger drives which joint is a table (`FingerMap`), not code.
 */

export const DEFAULT_FINGER_MAP: FingerMap = {
  frontShoulder: 'index',
  frontElbow: 'middle',
  frontWrist: 'thumb',
  backShoulder: 'ring',
  backElbow: 'pinky',
};

export const CHANNEL_LABEL: Record<JointChannel, string> = {
  frontShoulder: 'Front Arm',
  frontElbow: 'Front Elbow',
  frontWrist: 'Grip / Wrist',
  backShoulder: 'Rear Arm',
  backElbow: 'Rear Elbow',
};

/** The joint a finger drives under a given mapping, if any. */
export function channelOfFinger(map: FingerMap, finger: FingerName): JointChannel | null {
  for (const channel of Object.keys(map) as JointChannel[]) if (map[channel] === finger) return channel;
  return null;
}

/** Independent gains, each a multiplier around 1. Sensitivity is never smoothing. */
export interface ControlGains {
  /** Finger curl → joint angle. */
  finger: number;
  /** Palm travel → puppet travel. */
  palm: number;
  /** Fingertip closeness → grip. */
  pinch: number;
  /** Wrist roll → lean. */
  roll: number;
  /** Palm size → depth. */
  depth: number;
}

/** Slider position (0..1) → gain: 0.75 (calm), 1.25 at the default 0.5, 1.75 (lively). */
export const gainFromSetting = (value: number) => lerp(0.75, 1.75, clamp(value, 0, 1));

/** The ring and little fingers move less on their own, so they are given more gain. */
const FINGER_GAIN: Record<FingerName, number> = { thumb: 1.1, index: 1, middle: 1, ring: 1.15, pinky: 1.25 };

/** Upright hands lean in by a few degrees; that much roll is treated as standing straight. */
const NEUTRAL_ROLL = 4;
const LEAN_GAIN = 0.6;
const MAX_LEAN = 22;

/**
 * The feet hold the ground a little: the first few stage units of a lift are
 * eased in (slope 0 at the ground, 1 soon after), so a hand resting near its
 * home height gives a puppet that stands rather than one that hovers. It is a
 * soft knee, not a dead zone: every movement of the hand still moves the puppet.
 */
const GROUND_GRIP = 9;

/** Joint ranges, degrees: [finger straight, finger fully curled]. */
export const JOINT_RANGE: Record<JointChannel, readonly [number, number]> = {
  frontShoulder: [84, 6],
  frontElbow: [4, 84],
  frontWrist: [18, -30],
  backShoulder: [-74, 6],
  backElbow: [-4, -82],
};

/* ------------------------------------------------------------------ root position */

/** The part of the camera view a palm travels in, and how it maps onto the stage. */
export interface PalmMapping {
  /** Palm position that puts the puppet in the middle of its range, feet on the ground. */
  homeX: number;
  homeY: number;
  /** Palm travel (view widths / heights) that covers the whole range at gain 1. */
  spanX: number;
  spanY: number;
}

const DEFAULT_PALM: Record<Side, PalmMapping> = {
  left: { homeX: 0.3, homeY: 0.62, spanX: 0.32, spanY: 0.4 },
  right: { homeX: 0.7, homeY: 0.62, spanX: 0.32, spanY: 0.4 },
};

/** Uses the calibrated range when there is one, the built-in comfortable range otherwise. */
export function palmMapping(side: Side, range: PalmRange | null | undefined): PalmMapping {
  if (!range) return DEFAULT_PALM[side];
  const width = range.maxX - range.minX;
  const height = range.maxY - range.minY;
  return {
    homeX: (range.minX + range.maxX) / 2,
    homeY: range.maxY - height * 0.1,
    spanX: Math.max(0.14, width * 0.9),
    spanY: Math.max(0.12, height * 0.85),
  };
}

export interface MappingContext {
  side: Side;
  layout: StageLayout;
  gains: ControlGains;
  fingerMap: FingerMap;
  palm: PalmMapping;
  invertY: boolean;
}

/**
 * Where a held puppet stands for a given palm position (normalized view
 * coordinates). Linear around the hand's home with no flat spots, so the
 * slightest palm movement moves the puppet; only the approach to a limit is
 * eased. Kept separate from articulation so the root can be fed a predicted
 * palm position every render frame.
 */
export function stagePosition(palmX: number, palmY: number, ctx: MappingContext, out: { x: number; y: number }) {
  const { layout, palm } = ctx;
  const [min, max] = layout.range[ctx.side];
  const half = (max - min) / 2;
  const travel = ((palmX - palm.homeX) / (palm.spanX / 2)) * half * ctx.gains.palm;
  out.x = softClamp((min + max) / 2 + travel, min, max, Math.min(30, half * 0.3));
  // Raising the hand (smaller y in the view) lifts the puppet; pressing down folds its knees.
  const raw = ((palm.homeY - palmY) / palm.spanY) * layout.maxLift * ctx.gains.palm * (ctx.invertY ? -1 : 1);
  const rise = raw > 0 ? raw - GROUND_GRIP * Math.tanh(raw / GROUND_GRIP) : raw;
  out.y = layout.groundY - softClamp(rise, -layout.maxCrouch, layout.maxLift, 14);
}

/* ------------------------------------------------------------------ articulation */

/** Response-curved bend (0..1) of the finger assigned to each joint. */
function channelBend(hand: HandFeatures, map: FingerMap, channel: JointChannel, gain: number): number {
  const finger = map[channel];
  return respond(hand[finger].curl, FINGER_GAIN[finger] * gain);
}

/**
 * Turns filtered hand features into every hand-driven joint of the puppet
 * except its root position.
 *
 * Priority between direct control and gestures: each joint's angle comes from
 * its own finger first. Gestures (pinch, fist, pointing) only add a bounded
 * offset on top, and are built so that one finger moving alone leaves them at
 * zero: a fist needs all four fingers, pointing needs the other three curled.
 */
export function articulateFromHand(hand: HandFeatures, ctx: MappingContext, out: PuppetRig): PuppetRig {
  const f = facing(ctx.side);
  const { gains, fingerMap } = ctx;
  const shoulder = channelBend(hand, fingerMap, 'frontShoulder', gains.finger);
  const elbow = channelBend(hand, fingerMap, 'frontElbow', gains.finger);
  const wrist = channelBend(hand, fingerMap, 'frontWrist', gains.finger);
  const backShoulder = channelBend(hand, fingerMap, 'backShoulder', gains.finger);
  const backElbow = channelBend(hand, fingerMap, 'backElbow', gains.finger);

  // The pinch is already linear over the whole approach of the fingertips.
  const pinch = boost(hand.pinchStrength, gains.pinch);
  const fist = hand.fistStrength;
  // Index alone, the other three folded away: the arm reaches out to point.
  const pointing = clamp(Math.min(hand.middle.curl, hand.ring.curl, hand.pinky.curl) - hand.index.curl - 0.25, 0, 0.6) / 0.6;

  const forwardRoll = f * hand.roll - NEUTRAL_ROLL;
  const lean = softClamp(forwardRoll * LEAN_GAIN * gains.roll, -MAX_LEAN, MAX_LEAN, 6);
  out.bodyRotation = lean;
  out.headRotation = clamp(-lean * 0.3 + hand.pitch * 0.15 + pinch * 7, -14, 14);

  // A curled finger has no meaningful direction, so its aim is weighted by how straight it is.
  const aimFinger = hand[fingerMap.frontShoulder];
  const aim = clamp(f * aimFinger.direction, -40, 40) * (1 - shoulder);

  const [s0, s1] = JOINT_RANGE.frontShoulder;
  out.shoulderAngle = clamp(lerp(s0, s1, shoulder) + 0.55 * aim + 14 * pointing - 8 * fist, -30, 150);

  const [e0, e1] = JOINT_RANGE.frontElbow;
  out.elbowAngle = clamp(lerp(e0, e1, elbow) + 12 * pinch + 12 * fist - 8 * pointing, -12, 124);

  // Bending the wrist's finger turns it through its whole range. The thumb adds its second movement, swinging in and
  // out beside the palm, as a finer turn on top; as a pinch closes, the pinch takes the wrist over.
  const [w0, w1] = JOINT_RANGE.frontWrist;
  const free = lerp(w0, w1, wrist) + (fingerMap.frontWrist === 'thumb' ? 14 * (hand.thumbSpread - 0.5) : 0);
  out.wristAngle = clamp((1 - pinch) * free + pinch * w1, -44, 40);
  out.grip = clamp(Math.max(pinch, 0.5 * wrist, fist), 0, 1);

  const [bs0, bs1] = JOINT_RANGE.backShoulder;
  out.backShoulderAngle = clamp(lerp(bs0, bs1, backShoulder) + 6 * fist, -110, 40);
  const [be0, be1] = JOINT_RANGE.backElbow;
  out.backElbowAngle = clamp(lerp(be0, be1, backElbow) - 8 * fist, -120, 10);
  // The keris follows the spread of the two fingers that carry it: decorative, and small.
  out.backWristAngle = clamp(14 * (hand.spreadRingPinky - 0.4), -10, 10);

  const depth = clamp(0.5 + (normalize(hand.size, 0.1, 0.28) - 0.5) * gains.depth, 0, 1);
  out.depth = depth;
  out.scale = ctx.layout.puppetScale * (1 + lerp(-0.05, 0.09, depth));
  return out;
}

/* ------------------------------------------------------------------ rest */

interface RestPose {
  phase: number;
  tempo: number;
  lean: number;
  shoulder: number;
  elbow: number;
  wrist: number;
  backShoulder: number;
  backElbow: number;
}

/** Each puppet rests in its own pose and breathes on its own clock, so they never move in lockstep. */
const REST_POSE: Record<Side, RestPose> = {
  left: { phase: 0, tempo: 1, lean: 1.5, shoulder: 26, elbow: 34, wrist: -6, backShoulder: -16, backElbow: -14 },
  right: { phase: 2.1, tempo: 0.87, lean: 2.4, shoulder: 34, elbow: 22, wrist: 4, backShoulder: -22, backElbow: -8 },
};

/**
 * Resting pose: standing at home, facing the table, paddle lowered, breathing
 * almost imperceptibly. `amplitude` scales the idle motion. Writes into `out`
 * to stay allocation-free in the render loop.
 */
export function idleRig(side: Side, time: number, amplitude: number, layout: StageLayout, out: PuppetRig = emptyRig()): PuppetRig {
  const pose = REST_POSE[side];
  const t = time * pose.tempo;
  const p = pose.phase;
  const a = amplitude;
  out.x = layout.home[side] + 1.5 * a * Math.sin(t * 0.17 + p);
  out.y = layout.groundY;
  out.scale = layout.puppetScale;
  out.depth = 0.2;
  out.bodyRotation = pose.lean + a * (0.8 * Math.sin(t * 0.52 + p) + 0.3 * Math.sin(t * 0.23 + p * 1.7));
  // The head trails the body's sway slightly.
  out.headRotation = a * Math.sin(t * 0.52 + p - 0.9);
  out.shoulderAngle = pose.shoulder + 2.2 * a * Math.sin(t * 0.61 + p);
  out.elbowAngle = pose.elbow + 2.6 * a * Math.sin(t * 0.47 + p + 0.6);
  out.wristAngle = pose.wrist + 2.5 * a * Math.sin(t * 0.8 + p);
  out.grip = 0.3;
  out.backShoulderAngle = pose.backShoulder + 1.8 * a * Math.sin(t * 0.43 + p + 2);
  out.backElbowAngle = pose.backElbow + 2 * a * Math.sin(t * 0.55 + p);
  out.backWristAngle = 0;
  return out;
}
