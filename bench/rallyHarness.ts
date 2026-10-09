import { AgentPuppeteer } from '../src/motion/AgentPuppeteer';
import { PuppetController, type ControlEnvironment } from '../src/motion/PuppetController';
import { DEFAULT_FINGER_MAP, gainFromSetting } from '../src/motion/PuppetMapping';
import { computeJoints, createJoints } from '../src/motion/PuppetRig';
import { BALL_RADIUS, emptyPaddle, SceneController, type BallSample, type PaddleInput } from '../src/scene/SceneController';
import { computeLayout, type StageLayout } from '../src/scene/StageProps';
import type { Side } from '../src/types';
import { mulberry32 } from '../src/utils/math';

/**
 * Deterministic measurement of the ball game, independent of how the scene
 * implements it: the harness only places paddles, steps the scene and watches
 * the ball. The same scenarios, seeds and frame pacing therefore measure any
 * version of the collision and rally code, which is what makes a before /
 * after comparison meaningful.
 *
 *   fly-by  a ball is fired past a paddle with a known miss distance
 *   rally   a simulated, imperfect player rallies with the stage agent
 */

export type AssistLabel = 'baseline' | 'precision' | 'natural' | 'cinematic';

/** Newer scenes take a rally-assistance mode; the original one has none. */
interface AssistableScene {
  setAssist?: (mode: string) => void;
}

function applyAssist(scene: SceneController, agent: AgentPuppeteer | null, mode: AssistLabel) {
  if (mode === 'baseline') return;
  (scene as unknown as AssistableScene).setAssist?.(mode);
  (agent as unknown as AssistableScene | null)?.setAssist?.(mode);
}

const STAGE_WIDTH = 1200;
const PADDLE_RADIUS = 20;
/** Centre distance at which ball and paddle disc just touch. */
export const TOUCH = PADDLE_RADIUS + BALL_RADIUS;

const GRAVITY = 560;
const DRAG = 0.12;

/** Free flight of the ball in closed form (gravity + linear drag): the reference the scene is compared against. */
function flight(x0: number, y0: number, vx0: number, vy0: number, t: number) {
  const decay = Math.exp(-DRAG * t);
  const gain = (1 - decay) / DRAG;
  const terminal = GRAVITY / DRAG;
  return {
    x: x0 + vx0 * gain,
    y: y0 + terminal * t + (vy0 - terminal) * gain,
    vx: vx0 * decay,
    vy: terminal + (vy0 - terminal) * decay,
  };
}

/* ------------------------------------------------------------------ fly-by */

export interface FlyByOptions {
  mode: AssistLabel;
  fps: number;
  trials: number;
  seed: number;
  /** Vary the frame time by ±35 % around 1 / fps. */
  jitter?: boolean;
}

export interface Band {
  /** Upper bound of the true miss distance, in units of the touching distance. */
  upTo: number;
  trials: number;
  hits: number;
}

export interface FlyByResult {
  mode: AssistLabel;
  fps: number;
  jitter: boolean;
  trials: number;
  /** Hit rate by how close the ball really came to the paddle's centre. */
  bands: Band[];
  /** The same, for passes where ball and paddle closed at more than 600 units / s. */
  fastBands: Band[];
  /** Hits where the ball never came within two touching distances of the paddle: nothing a player would call a hit. */
  falsePositives: number;
  /** Largest true miss distance that still counted as a hit, in touching distances. */
  furthestHit: number;
}

const BAND_EDGES = [1, 1.3, 1.45, 1.8, 2.6];
const emptyBands = (): Band[] => BAND_EDGES.map((upTo) => ({ upTo, trials: 0, hits: 0 }));
const bandOf = (bands: Band[], ratio: number) => bands.find((band) => ratio <= band.upTo) ?? bands[bands.length - 1];

/**
 * Fires balls past a paddle. Each trial knows, from the closed-form flight,
 * how close the ball would come to the paddle's centre if nothing stopped it;
 * the scene then decides whether it was a hit.
 */
