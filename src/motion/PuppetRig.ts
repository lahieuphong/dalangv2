import type { JointChannel, Point, PuppetRig, Side } from '../types';
import { RAD } from '../utils/math';

/**
 * Puppet-local rig dimensions. Artwork is drawn facing right with the soles on
 * y = 0 (up is negative y); the right-hand puppet is the same rig mirrored.
 */
export const PUPPET = {
  /** Soles to the tip of the crown, for layout. */
  height: 500,
  /** The upper body leans about the belt. */
  hip: { x: 0, y: -228 },
  neck: { x: 40, y: -336 },
  chest: { x: 4, y: -284 },
  crown: { x: 38, y: -488 },
  /** Where the ornament behind the head is pinned. */
  fan: { x: 6, y: -372 },
  front: { shoulder: { x: 46, y: -297 }, upper: 108, fore: 102 },
  back: { shoulder: { x: -42, y: -295 }, upper: 108, fore: 102 },
  /** Where the four-finger blade hinges on the palm, in hand coordinates. */
  knuckle: { x: 0.3, y: 21 },
  /** Distance from the wrist pin to the string tie on the palm. */
  handTip: 30,
  /** The paddle held in the front hand: distance from wrist to the disc's centre, and the disc's radius. */
  paddle: { reach: 68, radius: 25 },
  /** The keris in the back hand: tilted backward from the hand, with this much blade beyond the grip. */
  sword: { tilt: 50, grip: 16, length: 138 },
  frontLeg: { hip: { x: 68, y: -196 }, knee: { x: 70.5, y: -84 }, ankle: { x: 72, y: -22 } },
  backLeg: { hip: { x: -46, y: -196 }, knee: { x: -46, y: -84 }, ankle: { x: -50.5, y: -22 } },
  /** Hip → knee and knee → sole, for the crouch. */
  thigh: 112,
  shin: 84,
} as const;

/** +1 when the puppet faces right (stage left puppet), -1 when it faces left. */
export const facing = (side: Side) => (side === 'left' ? 1 : -1);

export const RIG_KEYS = [
  'x',
  'y',
  'scale',
  'depth',
  'bodyRotation',
  'headRotation',
  'shoulderAngle',
  'elbowAngle',
  'wristAngle',
  'grip',
  'backShoulderAngle',
  'backElbowAngle',
  'backWristAngle',
  'hipAngle',
  'kneeAngle',
  'footAngle',
  'backHipAngle',
  'backKneeAngle',
  'backFootAngle',
  'clothSwing',
  'fanSway',
] as const satisfies readonly (keyof PuppetRig)[];

export type RigKey = (typeof RIG_KEYS)[number];

/**
 * The channels a hand controls directly. They go through the display-rate
 * followers; the legs, cloth and ornament are procedural and are layered on
 * afterwards.
 */
export const CONTROL_KEYS = [
  'x',
  'y',
  'scale',
  'depth',
  'bodyRotation',
  'headRotation',
  'shoulderAngle',
  'elbowAngle',
  'wristAngle',
  'grip',
  'backShoulderAngle',
  'backElbowAngle',
  'backWristAngle',
] as const satisfies readonly RigKey[];

export type ControlKey = (typeof CONTROL_KEYS)[number];

/** The rig field each finger channel drives. */
export const CHANNEL_RIG_KEY: Record<JointChannel, ControlKey> = {
  frontShoulder: 'shoulderAngle',
  frontElbow: 'elbowAngle',
  frontWrist: 'wristAngle',
  backShoulder: 'backShoulderAngle',
  backElbow: 'backElbowAngle',
};

export const emptyRig = (): PuppetRig => ({
  x: 0,
  y: 0,
  scale: 0.8,
  depth: 0,
  bodyRotation: 0,
  headRotation: 0,
  shoulderAngle: 0,
  elbowAngle: 0,
  wristAngle: 0,
  grip: 0,
  backShoulderAngle: 0,
  backElbowAngle: 0,
  backWristAngle: 0,
  hipAngle: 0,
  kneeAngle: 0,
  footAngle: 0,
  backHipAngle: 0,
  backKneeAngle: 0,
  backFootAngle: 0,
  clothSwing: 0,
  fanSway: 0,
});

export function copyRig(from: PuppetRig, to: PuppetRig): PuppetRig {
  for (const key of RIG_KEYS) to[key] = from[key];
  return to;
}

