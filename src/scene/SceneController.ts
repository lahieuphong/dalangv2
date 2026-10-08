import { SIDES, type Point, type Side } from '../types';
import { clamp, lerp, mulberry32 } from '../utils/math';
import type { StageLayout } from './StageProps';

/**
 * Everything on the stage that is not a puppet: the flies, the ball, the
 * table as a collider, and the two little games they make.
 *
 *   hunt   flies drift about the stage; a swing of the paddle knocks one down
 *   rally  a ball is served over the table and the paddles keep it in play
 *
 * The scene never moves a puppet. It only reads where the paddles are and how
 * fast they travel, so direct control is never taken away from the hand.
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

export interface BallSample {
  x: number;
  y: number;
  vy: number;
  /** Seconds from now. */
  t: number;
  /** Table bounces so far along this prediction. */
  bounces: number;
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

export const BALL_RADIUS = 6.5;
const GRAVITY = 560;
const AIR_DRAG = 0.12;
const TABLE_BOUNCE = 0.86;
const BALL_MAX_SPEED = 820;
/** The paddle catches the ball a little beyond its drawn edge, and steers the return toward the far half of the table. */
const PADDLE_REACH = 1.35;
const AIM_ASSIST = 0.72;
const HIT_COOLDOWN_MS = 260;
const GRAB_RADIUS = 52;
const SERVE_DELAY_MS = 1500;
/** Serves that nobody returns before the scene goes back to the hunt. */
const IDLE_SERVES = 3;
const MAX_EVENTS = 5;
const MAX_IMPACTS = 8;
const TRAIL_LENGTH = 9;

