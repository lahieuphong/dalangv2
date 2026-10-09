import { SIDES, type Point, type Side } from '../types';
import { clamp, lerp, mulberry32 } from '../utils/math';
import { BALL_RADIUS, emptySample, fly, GRAVITY, PHYSICS_STEP, predictFlight, stepBall, type BallBody, type BallContact, type BallSample } from './BallPhysics';
import { contactQuality, emptyContact, sweepContact, type ContactKind, type ContactZones } from './RacketCollision';
import {
  buildZones,
  DEFAULT_RALLY_ASSIST,
  emptyStroke,
  MAX_BALL_SPEED,
  RALLY_ASSIST,
  resolveStroke,
  type RallyAssistConfig,
  type RallyAssistMode,
  type StrokeInput,
} from './RallyAssist';
import type { StageLayout } from './StageProps';

export { BALL_RADIUS } from './BallPhysics';
export type { BallSample } from './BallPhysics';

/**
 * Everything on the stage that is not a puppet: the flies, the ball, the
 * table as a collider, and the two little games they make.
 *
 *   hunt   flies drift about the stage; a swing of the paddle knocks one down
 *   rally  a ball is served over the table and the paddles keep it in play
 *
 * The scene never moves a puppet. It only reads where the paddles are and how
 * fast they travel, so direct control is never taken away from the hand.
 *
 * The ball is simulated in fixed steps (BallPhysics), tested against each
 * paddle along both their motions (RacketCollision), and sent on its way by
 * the stroke model with a capped amount of aim assistance (RallyAssist).
 */

export type SceneMode = 'hunt' | 'rally';

export type FlyState = 'roam' | 'stunned' | 'down' | 'carry' | 'perch' | 'held';

export interface Fly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: FlyState;
  /** When the current state began (ms). */
  stateAt: number;
  targetX: number;
  targetY: number;
  retargetAt: number;
  /** Body tilt in radians, and wing-beat phase, for drawing. */
  angle: number;
  wing: number;
  /** Which string (0..4) the fly carries for the agent, or which perch it sits on. */
  slot: number;
  holder: Side | null;
}

export type BallState = 'none' | 'held' | 'live' | 'dead';

export interface Ball {
  state: BallState;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  holder: Side | null;
  lastHitter: Side | null;
  /** Table bounces on each side since the last hit. */
  bounces: Record<Side, number>;
  /** When the ball last changed state (ms). */
  stateAt: number;
  /**
   * Where to draw it: the physics state carried forward over the fraction of
   * a step the display is ahead of the simulation, so it glides at any frame rate.
   */
  renderX: number;
  renderY: number;
  /** Recent positions, newest first, for the streak behind the ball. */
  trail: Point[];
}

/** What the scene needs to know about one paddle. */
export interface PaddleInput {
  /** A hand or the agent is driving this puppet. */
  active: boolean;
  /** A human hand (not the agent) is driving it. */
  human: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** The pinch is closed. */
  grabbing: boolean;
  justGrabbed: boolean;
  justReleased: boolean;
}

export const emptyPaddle = (): PaddleInput => ({
  active: false,
  human: false,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  radius: 20,
  grabbing: false,
  justGrabbed: false,
  justReleased: false,
});

export type CueKind = 'hit' | 'bounce' | 'swat' | 'serve' | 'miss' | 'grab';

export interface SceneCue {
  kind: CueKind;
  /** -1 (stage left) … 1 (stage right). */
  pan: number;
  /** 0..1 */
  strength: number;
}

/** A contact that just happened, for the little burst drawn where it did. */
export interface Impact {
  x: number;
  y: number;
  /** When it happened (ms). */
  at: number;
  kind: CueKind;
  strength: number;
}

export interface SceneEvent {
  /** Seconds since the scene started. */
  at: number;
  text: string;
}

/** One valid paddle contact. */
export interface RallyContact {
  side: Side;
  /** CORE: the discs really touched. ASSIST: a near pass rescued by the forgiveness ring. */
  kind: ContactKind;
  /** 0..1 */
  quality: number;
  /** Aim-assist weight that was applied, 0..the preset's ceiling, and how far the pace was drawn toward a landing one. */
  weight: number;
  pace: number;
  /** 0..1: how hard the stroke was. */
  power: number;
  /** Speed the ball left with, stage units / s. */
  speed: number;
  x: number;
  y: number;
  /** When it happened (ms). */
  at: number;
  human: boolean;
}

/** Counters of the ball game. Every number is counted from a real event; none is estimated. */
export interface RallyStats {
  /** Rallies that ended after at least one valid paddle contact. */
  rallies: number;
  longest: number;
  /** Mean paddle contacts per finished rally. */
  averageLength: number;
  coreContacts: number;
  assistedContacts: number;
  /** Balls that came within reach of an active paddle whose turn it was. */
  attempts: number;
  /** Attempts that ended without a contact. */
  misses: number;
  averageQuality: number;
  /** Time the ball last spent in the air between two contacts, and the mean, ms. */
  travelMs: number;
  averageTravelMs: number;
  /** Re-contacts of the same stroke that were refused (each stroke counts once). */
  blockedDoubleHits: number;
}

export const emptyRallyStats = (): RallyStats => ({
  rallies: 0,
  longest: 0,
  averageLength: 0,
  coreContacts: 0,
  assistedContacts: 0,
  attempts: 0,
  misses: 0,
  averageQuality: 0,
  travelMs: 0,
  averageTravelMs: 0,
  blockedDoubleHits: 0,
});