export function runFlyBy(options: FlyByOptions): FlyByResult {
  const random = mulberry32(options.seed);
  const layout = computeLayout(STAGE_WIDTH);
  const bands = emptyBands();
  const fastBands = emptyBands();
  let falsePositives = 0;
  let furthestHit = 0;
  const encounterAt = 0.2;

  for (let trial = 0; trial < options.trials; trial++) {
    // Ball: 150–800 units / s, coming from the right, anywhere from steeply down to steeply up.
    const speed = 150 + random() * 650;
    const heading = Math.PI + (random() - 0.5) * 2.2;
    const vx0 = Math.cos(heading) * speed;
    const vy0 = Math.sin(heading) * speed;
    // Paddle: a third stand still, the rest sweep at up to 1200 units / s in any direction.
    const sweeping = random() > 0.34;
    const paddleSpeed = sweeping ? random() * 1200 : 0;
    const paddleHeading = random() * Math.PI * 2;
    const pvx = Math.cos(paddleHeading) * paddleSpeed;
    const pvy = Math.sin(paddleHeading) * paddleSpeed;
    // Where they meet, and by how much the ball misses the paddle's centre.
    const ex = 250 + random() * 120;
    const ey = 170 + random() * 90;
    const miss = random() * TOUCH * 2.6 * (random() < 0.5 ? -1 : 1);

    const atEncounter = flight(0, 0, vx0, vy0, encounterAt);
    const rvx = atEncounter.vx - pvx;
    const rvy = atEncounter.vy - pvy;
    const closing = Math.hypot(rvx, rvy);
    if (closing < 60) {
      trial -= 1;
      continue;
    }
    const bx0 = ex + (-rvy / closing) * miss - atEncounter.x;
    const by0 = ey + (rvx / closing) * miss - atEncounter.y;
    const paddleAt = (t: number) => ({ x: ex + pvx * (t - encounterAt), y: ey + pvy * (t - encounterAt) });

    // The true closest approach, from the closed-form flight.
    let closest = Infinity;
    for (let t = 0; t <= 0.4; t += 0.0002) {
      const b = flight(bx0, by0, vx0, vy0, t);
      const p = paddleAt(t);
      closest = Math.min(closest, Math.hypot(b.x - p.x, b.y - p.y));
    }
    const start = flight(bx0, by0, vx0, vy0, 0);
    if (closest > TOUCH * 2.6 || start.y < 20 || start.y > 470 || start.x < 20 || start.x > 470) {
      trial -= 1;
      continue;
    }

    const scene = new SceneController(layout);
    scene.mode = 'rally';
    applyAssist(scene, null, options.mode);
    const paddles: Record<Side, PaddleInput> = { left: emptyPaddle(), right: emptyPaddle() };
    const paddle = paddles.left;
    paddle.active = true;
    paddle.human = true;
    paddle.radius = PADDLE_RADIUS;
    paddle.vx = pvx;
    paddle.vy = pvy;
    Object.assign(paddle, paddleAt(0));
    let now = 1000;
    // One idle frame, so a scene that remembers the previous paddle pose has one to remember.
    scene.update(now, 1 / options.fps, layout, paddles, null, null);
    const ball = scene.ball;
    ball.state = 'live';
    ball.holder = null;
    ball.lastHitter = null;
    ball.bounces.left = 0;
    ball.bounces.right = 0;
    ball.x = bx0;
    ball.y = by0;
    ball.vx = vx0;
    ball.vy = vy0;

    let hit = false;
    for (let t = 0; t < 0.4 && !hit; ) {
      const dt = (1 / options.fps) * (options.jitter ? 0.65 + random() * 0.7 : 1);
      t += dt;
      now += dt * 1000;
      Object.assign(paddle, paddleAt(t));
      scene.update(now, dt, layout, paddles, null, null);
      hit = ball.lastHitter === 'left';
      if (ball.state !== 'live') break;
    }

    const ratio = closest / TOUCH;
    for (const set of closing > 600 ? [bands, fastBands] : [bands]) {
      const band = bandOf(set, ratio);
      band.trials += 1;
      if (hit) band.hits += 1;
    }
    if (hit) {
      furthestHit = Math.max(furthestHit, ratio);
      if (ratio > 2) falsePositives += 1;
    }
  }
  return { mode: options.mode, fps: options.fps, jitter: options.jitter ?? false, trials: options.trials, bands, fastBands, falsePositives, furthestHit };
}

/* ------------------------------------------------------------------ rally */

export type Skill = 'steady' | 'average' | 'sloppy' | 'novice' | 'absent';

