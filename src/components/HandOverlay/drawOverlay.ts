import { CHANNEL_STRING_JOINT, type PuppetJoints } from '../../motion/PuppetRig';
import { drawHandSilhouette } from '../../scene/HandSilhouette';
import { FINGER_CHAINS, FINGERTIPS } from '../../tracking/FingerGeometry';
import { FINGER_NAMES, JOINT_CHANNELS, type FingerMap, type FingerName } from '../../types';

/**
 * The tracking overlay drawn over the camera: all 21 landmarks of each hand,
 * the bones between them, and the strings from the fingertips to the
 * miniature puppet. Points are already in canvas pixels and already mirrored
 * when the preview is, so nothing here ever flips or scales the canvas.
 */

const TEAL = '62, 240, 194';
const YELLOW = '255, 214, 74';
const CORAL = '255, 106, 92';
const STRING = '255, 78, 78';

/** A finger lights up while it is moving at least this much (0..1). */
const ACTIVE = 0.3;

/** Knuckles and wrist: the joints that carry the hand's pose. */
const KEY_JOINTS = [0, 1, 5, 9, 13, 17] as const;
const PALM_ARCH = [5, 9, 13, 17] as const;

export interface OverlayHand {
  /** 42 numbers: x,y per landmark, canvas pixels. */
  points: Float32Array;
  activity: Record<FingerName, number>;
  pinched: boolean;
  /** 0..1 */
  alpha: number;
}

const isActive = (hand: OverlayHand, finger: FingerName) =>
  hand.activity[finger] > ACTIVE || (hand.pinched && (finger === 'thumb' || finger === 'index'));

function strokePath(ctx: CanvasRenderingContext2D, points: Float32Array, ids: readonly number[]) {
  ctx.beginPath();
  ctx.moveTo(points[ids[0] * 2], points[ids[0] * 2 + 1]);
  for (let i = 1; i < ids.length; i++) ctx.lineTo(points[ids[i] * 2], points[ids[i] * 2 + 1]);
  ctx.stroke();
}

/** A thin bright line over a wide faint one: a soft glow without a costly shadow blur. */
function glowLine(ctx: CanvasRenderingContext2D, points: Float32Array, ids: readonly number[], rgb: string, unit: number, alpha: number) {
  ctx.strokeStyle = `rgba(${rgb}, ${(0.2 * alpha).toFixed(3)})`;
  ctx.lineWidth = 5.4 * unit;
  strokePath(ctx, points, ids);
  ctx.strokeStyle = `rgba(${rgb}, ${(0.95 * alpha).toFixed(3)})`;
  ctx.lineWidth = 1.7 * unit;
  strokePath(ctx, points, ids);
}

export function drawSkeleton(ctx: CanvasRenderingContext2D, hand: OverlayHand, unit: number) {
  const { points, alpha } = hand;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Palm: the arch of the knuckles and the two edges down to the wrist.
  glowLine(ctx, points, PALM_ARCH, TEAL, unit, alpha);
  glowLine(ctx, points, [0, 17], TEAL, unit, alpha);

  // Each finger from the wrist out to its tip; a finger that is driving something right now turns yellow.
  for (const finger of FINGER_NAMES) {
    const chain = FINGER_CHAINS[finger];
    glowLine(ctx, points, [0, ...chain], isActive(hand, finger) ? YELLOW : TEAL, unit, alpha);
  }

  // Finger joints.
  for (const finger of FINGER_NAMES) {
    const chain = FINGER_CHAINS[finger];
    const rgb = isActive(hand, finger) ? YELLOW : TEAL;
    ctx.fillStyle = `rgba(232, 255, 248, ${(0.95 * alpha).toFixed(3)})`;
    ctx.strokeStyle = `rgba(${rgb}, ${(0.9 * alpha).toFixed(3)})`;
    ctx.lineWidth = 1 * unit;
    for (const id of [chain[1], chain[2]]) {
      ctx.beginPath();
      ctx.arc(points[id * 2], points[id * 2 + 1], 2 * unit, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Key joints in coral.
  ctx.fillStyle = `rgba(${CORAL}, ${alpha.toFixed(3)})`;
  ctx.strokeStyle = `rgba(255, 240, 236, ${(0.85 * alpha).toFixed(3)})`;
  ctx.lineWidth = 0.9 * unit;
  for (const id of KEY_JOINTS) {
    ctx.beginPath();
    ctx.arc(points[id * 2], points[id * 2 + 1], 2.9 * unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Fingertips: pale rings.
  FINGER_NAMES.forEach((finger, i) => {
    const id = FINGERTIPS[i];
    const active = isActive(hand, finger);
    const x = points[id * 2];
    const y = points[id * 2 + 1];
    const radius = (active ? 6.4 : 5.2) * unit;
    ctx.fillStyle = `rgba(${active ? YELLOW : '235, 255, 250'}, ${(0.22 * alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${active ? YELLOW : TEAL}, ${(0.3 * alpha).toFixed(3)})`;
    ctx.lineWidth = 4.2 * unit;
    ctx.stroke();
    ctx.strokeStyle = `rgba(${active ? '255, 244, 196' : '240, 255, 252'}, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.6 * unit;
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.9 * alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.3 * unit, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** One string per finger, from its tip to the joint it controls on the miniature puppet. */
export function drawStrings(ctx: CanvasRenderingContext2D, hand: OverlayHand, joints: PuppetJoints, fingerMap: FingerMap, unit: number) {
  const { points, alpha } = hand;
  ctx.lineCap = 'round';
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? `rgba(${STRING}, ${(0.22 * alpha).toFixed(3)})` : `rgba(${STRING}, ${(0.9 * alpha).toFixed(3)})`;
    ctx.lineWidth = (pass === 0 ? 4.2 : 1.35) * unit;
    ctx.beginPath();
    for (const channel of JOINT_CHANNELS) {
      const tip = FINGERTIPS[FINGER_NAMES.indexOf(fingerMap[channel])];
      const joint = joints[CHANNEL_STRING_JOINT[channel]];
      ctx.moveTo(points[tip * 2], points[tip * 2 + 1]);
      ctx.lineTo(joint.x, joint.y);
    }
    ctx.stroke();
  }
}

/** Simulation mode has no camera image: a dim studio backdrop stands in for it. */
export function drawSimulatedBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const wall = ctx.createLinearGradient(0, 0, 0, height);
  wall.addColorStop(0, '#2b2622');
  wall.addColorStop(0.62, '#3a332c');
  wall.addColorStop(1, '#1d1916');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, width, height);
  const lamp = ctx.createRadialGradient(width * 0.5, height * 0.38, 0, width * 0.5, height * 0.38, Math.max(width, height) * 0.6);
  lamp.addColorStop(0, 'rgba(255, 226, 170, 0.2)');
  lamp.addColorStop(1, 'rgba(255, 226, 170, 0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = Math.max(28, Math.round(height / 9));
  for (let x = (width / 2) % step; x < width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = step; y < height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

/** The stand-in hand of simulation mode, drawn from the same landmarks the pipeline receives. */
export function drawSimulatedHand(ctx: CanvasRenderingContext2D, points: Float32Array, palmLength: number) {
  ctx.fillStyle = '#c99a78';
  ctx.strokeStyle = '#c99a78';
  drawHandSilhouette(ctx, points, palmLength, 1.5);
}