/** The ball's predicted flight, from the same steps the live ball will take. */
export interface Forecast {
  valid: boolean;
  /** Seconds since the forecast was made; a sample's time minus this is how far ahead it lies. */
  age: number;
  count: number;
  samples: BallSample[];
}

/** What a puppet is doing in the rally, for the pose extras and the debug view. */
export type RallyPhase = 'READY' | 'ANTICIPATE' | 'SWING' | 'CONTACT' | 'FOLLOW' | 'RECOVER';

/** Where the ball will come nearest a paddle that stays where it is. */
export interface Arrival {
  valid: boolean;
  x: number;
  y: number;
  /** Seconds from now. */
  t: number;
}

const FLY_COUNT = 7;
/** Flies that carry the agent's strings: one per finger. */
export const CARRIERS = 5;
const FLY_RADIUS = 8;
const FLY_MAX_SPEED = 250;
/** A paddle must be moving at least this fast (stage units / s) to swat. */
const SWAT_SPEED = 105;
const STUN_MS = 2400;
/** Swats that end the hunt and bring out the ball. */
const SWATS_TO_RALLY = 5;

/** The most physics steps one frame may run (a stalled tab must not replay seconds of flight at once). */
const MAX_STEPS_PER_FRAME = 36;
/**
 * A stroke owns the ball. The same paddle is never credited again within this
 * long, whatever happens in between, and after that only once the ball has
 * come back off the table, the net or a wall, or the other paddle has played
 * it. The other paddle is never held back by it.
 */
const LOCK_MS = 220;
/**
 * Without such a rebound the paddle must wait this long, and the ball must
 * have left its zones. A hand swings faster than a ball may fly, so the paddle
 * often overtakes its own shot during the follow-through; the ball has to be
 * able to pass it then. A ball popped straight up can still be played again
 * on its way down.
 */
const FOLLOW_THROUGH_MS = 650;
/**
 * A near-miss is not rescued while the paddle is being drawn back: moving
 * away from the ball faster than this (stage units / s) and away from the net.
 * That is a backswing or a retreat, not a stroke, and a ball that slips past
 * it is simply missed. A forward swing that arrives a little early still is one.
 */
const RETREAT_LIMIT = 100;
/** A ball within this many touching distances of a paddle whose turn it is counts as an attempt. */
const ATTENTION = 2.4;
const FORECAST_SECONDS = 1.6;
const FORECAST_SPACING = 1 / 60;
const FORECAST_SAMPLES = 97;
const GRAB_RADIUS = 52;
const SERVE_DELAY_MS = 1500;
/** Serves that nobody returns before the scene goes back to the hunt. */
const IDLE_SERVES = 3;
const MAX_EVENTS = 5;
const MAX_IMPACTS = 8;
const TRAIL_LENGTH = 9;

const sideOf = (x: number, layout: StageLayout): Side => (x < layout.centerX ? 'left' : 'right');
const panOf = (x: number, layout: StageLayout) => clamp((x / layout.width) * 2 - 1, -1, 1);

export class SceneController {
  mode: SceneMode = 'hunt';
  readonly flies: Fly[] = [];
  readonly ball: Ball = {
    state: 'none',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    holder: null,
    lastHitter: null,
    bounces: { left: 0, right: 0 },
    stateAt: 0,
    renderX: 0,
    renderY: 0,
    trail: [],
  };
  /** The newest events, oldest first. */
  readonly events: SceneEvent[] = [];
  /** Sounds to play for this frame; drained by the caller. */
  readonly cues: SceneCue[] = [];
  /** Recent contacts, oldest first. */
  readonly impacts: Impact[] = [];
  /** Flies knocked down since the hunt began. */
  swats = 0;
  /** Paddle hits in the current rally. */
  rallyHits = 0;
  /** Length of the current (or last) rally, seconds. */
  rallySeconds = 0;
  bestRally = 0;
  /** Per puppet: its pinch holds a prop / a fly is within reach. */
  readonly holding: Record<Side, boolean> = { left: false, right: false };
  readonly nearFly: Record<Side, boolean> = { left: false, right: false };

  /** The rally-assistance preset in force. Changing it touches nothing else: no ball, puppet or count is reset. */
  assist: RallyAssistConfig = RALLY_ASSIST[DEFAULT_RALLY_ASSIST];
  readonly stats: RallyStats = emptyRallyStats();
  /** Valid contacts made by the latest update (almost always none, sometimes one). */
  readonly contacts: RallyContact[] = [];
  /** The most recent valid contact, and how each paddle's latest attempt ended. */
  lastContact: RallyContact | null = null;
  readonly lastOutcome: Record<Side, ContactKind | 'MISS' | null> = { left: null, right: null };
  /** Each paddle's contact zones as of this frame (for the debug view). */
  readonly zones: Record<Side, ContactZones> = {
    left: { core: 0, forgiveness: 0, leadX: 0, leadY: 0 },
    right: { core: 0, forgiveness: 0, leadX: 0, leadY: 0 },
  };
  readonly forecast: Forecast = { valid: false, age: 0, count: 0, samples: Array.from({ length: FORECAST_SAMPLES }, emptySample) };
  readonly arrival: Record<Side, Arrival> = { left: { valid: false, x: 0, y: 0, t: 0 }, right: { valid: false, x: 0, y: 0, t: 0 } };
  readonly phase: Record<Side, RallyPhase> = { left: 'READY', right: 'READY' };