export function blendRig(from: PuppetRig, to: PuppetRig, t: number, out: PuppetRig): PuppetRig {
  for (const key of RIG_KEYS) out[key] = from[key] + (to[key] - from[key]) * t;
  return out;
}

/* ------------------------------------------------------------------ forward kinematics */

/** Where the rig's joints are on the stage. Shared by strings, props and collisions. */
export interface PuppetJoints {
  root: Point;
  hip: Point;
  chest: Point;
  neck: Point;
  crown: Point;
  frontShoulder: Point;
  frontElbow: Point;
  frontWrist: Point;
  frontHand: Point;
  /** Centre of the paddle's disc. */
  paddle: Point;
  backShoulder: Point;
  backElbow: Point;
  backWrist: Point;
  backHand: Point;
  swordTip: Point;
  /** Direction of the paddle (wrist → disc), degrees from straight down toward the way the puppet faces. */
  paddleAngle: number;
  paddleRadius: number;
}

const point = (): Point => ({ x: 0, y: 0 });

export const createJoints = (): PuppetJoints => ({
  root: point(),
  hip: point(),
  chest: point(),
  neck: point(),
  crown: point(),
  frontShoulder: point(),
  frontElbow: point(),
  frontWrist: point(),
  frontHand: point(),
  paddle: point(),
  backShoulder: point(),
  backElbow: point(),
  backWrist: point(),
  backHand: point(),
  swordTip: point(),
  paddleAngle: 0,
  paddleRadius: PUPPET.paddle.radius,
});

/** The joint at the far end of the bone each finger channel turns: where that finger's string is tied. */
export const CHANNEL_STRING_JOINT: Record<JointChannel, 'frontElbow' | 'frontWrist' | 'frontHand' | 'backElbow' | 'backWrist'> = {
  frontShoulder: 'frontElbow',
  frontElbow: 'frontWrist',
  frontWrist: 'frontHand',
  backShoulder: 'backElbow',
  backElbow: 'backWrist',
};

/**
 * Forward kinematics, matching the SVG transforms in `rigTransforms` exactly:
 * arm chains in puppet space, the lean about the belt, then mirror, scale and
 * place on the stage.
 */
export function computeJoints(rig: PuppetRig, side: Side, out: PuppetJoints): PuppetJoints {
  const flip = facing(side);
  const s = rig.scale;
  const lean = rig.bodyRotation * RAD;
  const cosL = Math.cos(lean);
  const sinL = Math.sin(lean);
  const { hip } = PUPPET;

  // Puppet space → leaned → stage.
  const place = (x: number, y: number, target: Point) => {
    const dx = x - hip.x;
    const dy = y - hip.y;
    target.x = rig.x + flip * s * (hip.x + dx * cosL - dy * sinL);
    target.y = rig.y + s * (hip.y + dx * sinL + dy * cosL);
  };

  out.root.x = rig.x;
  out.root.y = rig.y;
  place(hip.x, hip.y, out.hip);
  place(PUPPET.chest.x, PUPPET.chest.y, out.chest);
  place(PUPPET.neck.x, PUPPET.neck.y, out.neck);

  // The crown turns with the head about the neck.
  const head = rig.headRotation * RAD;
  const cx = PUPPET.crown.x - PUPPET.neck.x;
  const cy = PUPPET.crown.y - PUPPET.neck.y;
  place(PUPPET.neck.x + cx * Math.cos(head) - cy * Math.sin(head), PUPPET.neck.y + cx * Math.sin(head) + cy * Math.cos(head), out.crown);

  // Front arm: shoulder → elbow → wrist → hand, then on to the paddle.
  const f = PUPPET.front;
  const a1 = rig.shoulderAngle * RAD;
  const a2 = a1 + rig.elbowAngle * RAD;
  const a3 = a2 + rig.wristAngle * RAD;
  const ex = f.shoulder.x + f.upper * Math.sin(a1);
  const ey = f.shoulder.y + f.upper * Math.cos(a1);
  const wx = ex + f.fore * Math.sin(a2);
  const wy = ey + f.fore * Math.cos(a2);
  place(f.shoulder.x, f.shoulder.y, out.frontShoulder);
  place(ex, ey, out.frontElbow);
  place(wx, wy, out.frontWrist);
  place(wx + PUPPET.handTip * Math.sin(a3), wy + PUPPET.handTip * Math.cos(a3), out.frontHand);
  place(wx + PUPPET.paddle.reach * Math.sin(a3), wy + PUPPET.paddle.reach * Math.cos(a3), out.paddle);
  out.paddleAngle = rig.shoulderAngle + rig.elbowAngle + rig.wristAngle - rig.bodyRotation;
  out.paddleRadius = PUPPET.paddle.radius * s;

  // Back arm, and the keris it holds.
  const b = PUPPET.back;
  const b1 = rig.backShoulderAngle * RAD;
  const b2 = b1 + rig.backElbowAngle * RAD;
  const b3 = b2 + rig.backWristAngle * RAD;
  const bex = b.shoulder.x + b.upper * Math.sin(b1);
  const bey = b.shoulder.y + b.upper * Math.cos(b1);
  const bwx = bex + b.fore * Math.sin(b2);
  const bwy = bey + b.fore * Math.cos(b2);
  const blade = b3 - PUPPET.sword.tilt * RAD;
  const bladeLength = PUPPET.sword.grip + PUPPET.sword.length;
  place(b.shoulder.x, b.shoulder.y, out.backShoulder);
  place(bex, bey, out.backElbow);
  place(bwx, bwy, out.backWrist);
  place(bwx + PUPPET.handTip * Math.sin(b3), bwy + PUPPET.handTip * Math.cos(b3), out.backHand);
  place(bwx + bladeLength * Math.sin(blade), bwy + bladeLength * Math.cos(blade), out.swordTip);
  return out;
}

