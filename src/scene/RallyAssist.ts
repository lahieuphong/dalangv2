import type { Side } from '../types';
import { clamp, lerp, RAD, smoothstep } from '../utils/math';
import { AIR_DRAG, BALL_RADIUS, heightAfter, launchVelocity } from './BallPhysics';
import type { ContactZones } from './RacketCollision';
import type { StageLayout } from './StageProps';

/**
 * Rally assistance: how forgiving a contact is, and how much a return is
 * nudged toward a playable spot. Three presets; the collision itself is
 * always swept, in every one of them.
 *
 * Nothing here ever moves the ball or a paddle. Assistance only decides
 * whether a near pass counts as a hit, and (within fixed ceilings) which way
 * and how fast the ball leaves once it has been hit.
 */

export type RallyAssistMode = 'precision' | 'natural' | 'cinematic';

export const RALLY_ASSIST_MODES: readonly RallyAssistMode[] = ['precision', 'natural', 'cinematic'];

export interface RallyAssistConfig {
  mode: RallyAssistMode;
  /** Outer edge of the forgiveness ring, as a multiple of the touching distance (paddle radius + ball radius). */
  forgiveness: number;
  /** The most the adaptive terms may widen it to. */
  forgivenessMax: number;
  /** Hard limit on how far from the paddle's centre a contact can ever be made, lead included (multiple of the touching distance). */
  reachMax: number;
  /** Latency lead: the forgiveness ring reaches this many seconds of paddle travel ahead… */
  leadTime: number;
  /** …but never further than this many paddle radii. */
  leadMax: number;
  /** Ceiling of the aim-assist weight: the most a return's direction may be blended toward the safe target. */
  aimAssist: number;
  /**
   * Pace assist: how far the speed of a return that is already heading the
   * right way is drawn toward the speed that would land it. A paddle has no
   * way to dose its pace against a ball it cannot feel, so this is what keeps
   * a block from dropping short and a keen swing from sailing long.
   */
  paceAssist: number;
  /** How much the safe target varies from shot to shot, 0..1. */
  variation: number;
  /** The stage agent: aiming error on its first shot, growth per shot of the rally, ceiling (stage units), and reaction time. */
  cpu: { error: number; errorGrowth: number; errorMax: number; reactionMs: number };
}

/**
 * For scale: the touching distance is 26.5 stage units at full puppet size
 * (paddle 20 + ball 6.5). Before these presets existed there was one hit
 * zone, 1.26 touching distances wide (33.5 units), tested only at the end of
 * a step. Natural now starts 15 % wider than that and may reach 30 % wider;
 * Cinematic starts 27 % wider and may reach 46 %. Precision is the true size,
 * which is 21 % *narrower* than the old zone.
 */
export const RALLY_ASSIST: Record<RallyAssistMode, RallyAssistConfig> = {
  // The ball must really touch the paddle, and goes exactly where the stroke sends it.
  precision: {
    mode: 'precision',
    forgiveness: 1,
    forgivenessMax: 1,
    reachMax: 1,
    leadTime: 0,
    leadMax: 0,
    aimAssist: 0,
    paceAssist: 0,
    variation: 1,
    cpu: { error: 7, errorGrowth: 4, errorMax: 40, reactionMs: 170 },
  },
  natural: {
    mode: 'natural',
    forgiveness: 1.45,
    forgivenessMax: 1.65,
    reachMax: 1.8,
    leadTime: 0.045,
    leadMax: 0.6,
    aimAssist: 0.25,
    paceAssist: 0.7,
    variation: 0.6,
    cpu: { error: 5, errorGrowth: 2.6, errorMax: 30, reactionMs: 140 },
  },
  cinematic: {
    mode: 'cinematic',
    forgiveness: 1.6,
    forgivenessMax: 1.85,
    reachMax: 1.95,
    leadTime: 0.055,
    leadMax: 0.7,
    aimAssist: 0.4,
    paceAssist: 0.85,
    variation: 0.6,
    cpu: { error: 4, errorGrowth: 1.5, errorMax: 30, reactionMs: 110 },
  },
};

export const DEFAULT_RALLY_ASSIST: RallyAssistMode = 'natural';

