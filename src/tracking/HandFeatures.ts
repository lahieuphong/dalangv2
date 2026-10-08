import { FINGER_NAMES, type FingerFeatures, type HandDetection, type HandFeatures } from '../types';
import { angleFromVertical, clamp, distance, lerp, normalize, smoothstep } from '../utils/math';
import {
  FINGER_CHAINS,
  LANDMARK,
  fingerDirection,
  fingerInFrame,
  fingerSpread,
  len,
  longFingerCurl,
  palmBasis,
  palmCenter,
  sub,
  thumbGeometry,
  type LongFinger,
} from './FingerGeometry';

/**
 * Thumb tip ↔ index tip distance over the hand's own size: about 0.18 when
 * the pads touch and 1.0 with the hand comfortably open. The whole span in
 * between counts, so the pinch is felt long before the fingers meet.
 */
export const PINCH_NEAR = 0.18;
export const PINCH_FAR = 1.0;

/** Turns a normalized fingertip distance into a 0..1 closeness, linear over the whole approach. */
export const pinchFromDistance = (distanceRatio: number) => 1 - normalize(distanceRatio, PINCH_NEAR, PINCH_FAR);

/**
 * A pinch happens out in front of the palm, with the index finger only partly
 * bent. An index finger that simply folds into the palm also carries its tip
 * past the thumb, but that is not a pinch. So closeness only counts while the
 * index tip is still this far (in hand scales) from the palm centre, and
 * while the finger is not curled beyond what a pinch ever needs.
 */
const PINCH_REACH_MIN = 0.42;
const PINCH_REACH_FULL = 0.7;
const PINCH_CURL_FULL = 0.55;
const PINCH_CURL_NONE = 0.8;

/**
 * How closed the whole hand is. Built on the *least* curled finger, so one
 * finger (or even three) bending on its own never reads as the start of a
 * fist: every finger has to come in.
 */
export const fistFromCurls = (index: number, middle: number, ring: number, pinky: number) => {
  const least = Math.min(index, middle, ring, pinky);
  const mean = (index + middle + ring + pinky) / 4;
  return smoothstep(normalize(0.7 * least + 0.3 * mean, 0.45, 0.85));
};

const emptyFinger = (): FingerFeatures => ({ curl: 0, extension: 1, direction: 0, inFrame: true });

export function emptyFeatures(): HandFeatures {
  return {
    palmX: 0.5,
    palmY: 0.5,
    roll: 0,
    pitch: 0,
    yaw: 0,
    size: 0.15,
    thumb: emptyFinger(),
    index: emptyFinger(),
    middle: emptyFinger(),
    ring: emptyFinger(),
    pinky: emptyFinger(),
    thumbSpread: 0,
    thumbOpposition: 0,
    pinchDistance: PINCH_FAR,
    pinchStrength: 0,
    spreadIndexMiddle: 0,
    spreadMiddleRing: 0,
    spreadRingPinky: 0,
    openness: 1,
    fistStrength: 0,
  };
}

export function copyFeatures(from: HandFeatures, to: HandFeatures): HandFeatures {
  for (const finger of FINGER_NAMES) Object.assign(to[finger], from[finger]);
  to.palmX = from.palmX;
  to.palmY = from.palmY;
  to.roll = from.roll;
  to.pitch = from.pitch;
  to.yaw = from.yaw;
  to.size = from.size;
  to.thumbSpread = from.thumbSpread;
  to.thumbOpposition = from.thumbOpposition;
  to.pinchDistance = from.pinchDistance;
  to.pinchStrength = from.pinchStrength;
  to.spreadIndexMiddle = from.spreadIndexMiddle;
  to.spreadMiddleRing = from.spreadMiddleRing;
  to.spreadRingPinky = from.spreadRingPinky;
  to.openness = from.openness;
  to.fistStrength = from.fistStrength;
  return to;
}

/**
 * Builds the full continuous feature set for one hand. Position and in-image
 * rotation come from the normalized image landmarks; everything about the
 * hand's shape comes from the metric world landmarks when available, and every
 * distance is divided by the hand's own size, so nothing changes when the
 * hand moves toward or away from the camera.
 */
