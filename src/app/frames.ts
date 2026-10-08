import type { PuppetJoints } from '../motion/PuppetRig';
import type { SceneController } from '../scene/SceneController';
import type { StageLayout } from '../scene/StageProps';
import type { FingerMap, FingerName, HandDetection, PuppetRig, Side } from '../types';
import type { QualityProfile } from './settings';

/**
 * What the engine hands to the views every frame. Plain data, reused and
 * mutated in place: a view reads it during `render` and keeps nothing.
 */

/** Everything the stage needs to draw one frame. */
export interface StageFrame {
  now: number;
  dt: number;
  layout: StageLayout;
  quality: QualityProfile;
  rigs: Record<Side, PuppetRig>;
  joints: Record<Side, PuppetJoints>;
  /** 0 at rest … 1 held, by a hand or by the agent. */
  presence: Record<Side, number>;
  /** 0..1: how much a human hand holds the puppet. */
  handPresence: Record<Side, number>;
  /** The newest landmarks of the hand on each puppet (view space); null while none is fresh. */
  hands: Record<Side, HandDetection | null>;
  /** Width / height of the tracked video. */
  aspect: number;
  fingerMap: FingerMap;
  agentSide: Side | null;
  scene: SceneController;
  reducedMotion: boolean;
}

/** Everything the camera overlay needs to draw one frame. */
export interface CameraFrame {
  now: number;
  hands: Record<Side, HandDetection | null>;
  rigs: Record<Side, PuppetRig>;
  handPresence: Record<Side, number>;
  /** 0..1 per finger: how much it is moving right now. */
  activity: Record<Side, Record<FingerName, number>>;
  pinched: Record<Side, boolean>;
  fingerMap: FingerMap;
  showSkeleton: boolean;
  showMiniPuppets: boolean;
  simulated: boolean;
}