/* ------------------------------------------------------------------ zones */

/** Closing speed (stage units / s) at which a fast exchange starts to earn extra forgiveness, and where that tops out. */
const FAST_FROM = 320;
const FAST_FULL = 800;
const FAST_BONUS = 0.1;
/** Each consecutive miss by a human widens the ring a little, up to three misses. */
const STREAK_BONUS = 0.04;
const STREAK_LIMIT = 3;

/**
 * The contact zones of one paddle right now. The core is always the true
 * touching distance. The forgiveness ring starts from the preset and grows,
 * within the preset's ceiling, for a fast exchange and after a run of misses;
 * the lead follows the paddle's own motion. Precision has neither.
 *
 * @param ballVx,ballVy the ball's velocity
 * @param missStreak    consecutive balls this (human) paddle has missed
 */
export function buildZones(
  config: RallyAssistConfig,
  paddleRadius: number,
  paddleVx: number,
  paddleVy: number,
  ballVx: number,
  ballVy: number,
  missStreak: number,
  out: ContactZones,
): ContactZones {
  const closingSpeed = Math.hypot(ballVx - paddleVx, ballVy - paddleVy);
  const core = paddleRadius + BALL_RADIUS;
  let multiplier = config.forgiveness;
  if (multiplier > 1) {
    multiplier += FAST_BONUS * smoothstep((closingSpeed - FAST_FROM) / (FAST_FULL - FAST_FROM));
    multiplier += STREAK_BONUS * Math.min(missStreak, STREAK_LIMIT);
    multiplier = Math.min(multiplier, config.forgivenessMax);
  }
  out.core = core;
  out.forgiveness = core * multiplier;
  const speed = Math.hypot(paddleVx, paddleVy);
  // The lead stands in for where the paddle is about to be, so it only applies while the paddle is
  // actually gaining on the ball along its own path: a ball flying away faster than the paddle is not caught up.
  const gaining = speed > 40 && (ballVx - paddleVx) * paddleVx + (ballVy - paddleVy) * paddleVy < 0;
  const lead = gaining ? Math.min(speed * config.leadTime, config.leadMax * paddleRadius, Math.max(0, core * config.reachMax - out.forgiveness)) : 0;
  out.leadX = lead > 0 ? (paddleVx / speed) * lead : 0;
  out.leadY = lead > 0 ? (paddleVy / speed) * lead : 0;
  return out;
}

/* ------------------------------------------------------------------ the stroke */

/**
 * How the paddle sends the ball, before any assistance.
 *
 * The paddle is a blade the puppet holds open toward the far side, and the
 * puppet angles it so that the ball leaves along the *stroke direction*. That
 * direction is what the performer controls:
 *
 *   stance   a gentle arc toward the far side (what a paddle held still does)
 *   contact  where the ball met the disc: on top sends it higher, in front
 *            flatter, behind the paddle sends it backward
 *   swing    the paddle's own velocity: forward flattens the shot, upward
 *            lifts it, and a swing away from the table really does send the
 *            ball away from the table
 *
 * Speed is the rebound of the incoming ball plus a share of the swing along
 * the stroke, softly limited so no shot leaves faster than a rally can follow.
 * The model knows nothing of the table or of the other puppet.
 */
const STANCE_ELEVATION = 52 * RAD;
const CONTACT_WEIGHT = 0.36;
const SWING_WEIGHT = 1.1;
/** Paddle speed at which the swing has its full say over direction. */
const SWING_FULL = 420;
const REBOUND = 0.4;
const BLOCK_SPEED = 185;
const BLOCK_RANGE: readonly [number, number] = [245, 315];
/** Share of the swing (along the stroke) that reaches the ball. */
const DRIVE = 0.55;
/** No stroke launches the ball faster than this (at full puppet size); the limit sets in softly over its last quarter. */
export const MAX_LAUNCH_SPEED = 430;
const LIMIT_KNEE = 0.75;
/** No stroke sends the ball off faster than this, however fast the hand. (In flight, gravity may add to it.) */
export const MAX_BALL_SPEED = 520;

/* ------------------------------------------------------------------ the safe target */