export function extractHandFeatures(hand: HandDetection, aspect: number, out: HandFeatures = emptyFeatures()): HandFeatures {
  const lm = hand.landmarks;
  const shape = hand.worldLandmarks ?? lm.map((p) => ({ x: p.x * aspect, y: p.y, z: (p.z ?? 0) * aspect }));
  const { WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP, THUMB_TIP, INDEX_TIP } = LANDMARK;

  const palm = palmCenter(lm);
  // Hand axis: wrist → centroid of the four knuckles (steadier than one knuckle).
  const knuckles = {
    x: (lm[INDEX_MCP].x + lm[MIDDLE_MCP].x + lm[RING_MCP].x + lm[PINKY_MCP].x) / 4,
    y: (lm[INDEX_MCP].y + lm[MIDDLE_MCP].y + lm[RING_MCP].y + lm[PINKY_MCP].y) / 4,
  };
  const roll = angleFromVertical(lm[WRIST], knuckles, aspect);

  const basis = palmBasis(shape);
  const { along, across, normal } = basis;

  const long = (name: LongFinger, target: FingerFeatures) => {
    const chain = FINGER_CHAINS[name];
    target.curl = longFingerCurl(shape, name, normal);
    target.extension = 1 - target.curl;
    target.direction = fingerDirection(lm, chain, aspect, roll);
    target.inFrame = fingerInFrame(lm, chain);
  };
  long('index', out.index);
  long('middle', out.middle);
  long('ring', out.ring);
  long('pinky', out.pinky);

  const thumb = thumbGeometry(shape, basis);
  out.thumb.curl = thumb.curl;
  out.thumb.extension = 1 - thumb.curl;
  out.thumb.direction = fingerDirection(lm, FINGER_CHAINS.thumb, aspect, roll);
  out.thumb.inFrame = fingerInFrame(lm, FINGER_CHAINS.thumb);

  // Pinch: fingertip distance in hand scales, counted only while the index tip is out in front of the palm.
  const tipGap = distance(shape[THUMB_TIP], shape[INDEX_TIP]) / basis.scale;
  const indexReach = distance(shape[INDEX_TIP], palmCenter(shape)) / basis.scale;
  const gate =
    smoothstep(normalize(indexReach, PINCH_REACH_MIN, PINCH_REACH_FULL)) * (1 - smoothstep(normalize(out.index.curl, PINCH_CURL_FULL, PINCH_CURL_NONE)));

  const wrist = lm[WRIST];
  const knuckle = lm[MIDDLE_MCP];
  out.palmX = palm.x;
  out.palmY = palm.y;
  out.roll = roll;
  out.pitch = clamp((Math.atan2(-along.z, Math.hypot(along.x, along.y)) * 180) / Math.PI, -45, 45);
  out.yaw = clamp((Math.atan2(across.z, Math.hypot(across.x, across.y)) * 180) / Math.PI, -45, 45);
  out.size = Math.hypot((knuckle.x - wrist.x) * aspect, knuckle.y - wrist.y);
  out.thumbSpread = thumb.spread;
  out.thumbOpposition = thumb.opposition;
  out.pinchDistance = lerp(PINCH_FAR, Math.min(tipGap, PINCH_FAR), gate);
  out.spreadIndexMiddle = fingerSpread(shape, FINGER_CHAINS.index, FINGER_CHAINS.middle, normal);
  out.spreadMiddleRing = fingerSpread(shape, FINGER_CHAINS.middle, FINGER_CHAINS.ring, normal);
  out.spreadRingPinky = fingerSpread(shape, FINGER_CHAINS.ring, FINGER_CHAINS.pinky, normal);
  deriveFeatures(out);
  return out;
}

/** Signals that are pure functions of the per-finger channels; recomputed after filtering, never filtered twice. */
export function deriveFeatures(features: HandFeatures): HandFeatures {
  for (const finger of FINGER_NAMES) {
    const f = features[finger];
    f.curl = clamp(f.curl, 0, 1);
    f.extension = 1 - f.curl;
  }
  const { index, middle, ring, pinky } = features;
  features.pinchStrength = pinchFromDistance(features.pinchDistance);
  features.openness = 1 - (index.curl + middle.curl + ring.curl + pinky.curl) / 4;
  features.fistStrength = fistFromCurls(index.curl, middle.curl, ring.curl, pinky.curl);
  return features;
}

/** Length of the palm in metres when the world landmarks are present (≈ 0.08–0.10 for an adult). */
export const palmLengthMetres = (hand: HandDetection) =>
  hand.worldLandmarks ? len(sub(hand.worldLandmarks[LANDMARK.MIDDLE_MCP], hand.worldLandmarks[LANDMARK.WRIST])) : null;