interface SkillProfile {
  /** How far off the player's paddle lands, one standard deviation, stage units. */
  aim: number;
  /** How quickly the hand gets there (natural frequency, rad / s). */
  agility: number;
  /** How hard the player swings through the ball, 0..1. */
  swing: number;
  /** How long it takes the player to act on what they see, ms. */
  reaction: number;
}

const SKILLS: Record<Exclude<Skill, 'absent'>, SkillProfile> = {
  steady: { aim: 8, agility: 22, swing: 0.6, reaction: 0 },
  average: { aim: 18, agility: 16, swing: 0.7, reaction: 0 },
  sloppy: { aim: 30, agility: 12, swing: 0.9, reaction: 0 },
  // Someone new to it, on a slow camera: often a paddle-width off, and late.
  novice: { aim: 40, agility: 9, swing: 1, reaction: 140 },
};

export interface RallyOptions {
  mode: AssistLabel;
  skill: Skill;
  seed: number;
  seconds: number;
  fps: number;
  jitter?: boolean;
  /** How often the player re-reads the ball: the tracking rate of their camera. */
  cameraHz?: number;
}

export interface RallyResult {
  mode: AssistLabel;
  skill: Skill;
  seed: number;
  fps: number;
  jitter: boolean;
  cameraHz: number;
  /** Rallies that ended (serve → dead ball). */
  rallies: number;
  /** Paddle hits per rally. */
  averageHits: number;
  longestRally: number;
  /** Balls that came to the player, and how many the player hit. */
  playerAttempts: number;
  playerHits: number;
  /** Player misses where the ball passed within 1.6 touching distances of the paddle. */
  playerNearMisses: number;
  /**
   * The serve alone: the one ball that is the same in every version (a slow
   * drop onto the player's half), so its hit rate compares like with like.
   */
  serveAttempts: number;
  serveHits: number;
  serveNearMisses: number;
  cpuAttempts: number;
  cpuHits: number;
  /** The same paddle credited twice within 150 ms. */
  doubleHits: number;
  /** Player returns that reached the far side (crossed the net) before dying. */
  playerReturnsOver: number;
  /** Why rallies ended: who failed to reach the ball, and whose own shot never made it across. */
  endings: { playerMiss: number; playerFault: number; cpuMiss: number; cpuFault: number };
  /** Mean cost of one scene update, microseconds. */
  updateMicros: number;
}

/** A hand-controlled paddle with human limits: it sees the ball's path, aims a little off, and takes time to get there. */
export class SimPlayer {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  private tx: number;
  private ty: number;
  private errorX = 0;
  private errorY = 0;
  private planAt = 0;
  private plannedFor = -1;
  private seenAt = 0;
  /** When set, the aiming error of the next ball: lets a drill give every version the very same errors. */
  nextError: { x: number; y: number } | null = null;
  private readonly samples: BallSample[] = Array.from({ length: 96 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, t: 0, bounces: 0 }) as BallSample);
  private readonly skill: Skill;
  private readonly layout: StageLayout;
  private readonly random: () => number;
  private readonly cameraHz: number;

  constructor(skill: Skill, layout: StageLayout, random: () => number, cameraHz: number) {
    this.skill = skill;
    this.layout = layout;
    this.random = random;
    this.cameraHz = cameraHz;
    const home = this.home();
    this.x = this.tx = home.x;
    this.y = this.ty = home.y;
  }

  private home() {
    const { layout } = this;
    // An absent player's paddle hangs far from the table and never moves.
    return this.skill === 'absent' ? { x: 70, y: 140 } : { x: layout.table.left - 46, y: layout.table.top - 96 };
  }

  private gaussian() {
    return Math.sqrt(-2 * Math.log(Math.max(1e-9, this.random()))) * Math.cos(2 * Math.PI * this.random());
  }

  update(now: number, dt: number, scene: SceneController, incoming: number) {
    const { layout } = this;
    if (this.skill !== 'absent') {
      const profile = SKILLS[this.skill];
      const ball = scene.ball;
      const home = this.home();
      let tx = home.x;
      let ty = home.y;
      if (ball.state === 'live' && ball.lastHitter !== 'left') {
        if (incoming !== this.plannedFor) {
          // A new ball: one aiming error for the whole stroke.
          this.plannedFor = incoming;
          this.errorX = this.nextError ? this.nextError.x * profile.aim : this.gaussian() * profile.aim;
          this.errorY = this.nextError ? this.nextError.y * profile.aim : this.gaussian() * profile.aim;
          this.planAt = 0;
          this.tx = NaN;
          this.seenAt = now;
        }
        if (now >= this.planAt && now - this.seenAt >= profile.reaction) {
          this.planAt = now + 1000 / this.cameraHz;
          const count = scene.predict(layout, 1.6, 1 / 60, this.samples);
          const ideal = layout.table.top - 104;
          let best = -1;
          let bestCost = Infinity;
          for (let i = 0; i < count; i++) {
            const sample = this.samples[i];
            if (sample.x > layout.centerX - 14 || sample.x < 60 || sample.t < 0.1) continue;
            if (sample.y < layout.table.top - 250 || sample.y > layout.table.top - 30) continue;
            const cost = Math.abs(sample.y - ideal) + (sample.bounces === 0 ? 60 : 0) + sample.t * 30;
            if (cost < bestCost) {
              bestCost = cost;
              best = i;
            }
          }
          if (best >= 0) {
            const sample = this.samples[best];
            // Meet the ball from slightly behind and below, then swing through it toward the far side.
            this.tx = sample.x - 9 + this.errorX;
            this.ty = sample.y + 7 + this.errorY;
            if (sample.t < 0.13) {
              this.tx += 52 * profile.swing;
              this.ty -= 34 * profile.swing;
            }
          } else this.tx = NaN;
        }
        if (!Number.isNaN(this.tx)) {
          tx = this.tx;
          ty = this.ty;
        }
      }
      const w = profile.agility;
      this.vx += (w * w * (tx - this.x) - 2 * w * this.vx) * dt;
      this.vy += (w * w * (ty - this.y) - 2 * w * this.vy) * dt;
      const speed = Math.hypot(this.vx, this.vy);
      if (speed > 1400) {
        this.vx *= 1400 / speed;
        this.vy *= 1400 / speed;
      }
      this.x = Math.min(layout.centerX + 10, Math.max(40, this.x + this.vx * dt));
      this.y = Math.min(layout.groundY - 50, Math.max(layout.table.top - 300, this.y + this.vy * dt));
    }
  }
}

