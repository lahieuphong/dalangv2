import type { StageLayout } from './StageProps';

/**
 * Flight of the ball: gravity, a little air drag, the table, its net, the
 * ground and the walls. One function advances the ball, and both the live
 * ball and every prediction go through it, so a predicted path is the path.
 *
 * The scene always calls it with the same small step (`PHYSICS_STEP`), fed
 * from an accumulator, and free flight is integrated in closed form. How the
 * display paces its frames therefore changes nothing about where the ball
 * goes: 30, 60 or 144 frames a second all walk through the same states.
 */

export const BALL_RADIUS = 6.5;
export const GRAVITY = 560;
/** Linear drag, 1 / s. Light: it trims about a tenth off a one-second lob. */
export const AIR_DRAG = 0.12;
export const TABLE_BOUNCE = 0.86;
/** The fixed physics step, seconds. Small enough that the ball moves under a third of its radius per step at rally speeds. */
export const PHYSICS_STEP = 1 / 240;

const TERMINAL = GRAVITY / AIR_DRAG;

export interface BallBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type BallContact = 'none' | 'table' | 'net' | 'ground' | 'wall';

/** Free flight over `dt` seconds, exactly (the solution of dv/dt = g - k·v), with nothing in the way. */
export function fly(b: BallBody, dt: number) {
  const decay = Math.exp(-AIR_DRAG * dt);
  const gain = (1 - decay) / AIR_DRAG;
  b.x += b.vx * gain;
  b.y += TERMINAL * dt + (b.vy - TERMINAL) * gain;
  b.vx *= decay;
  b.vy = TERMINAL + (b.vy - TERMINAL) * decay;
}

/**
 * The launch velocity that carries a ball from (x0, y0) to (x1, y1) in
 * exactly `time` seconds of free flight. The inverse of `fly`, drag included,
 * so a shot aimed with it lands where it was aimed.
 */
export function launchVelocity(x0: number, y0: number, x1: number, y1: number, time: number, out: { vx: number; vy: number }) {
  const gain = (1 - Math.exp(-AIR_DRAG * time)) / AIR_DRAG;
  out.vx = (x1 - x0) / gain;
  out.vy = TERMINAL + (y1 - y0 - TERMINAL * time) / gain;
  return out;
}

/** Height of a ball launched from y0 with vertical speed vy0, `time` seconds later. */
export const heightAfter = (y0: number, vy0: number, time: number) =>
  y0 + TERMINAL * time + ((vy0 - TERMINAL) * (1 - Math.exp(-AIR_DRAG * time))) / AIR_DRAG;

/** One step of the ball, world included. Shared by the live ball and by trajectory prediction. */
export function stepBall(b: BallBody, dt: number, layout: StageLayout): BallContact {
  const { table, groundY, width, centerX } = layout;
  const r = BALL_RADIUS;
  const px = b.x;
  const py = b.y;
  fly(b, dt);

  if (b.vy > 0 && py <= table.top - r + 0.5 && b.y > table.top - r && b.x > table.left - r && b.x < table.right + r) {
    b.y = table.top - r;
    b.vy = -b.vy * TABLE_BOUNCE;
    b.vx *= 0.985;
    return 'table';
  }
  if ((px - centerX) * (b.x - centerX) <= 0 && px !== b.x && b.y > table.netTop - r && b.y < table.top) {
    const from = px < centerX ? -1 : 1;
    b.x = centerX + from * (r + 0.5);
    b.vx = -b.vx * 0.35;
    return 'net';
  }
  if (b.y > groundY - r) {
    b.y = groundY - r;
    return 'ground';
  }
  if (b.x < r) {
    b.x = r;
    b.vx = Math.abs(b.vx) * 0.6;
    return 'wall';
  }
  if (b.x > width - r) {
    b.x = width - r;
    b.vx = -Math.abs(b.vx) * 0.6;
    return 'wall';
  }
  if (b.y < r) {
    b.y = r;
    b.vy = Math.abs(b.vy) * 0.5;
  }
  return 'none';
}

export interface BallSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds from now. */
  t: number;
  /** Table bounces so far along this prediction. */
  bounces: number;
}

export const emptySample = (): BallSample => ({ x: 0, y: 0, vx: 0, vy: 0, t: 0, bounces: 0 });

/**
 * Predicts the ball's flight from a given state by running the very same
 * steps the live ball will take, and writes one sample every `spacing`
 * seconds into `out`. Returns how many samples were written; the prediction
 * stops where the ball would reach the ground.
 */
export function predictFlight(from: BallBody, layout: StageLayout, seconds: number, spacing: number, out: BallSample[]): number {
  const body: BallBody = { x: from.x, y: from.y, vx: from.vx, vy: from.vy };
  const every = Math.max(1, Math.round(spacing / PHYSICS_STEP));
  const steps = Math.round(seconds / PHYSICS_STEP);
  let bounces = 0;
  let count = 0;
  for (let i = 1; i <= steps && count < out.length; i++) {
    const contact = stepBall(body, PHYSICS_STEP, layout);
    if (contact === 'table') bounces += 1;
    if (i % every === 0 || contact === 'ground') {
      const sample = out[count++];
      sample.x = body.x;
      sample.y = body.y;
      sample.vx = body.vx;
      sample.vy = body.vy;
      sample.t = i * PHYSICS_STEP;
      sample.bounces = bounces;
    }
    if (contact === 'ground') break;
  }
  return count;
}
