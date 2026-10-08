import type { Point } from '../types';
import { angleFromVertical, clamp, normalize, wrapDegrees } from '../utils/math';

/**
 * Per-finger geometry from the 21 hand landmarks. Everything here is a pure
 * function of one hand's landmarks; nothing is smoothed and nothing depends
 * on the camera resolution or on how far the hand is from the lens.
 */

export const LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
} as const;

export const LANDMARK_COUNT = 21;

export type Chain = readonly [base: number, mid: number, far: number, tip: number];

/** Thumb: CMC → MCP → IP → TIP. Fingers: MCP → PIP → DIP → TIP. */
export const FINGER_CHAINS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
} as const satisfies Record<string, Chain>;

export const FINGERTIPS = [4, 8, 12, 16, 20] as const;

/** Bones of the hand skeleton, as landmark index pairs. */
export const HAND_BONES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const PALM_IDS = [LANDMARK.WRIST, LANDMARK.INDEX_MCP, LANDMARK.MIDDLE_MCP, LANDMARK.RING_MCP, LANDMARK.PINKY_MCP] as const;

/** Average of the wrist and the four finger knuckles: far steadier than the wrist alone. */
export function palmCenter(landmarks: Point[]): Point {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const id of PALM_IDS) {
    x += landmarks[id].x;
    y += landmarks[id].y;
    z += landmarks[id].z ?? 0;
  }
  return { x: x / PALM_IDS.length, y: y / PALM_IDS.length, z: z / PALM_IDS.length };
}

/* ------------------------------------------------------------------ 3D vectors */

export interface Vec {
  x: number;
  y: number;
  z: number;
}

export const sub = (a: Point, b: Point): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: Vec) => Math.hypot(a.x, a.y, a.z);
export const cross = (a: Vec, b: Vec): Vec => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const unit = (a: Vec): Vec => {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0, z: 0 } : { x: a.x / l, y: a.y / l, z: a.z / l };
};
/** Removes the component of `a` along unit vector `n` (projects onto the plane normal to `n`). */
export const flatten = (a: Vec, n: Vec): Vec => {
  const k = dot(a, n);
  return { x: a.x - n.x * k, y: a.y - n.y * k, z: a.z - n.z * k };
};
/** Unsigned angle between two vectors, degrees. */
export const angleBetween = (a: Vec, b: Vec) => {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  return (Math.acos(clamp(dot(a, b) / (la * lb), -1, 1)) * 180) / Math.PI;
};

/* ------------------------------------------------------------------ palm */

export interface PalmBasis {
  /** Wrist → middle knuckle. */
  along: Vec;
  /** Little-finger knuckle → index knuckle. */
  across: Vec;
  /** Unit normal of the palm plane. */
  normal: Vec;
  /** Mean of palm length and palm width: the hand's own ruler for every distance. */
  scale: number;
}

export function palmBasis(shape: Point[]): PalmBasis {
  const along = sub(shape[LANDMARK.MIDDLE_MCP], shape[LANDMARK.WRIST]);
  const across = sub(shape[LANDMARK.INDEX_MCP], shape[LANDMARK.PINKY_MCP]);
  return { along, across, normal: unit(cross(along, across)), scale: Math.max(1e-6, 0.5 * (len(along) + len(across))) };
}

/* ------------------------------------------------------------------ fingers */

/**
 * How far each finger flexes compared with the index finger. The ring and
 * little fingers travel less, so their full range is reached sooner.
 */
export const FINGER_REACH = { index: 1, middle: 1, ring: 0.92, pinky: 0.85 } as const;

export type LongFinger = keyof typeof FINGER_REACH;

/**
 * Flexion of a long finger, 0 (straight) to 1 (folded), built from three
 * angles that are all linear for small bends, so a slight bend reads as a
 * slight curl instead of vanishing:
 *
 * - sweep:   how far the whole finger (knuckle → tip) has swung toward the palm
 * - knuckle: flexion at the MCP joint
 * - hook:    flexion of the two finger joints together (PIP and DIP)
 *
 * Each uses the longest baseline available rather than the short bones on
 * their own, which keeps landmark noise several times lower than summing the
 * three joint angles would. Sweep and knuckle are measured in the finger's
 * own flexion plane, so spreading the fingers sideways does not read as
 * curling, and each finger only ever looks at its own four landmarks plus the
 * wrist: bending one finger cannot change another finger's value.
 */