/* ------------------------------------------------------------------ serve drill */

export interface DrillOptions {
  mode: AssistLabel;
  skill: Skill;
  serves: number;
  seed: number;
  fps: number;
}

export interface DrillResult {
  mode: AssistLabel;
  skill: Skill;
  fps: number;
  serves: number;
  hits: number;
  /** Misses where the ball passed within 1.3 / 1.6 / 2 touching distances of the paddle. */
  missWithin: { tight: number; near: number; wide: number };
  /** Misses where the paddle was nowhere near. */
  cleanMisses: number;
  /** Hit serves that then crossed the net. */
  returnsOver: number;
  /**
   * Attempts and hits by how close the ball would truly have come to the
   * paddle had there been nothing to hit (in touching distances): the same
   * serve and the same player, replayed with the paddle taken out of play.
   */
  bands: Band[];
}

const DRILL_EDGES = [1, 1.3, 1.6, 2, 99];

/**
 * The like-for-like test of how easy the ball is to hit. Every serve is the
 * same slow drop onto the player's half, played on a fresh stage by a player
 * whose aiming error for serve number n depends only on (seed, n). Any
 * version of the game is therefore handed exactly the same attempts; what
 * differs is only whether it calls them hits.
 *
 * Each serve is played twice: once for real, and once as a ghost, which gives
 * the true distance by which that attempt would have missed or met the ball.
 */
export function runServeDrill(options: DrillOptions): DrillResult {
  const layout = computeLayout(STAGE_WIDTH);
  const result: DrillResult = {
    mode: options.mode,
    skill: options.skill,
    fps: options.fps,
    serves: options.serves,
    hits: 0,
    missWithin: { tight: 0, near: 0, wide: 0 },
    cleanMisses: 0,
    returnsOver: 0,
    bands: DRILL_EDGES.map((upTo) => ({ upTo, trials: 0, hits: 0 })),
  };
  for (let serve = 0; serve < options.serves; serve++) {
    const real = playServe(options, layout, serve, false);
    const ghost = playServe(options, layout, serve, true);
    const band = bandOf(result.bands, ghost.closest / TOUCH);
    band.trials += 1;
    if (real.hit) {
      band.hits += 1;
      result.hits += 1;
      if (real.over) result.returnsOver += 1;
    } else if (real.closest <= TOUCH * 1.3) result.missWithin.tight += 1;
    else if (real.closest <= TOUCH * 1.6) result.missWithin.near += 1;
    else if (real.closest <= TOUCH * 2) result.missWithin.wide += 1;
    else result.cleanMisses += 1;
  }
  return result;
}

