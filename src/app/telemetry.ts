import type { BallState, SceneEvent, SceneMode } from '../scene/SceneController';
import {
  FINGER_NAMES,
  type FingerName,
  type GestureName,
  type InteractionState,
  type JointChannel,
  type Side,
  type TrackingStatus,
} from '../types';

/**
 * Everything the HUDs show. One mutable object, refreshed by the engine and
 * read by the overlays: nothing here is ever invented for display. A value
 * that cannot be measured is NaN and is shown as "–".
 */

export interface FingerTelemetry {
  /** Calibrated curl before filtering, 0..1. */
  raw: number;
  /** Filtered curl, 0..1: what the puppet is driven with. */
  filtered: number;
  /** False while the fingertip is outside the camera frame (the value is being held). */
  inFrame: boolean;
  /** 0..1: how much the finger is moving right now. */
  activity: number;
  /** The joint this finger drives, if any. */
  channel: JointChannel | null;
  /** That joint's target and rendered angle, degrees. */
  targetAngle: number;
  renderedAngle: number;
}

export type PaddleStatus = 'idle' | 'follow' | 'armed' | 'recover' | 'cpu';

export interface HandTelemetry {
  /** A human hand is on this puppet (including the short hold after it drops out). */
  tracked: boolean;
  /** Landmarks were seen in the last few frames. */
  visible: boolean;
  recovering: boolean;
  /** The stage agent is flying this puppet. */
  agent: boolean;
  state: InteractionState;
  gesture: GestureName;
  /** MediaPipe's left / right label for the hand on this puppet, and its classification score. */
  handedness: Side | null;
  handednessScore: number;
  palmX: number;
  palmY: number;
  /** Palm speed in view widths per second, and in preview pixels per second. */
  speed: number;
  speedPx: number;
  pinch: number;
  fist: number;
  roll: number;
  depth: number;
  /** Height above the ground, stage units. */
  lift: number;
  fingers: Record<FingerName, FingerTelemetry>;
  /** How far the rendered puppet trails its target, ms. */
  followLagMs: number;
  paddle: PaddleStatus;
  /** Angular speed of the paddle, degrees per second. */
  weaponSpin: number;
}

export interface Telemetry {
  source: 'camera' | 'simulated' | 'none';
  /** The simulated scenario being played. */
  simSegment: string;
  trackerStatus: TrackingStatus;
  /** Where the model runs, e.g. "main-thread · GPU". */
  backend: string;

  /** Frames the camera delivers per second, and the mode it was granted. */
  cameraFps: number;
  cameraWidth: number;
  cameraHeight: number;
  cameraTrackFps: number;
  /** Camera capture → the page can see the frame (NaN where the browser does not report it). */
  captureDelayMs: number;

  /** Tracking results per second. Independent of the render rate. */
  trackHz: number;
  /** Time the model needs for one frame. */
  inferenceMs: number;
  /** Grabbing a frame → its result back on the render thread. */
  roundTripMs: number;
  /** Camera capture → that frame's result driving the pose. */
  inputAgeMs: number;
  /** How old the result on screen is, averaged over render frames. */
  sampleAgeMs: number;
  /** Feature extraction + filtering + mapping, per tracking result. */
  mappingMs: number;

  renderFps: number;
  frameMs: number;
  /** The longest frame of the last second. */
  worstFrameMs: number;
  /** Time the engine spends per render frame (everything but the browser's own painting). */
  engineMs: number;
  /** Camera capture → pose on screen: input age plus how far the followers trail. */
  responseMs: number;

  /** The hand the status HUD describes. */
  primary: Side | null;
  hands: Record<Side, HandTelemetry>;
  /** e.g. "L→left  R→right". */
  assignment: string;

  mode: SceneMode;
  ball: BallState;
  /** Flies swatted in the hunt, or paddle hits in the rally. */
  returns: number;
  rallySeconds: number;
  bestRally: number;
  agentSide: Side | null;

  /** 0..1: how lively the primary hand has been over the last second. */
  energy: number;
  /** Recent palm speed (preview px / s), oldest first: the sparkline. */
  motion: Float32Array;
  motionHead: number;

  /** Gains as multipliers, and the smoothing amount. */
  fingerGain: number;
  palmGain: number;
  pinchGain: number;
  smoothing: number;

  events: readonly SceneEvent[];
}

export const MOTION_SAMPLES = 64;

const emptyFinger = (): FingerTelemetry => ({ raw: 0, filtered: 0, inFrame: true, activity: 0, channel: null, targetAngle: 0, renderedAngle: 0 });

const emptyHand = (): HandTelemetry => ({
  tracked: false,
  visible: false,
  recovering: false,
  agent: false,
  state: 'IDLE',
  gesture: 'none',
  handedness: null,
  handednessScore: 0,
  palmX: 0.5,
  palmY: 0.5,
  speed: 0,
  speedPx: 0,
  pinch: 0,
  fist: 0,
  roll: 0,
  depth: 0,
  lift: 0,
  fingers: Object.fromEntries(FINGER_NAMES.map((finger) => [finger, emptyFinger()])) as Record<FingerName, FingerTelemetry>,
  followLagMs: 0,
  paddle: 'idle',
  weaponSpin: 0,
});

export const createTelemetry = (): Telemetry => ({
  source: 'none',
  simSegment: '',
  trackerStatus: 'idle',
  backend: '',
  cameraFps: NaN,
  cameraWidth: 0,
  cameraHeight: 0,
  cameraTrackFps: NaN,
  captureDelayMs: NaN,
  trackHz: NaN,
  inferenceMs: NaN,
  roundTripMs: NaN,
  inputAgeMs: NaN,
  sampleAgeMs: NaN,
  mappingMs: NaN,
  renderFps: NaN,
  frameMs: NaN,
  worstFrameMs: NaN,
  engineMs: NaN,
  responseMs: NaN,
  primary: null,
  hands: { left: emptyHand(), right: emptyHand() },
  assignment: '–',
  mode: 'hunt',
  ball: 'none',
  returns: 0,
  rallySeconds: 0,
  bestRally: 0,
  agentSide: null,
  energy: 0,
  motion: new Float32Array(MOTION_SAMPLES),
  motionHead: 0,
  fingerGain: 1,
  palmGain: 1,
  pinchGain: 1,
  smoothing: 0,
  events: [],
});

/** Formats a measurement; anything that is not a real number reads as "–". */
export const fixed = (value: number | undefined, digits = 0) =>
  value === undefined || !Number.isFinite(value) ? '–' : value.toFixed(digits);
