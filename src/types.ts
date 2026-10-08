/**
 * Shared data shapes for the whole pipeline:
 *
 *   camera frame → HandFrame (raw sensor data)
 *     → HandFeatures (normalized, then filtered)
 *     → PuppetRig (pose target, then rendered pose)
 */

export type Side = 'left' | 'right';

export const SIDES: readonly Side[] = ['left', 'right'];

export const otherSide = (side: Side): Side => (side === 'left' ? 'right' : 'left');

export interface Point {
  x: number;
  y: number;
  z?: number;
}

/* ------------------------------------------------------------------ sensing */

export interface HandDetection {
  /** 21 landmarks normalized to the video frame, in view space (mirrored when the preview is). */
  landmarks: Point[];
  /** 21 metric landmarks centred on the hand; used for scale-free shape features. */
  worldLandmarks: Point[] | null;
  /** The user's physical hand according to MediaPipe. */
  handedness: Side | null;
  /** The puppet this hand naturally belongs to, given the current mirroring. */
  naturalSide: Side | null;
  /** Confidence of the left/right classification (the only score the model reports per hand). */
  handednessScore: number;
}

export interface HandFrame {
  hands: HandDetection[];
  /** Width / height of the source video. */
  aspect: number;
  /** When the camera captured this frame (performance.now() timeline). */
  time: number;
  /** When the tracking result reached the render thread (same timeline). */
  received: number;
}

export type AssignedHands = Record<Side, HandDetection | null>;

export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

export const FINGER_NAMES: readonly FingerName[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export interface FingerFeatures {
  /** 0 = straight, 1 = fully flexed; linear in the joint angles. */
  curl: number;
  /** Always 1 - curl. */
  extension: number;
  /** Pointing direction relative to the hand axis, degrees, positive toward +x in view. */
  direction: number;
  /**
   * False while the fingertip lies outside the camera frame. The model still
   * guesses a position there, so the value is held instead of trusted: an
   * unseen finger is never read as a curled one.
   */
  inFrame: boolean;
}

/** Continuous description of one hand, built from all 21 landmarks. */
export interface HandFeatures {
  /** Palm centre in normalized view coordinates. */
  palmX: number;
  palmY: number;
  /** In-image rotation of the hand axis (wrist roll), degrees from upright, positive toward +x. */
  roll: number;
  /** Fingers tipping toward (+) or away from the camera, degrees. */
  pitch: number;
  /** Palm turning sideways, degrees. */
  yaw: number;
  /** Palm length relative to the frame height: grows as the hand nears the camera (approximate depth). */
  size: number;
  thumb: FingerFeatures;
  index: FingerFeatures;
  middle: FingerFeatures;
  ring: FingerFeatures;
  pinky: FingerFeatures;
  /** Thumb abduction away from the index finger, 0..1. */
  thumbSpread: number;
  /** Thumb reaching across the palm toward the little finger, 0..1. */
  thumbOpposition: number;
  /** Thumb tip ↔ index tip distance divided by the hand scale (gated, see HandFeatures.ts). */
  pinchDistance: number;
  /** 0 = wide apart … 1 = touching; linear over the whole approach. */
  pinchStrength: number;
  /** Angular separation of neighbouring fingers, each 0..1. */
  spreadIndexMiddle: number;
  spreadMiddleRing: number;
  spreadRingPinky: number;
  /** Mean extension of the four fingers. */
  openness: number;
  /** How closed the whole hand is, 0..1. Stays 0 while any one finger is straight. */
  fistStrength: number;
}

/* ------------------------------------------------------------------ puppet */

/** The five puppet joints a finger can drive. */
export type JointChannel = 'frontShoulder' | 'frontElbow' | 'frontWrist' | 'backShoulder' | 'backElbow';

export const JOINT_CHANNELS: readonly JointChannel[] = ['frontShoulder', 'frontElbow', 'frontWrist', 'backShoulder', 'backElbow'];

/** Which finger drives which joint. */
export type FingerMap = Record<JointChannel, FingerName>;

/**
 * Pose of one puppet. Angles are in degrees and expressed in the puppet's own
 * frame, so the same values mean the same gesture for both mirrored puppets.
 */
export interface PuppetRig {
  /** Where the soles would be if the puppet stood straight, in stage units. */
  x: number;
  y: number;
  scale: number;
  /** 0 = pressed against the screen, 1 = held toward the lamp (larger, softer shadow). */
  depth: number;
  /** Lean of the upper body about the hips; positive tips toward the direction it faces. */
  bodyRotation: number;
  /** Nod; positive dips the face. */
  headRotation: number;
  /** Front arm. 0 hangs straight down, positive swings forward and up. */
  shoulderAngle: number;
  elbowAngle: number;
  wristAngle: number;
  /** 0 = open hand, 1 = closed around the paddle. */
  grip: number;
  /** Back arm, same convention (negative swings backward). */
  backShoulderAngle: number;
  backElbowAngle: number;
  backWristAngle: number;
  /** Legs: hip positive swings the thigh forward, knee positive folds the shin back, foot keeps the sole level. */
  hipAngle: number;
  kneeAngle: number;
  footAngle: number;
  backHipAngle: number;
  backKneeAngle: number;
  backFootAngle: number;
  /** Swing of the kain (skirt) and sashes about the belt. */
  clothSwing: number;
  /** Sway of the ornament behind the head. */
  fanSway: number;
}

export type InteractionState = 'IDLE' | 'TRACKING' | 'LIFT' | 'HUNT' | 'RALLY' | 'INTERACT' | 'RECOVER';

/** High-level hand gestures. They only add behaviour; they never switch off a finger channel. */
export type GestureName = 'none' | 'open' | 'pinch' | 'fist' | 'point';

/* ------------------------------------------------------------------ app */

export type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unsupported' | 'insecure' | 'error';

export type TrackingStatus = 'idle' | 'loading' | 'ready' | 'error';

export type QualityPreset = 'performance' | 'balanced' | 'quality';