/**
 * One serve of the drill. As a `ghost`, the scene is handed a paddle parked
 * far from everything while the player moves exactly as it otherwise would:
 * nothing can be hit, and `closest` is how near the attempt truly came.
 */
function playServe(options: DrillOptions, layout: StageLayout, serve: number, ghost: boolean) {
  const dt = 1 / options.fps;
  const random = mulberry32(options.seed * 104729 + serve * 31 + 7);
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());
  const scene = new SceneController(layout);
  applyAssist(scene, null, options.mode);
  const player = new SimPlayer(options.skill, layout, random, 30);
  player.nextError = { x: gaussian(), y: gaussian() };
  const paddles: Record<Side, PaddleInput> = { left: emptyPaddle(), right: emptyPaddle() };
  const left = paddles.left;
  left.active = true;
  left.human = true;
  left.radius = PADDLE_RADIUS;
  left.x = ghost ? 40 : player.x;
  left.y = ghost ? 40 : player.y;
  let now = 1000;
  scene.setMode('rally', now);
  let closest = Infinity;
  let hit = false;
  let over = false;
  let wasLive = false;
  let prevBallX = 0;
  let prevBallY = 0;
  let prevX = player.x;
  let prevY = player.y;
  for (let frame = 0; frame < options.fps * 6; frame++) {
    now += dt * 1000;
    player.update(now, dt, scene, 1);
    if (!ghost) {
      left.vx += ((player.x - left.x) / dt - left.vx) * 0.6;
      left.vy += ((player.y - left.y) / dt - left.vy) * 0.6;
      left.x = player.x;
      left.y = player.y;
    }
    scene.update(now, dt, layout, paddles, null, null);
    scene.cues.length = 0;
    const ball = scene.ball;
    const live = ball.state === 'live';
    if (live && ball.lastHitter === 'left') hit = true;
    if (live && !hit && wasLive) closest = Math.min(closest, sweptDistance(prevBallX, prevBallY, ball.x, ball.y, prevX, prevY, player.x, player.y));
    if (hit && live && ball.x > layout.centerX + BALL_RADIUS) over = true;
    if (wasLive && !live) break;
    wasLive = live;
    prevBallX = ball.x;
    prevBallY = ball.y;
    prevX = player.x;
    prevY = player.y;
  }
  return { hit, over, closest };
}

/** Closest approach of two points that each move in a straight line over one frame. */
function sweptDistance(ax0: number, ay0: number, ax1: number, ay1: number, bx0: number, by0: number, bx1: number, by1: number) {
  const dx = ax0 - bx0;
  const dy = ay0 - by0;
  const ex = ax1 - ax0 - (bx1 - bx0);
  const ey = ay1 - ay0 - (by1 - by0);
  const span = ex * ex + ey * ey;
  const t = span > 1e-9 ? Math.min(1, Math.max(0, -(dx * ex + dy * ey) / span)) : 0;
  return Math.hypot(dx + ex * t, dy + ey * t);
}

/** One pass of the ball toward a paddle, from the moment it is that paddle's to play until it is hit or gone. */
interface Pass {
  open: boolean;
  closest: number;
  /** The ball of this pass is the serve (nobody has hit it yet). */
  serve: boolean;
}

/**
 * @param observe called after every scene update, for callers that want to look at the scene itself
 */