type Contact = 'none' | 'table' | 'net' | 'ground' | 'wall';

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** One physics step of the ball. Shared by the live ball and by trajectory prediction. */
function stepBall(b: Body, dt: number, layout: StageLayout): Contact {
  const { table, groundY, width, centerX } = layout;
  const r = BALL_RADIUS;
  const drag = Math.exp(-AIR_DRAG * dt);
  b.vy += GRAVITY * dt;
  b.vx *= drag;
  b.vy *= drag;
  const px = b.x;
  const py = b.y;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

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

  private readonly random = mulberry32(7731);
  private readonly hitAt: Record<Side, number> = { left: -Infinity, right: -Infinity };
  private startedAt: number | null = null;
  private serveAt = Infinity;
  private nextReceiver: Side = 'left';
  private idleServes = 0;
  private humanHits = 0;
  private rallyStartedAt = 0;
  private lastHumanAt = 0;
  private clock = 0;

  constructor(layout: StageLayout) {
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
    const anyHuman = paddles.left.human || paddles.right.human;
    if (anyHuman) this.lastHumanAt = now;
    // With nobody at the stage the rally winds down by itself.
    if (this.mode === 'rally' && !anyHuman && now - this.lastHumanAt > 6000) this.setMode('hunt', now);

    this.updateGrabs(now, layout, paddles);
    this.updateBall(now, dt, layout, paddles);
    this.updateFlies(now, dt, layout, paddles, agentSide, carryPoints);
  }

  /** Predicts the ball's flight from now on; used by the agent to decide where to stand. */
  predict(layout: StageLayout, seconds: number, step: number, out: BallSample[]): number {
    if (this.ball.state !== 'live') return 0;
    const body: Body = { x: this.ball.x, y: this.ball.y, vx: this.ball.vx, vy: this.ball.vy };
    let bounces = 0;
    let count = 0;
    for (let t = step; t <= seconds && count < out.length; t += step) {
      const contact = stepBall(body, step, layout);
      if (contact === 'table') bounces += 1;
      const sample = out[count++];
      sample.x = body.x;
      sample.y = body.y;
      sample.vy = body.vy;
      sample.t = t;
      sample.bounces = bounces;
      if (contact === 'ground') break;
    }
    return count;
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
        ball.state = 'live';
        ball.holder = null;
        ball.stateAt = now;
        ball.vx = clamp(paddle.vx * 0.9 + dir * 90, -BALL_MAX_SPEED, BALL_MAX_SPEED);
        ball.vy = clamp(paddle.vy * 0.9 - 230, -BALL_MAX_SPEED, BALL_MAX_SPEED);
        ball.lastHitter = side;
        ball.bounces.left = 0;
        ball.bounces.right = 0;
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
    const ball = this.ball;
    ball.state = 'live';
    ball.holder = null;
    ball.stateAt = now;
    ball.x = layout.centerX - dir * 34;
    ball.y = Math.max(40, layout.table.top - 250);
    ball.vx = dir * 88;
    ball.vy = 0;
    ball.lastHitter = null;
    ball.bounces.left = 0;
    ball.bounces.right = 0;
    ball.trail.length = 0;
    this.serveAt = Infinity;
    this.beginRally(now, false);
    this.log(now, 'serve');
    this.cue('serve', ball.x, ball.y, layout, 0.4);
  }

  private endRally(now: number, layout: StageLayout, reason: string) {
    const ball = this.ball;
    ball.state = 'dead';
    ball.stateAt = now;
    this.bestRally = Math.max(this.bestRally, this.rallyHits);
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

    if (ball.state === 'held' && ball.holder) {
      const paddle = paddles[ball.holder];
      ball.x = paddle.x;
      ball.y = paddle.y - paddle.radius * 0.15;
      return;
    }
    if (ball.state === 'dead') {
      // Roll to a stop where it fell.
      ball.vx *= Math.exp(-4 * dt);
      ball.x = clamp(ball.x + ball.vx * dt, BALL_RADIUS, layout.width - BALL_RADIUS);
      ball.angle += (ball.vx * dt) / BALL_RADIUS;
      return;
    }
    if (ball.state !== 'live') return;

    this.rallySeconds = (now - this.rallyStartedAt) / 1000;
    // Two half steps keep a fast ball from tunnelling through the table or a paddle.
    const steps = dt > 1 / 90 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps && ball.state === 'live'; i++) {
      const contact = stepBall(ball, h, layout);
      if (contact === 'table') {
        const side = sideOf(ball.x, layout);
        ball.bounces[side] += 1;
        this.cue('bounce', ball.x, ball.y, layout, clamp(Math.abs(ball.vy) / 500, 0.2, 1));
        if (ball.bounces[side] >= 2) {
          this.endRally(now, layout, 'return missed');
          break;
        }
        this.log(now, 'table contact');
      } else if (contact === 'ground') {
        ball.vx *= 0.5;
        this.endRally(now, layout, 'return missed');
        break;
      } else if (contact === 'net') {
        this.log(now, 'net');
      }
      for (const side of SIDES) this.collide(side, paddles[side], now, layout);
    }
    ball.angle += (ball.vx * dt) / 40;
    ball.trail.unshift({ x: ball.x, y: ball.y });
    if (ball.trail.length > TRAIL_LENGTH) ball.trail.length = TRAIL_LENGTH;
  }

  private collide(side: Side, paddle: PaddleInput, now: number, layout: StageLayout) {
    const ball = this.ball;
    if (!paddle.active || ball.state !== 'live' || now - this.hitAt[side] < HIT_COOLDOWN_MS) return;
    const dx = ball.x - paddle.x;
    const dy = ball.y - paddle.y;
    const distance = Math.hypot(dx, dy);
    if (distance > paddle.radius * PADDLE_REACH + BALL_RADIUS) return;

    const dir = side === 'left' ? 1 : -1;
    const { table, centerX } = layout;
    // Where a good return lands: somewhere on the far half of the table.
    const tx = centerX + dir * lerp(0.3, 0.78, this.random()) * (table.right - centerX);
    const ty = table.top - BALL_RADIUS;
    let time = clamp(Math.abs(tx - ball.x) / 270, 0.55, 1.15);
    let ix = 0;
    let iy = 0;
    for (let attempt = 0; attempt < 7; attempt++) {
      ix = (tx - ball.x) / time;
      iy = (ty - ball.y - 0.5 * GRAVITY * time * time) / time;
      const toNet = (centerX - ball.x) / ix;
      const netY = ball.y + iy * toNet + 0.5 * GRAVITY * toNet * toNet;
      if (toNet <= 0 || toNet >= time || netY < table.netTop - 16) break;
      time += 0.12;
    }

    // The physical part: bounce off the paddle face and pick up some of its swing.
    const nx = distance > 1e-3 ? dx / distance : dir;
    const ny = distance > 1e-3 ? dy / distance : -0.3;
    const closing = Math.min(0, (ball.vx - paddle.vx) * nx + (ball.vy - paddle.vy) * ny);
    const px = ball.vx - 1.8 * closing * nx + paddle.vx * 0.35;
    const py = ball.vy - 1.8 * closing * ny + paddle.vy * 0.35;

    let vx = lerp(px, ix, AIM_ASSIST);
    let vy = lerp(py, iy, AIM_ASSIST);
    if (vx * dir < 70) vx = dir * Math.max(70, Math.abs(ix));
    const speed = Math.hypot(vx, vy);
    if (speed > BALL_MAX_SPEED) {
      vx *= BALL_MAX_SPEED / speed;
      vy *= BALL_MAX_SPEED / speed;
    }
    ball.vx = vx;
    ball.vy = vy;
    ball.lastHitter = side;
    ball.bounces.left = 0;
    ball.bounces.right = 0;
    this.hitAt[side] = now;
    this.rallyHits += 1;
    if (paddle.human) this.humanHits += 1;
    this.log(now, `${paddle.human ? 'player' : 'CPU'} return accepted`);
    this.cue('hit', ball.x, ball.y, layout, clamp(speed / 600, 0.3, 1));
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