  private readonly random = mulberry32(7731);
  private readonly hitAt: Record<Side, number> = { left: -Infinity, right: -Infinity };
  private readonly missAt: Record<Side, number> = { left: -Infinity, right: -Infinity };
  /** Where each paddle was at the simulation's own time (which trails the display by under one step). */
  private readonly paddleAt: Record<Side, { x: number; y: number; valid: boolean }> = {
    left: { x: 0, y: 0, valid: false },
    right: { x: 0, y: 0, valid: false },
  };
  private readonly lock: Record<Side, { active: boolean; at: number; counted: boolean; rebounded: boolean; holdMs: number }> = {
    left: { active: false, at: 0, counted: false, rebounded: false, holdMs: LOCK_MS },
    right: { active: false, at: 0, counted: false, rebounded: false, holdMs: LOCK_MS },
  };
  private readonly approached: Record<Side, boolean> = { left: false, right: false };
  private readonly attempt: Record<Side, boolean> = { left: false, right: false };
  /** This side has already let the ball in play go by: one ball, one miss, however often it comes back within reach. */
  private readonly passed: Record<Side, boolean> = { left: false, right: false };
  private readonly missStreak: Record<Side, number> = { left: 0, right: 0 };
  private readonly swept = emptyContact();
  private readonly next: BallBody = { x: 0, y: 0, vx: 0, vy: 0 };
  private readonly stroke = emptyStroke();
  private readonly strokeInput: StrokeInput;
  /** Simulation time not yet stepped, seconds (always under one step after an update). */
  private debt = 0;
  private forecastAt = 0;
  private physicsTime = 0;
  private totalHits = 0;
  private qualitySum = 0;
  private travelSum = 0;
  private travelCount = 0;
  private lastContactAt = 0;
  private startedAt: number | null = null;
  private serveAt = Infinity;
  private nextReceiver: Side = 'left';
  private idleServes = 0;
  private humanHits = 0;
  private rallyStartedAt = 0;
  private lastHumanAt = 0;
  private clock = 0;

  constructor(layout: StageLayout) {
    this.strokeInput = {
      side: 'left',
      layout,
      config: this.assist,
      ballX: 0,
      ballY: 0,
      ballVx: 0,
      ballVy: 0,
      paddleVx: 0,
      paddleVy: 0,
      nx: 0,
      ny: -1,
      quality: 1,
      opponentX: null,
      random: this.random,
    };
    for (let i = 0; i < FLY_COUNT; i++) {
      this.flies.push({
        x: lerp(0.2, 0.8, this.random()) * layout.width,
        y: lerp(60, layout.groundY - 220, this.random()),
        vx: 0,
        vy: 0,
        state: 'roam',
        stateAt: 0,
        targetX: layout.centerX,
        targetY: 200,
        retargetAt: 0,
        angle: 0,
        wing: this.random() * 6,
        slot: i,
        holder: null,
      });
    }
  }

  /** Whether the ball is in play. */
  get rallyLive() {
    return this.ball.state === 'live';
  }

  /** The stroke most recently resolved: what the paddle alone did, what the safe return would have been, and the blend. */
  get lastStroke() {
    return this.stroke;
  }

  /** Switches the rally-assistance preset. Safe at any moment of play. */
  setAssist(mode: RallyAssistMode) {
    this.assist = RALLY_ASSIST[mode];
  }

  /** Puts a live ball into play with a given position and velocity (serves, tests, benchmarks). */
  launchBall(x: number, y: number, vx: number, vy: number, now: number, hitter: Side | null = null) {
    const ball = this.ball;
    ball.state = 'live';
    ball.holder = null;
    ball.stateAt = now;
    ball.x = ball.renderX = x;
    ball.y = ball.renderY = y;
    ball.vx = vx;
    ball.vy = vy;
    ball.lastHitter = hitter;
    ball.bounces.left = 0;
    ball.bounces.right = 0;
    ball.trail.length = 0;
    this.debt = 0;
    this.forecast.valid = false;
    for (const side of SIDES) {
      this.lock[side].active = hitter === side;
      this.lock[side].at = now;
      this.lock[side].counted = false;
      this.lock[side].rebounded = false;
      // A ball let go of is a toss, not a stroke: the hand that tossed it may strike it as soon as it is clear.
      this.lock[side].holdMs = LOCK_MS;
      this.approached[side] = false;
      this.attempt[side] = false;
      this.passed[side] = false;
    }
  }

