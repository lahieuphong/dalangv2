import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';

/** Shared by the page and the tracking worker: message shapes and the compact result format. */

export type Delegate = 'GPU' | 'CPU';

/** Where to load the WASM runtime and the model from. */
export interface TrackerSource {
  wasm: string;
  model: string;
}

/** MediaPipe confidence thresholds, each 0..1. */
export interface TrackerThresholds {
  /** Palm detector: how sure it must be before a new hand is reported. */
  detection: number;
  /** Landmark model: below this the hand counts as gone and detection runs again. */
  presence: number;
  /** Frame-to-frame tracking: below this the tracker re-detects instead of following. */
  tracking: number;
}

export const DEFAULT_THRESHOLDS: TrackerThresholds = { detection: 0.55, presence: 0.5, tracking: 0.5 };

/** The thresholds as HandLandmarker options. Kept here, free of any runtime import, so the page can use it without loading MediaPipe. */
export const thresholdOptions = (thresholds: TrackerThresholds) => ({
  minHandDetectionConfidence: thresholds.detection,
  minHandPresenceConfidence: thresholds.presence,
  minTrackingConfidence: thresholds.tracking,
});

export const LANDMARKS_PER_HAND = 21;
/** Per hand: 21 image-space xyz followed by 21 world-space xyz. */
export const FLOATS_PER_HAND = LANDMARKS_PER_HAND * 6;

/** One inference result as flat numbers, cheap to hand between threads. */
export interface PackedHands {
  count: number;
  points: Float32Array;
  /** Per hand: 1 = "Right", 0 = "Left", -1 = unknown. */
  labels: number[];
  scores: number[];
}

export type TrackerRequest =
  | { type: 'init'; sources: TrackerSource[]; allowGpu: boolean; thresholds: TrackerThresholds }
  | { type: 'configure'; thresholds: TrackerThresholds }
  | { type: 'frame'; image: VideoFrame | ImageBitmap; timestamp: number };

export type TrackerResponse =
  | { type: 'ready'; delegate: Delegate }
  | { type: 'failed'; message: string }
  | { type: 'result'; hands: PackedHands; inferenceMs: number }
  | { type: 'error'; message: string };

export function packHands(result: HandLandmarkerResult): PackedHands {
  const count = result.landmarks.length;
  const points = new Float32Array(count * FLOATS_PER_HAND);
  const labels: number[] = [];
  const scores: number[] = [];
  for (let h = 0; h < count; h++) {
    const image = result.landmarks[h];
    const world = result.worldLandmarks[h];
    let o = h * FLOATS_PER_HAND;
    for (let i = 0; i < LANDMARKS_PER_HAND; i++) {
      points[o++] = image[i].x;
      points[o++] = image[i].y;
      points[o++] = image[i].z;
    }
    for (let i = 0; i < LANDMARKS_PER_HAND; i++) {
      // NaN marks "no world landmarks"; the reader falls back to image space.
      points[o++] = world ? world[i].x : NaN;
      points[o++] = world ? world[i].y : NaN;
      points[o++] = world ? world[i].z : NaN;
    }
    const category = result.handedness[h]?.[0];
    labels.push(category ? (category.categoryName === 'Right' ? 1 : 0) : -1);
    scores.push(category?.score ?? 0);
  }
  return { count, points, labels, scores };
}