/* ------------------------------------------------------------------ SVG transforms */

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

export interface RigTransforms {
  root: string;
  /** The lean; applied to every upper-body group. */
  upper: string;
  head: string;
  fan: string;
  frontUpper: string;
  frontFore: string;
  frontHand: string;
  frontFingers: string;
  backUpper: string;
  backFore: string;
  backHand: string;
  frontLeg: string;
  frontShin: string;
  frontFoot: string;
  backLeg: string;
  backShin: string;
  backFoot: string;
  cloth: string;
}

export const RIG_TRANSFORM_KEYS = [
  'root',
  'upper',
  'head',
  'fan',
  'frontUpper',
  'frontFore',
  'frontHand',
  'frontFingers',
  'backUpper',
  'backFore',
  'backHand',
  'frontLeg',
  'frontShin',
  'frontFoot',
  'backLeg',
  'backShin',
  'backFoot',
  'cloth',
] as const satisfies readonly (keyof RigTransforms)[];

const about = (angle: number, pivot: { x: number; y: number }) => `rotate(${f2(angle)} ${pivot.x} ${pivot.y})`;

/** Converts a rig into SVG transform attributes for each articulated group. */
export function rigTransforms(side: Side, rig: PuppetRig, out: Partial<RigTransforms> = {}): RigTransforms {
  const flip = facing(side);
  const { frontLeg, backLeg } = PUPPET;
  out.root = `translate(${f2(rig.x)} ${f2(rig.y)}) scale(${f2(flip * rig.scale)} ${f2(rig.scale)})`;
  out.upper = about(rig.bodyRotation, PUPPET.hip);
  out.head = about(rig.headRotation, PUPPET.neck);
  out.fan = about(rig.headRotation * 0.6 + rig.fanSway, PUPPET.fan);
  // Rig angles are "forward positive"; in the right-facing artwork that is a counter-clockwise SVG rotation.
  out.frontUpper = `rotate(${f2(-rig.shoulderAngle)})`;
  out.frontFore = `rotate(${f2(-rig.elbowAngle)})`;
  out.frontHand = `rotate(${f2(-rig.wristAngle)})`;
  out.frontFingers = about(-rig.grip * 72, PUPPET.knuckle);
  out.backUpper = `rotate(${f2(-rig.backShoulderAngle)})`;
  out.backFore = `rotate(${f2(-rig.backElbowAngle)})`;
  out.backHand = `rotate(${f2(-rig.backWristAngle)})`;
  out.frontLeg = about(-rig.hipAngle, frontLeg.hip);
  out.frontShin = about(rig.kneeAngle, frontLeg.knee);
  out.frontFoot = about(rig.footAngle, frontLeg.ankle);
  out.backLeg = about(-rig.backHipAngle, backLeg.hip);
  out.backShin = about(rig.backKneeAngle, backLeg.knee);
  out.backFoot = about(rig.backFootAngle, backLeg.ankle);
  out.cloth = about(rig.clothSwing, PUPPET.hip);
  return out as RigTransforms;
}