/** A good return lands this far across the far half of the table (0 = at the net, 1 = at its end). */
const TARGET_DEPTH = 0.55;
const TARGET_RANGE: readonly [number, number] = [0.3, 0.84];
/** Flight times tried for the safe return (seconds, at full puppet size): from a flat drive to a high lob. */
const FLIGHT_TIMES: readonly number[] = [0.44, 0.5, 0.56, 0.62, 0.69, 0.76, 0.84, 0.92, 1.0, 1.09, 1.18, 1.28, 1.39, 1.5, 1.62];
/** The ball's centre clears the top of the net by at least this much. */
const NET_CLEARANCE = 12;

/** Paddle speed (at full puppet size) below which a contact is a block, and from which it is a deliberate stroke. */
const INTENT_RANGE: readonly [number, number] = [40, 210];
/** Within this angle of the safe direction the stroke gets the full (capped) assist; beyond the second, none. */
const AGREE_FULL = Math.cos(25 * RAD);
const AGREE_NONE = Math.cos(80 * RAD);
/** The stroke's own direction must point at least this much toward the far side (as a share of its length) for the full assist; one pointing away gets none. */
const FORWARD_FULL = 0.25;

export interface StrokeInput {
  side: Side;
  layout: StageLayout;
  config: RallyAssistConfig;
  /** The ball at the moment of contact. */
  ballX: number;
  ballY: number;
  ballVx: number;
  ballVy: number;
  paddleVx: number;
  paddleVy: number;
  /** Unit vector from the paddle to the ball at contact. */
  nx: number;
  ny: number;
  /** Contact quality, 0..1. */
  quality: number;
  /** Where the other paddle is, when someone holds it. */
  opponentX: number | null;
  random: () => number;
}

export interface StrokeResult {
  /** The velocity the ball leaves with. */
  vx: number;
  vy: number;
  /** What the stroke alone would have done. */
  physicalVx: number;
  physicalVy: number;
  /** The return that would land on the safe target, when there is one. */
  assistedVx: number;
  assistedVy: number;
  assistedValid: boolean;
  /** How much of the assisted return's direction was blended in, 0..config.aimAssist. */
  weight: number;
  /** How far the speed was drawn toward the assisted return's, 0..config.paceAssist. */
  pace: number;
  /** 0..1: how hard the stroke was, for sound, effects and the follow-through. */
  power: number;
  targetX: number;
  targetY: number;
}

export const emptyStroke = (): StrokeResult => ({
  vx: 0,
  vy: 0,
  physicalVx: 0,
  physicalVy: 0,
  assistedVx: 0,
  assistedVy: 0,
  assistedValid: false,
  weight: 0,
  pace: 0,
  power: 0,
  targetX: 0,
  targetY: 0,
});

const launch = { vx: 0, vy: 0 };
const trial = { vx: 0, vy: 0 };

const stanceX = (forward: number) => forward * Math.cos(STANCE_ELEVATION);
const stanceY = -Math.sin(STANCE_ELEVATION);

/** Rebound speed of a ball met by a paddle held still. */
const blockSpeed = (incoming: number, scale: number) =>
  clamp(BLOCK_SPEED * scale + REBOUND * incoming, BLOCK_RANGE[0] * scale, BLOCK_RANGE[1] * scale);

/** Speeds pass unchanged up to three quarters of the limit, then ease into it. */
function limitSpeed(wanted: number, limit: number): number {
  const knee = limit * LIMIT_KNEE;
  return wanted <= knee ? wanted : knee + (limit - knee) * Math.tanh((wanted - knee) / (limit - knee));
}

/**
 * The inverse of the stroke, for a puppeteer that knows where it wants the
 * ball to go: the paddle velocity that makes a clean contact, met from
 * directly behind the ball, leave along (dirX, dirY) at `speed`. The stage
 * agent uses it to plan its swing; it then has to carry that swing out with
 * its arm like anyone else.
 */