export function longFingerCurl(shape: Point[], finger: LongFinger, palmNormal: Vec): number {
  const [mcp, pip, , tip] = FINGER_CHAINS[finger];
  const reach = FINGER_REACH[finger];
  const metacarpal = sub(shape[mcp], shape[LANDMARK.WRIST]);
  const proximal = sub(shape[pip], shape[mcp]);
  const lateral = unit(cross(palmNormal, metacarpal));
  const sweep = angleBetween(metacarpal, flatten(sub(shape[tip], shape[mcp]), lateral));
  const knuckle = angleBetween(metacarpal, flatten(proximal, lateral));
  const hook = angleBetween(proximal, sub(shape[tip], shape[pip]));
  return clamp(
    0.5 * normalize(sweep, 3, 140 * reach) + 0.2 * normalize(knuckle, 4, 80 * reach) + 0.3 * normalize(hook, 4, 118 * reach),
    0,
    1,
  );
}

export interface ThumbGeometry {
  /** Flexion of the thumb's two outer joints, 0..1. */
  curl: number;
  /** Abduction: the thumb's metacarpal swinging away from the index metacarpal, 0..1. */
  spread: number;
  /** Opposition: the thumb tip travelling across the palm toward the little finger, 0..1. */
  opposition: number;
}

/**
 * The thumb has its own anatomy (CMC → MCP → IP → tip, opposing the palm), so
 * it is measured on its own terms rather than with the long-finger formula.
 */
export function thumbGeometry(shape: Point[], basis: PalmBasis): ThumbGeometry {
  const { THUMB_CMC: cmc, THUMB_MCP: mcp, THUMB_IP: ip, THUMB_TIP: tip, INDEX_MCP, PINKY_MCP, WRIST } = LANDMARK;
  const metacarpal = sub(shape[mcp], shape[cmc]);
  const proximal = sub(shape[ip], shape[mcp]);
  const distal = sub(shape[tip], shape[ip]);
  // The swing of the two outer bones together against the metacarpal, plus the tip joint on its own.
  const sweep = angleBetween(metacarpal, sub(shape[tip], shape[mcp]));
  const curl = clamp(0.6 * normalize(sweep, 4, 75) + 0.4 * normalize(angleBetween(proximal, distal), 4, 80), 0, 1);
  const spread = normalize(angleBetween(metacarpal, sub(shape[INDEX_MCP], shape[WRIST])), 15, 55);
  const reach = len(sub(shape[tip], shape[PINKY_MCP])) / basis.scale;
  return { curl, spread, opposition: 1 - normalize(reach, 0.4, 1.25) };
}

/** Angular separation of two fingers, measured within the palm plane, 0..1. */
export function fingerSpread(shape: Point[], a: Chain, b: Chain, palmNormal: Vec): number {
  const da = flatten(sub(shape[a[3]], shape[a[0]]), palmNormal);
  const db = flatten(sub(shape[b[3]], shape[b[0]]), palmNormal);
  return normalize(angleBetween(da, db), 3, 25);
}

/** Where a finger points in the image, relative to the hand axis; degrees, positive toward +x. */
export function fingerDirection(image: Point[], chain: Chain, aspect: number, roll: number): number {
  return wrapDegrees(angleFromVertical(image[chain[0]], image[chain[3]], aspect) - roll);
}

/** Slack allowed around the frame before a fingertip counts as out of view. */
const FRAME_MARGIN = 0.02;

/** Whether the outer half of a finger is inside the camera frame. */
export function fingerInFrame(image: Point[], chain: Chain): boolean {
  for (const id of [chain[2], chain[3]]) {
    const p = image[id];
    if (p.x < -FRAME_MARGIN || p.x > 1 + FRAME_MARGIN || p.y < -FRAME_MARGIN || p.y > 1 + FRAME_MARGIN) return false;
  }
  return true;
}
