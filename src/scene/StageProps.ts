import type { Side } from '../types';
import { clamp, lerp } from '../utils/math';

/**
 * The stage is drawn in "stage units": always 600 tall, and as wide as the
 * panel's aspect ratio makes it (600 on a phone held upright, up to 1200 on a
 * desktop). Everything that depends on the width is derived here, so no
 * coordinate anywhere else is tied to a viewport.
 */

export const STAGE_HEIGHT = 600;
/** The theatre panels are laid out between these aspect ratios (width / height). */
export const MIN_STAGE_ASPECT = 1;
export const MAX_STAGE_ASPECT = 2;

export interface TableGeometry {
  left: number;
  right: number;
  /** Top surface of the table. */
  top: number;
  thickness: number;
  /** Top of the little net in the middle. */
  netTop: number;
}

export interface StageLayout {
  width: number;
  height: number;
  centerX: number;
  /** Where the puppets' soles rest. */
  groundY: number;
  /** Size of the puppet artwork on stage (artwork units → stage units). */
  puppetScale: number;
  table: TableGeometry;
  /** How far each puppet's root may travel sideways: it keeps to its own side of the table. */
  range: Record<Side, readonly [min: number, max: number]>;
  /** Where each puppet stands when nobody holds it. */
  home: Record<Side, number>;
  /** How high a puppet can be lifted off the ground, stage units. */
  maxLift: number;
  /** How far the root may sink below the ground line while the knees fold. */
  maxCrouch: number;
  moon: { x: number; y: number; r: number };
}

export function computeLayout(width: number): StageLayout {
  const w = clamp(width, STAGE_HEIGHT * MIN_STAGE_ASPECT, STAGE_HEIGHT * MAX_STAGE_ASPECT);
  // 0 on the narrowest stage, 1 once there is room for full-size puppets.
  const room = clamp((w - 600) / 360, 0, 1);
  const centerX = w / 2;
  const groundY = 546;
  const puppetScale = lerp(0.66, 0.8, room);
  const half = lerp(80, 116, room);
  const top = groundY - 108 * (puppetScale / 0.8);
  const outer = lerp(58, 96, room);
  const inner = centerX - half - lerp(34, 46, room);
  const left: readonly [number, number] = [outer, inner];
  const right: readonly [number, number] = [w - inner, w - outer];
  return {
    width: w,
    height: STAGE_HEIGHT,
    centerX,
    groundY,
    puppetScale,
    table: { left: centerX - half, right: centerX + half, top, thickness: 9, netTop: top - 30 * (puppetScale / 0.8) },
    range: { left, right },
    home: { left: lerp(left[0], left[1], 0.52), right: lerp(right[1], right[0], 0.52) },
    maxLift: 250,
    maxCrouch: 26 * puppetScale,
    moon: { x: centerX, y: STAGE_HEIGHT * 0.105, r: STAGE_HEIGHT * 0.176 },
  };
}

/** Width in stage units for a panel of the given pixel size. */
export const stageWidthFor = (pixelWidth: number, pixelHeight: number) =>
  pixelHeight > 0
    ? clamp((pixelWidth / pixelHeight) * STAGE_HEIGHT, STAGE_HEIGHT * MIN_STAGE_ASPECT, STAGE_HEIGHT * MAX_STAGE_ASPECT)
    : STAGE_HEIGHT * 1.5;