export function runRally(options: RallyOptions, observe?: (scene: SceneController, now: number) => void): RallyResult {
  const cameraHz = options.cameraHz ?? 30;
  const random = mulberry32(options.seed * 7919 + 13);
  const layout = computeLayout(STAGE_WIDTH);
  const scene = new SceneController(layout);
  const agent = new AgentPuppeteer();
  applyAssist(scene, agent, options.mode);
  const env: ControlEnvironment = {
    layout,
    gains: { finger: gainFromSetting(0.5), palm: gainFromSetting(0.5), pinch: gainFromSetting(0.5), roll: gainFromSetting(0.5), depth: 1 },
    fingerMap: DEFAULT_FINGER_MAP,
    smoothing: 0.3,
    invertY: false,
    holdMs: 300,
    calibration: {},
  };
  const cpu = new PuppetController('right', env);
  const joints = createJoints();
  const player = new SimPlayer(options.skill, layout, random, cameraHz);
  const paddles: Record<Side, PaddleInput> = { left: emptyPaddle(), right: emptyPaddle() };
  paddles.left.active = true;
  paddles.left.human = true;
  paddles.left.radius = PADDLE_RADIUS;
  paddles.left.x = player.x;
  paddles.left.y = player.y;
  paddles.right.active = true;

  const result: RallyResult = {
    mode: options.mode,
    skill: options.skill,
    seed: options.seed,
    fps: options.fps,
    jitter: options.jitter ?? false,
    cameraHz,
    rallies: 0,
    averageHits: 0,
    longestRally: 0,
    playerAttempts: 0,
    playerHits: 0,
    playerNearMisses: 0,
    serveAttempts: 0,
    serveHits: 0,
    serveNearMisses: 0,
    cpuAttempts: 0,
    cpuHits: 0,
    doubleHits: 0,
    playerReturnsOver: 0,
    endings: { playerMiss: 0, playerFault: 0, cpuMiss: 0, cpuFault: 0 },
    updateMicros: 0,
  };

  let now = 1000;
  scene.setMode('rally', now);
  const passes: Record<Side, Pass> = { left: { open: false, closest: Infinity, serve: false }, right: { open: false, closest: Infinity, serve: false } };
  const lastHitAt: Record<Side, number> = { left: -Infinity, right: -Infinity };
  const previous = { ballX: 0, ballY: 0, live: false, hitter: null as Side | null, hits: 0, left: { x: player.x, y: player.y }, right: { x: 0, y: 0 } };
  let rallyHits = 0;
  let totalHits = 0;
  let incoming = 0;
  let awaitingCrossing = false;
  // Whether the ball has crossed the net since it was last hit (or served).
  let crossed = false;
  let cost = 0;
  let frames = 0;
  let rightValid = false;

  const closePass = (side: Side, hit: boolean) => {
    const pass = passes[side];
    if (!pass.open) return;
    pass.open = false;
    if (side === 'left') {
      result.playerAttempts += 1;
      if (hit) result.playerHits += 1;
      else if (pass.closest <= TOUCH * 1.6) result.playerNearMisses += 1;
      if (pass.serve) {
        result.serveAttempts += 1;
        if (hit) result.serveHits += 1;
        else if (pass.closest <= TOUCH * 1.6) result.serveNearMisses += 1;
      }
    } else {
      result.cpuAttempts += 1;
      if (hit) result.cpuHits += 1;
    }
    pass.closest = Infinity;
  };

  for (let elapsed = 0; elapsed < options.seconds; ) {
    const dt = (1 / options.fps) * (options.jitter ? 0.65 + random() * 0.7 : 1);
    elapsed += dt;
    now += dt * 1000;

    // The agent's pose goes through the same followers a hand's would.
    const agentRig = agent.update('right', now, dt, layout, scene);
    cpu.prepareTarget(now, dt, 1, agentRig);
    computeJoints(cpu.integrate(dt), 'right', joints);
    const right = paddles.right;
    if (rightValid) {
      right.vx += ((joints.paddle.x - right.x) / dt - right.vx) * 0.6;
      right.vy += ((joints.paddle.y - right.y) / dt - right.vy) * 0.6;
    }
    rightValid = true;
    right.x = joints.paddle.x;
    right.y = joints.paddle.y;
    right.radius = joints.paddleRadius;

    player.update(now, dt, scene, incoming);
    const left = paddles.left;
    left.vx += ((player.x - left.x) / dt - left.vx) * 0.6;
    left.vy += ((player.y - left.y) / dt - left.vy) * 0.6;
    left.x = player.x;
    left.y = player.y;

    const started = performance.now();
    scene.update(now, dt, layout, paddles, 'right', null);
    cost += performance.now() - started;
    frames += 1;
    observe?.(scene, now);
    scene.cues.length = 0;

    const ball = scene.ball;
    const live = ball.state === 'live';

    // A hit: the ball is now this side's, and it was not a moment ago (or the count went up again).
    if (live && ball.lastHitter && (ball.lastHitter !== previous.hitter || (previous.live && scene.rallyHits > previous.hits))) {
      const side = ball.lastHitter;
      passes[side].serve = previous.hitter === null;
      if (now - lastHitAt[side] < 150) result.doubleHits += 1;
      lastHitAt[side] = now;
      rallyHits += 1;
      closePass(side, true);
      if (side === 'left') awaitingCrossing = true;
      crossed = false;
      incoming += 1;
    }
    if (live && !previous.live) {
      incoming += 1;
      crossed = false;
    }

    if (live) {
      if (awaitingCrossing && ball.lastHitter === 'left' && ball.x > layout.centerX + BALL_RADIUS) {
        result.playerReturnsOver += 1;
        awaitingCrossing = false;
      }
      if (ball.lastHitter === 'left' ? ball.x > layout.centerX : ball.lastHitter === 'right' && ball.x < layout.centerX) crossed = true;
      // Whose ball is it? The opponent's last shot once it is on this side; a serve belongs to the side it travels into.
      for (const side of ['left', 'right'] as const) {
        const mine = side === 'left' ? ball.x < layout.centerX : ball.x > layout.centerX;
        const pass = passes[side];
        const inbound = side === 'left' ? ball.vx < 0 : ball.vx > 0;
        const toPlay = ball.lastHitter === null ? inbound || pass.open : ball.lastHitter !== side;
        if (mine && toPlay) {
          pass.open = true;
          pass.serve = ball.lastHitter === null;
          if (previous.live) {
            const p = paddles[side];
            const before = previous[side];
            pass.closest = Math.min(pass.closest, sweptDistance(previous.ballX, previous.ballY, ball.x, ball.y, before.x, before.y, p.x, p.y));
          }
        } else if (pass.open && !mine) closePass(side, false);
      }
    } else if (previous.live) {
      // The rally is over: whoever still had the ball to play missed it.
      closePass('left', false);
      closePass('right', false);
      awaitingCrossing = false;
      const hitter = previous.hitter;
      if (hitter === 'left') result.endings[crossed ? 'cpuMiss' : 'playerFault'] += 1;
      else if (hitter === 'right') result.endings[crossed ? 'playerMiss' : 'cpuFault'] += 1;
      else result.endings.playerMiss += 1;
      result.rallies += 1;
      totalHits += rallyHits;
      result.longestRally = Math.max(result.longestRally, rallyHits);
      rallyHits = 0;
    }

    previous.ballX = ball.x;
    previous.ballY = ball.y;
    previous.live = live;
    previous.hitter = live ? ball.lastHitter : null;
    previous.hits = scene.rallyHits;
    previous.left.x = left.x;
    previous.left.y = left.y;
    previous.right.x = right.x;
    previous.right.y = right.y;
    // The scene may fall back to the fly hunt after unreturned serves; the benchmark keeps the rally going.
    if (scene.mode !== 'rally') scene.setMode('rally', now);
  }

  result.averageHits = result.rallies ? totalHits / result.rallies : 0;
  result.updateMicros = frames ? (cost / frames) * 1000 : 0;
  return result;
}