export function planSwing(side: Side, dirX: number, dirY: number, speed: number, incoming: number, puppetScale: number, out: { vx: number; vy: number }) {
  const forward = side === 'left' ? 1 : -1;
  const scale = Math.sqrt(puppetScale / 0.8);
  // The swing must supply whatever speed the rebound alone does not.
  const along = clamp((speed - blockSpeed(incoming, scale)) / DRIVE, 50 * scale, SWING_FULL * scale);
  const sway = SWING_WEIGHT * Math.min(1, along / (SWING_FULL * scale));
  // stance + contact (the paddle is behind the ball, so the contact normal is the wanted direction) + sway·ŝ ∝ direction
  const ax = stanceX(forward) + CONTACT_WEIGHT * dirX;
  const ay = stanceY + CONTACT_WEIGHT * dirY;
  const dot = ax * dirX + ay * dirY;
  const discriminant = dot * dot - (ax * ax + ay * ay) + sway * sway;
  let sx = dirX;
  let sy = dirY;
  if (discriminant >= 0) {
    const reach = dot + Math.sqrt(discriminant);
    sx = (reach * dirX - ax) / sway;
    sy = (reach * dirY - ay) / sway;
  } else {
    // The swing is too gentle to turn the stroke all the way: lean it as far toward the wanted line as it goes.
    sx = dirX * dot - ax;
    sy = dirY * dot - ay;
    const norm = Math.hypot(sx, sy);
    if (norm > 1e-6) {
      sx /= norm;
      sy /= norm;
    } else {
      sx = dirX;
      sy = dirY;
    }
  }
  out.vx = sx * along;
  out.vy = sy * along;
  return out;
}

/** Time for a ball launched with horizontal speed `vx` to cover `distance`, drag included; Infinity if it never gets there. */
function timeToCover(distance: number, vx: number): number {
  const ratio = (AIR_DRAG * distance) / vx;
  return ratio > 0 && ratio < 1 ? -Math.log(1 - ratio) / AIR_DRAG : ratio === 0 ? 0 : Infinity;
}

/**
 * Resolves one paddle contact into the ball's new velocity.
 *
 *   final direction = normalize(lerp(physical direction, assisted direction, weight))
 *   final speed     = lerp(physical speed, assisted speed, pace)
 *
 * with `weight` never above the preset's `aimAssist` and `pace` never above
 * its `paceAssist`. The assisted return is the landing arc nearest the
 * stroke's own line. The weight is highest for a rescued or off-centre
 * contact, and for a paddle merely held in the ball's way (which aims at
 * nothing, so there is no aim to override); about half that for a clean,
 * deliberate stroke. Both are zero for a stroke aimed somewhere else
 * entirely: a ball hit backward goes backward, as hard as it was hit.
 */