  setMode(mode: SceneMode, now: number) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'rally') {
      this.idleServes = 0;
      this.serveAt = now + SERVE_DELAY_MS;
      this.log(now, 'rally · first serve');
    } else {
      this.ball.state = 'none';
      this.ball.holder = null;
      this.serveAt = Infinity;
      this.swats = 0;
      this.log(now, 'back to fly hunt');
    }
  }

  /**
   * Advances the scene by one frame.
   *
   * @param agentSide    the puppet the stage agent is flying, if any
   * @param carryPoints  where the agent's five string-carrying flies should hover
   */
  update(
    now: number,
    dt: number,
    layout: StageLayout,
    paddles: Record<Side, PaddleInput>,
    agentSide: Side | null,
    carryPoints: readonly Point[] | null,
  ) {
    this.startedAt ??= now;
    this.clock = now;
    this.contacts.length = 0;
    const anyHuman = paddles.left.human || paddles.right.human;
    if (anyHuman) this.lastHumanAt = now;
    // With nobody at the stage the rally winds down by itself.
    if (this.mode === 'rally' && !anyHuman && now - this.lastHumanAt > 6000) this.setMode('hunt', now);

    this.updateGrabs(now, layout, paddles);
    this.updateBall(now, dt, layout, paddles);
    this.updateFlies(now, dt, layout, paddles, agentSide, carryPoints);
  }

  /**
   * Predicts the ball's flight from now on, one sample every `step` seconds.
   * It runs the same fixed steps the live ball will take, so (until a paddle
   * touches the ball) the prediction and the flight are the same thing.
   */
  predict(layout: StageLayout, seconds: number, step: number, out: BallSample[]): number {
    if (this.ball.state !== 'live') return 0;
    return predictFlight(this.ball, layout, seconds, step, out);
  }

  /* ---------------------------------------------------------------- grabbing */

  private updateGrabs(now: number, layout: StageLayout, paddles: Record<Side, PaddleInput>) {
    const ball = this.ball;
    for (const side of SIDES) {
      const paddle = paddles[side];
      const heldFly = this.flies.find((fly) => fly.state === 'held' && fly.holder === side);
      const holdsBall = ball.state === 'held' && ball.holder === side;

      if (paddle.human && paddle.justGrabbed && !heldFly && !holdsBall) {
        const reach = GRAB_RADIUS * (paddle.radius / 20);
        if (ball.state !== 'held' && ball.state !== 'none' && Math.hypot(ball.x - paddle.x, ball.y - paddle.y) < reach) {
          this.holdBall(side, now);
        } else {
          const fly = this.nearestFly(paddle.x, paddle.y, reach);
          if (fly) {
            fly.state = 'held';
            fly.holder = side;
            fly.stateAt = now;
            this.log(now, 'fly caught');
            this.cue('grab', paddle.x, paddle.y, layout, 0.5);
          } else if (this.mode === 'rally' && ball.state !== 'live') {
            // An empty-handed pinch during a rally picks up a fresh ball to serve.
            this.holdBall(side, now);
          }
        }
      }

      const letGo = paddle.justReleased || !paddle.active || !paddle.grabbing;
      if (letGo && holdsBall) {
        const dir = side === 'left' ? 1 : -1;
        const limit = MAX_BALL_SPEED;
        this.launchBall(ball.x, ball.y, clamp(paddle.vx * 0.9 + dir * 90, -limit, limit), clamp(paddle.vy * 0.9 - 230, -limit, limit), now, side);
        this.beginRally(now, true);
        this.log(now, 'player serve');
        this.cue('serve', paddle.x, paddle.y, layout, 0.6);
        if (this.mode !== 'rally') {
          this.mode = 'rally';
          this.idleServes = 0;
        }
      }
      if (letGo && heldFly) {
        heldFly.state = 'roam';
        heldFly.holder = null;
        heldFly.stateAt = now;
        heldFly.vx = paddle.vx * 0.6;
        heldFly.vy = paddle.vy * 0.6 - 60;
        heldFly.retargetAt = 0;
        this.log(now, 'fly released');
      }
      this.holding[side] = (ball.state === 'held' && ball.holder === side) || this.flies.some((fly) => fly.state === 'held' && fly.holder === side);
    }
  }

  private holdBall(side: Side, now: number) {
    const ball = this.ball;
    ball.state = 'held';
    ball.holder = side;
    ball.stateAt = now;
    ball.vx = 0;
    ball.vy = 0;
    ball.trail.length = 0;
    this.serveAt = Infinity;
    this.log(now, 'paddle armed');
  }

  private nearestFly(x: number, y: number, reach: number): Fly | null {
    let best: Fly | null = null;
    let bestDistance = reach;
    for (const fly of this.flies) {
      if (fly.state !== 'roam' && fly.state !== 'perch' && fly.state !== 'down') continue;
      const d = Math.hypot(fly.x - x, fly.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = fly;
      }
    }
    return best;
  }

  /* ---------------------------------------------------------------- ball */

  private beginRally(now: number, humanHit: boolean) {
    this.rallyStartedAt = now;
    this.rallyHits = humanHit ? 1 : 0;
    this.rallySeconds = 0;
    this.humanHits = humanHit ? 1 : 0;
    this.lastContactAt = humanHit ? now : 0;
  }

  private serve(now: number, layout: StageLayout, paddles: Record<Side, PaddleInput>) {
    const humans = SIDES.filter((side) => paddles[side].human);
    if (humans.length === 0) {
      this.serveAt = now + SERVE_DELAY_MS;
      return;
    }
    // Serve to a human; with two of them, take turns.
    const receiver = humans.length === 1 ? humans[0] : this.nextReceiver;
    this.nextReceiver = receiver === 'left' ? 'right' : 'left';
    const dir = receiver === 'right' ? 1 : -1;
    this.launchBall(layout.centerX - dir * 34, Math.max(40, layout.table.top - 250), dir * 88, 0, now);
    this.serveAt = Infinity;
    this.beginRally(now, false);
    this.log(now, 'serve');
    this.cue('serve', this.ball.x, this.ball.y, layout, 0.4);
  }

  private endRally(now: number, layout: StageLayout, reason: string) {
    const ball = this.ball;
    ball.state = 'dead';
    ball.stateAt = now;
    this.bestRally = Math.max(this.bestRally, this.rallyHits);
    // A rally only counts once a paddle has really met the ball.
    if (this.rallyHits > 0) {
      const stats = this.stats;
      stats.rallies += 1;
      this.totalHits += this.rallyHits;
      stats.longest = Math.max(stats.longest, this.rallyHits);
      stats.averageLength = this.totalHits / stats.rallies;
    }
    // Whoever still had the ball within reach has missed it.
    for (const side of SIDES) this.closeAttempt(side, now);
    this.log(now, reason);
    this.cue('miss', ball.x, ball.y, layout, 0.5);
    this.idleServes = this.humanHits === 0 ? this.idleServes + 1 : 0;
    if (this.idleServes >= IDLE_SERVES) {
      this.setMode('hunt', now);
      return;
    }
    this.log(now, 'rally ended / next serve');
    this.serveAt = now + SERVE_DELAY_MS;
  }

  private updateBall(now: number, dt: number, layout: StageLayout, paddles: Record<Side, PaddleInput>) {
    const ball = this.ball;
    if (this.mode === 'rally' && ball.state !== 'live' && ball.state !== 'held' && now >= this.serveAt) this.serve(now, layout, paddles);

    if (ball.state !== 'live') {
      this.forecast.valid = false;
      this.rememberPaddles(paddles, 1);
      for (const side of SIDES) {
        const paddle = paddles[side];
        this.arrival[side].valid = false;
        this.phase[side] = this.phaseOf(side, paddle, now);
        // Kept current while no ball is in play, so the debug view always shows the zones a ball would meet.
        if (paddle.active) buildZones(this.assist, paddle.radius, paddle.vx, paddle.vy, 0, 0, paddle.human ? this.missStreak[side] : 0, this.zones[side]);
      }
      if (ball.state === 'held' && ball.holder) {
        const paddle = paddles[ball.holder];
        ball.x = ball.renderX = paddle.x;
        ball.y = ball.renderY = paddle.y - paddle.radius * 0.15;
      } else if (ball.state === 'dead') {
        // Roll to a stop where it fell.
        ball.vx *= Math.exp(-4 * dt);
        ball.x = ball.renderX = clamp(ball.x + ball.vx * dt, BALL_RADIUS, layout.width - BALL_RADIUS);
        ball.renderY = ball.y;
        ball.angle += (ball.vx * dt) / BALL_RADIUS;
      }
      return;
    }

    this.rallySeconds = (now - this.rallyStartedAt) / 1000;

    // Fixed steps from an accumulator: the same states at any frame rate.
    const total = this.debt + dt;
    const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(total / PHYSICS_STEP + 1e-9));
    for (const side of SIDES) {
      const memory = this.paddleAt[side];
      const paddle = paddles[side];
      // A paddle that just appeared (or jumped) has no motion to sweep.
      if (!memory.valid || Math.hypot(paddle.x - memory.x, paddle.y - memory.y) > 420) {
        memory.x = paddle.x;
        memory.y = paddle.y;
        memory.valid = true;
      }
    }
    let done = 0;
    for (; done < steps && ball.state === 'live'; done++) {
      this.step(now, layout, paddles, (done * PHYSICS_STEP) / total, ((done + 1) * PHYSICS_STEP) / total);
      this.physicsTime += PHYSICS_STEP;
    }
    // After a long stall the surplus is dropped rather than replayed.
    this.debt = steps === MAX_STEPS_PER_FRAME ? 0 : total - steps * PHYSICS_STEP;
    this.rememberPaddles(paddles, steps > 0 ? (steps * PHYSICS_STEP) / total : 0);

    if (ball.state === 'live') {
      ball.renderX = ball.x + ball.vx * this.debt;
      ball.renderY = ball.y + ball.vy * this.debt;
      ball.angle += (ball.vx * dt) / 40;
      ball.trail.unshift({ x: ball.renderX, y: ball.renderY });
      if (ball.trail.length > TRAIL_LENGTH) ball.trail.length = TRAIL_LENGTH;
      this.refreshForecast(layout);
    } else {
      ball.renderX = ball.x;
      ball.renderY = ball.y;
      this.forecast.valid = false;
    }
    for (const side of SIDES) {
      this.trackAttempt(side, paddles[side], now, layout);
      this.phase[side] = this.phaseOf(side, paddles[side], now);
    }
  }

  /** Moves each paddle's remembered position along its motion to the simulation's new time. */
  private rememberPaddles(paddles: Record<Side, PaddleInput>, fraction: number) {
    for (const side of SIDES) {
      const memory = this.paddleAt[side];
      const paddle = paddles[side];
      if (!paddle.active) {
        memory.valid = false;
        continue;
      }
      if (!memory.valid) {
        memory.x = paddle.x;
        memory.y = paddle.y;
        memory.valid = true;
      } else {
        memory.x += (paddle.x - memory.x) * fraction;
        memory.y += (paddle.y - memory.y) * fraction;
      }
    }
  }

  /**
   * One fixed step. The ball's flight for the step is worked out first; each
   * paddle is then swept along its own motion over the same step against it.
   * On contact the ball flies only up to the contact, is given its new
   * velocity there, and then flies the rest of the step.
   */
  private step(now: number, layout: StageLayout, paddles: Record<Side, PaddleInput>, from: number, to: number) {
    const ball = this.ball;
    const next = this.next;
    next.x = ball.x;
    next.y = ball.y;
    next.vx = ball.vx;
    next.vy = ball.vy;
    let world = stepBall(next, PHYSICS_STEP, layout);

    for (const side of SIDES) {
      const paddle = paddles[side];
      const memory = this.paddleAt[side];
      if (!paddle.active || !memory.valid) continue;
      const px0 = memory.x + (paddle.x - memory.x) * from;
      const py0 = memory.y + (paddle.y - memory.y) * from;
      const px1 = memory.x + (paddle.x - memory.x) * to;
      const py1 = memory.y + (paddle.y - memory.y) * to;
      const zones = buildZones(this.assist, paddle.radius, paddle.vx, paddle.vy, ball.vx, ball.vy, paddle.human ? this.missStreak[side] : 0, this.zones[side]);

      // A stroke owns the ball until it has left the paddle's zones: one contact, one hit, however the paddle follows through.
      const lock = this.lock[side];
      if (lock.active) {
        const gone = Math.hypot(next.x - px1, next.y - py1) > zones.forgiveness + Math.hypot(zones.leadX, zones.leadY) + 3;
        const waited = now - lock.at;
        const newBall = lock.rebounded || ball.lastHitter !== side;
        if (newBall ? waited >= LOCK_MS : gone && waited >= lock.holdMs) lock.active = false;
      }

      const hit = sweepContact(ball.x, ball.y, next.x, next.y, px0, py0, px1, py1, zones, this.approached[side], this.swept);
      this.approached[side] = this.swept.closing;
      if (!hit) continue;
      const drawnBack = paddle.vx * hit.nx + paddle.vy * hit.ny < -RETREAT_LIMIT && paddle.vx * (side === 'left' ? 1 : -1) < 0;
      if (hit.kind === 'ASSIST' && drawnBack) continue;
      if (lock.active) {
        if (!lock.counted && hit.kind === 'CORE') {
          lock.counted = true;
          this.stats.blockedDoubleHits += 1;
        }
        continue;
      }

      // Fly to the moment of contact, strike, and fly the remainder of the step.
      fly(ball, hit.time * PHYSICS_STEP);
      this.strike(side, paddle, paddles[side === 'left' ? 'right' : 'left'], zones, now, layout);
      next.x = ball.x;
      next.y = ball.y;
      next.vx = ball.vx;
      next.vy = ball.vy;
      world = stepBall(next, (1 - hit.time) * PHYSICS_STEP, layout);
      break;
    }

    ball.x = next.x;
    ball.y = next.y;
    ball.vx = next.vx;
    ball.vy = next.vy;
    this.afterWorldContact(world, now, layout);
  }

  private afterWorldContact(contact: BallContact, now: number, layout: StageLayout) {
    const ball = this.ball;
    // Once the ball has come back off the table, the net or a wall, it is a new ball for whoever reaches it.
    if (contact !== 'none') this.lock.left.rebounded = this.lock.right.rebounded = true;
    if (contact === 'table') {
      const side = sideOf(ball.x, layout);
      ball.bounces[side] += 1;
      this.cue('bounce', ball.x, ball.y, layout, clamp(Math.abs(ball.vy) / 500, 0.2, 1));
      if (ball.bounces[side] >= 2) this.endRally(now, layout, 'return missed');
      else this.log(now, 'table contact');
    } else if (contact === 'ground') {
      ball.vx *= 0.5;
      this.endRally(now, layout, 'return missed');
    } else if (contact === 'net') {
      this.log(now, 'net');
    }
  }

  /** A valid contact: resolve the stroke, hand the ball its new velocity, and count it, once. */
  private strike(side: Side, paddle: PaddleInput, opponent: PaddleInput, zones: ContactZones, now: number, layout: StageLayout) {
    const ball = this.ball;
    const hit = this.swept;
    const quality = contactQuality(hit, zones);
    const input = this.strokeInput;
    input.side = side;
    input.layout = layout;
    input.config = this.assist;
    input.ballX = ball.x;
    input.ballY = ball.y;
    input.ballVx = ball.vx;
    input.ballVy = ball.vy;
    input.paddleVx = paddle.vx;
    input.paddleVy = paddle.vy;
    input.nx = hit.nx;
    input.ny = hit.ny;
    input.quality = quality;
    input.opponentX = opponent.active ? opponent.x : null;
    const stroke = resolveStroke(input, this.stroke);

    let speed = Math.hypot(stroke.vx, stroke.vy);
    const limit = MAX_BALL_SPEED * Math.sqrt(layout.puppetScale / 0.8);
    const scale = speed > limit ? limit / speed : 1;
    ball.vx = stroke.vx * scale;
    ball.vy = stroke.vy * scale;
    speed *= scale;
    ball.lastHitter = side;
    ball.bounces.left = 0;
    ball.bounces.right = 0;

    const lock = this.lock[side];
    lock.active = true;
    lock.at = now;
    lock.counted = false;
    lock.rebounded = false;
    lock.holdMs = FOLLOW_THROUGH_MS;
    this.approached.left = false;
    this.approached.right = false;
    this.forecast.valid = false;
    this.hitAt[side] = now;
    this.attempt[side] = false;
    this.passed.left = false;
    this.passed.right = false;
    this.missStreak[side] = 0;
    this.lastOutcome[side] = hit.kind;

    const stats = this.stats;
    stats.attempts += 1;
    if (hit.kind === 'CORE') stats.coreContacts += 1;
    else stats.assistedContacts += 1;
    this.qualitySum += quality;
    stats.averageQuality = this.qualitySum / (stats.coreContacts + stats.assistedContacts);
    if (this.lastContactAt > 0) {
      stats.travelMs = now - this.lastContactAt;
      this.travelSum += stats.travelMs;
      this.travelCount += 1;
      stats.averageTravelMs = this.travelSum / this.travelCount;
    }
    this.lastContactAt = now;
    this.rallyHits += 1;
    if (paddle.human) this.humanHits += 1;

    const contact: RallyContact = { side, kind: hit.kind, quality, weight: stroke.weight, pace: stroke.pace, power: stroke.power, speed, x: ball.x, y: ball.y, at: now, human: paddle.human };
    this.contacts.push(contact);
    this.lastContact = contact;
    this.log(now, `${paddle.human ? 'player' : 'CPU'} return accepted`);
    this.cue('hit', ball.x, ball.y, layout, clamp(0.3 + 0.7 * stroke.power, 0.3, 1));
  }

  /** The ball's flight is only re-predicted when something has changed it, or the forecast is running out. */
  private refreshForecast(layout: StageLayout) {
    const forecast = this.forecast;
    forecast.age = this.physicsTime - this.forecastAt;
    if (forecast.valid && forecast.age < FORECAST_SECONDS * 0.6) return;
    forecast.count = predictFlight(this.ball, layout, FORECAST_SECONDS, FORECAST_SPACING, forecast.samples);
    forecast.valid = forecast.count > 0;
    forecast.age = 0;
    this.forecastAt = this.physicsTime;
  }

  /**
   * Whether the live ball is this side's to play: the other side's shot, or a
   * serve on its way to this side. A serve is dropped beside the net and
   * drifts toward its receiver, so it belongs to the side it is travelling
   * to, wherever it happens to be.
   */
  toPlay(side: Side, layout: StageLayout): boolean {
    const ball = this.ball;
    if (ball.state !== 'live') return false;
    if (ball.lastHitter !== null) return ball.lastHitter !== side;
    const toward = ball.vx !== 0 ? ball.vx : ball.x - layout.centerX;
    return side === 'left' ? toward < 0 : toward > 0;
  }

  /** Attempts and misses: a ball that came within reach of a paddle whose turn it was, and how that ended. */
  private trackAttempt(side: Side, paddle: PaddleInput, now: number, layout: StageLayout) {
    const arrival = this.arrival[side];
    arrival.valid = false;
    if (!paddle.active || !this.toPlay(side, layout)) {
      this.closeAttempt(side, now);
      return;
    }
    const ball = this.ball;
    const reach = (paddle.radius + BALL_RADIUS) * ATTENTION;
    const distance = Math.hypot(ball.x - paddle.x, ball.y - paddle.y);
    if (distance < reach) this.attempt[side] = !this.passed[side];
    else if (this.attempt[side] && distance > reach * 1.2) this.closeAttempt(side, now);

    // Where the predicted flight comes nearest this paddle if it stays put.
    const forecast = this.forecast;
    if (!forecast.valid) return;
    let best = Infinity;
    for (let i = 0; i < forecast.count; i++) {
      const sample = forecast.samples[i];
      const ahead = sample.t - forecast.age;
      if (ahead < 0) continue;
      const d = Math.hypot(sample.x - paddle.x, sample.y - paddle.y);
      if (d < best) {
        best = d;
        arrival.valid = true;
        arrival.x = sample.x;
        arrival.y = sample.y;
        arrival.t = ahead;
      }
    }
  }

  private closeAttempt(side: Side, now: number) {
    if (!this.attempt[side]) return;
    this.attempt[side] = false;
    this.passed[side] = true;
    this.stats.attempts += 1;
    this.stats.misses += 1;
    this.missStreak[side] += 1;
    this.missAt[side] = now;
    this.lastOutcome[side] = 'MISS';
  }

  private phaseOf(side: Side, paddle: PaddleInput, now: number): RallyPhase {
    if (!paddle.active || this.mode !== 'rally') return 'READY';
    const sinceHit = now - this.hitAt[side];
    if (sinceHit < 90) return 'CONTACT';
    if (sinceHit < 380) return 'FOLLOW';
    if (sinceHit < 760 || now - this.missAt[side] < 500) return 'RECOVER';
    const arrival = this.arrival[side];
    if (!arrival.valid) return 'READY';
    return arrival.t < 0.24 && Math.hypot(paddle.vx, paddle.vy) > 90 ? 'SWING' : 'ANTICIPATE';
  }

  /* ---------------------------------------------------------------- flies */

  private updateFlies(
    now: number,
    dt: number,
    layout: StageLayout,
    paddles: Record<Side, PaddleInput>,
    agentSide: Side | null,
    carryPoints: readonly Point[] | null,
  ) {
    const carrying = agentSide !== null && carryPoints !== null;
    this.nearFly.left = false;
    this.nearFly.right = false;

    for (const fly of this.flies) {
      // Roles follow the scene: carriers hold the agent's strings, the rest hunt or sit the rally out.
      if (fly.state !== 'stunned' && fly.state !== 'down' && fly.state !== 'held') {
        const role: FlyState = carrying && fly.slot < CARRIERS ? 'carry' : this.mode === 'rally' ? 'perch' : 'roam';
        if (fly.state !== role) {
          fly.state = role;
          fly.stateAt = now;
          fly.retargetAt = 0;
        }
      }

      switch (fly.state) {
        case 'roam':
          this.roam(fly, now, dt, layout, paddles);
          break;
        case 'carry': {
          const target = carryPoints![fly.slot];
          this.seek(fly, target.x, target.y + 3 * Math.sin(now / 260 + fly.slot), 300, 34, dt);
          break;
        }
        case 'perch': {
          const spread = (fly.slot + 0.5) / FLY_COUNT;
          const px = lerp(layout.width * 0.18, layout.width * 0.82, spread);
          const py = layout.groundY - 5;
          this.seek(fly, px, py, 40, 12, dt);
          if (Math.abs(fly.y - py) < 2) fly.vy = 0;
          break;
        }
        case 'held': {
          const paddle = fly.holder ? paddles[fly.holder] : null;
          if (paddle) {
            fly.x = paddle.x;
            fly.y = paddle.y - paddle.radius * 0.2;
            fly.vx = paddle.vx;
            fly.vy = paddle.vy;
          }
          break;
        }
        case 'stunned': {
          fly.vy += GRAVITY * 0.8 * dt;
          fly.x = clamp(fly.x + fly.vx * dt, 8, layout.width - 8);
          fly.y += fly.vy * dt;
          fly.angle += 9 * dt;
          const onTable = fly.x > layout.table.left && fly.x < layout.table.right && fly.y > layout.table.top - 4 && fly.vy > 0 && fly.y < layout.table.top + 12;
          const floor = onTable ? layout.table.top - 4 : layout.groundY - 4;
          if (fly.y >= floor) {
            fly.y = floor;
            fly.state = 'down';
            fly.stateAt = now;
            fly.vx = 0;
            fly.vy = 0;
            this.cue('bounce', fly.x, fly.y, layout, 0.25);
          }
          break;
        }
        case 'down':
          if (now - fly.stateAt > STUN_MS) {
            fly.state = 'roam';
            fly.stateAt = now;
            fly.retargetAt = 0;
            fly.vy = -120;
          }
          break;
      }

      const flying = fly.state === 'roam' || fly.state === 'carry' || fly.state === 'held' || (fly.state === 'perch' && Math.abs(fly.vy) + Math.abs(fly.vx) > 12);
      if (flying) fly.wing += dt * 62;
      if (fly.state !== 'stunned') {
        const lean = fly.state === 'down' ? Math.PI : clamp(fly.vx / 300, -0.6, 0.6);
        fly.angle += (lean - fly.angle) * Math.min(1, dt * 10);
      }
    }
  }

  private roam(fly: Fly, now: number, dt: number, layout: StageLayout, paddles: Record<Side, PaddleInput>) {
    if (now >= fly.retargetAt) this.retarget(fly, now, layout, paddles);

    let ax = (fly.targetX - fly.x) * 2.4 - fly.vx * 1.5 + 60 * Math.sin(now / 190 + fly.slot * 2.1);
    let ay = (fly.targetY - fly.y) * 2.4 - fly.vy * 1.5 + 70 * Math.cos(now / 230 + fly.slot * 1.3);

    for (const side of SIDES) {
      const paddle = paddles[side];
      if (!paddle.human) continue;
      const dx = fly.x - paddle.x;
      const dy = fly.y - paddle.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance < 150 * (paddle.radius / 20)) this.nearFly[side] = true;
      const speed = Math.hypot(paddle.vx, paddle.vy);

      if (distance < paddle.radius + FLY_RADIUS && speed > SWAT_SPEED) {
        fly.state = 'stunned';
        fly.stateAt = now;
        fly.vx = clamp(paddle.vx * 0.6 + (dx / distance) * 60, -360, 360);
        fly.vy = clamp(paddle.vy * 0.5 - 80, -360, 240);
        this.swats += 1;
        this.log(now, `fly swatted · ${this.swats}`);
        this.cue('swat', fly.x, fly.y, layout, clamp(speed / 500, 0.4, 1));
        if (this.mode === 'hunt' && this.swats >= SWATS_TO_RALLY) this.setMode('rally', now);
        return;
      }
      // A slow paddle is easy to dodge; it takes a real swing to catch one.
      if (distance < 72) {
        const push = ((72 - distance) / 72) * 380;
        ax += (dx / distance) * push;
        ay += (dy / distance) * push;
      }
    }

    fly.vx += ax * dt;
    fly.vy += ay * dt;
    const speed = Math.hypot(fly.vx, fly.vy);
    if (speed > FLY_MAX_SPEED) {
      fly.vx *= FLY_MAX_SPEED / speed;
      fly.vy *= FLY_MAX_SPEED / speed;
    }
    fly.x = clamp(fly.x + fly.vx * dt, 10, layout.width - 10);
    fly.y = clamp(fly.y + fly.vy * dt, 14, layout.groundY - 26);
  }

  private retarget(fly: Fly, now: number, layout: StageLayout, paddles: Record<Side, PaddleInput>) {
    const humans = SIDES.filter((side) => paddles[side].human);
    if (humans.length > 0 && this.random() < 0.8) {
      // Tease whoever is playing: hover within reach of their paddle.
      const paddle = paddles[humans[Math.floor(this.random() * humans.length)]];
      fly.targetX = paddle.x + lerp(-170, 170, this.random());
      fly.targetY = paddle.y + lerp(-170, 90, this.random());
    } else {
      fly.targetX = lerp(0.08, 0.92, this.random()) * layout.width;
      fly.targetY = lerp(50, layout.groundY - 170, this.random());
    }
    fly.targetX = clamp(fly.targetX, 20, layout.width - 20);
    fly.targetY = clamp(fly.targetY, 36, layout.groundY - 70);
    fly.retargetAt = now + lerp(900, 2400, this.random());
  }

  /**
   * Damped approach to a point, for flies that have somewhere to be. The
   * damping is integrated implicitly, so it stays stable at any frame rate.
   */
  private seek(fly: Fly, x: number, y: number, stiffness: number, damping: number, dt: number) {
    fly.vx = (fly.vx + (x - fly.x) * stiffness * dt) / (1 + damping * dt);
    fly.vy = (fly.vy + (y - fly.y) * stiffness * dt) / (1 + damping * dt);
    const speed = Math.hypot(fly.vx, fly.vy);
    const limit = FLY_MAX_SPEED * 2.2;
    if (speed > limit) {
      fly.vx *= limit / speed;
      fly.vy *= limit / speed;
    }
    fly.x += fly.vx * dt;
    fly.y += fly.vy * dt;
  }

  /* ---------------------------------------------------------------- bookkeeping */

  /** Adds a line to the event log shown in the HUD. */
  log(now: number, text: string) {
    this.events.push({ at: (now - (this.startedAt ?? now)) / 1000, text });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  private cue(kind: CueKind, x: number, y: number, layout: StageLayout, strength: number) {
    this.cues.push({ kind, pan: panOf(x, layout), strength });
    if (kind === 'hit' || kind === 'swat' || kind === 'bounce') {
      this.impacts.push({ x, y, at: this.clock, kind, strength });
      if (this.impacts.length > MAX_IMPACTS) this.impacts.shift();
    }
  }
}