/** Sums a set of rally runs into one line. */
export function combine(results: RallyResult[]): RallyResult {
  const total = { ...results[0], seed: -1, endings: { ...results[0].endings } };
  let hits = total.averageHits * total.rallies;
  let cost = total.updateMicros;
  for (const r of results.slice(1)) {
    hits += r.averageHits * r.rallies;
    cost += r.updateMicros;
    total.rallies += r.rallies;
    total.longestRally = Math.max(total.longestRally, r.longestRally);
    total.playerAttempts += r.playerAttempts;
    total.playerHits += r.playerHits;
    total.playerNearMisses += r.playerNearMisses;
    total.serveAttempts += r.serveAttempts;
    total.serveHits += r.serveHits;
    total.serveNearMisses += r.serveNearMisses;
    total.cpuAttempts += r.cpuAttempts;
    total.cpuHits += r.cpuHits;
    total.doubleHits += r.doubleHits;
    total.playerReturnsOver += r.playerReturnsOver;
    total.endings = {
      playerMiss: total.endings.playerMiss + r.endings.playerMiss,
      playerFault: total.endings.playerFault + r.endings.playerFault,
      cpuMiss: total.endings.cpuMiss + r.endings.cpuMiss,
      cpuFault: total.endings.cpuFault + r.endings.cpuFault,
    };
  }
  total.averageHits = total.rallies ? hits / total.rallies : 0;
  total.updateMicros = cost / results.length;
  return total;
}