export function resolveStroke(input: StrokeInput, out: StrokeResult): StrokeResult {
  const { side, layout, config, quality } = input;
  const forward = side === 'left' ? 1 : -1;
  // Distances shrink with the stage; speeds must shrink with their square root for the same arcs.
  const scale = Math.sqrt(layout.puppetScale / 0.8);

  /* ---- the stroke itself */
  const paddleSpeed = Math.hypot(input.paddleVx, input.paddleVy);
  const swing = paddleSpeed > 30 ? Math.min(1, paddleSpeed / (SWING_FULL * scale)) : 0;
  // Where the ball met the disc only means something if it met it: a rescued near-miss (quality below the rim's)
  // leans on the stance instead.
  const contact = CONTACT_WEIGHT * smoothstep((quality - 0.2) / 0.42);
  let dx = stanceX(forward) + contact * input.nx;
  let dy = stanceY + contact * input.ny;
  if (swing > 0) {
    dx += (SWING_WEIGHT * swing * input.paddleVx) / paddleSpeed;
    dy += (SWING_WEIGHT * swing * input.paddleVy) / paddleSpeed;
  }
  let length = Math.hypot(dx, dy);
  if (length < 1e-3) {
    dx = stanceX(forward);
    dy = stanceY;
    length = 1;
  }
  dx /= length;
  dy /= length;

  const incoming = Math.hypot(input.ballVx, input.ballVy);
  const block = blockSpeed(incoming, scale);
  const drive = Math.max(0, input.paddleVx * dx + input.paddleVy * dy) * DRIVE;
  // An off-centre or rescued contact transfers a little less.
  const wanted = (block + drive) * lerp(0.86, 1, quality);
  const limit = MAX_LAUNCH_SPEED * scale;
  const physicalSpeed = limitSpeed(wanted, limit);
  out.physicalVx = dx * physicalSpeed;
  out.physicalVy = dy * physicalSpeed;
  out.power = clamp((physicalSpeed - BLOCK_RANGE[0] * scale) / (limit - BLOCK_RANGE[0] * scale), 0, 1);

  /* ---- the safe target: somewhere on the far half of the table, a little different every time */
  const { table, centerX } = layout;
  const half = table.right - centerX;
  let depth = TARGET_DEPTH + 0.2 * (out.power - 0.4) + config.variation * 0.16 * (input.random() * 2 - 1);
  // An opponent standing well back is given a deeper ball, one at the table a shorter one.
  if (input.opponentX !== null) depth += clamp((Math.abs(input.opponentX - centerX) - half * 1.5) / (half * 4), -0.08, 0.1);
  depth = clamp(depth, TARGET_RANGE[0], TARGET_RANGE[1]);
  const targetX = centerX + forward * depth * half;
  const targetY = table.top - BALL_RADIUS;
  out.targetX = targetX;
  out.targetY = targetY;

  // Many arcs land there, from a flat drive to a high lob. The safe return is the one nearest the line the
  // stroke already has, so a lob stays a lob and a drive stays a drive, and what assistance adds is hard to see.
  let valid = false;
  let nearest = -Infinity;
  launch.vx = 0;
  launch.vy = 0;
  const onOwnSide = (input.ballX - centerX) * forward < 0;
  for (const seconds of FLIGHT_TIMES) {
    const time = seconds * scale;
    launchVelocity(input.ballX, input.ballY, targetX, targetY, time, trial);
    const speed = Math.hypot(trial.vx, trial.vy);
    if (speed < 1 || speed > MAX_LAUNCH_SPEED * 1.12 * scale) continue;
    if (onOwnSide) {
      // It has to clear the net on the way.
      const atNet = timeToCover(centerX - input.ballX, trial.vx);
      if (!(atNet < time) || heightAfter(input.ballY, trial.vy, atNet) >= table.netTop - BALL_RADIUS - NET_CLEARANCE) continue;
    }
    const match = (trial.vx * dx + trial.vy * dy) / speed;
    if (match > nearest) {
      nearest = match;
      launch.vx = trial.vx;
      launch.vy = trial.vy;
      valid = true;
    }
  }
  out.assistedValid = valid;
  out.assistedVx = launch.vx;
  out.assistedVy = launch.vy;

  /* ---- blend, within the ceiling */
  let weight = 0;
  let pace = 0;
  const assistedSpeed = Math.hypot(launch.vx, launch.vy);
  const ax = assistedSpeed > 1 ? launch.vx / assistedSpeed : 0;
  const ay = assistedSpeed > 1 ? launch.vy / assistedSpeed : 0;
  if (valid && assistedSpeed > 1 && (config.aimAssist > 0 || config.paceAssist > 0)) {
    // A stroke with nothing forward in it is not a return at all, whatever arc lies nearest: it is left alone.
    const agreement = smoothstep((dx * ax + dy * ay - AGREE_NONE) / (AGREE_FULL - AGREE_NONE)) * smoothstep((dx * forward) / FORWARD_FULL);
    // What the performer left to the stage: everything for a paddle held still, half for a clean swing.
    const intent = smoothstep((paddleSpeed / scale - INTENT_RANGE[0]) / (INTENT_RANGE[1] - INTENT_RANGE[0]));
    weight = config.aimAssist * lerp(0.5, 1, Math.max(1 - quality, 1 - intent)) * agreement;
    pace = config.paceAssist * agreement;
  }
  if (weight > 0 || pace > 0) {
    let fx = lerp(dx, ax, weight);
    let fy = lerp(dy, ay, weight);
    const norm = Math.hypot(fx, fy) || 1;
    fx /= norm;
    fy /= norm;
    const speed = lerp(physicalSpeed, assistedSpeed, pace);
    out.vx = fx * speed;
    out.vy = fy * speed;
  } else {
    out.vx = out.physicalVx;
    out.vy = out.physicalVy;
  }
  out.weight = weight;
  out.pace = pace;
  return out;
}
