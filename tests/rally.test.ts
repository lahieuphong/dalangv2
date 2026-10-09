import { describe, expect, it } from 'vitest';
import { combine, runRally, runServeDrill } from '../bench/rallyHarness';
import { BALL_RADIUS, fly, launchVelocity } from '../src/scene/BallPhysics';
import { emptyStroke, MAX_BALL_SPEED, RALLY_ASSIST, RALLY_ASSIST_MODES, resolveStroke, type RallyAssistMode, type StrokeInput } from '../src/scene/RallyAssist';
import { emptyPaddle, SceneController, type PaddleInput, type RallyContact } from '../src/scene/SceneController';
import { computeLayout } from '../src/scene/StageProps';
import { SIDES, type Side } from '../src/types';
import { mulberry32 } from '../src/utils/math';
import { runEngine } from './helpers';

/**
 * The ball game, tested as the player meets it: a paddle is put somewhere (or
 * moved along a path), a ball is sent on a known flight, and the scene decides.
 * Everything is deterministic: fixed stage, fixed flights, seeded randomness.
 */

const layout = computeLayout(1200);
const { table, centerX } = layout;
const RADIUS = 20;
/** Centre distance at which ball and paddle just touch. */
const TOUCH = RADIUS + BALL_RADIUS;

interface Pose {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
type Motion = (t: number) => Pose;

const hold = (x: number, y: number): Motion => () => ({ x, y, vx: 0, vy: 0 });
/** Out of the way: nowhere near anything a ball does in these tests. */
const AWAY: Record<Side, Motion> = { left: hold(60, 60), right: hold(1140, 60) };

/**
 * A straight stroke: the paddle rests at the start, then travels at (vx, vy)
 * so that it passes (x, y) at time `at`, and stops `follow` seconds later.
 */
const stroke = (x: number, y: number, vx: number, vy: number, at: number, lead = 0.12, follow = 0.1): Motion => (t) => {
  const u = Math.min(Math.max(t - at, -lead), follow);
  const moving = t - at > -lead && t - at < follow;
  return { x: x + vx * u, y: y + vy * u, vx: moving ? vx : 0, vy: moving ? vy : 0 };
};

/** A stage with scripted paddles. Both count as human hands. */
class Court {
  readonly scene = new SceneController(layout);
  readonly paddles: Record<Side, PaddleInput> = { left: emptyPaddle(), right: emptyPaddle() };
  readonly contacts: RallyContact[] = [];
  readonly motions: Partial<Record<Side, Motion>>;
  /** Seconds since the court was set up. */
  t = 0;
  private now = 1000;

  constructor(mode: RallyAssistMode, motions: Partial<Record<Side, Motion>>) {
    this.motions = motions;
    this.scene.setAssist(mode);
    this.scene.mode = 'rally';
    this.place();
    // One frame with no ball in play, so every paddle has a previous pose to be swept from.
    this.scene.update(this.now, 1 / 60, layout, this.paddles, null, null);
  }

  private place() {
    for (const side of SIDES) {
      const motion = this.motions[side];
      const paddle = this.paddles[side];
      paddle.active = paddle.human = motion !== undefined;
      paddle.radius = RADIUS;
      if (motion) Object.assign(paddle, motion(this.t));
    }
  }

  launch(x: number, y: number, vx: number, vy: number, hitter: Side | null = 'right') {
    this.scene.launchBall(x, y, vx, vy, this.now, hitter);
  }

  step(dt: number) {
    this.t += dt;
    this.now += dt * 1000;
    this.place();
    this.scene.update(this.now, dt, layout, this.paddles, null, null);
    for (const contact of this.scene.contacts) this.contacts.push({ ...contact });
    this.scene.cues.length = 0;
  }

  run(seconds: number, fps = 60, each?: (court: Court) => void) {
    const frames = Math.round(seconds * fps);
    for (let i = 0; i < frames; i++) {
      this.step(1 / fps);
      each?.(this);
    }
    return this;
  }
}

/* ------------------------------------------------------------------ a ball aimed past a paddle */

/** Where the fly-by tests keep the paddle: well clear of the table, the ground and the walls. */
const SPOT = { x: 330, y: 250 };
const ORIGIN = { x: 560, y: 215 };

/** How close a free-flying ball really comes to a point: the truth the scene is judged against. */
function closestApproach(from: { x: number; y: number }, v: { vx: number; vy: number }, point: { x: number; y: number }, seconds: number) {
  const body = { x: from.x, y: from.y, vx: v.vx, vy: v.vy };
  const h = 1 / 9600;
  let best = Infinity;
  for (let t = 0; t <= seconds; t += h) {
    best = Math.min(best, Math.hypot(body.x - point.x, body.y - point.y));
    fly(body, h);
  }
  return best;
}

/**
 * The launch velocity for a ball that leaves ORIGIN and passes SPOT at
 * `ratio` touching distances from its centre (0 = straight through the
 * middle, 1 = the discs just touch), taking `time` seconds to get there.
 */
function passAt(ratio: number, time = 0.5) {
  const launch = (offset: number) => launchVelocity(ORIGIN.x, ORIGIN.y, SPOT.x, SPOT.y - offset, time, { vx: 0, vy: 0 });
  let low = 0;
  let high = TOUCH * 5;
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (closestApproach(ORIGIN, launch(middle), SPOT, time * 1.4) < ratio * TOUCH) low = middle;
    else high = middle;
  }
  const velocity = launch((low + high) / 2);
  return { velocity, miss: closestApproach(ORIGIN, velocity, SPOT, time * 1.4) };
}

/** Plays one aimed ball past a paddle held still at SPOT. */
function flyBy(mode: RallyAssistMode, ratio: number, options: { time?: number; fps?: number; court?: Court } = {}) {
  const { velocity, miss } = passAt(ratio, options.time);
  const court = options.court ?? new Court(mode, { left: hold(SPOT.x, SPOT.y) });
  const before = court.contacts.length;
  court.launch(ORIGIN.x, ORIGIN.y, velocity.vx, velocity.vy);
  court.run(0.9, options.fps ?? 60);
  return { court, velocity, miss, contact: court.contacts[before] as RallyContact | undefined, hits: court.contacts.length - before };
}

const fromSpot = (contact: RallyContact) => Math.hypot(contact.x - SPOT.x, contact.y - SPOT.y);

describe('smart collision', () => {
  it('1 · core hit: a ball that meets the paddle is always a hit, stopped exactly where the two touch', () => {
    for (const mode of RALLY_ASSIST_MODES) {
      const { court, contact, hits } = flyBy(mode, 0);
      expect(hits).toBe(1);
      expect(contact).toMatchObject({ side: 'left', kind: 'CORE', human: true });
      expect(contact!.quality).toBeGreaterThan(0.99);
      // Contact is found inside the step, not at its end: the ball is on the rim to a hundredth of a unit.
      expect(Math.abs(fromSpot(contact!) - TOUCH)).toBeLessThan(0.02);
      const { scene } = court;
      expect(scene.ball.lastHitter).toBe('left');
      expect(scene.rallyHits).toBe(1);
      expect(scene.lastOutcome.left).toBe('CORE');
      expect(scene.stats).toMatchObject({ coreContacts: 1, assistedContacts: 0, attempts: 1, misses: 0 });
    }
    // Off-centre but still touching: a hit in every mode, rated lower the nearer the rim it lands.
    for (const mode of RALLY_ASSIST_MODES) {
      const centre = flyBy(mode, 0.2).contact!;
      const rim = flyBy(mode, 0.95).contact!;
      expect(rim.kind).toBe('CORE');
      expect(centre.quality).toBeGreaterThan(rim.quality);
      expect(rim.quality).toBeGreaterThanOrEqual(0.62);
    }
  });

  it('2 · forgiveness hit: a ball that passes just clear of the paddle is rescued where it is, except in Precision', () => {
    const precision = flyBy('precision', 1.2);
    expect(precision.miss / TOUCH).toBeCloseTo(1.2, 2);
    expect(precision.hits).toBe(0);
    expect(precision.court.scene.ball.lastHitter).toBe('right');
    expect(precision.court.scene.lastOutcome.left).toBe('MISS');

    for (const mode of ['natural', 'cinematic'] as const) {
      const { contact, hits, velocity, miss } = flyBy(mode, 1.2);
      expect(hits).toBe(1);
      expect(contact!.kind).toBe('ASSIST');
      // Rated below any real contact, and it earns no more help than the preset allows.
      expect(contact!.quality).toBeLessThan(0.62);
      expect(contact!.quality).toBeGreaterThanOrEqual(0.2);
      expect(contact!.weight).toBeLessThanOrEqual(RALLY_ASSIST[mode].aimAssist);
      // The ball was not pulled onto the paddle: it is struck at its nearest point, still on its own flight path.
      expect(fromSpot(contact!)).toBeGreaterThan(TOUCH * 1.15);
      expect(Math.abs(fromSpot(contact!) - miss)).toBeLessThan(0.5);
      expect(closestApproach(ORIGIN, velocity, contact!, 0.7)).toBeLessThan(0.05);
    }

    // Quality falls steadily from the middle of the paddle to the edge of the ring, with no step where the zones meet.
    const ratios = [0, 0.3, 0.6, 0.9, 0.99, 1.01, 1.1, 1.2, 1.3, 1.4];
    const quality = ratios.map((ratio) => flyBy('natural', ratio).contact!.quality);
    for (let i = 1; i < quality.length; i++) expect(quality[i]).toBeLessThanOrEqual(quality[i - 1] + 1e-9);
    expect(quality[4] - quality[5]).toBeLessThan(0.05);
    expect(quality[0]).toBe(1);
    expect(quality[quality.length - 1]).toBeLessThan(0.35);
  });

  it('3 · outside miss: a ball beyond the ring is a miss in every mode, however many were missed before', () => {
    for (const mode of RALLY_ASSIST_MODES) {
      const { court, hits } = flyBy(mode, 2.3);
      expect(hits).toBe(0);
      expect(court.scene.ball.lastHitter).toBe('right');
      expect(court.scene.lastOutcome.left).toBe('MISS');
      expect(court.scene.stats).toMatchObject({ coreContacts: 0, assistedContacts: 0, attempts: 1, misses: 1 });
    }

    // A run of misses widens the ring a little, but only up to the preset's ceiling.
    for (const mode of ['natural', 'cinematic'] as const) {
      const config = RALLY_ASSIST[mode];
      const court = new Court(mode, { left: hold(SPOT.x, SPOT.y) });
      let widest = 0;
      for (let pass = 0; pass < 6; pass++) {
        const { velocity } = passAt(2.3);
        court.launch(ORIGIN.x, ORIGIN.y, velocity.vx, velocity.vy);
        court.run(0.8, 60, () => (widest = Math.max(widest, court.scene.zones.left.forgiveness / TOUCH)));
      }
      expect(court.scene.stats.misses).toBe(6);
      expect(widest).toBeGreaterThan(config.forgiveness);
      expect(widest).toBeLessThanOrEqual(config.forgivenessMax + 1e-9);
      // Still a miss just beyond the furthest the ring can ever reach.
      expect(flyBy(mode, config.reachMax + 0.1, { court }).hits).toBe(0);
    }
  });

  it('4 · fast ball: nothing tunnels through the paddle, even at 30 frames a second', () => {
    for (const mode of RALLY_ASSIST_MODES) {
      for (const fps of [30, 60]) {
        // 230 units in 0.45 s, 0.2 s and under 0.1 s: up to 2400 units / s, 80 units between two frames at 30 fps.
        for (const time of [0.45, 0.2, 0.096]) {
          const { contact, hits } = flyBy(mode, 0, { time, fps });
          expect(hits).toBe(1);
          expect(contact!.kind).toBe('CORE');
          expect(Math.abs(fromSpot(contact!) - TOUCH)).toBeLessThan(0.05);
        }
        // The thinnest of grazes at full speed: the ball is inside the touching distance for less than one step.
        const graze = flyBy(mode, 0.985, { time: 0.096, fps });
        expect(graze.hits).toBe(1);
        expect(graze.contact!.kind).toBe('CORE');
      }
    }
  });

  it('5 · moving racket: a swing through a hanging ball hits it, and sends it where the swing was going', () => {
    /** A ball tossed gently up at (300, 200), and a paddle swung through that spot at the given velocity. */
    const swing = (mode: RallyAssistMode, vx: number, vy: number, fps = 30) => {
      const court = new Court(mode, { left: stroke(300, 202, vx, vy, 0.2, 0.2, 0.15) });
      court.launch(300, 200, 0, -40);
      court.run(0.5, fps);
      return { court, contact: court.contacts[0] as RallyContact | undefined, ball: { ...court.scene.lastStroke } };
    };
    const physicalSpeed = (s: { physicalVx: number; physicalVy: number }) => Math.hypot(s.physicalVx, s.physicalVy);
    const elevation = (v: { vx: number; vy: number }) => Math.atan2(-v.vy, Math.abs(v.vx));

    for (const mode of RALLY_ASSIST_MODES) {
      const cap = RALLY_ASSIST[mode].aimAssist;
      const flat = swing(mode, 900, 0);
      expect(flat.court.contacts).toHaveLength(1);
      expect(flat.contact!.kind).toBe('CORE');
      expect(flat.ball.vx).toBeGreaterThan(0);

      // The paddle crosses 80 units between two frames: it still cannot pass through the ball.
      const violent = swing(mode, 2400, 0);
      expect(violent.court.contacts).toHaveLength(1);
      expect(violent.contact!.kind).toBe('CORE');

      // A paddle merely held under the same ball returns it toward the far side at a moderate pace. The swing's
      // momentum adds to that: much more in the stroke itself, and still more once any pace assist has had its say.
      const block = new Court(mode, { left: hold(300, 240) });
      block.launch(300, 200, 0, -40);
      block.run(0.5, 30);
      expect(block.contacts).toHaveLength(1);
      expect(block.scene.ball.vx).toBeGreaterThan(0);
      expect(physicalSpeed(block.scene.lastStroke)).toBeGreaterThan(200);
      expect(physicalSpeed(block.scene.lastStroke)).toBeLessThan(330);
      expect(physicalSpeed(flat.ball)).toBeGreaterThan(physicalSpeed(block.scene.lastStroke) + 100);
      expect(flat.contact!.speed).toBeGreaterThan(block.contacts[0].speed);
      expect(flat.contact!.power).toBeGreaterThan(block.contacts[0].power + 0.4);

      // Swinging upward lifts the shot.
      const lifted = swing(mode, 640, -640);
      expect(lifted.court.contacts).toHaveLength(1);
      expect(elevation(lifted.ball)).toBeGreaterThan(elevation(flat.ball) + 0.15);

      // A deliberate swing the wrong way is not corrected: the ball goes backward, with next to no assistance.
      const backward = swing(mode, -900, 0);
      expect(backward.court.contacts).toHaveLength(1);
      expect(backward.ball.vx).toBeLessThan(0);
      expect(backward.ball.physicalVx).toBeLessThan(0);
      expect(backward.contact!.weight).toBeLessThanOrEqual(cap * 0.1);
    }
  });

  it('6 · no double hit: one stroke is one hit, however long the paddle stays on the ball', () => {
    for (const mode of RALLY_ASSIST_MODES) {
      const { velocity } = passAt(0);
      const court = new Court(mode, { left: hold(SPOT.x, SPOT.y) });
      court.launch(ORIGIN.x, ORIGIN.y, velocity.vx, velocity.vy);
      court.run(0.6, 60, () => {
        // After the hit the paddle follows through with the ball, overlapping it all the way.
        if (court.contacts.length === 0) return;
        const ball = court.scene.ball;
        court.motions.left = hold(ball.x - 9, ball.y + 4);
      });
      expect(court.contacts).toHaveLength(1);
      expect(court.scene.rallyHits).toBe(1);
      expect(court.scene.stats.coreContacts + court.scene.stats.assistedContacts).toBe(1);
      // The repeat contact was seen and refused, and is itself counted once.
      expect(court.scene.stats.blockedDoubleHits).toBe(1);

      // A second, separate stroke is a second hit: the paddle lets go of the ball, then meets it again further on.
      court.motions.left = AWAY.left;
      court.run(0.3);
      const forecast = court.scene.forecast;
      expect(forecast.valid).toBe(true);
      const ahead = forecast.samples.slice(0, forecast.count).find((sample) => sample.t - forecast.age >= 0.4)!;
      court.motions.left = hold(ahead.x - 6, ahead.y + 12);
      court.run(0.7);
      expect(court.contacts).toHaveLength(2);
      expect(court.contacts[1].at - court.contacts[0].at).toBeGreaterThan(650);
      expect(court.scene.rallyHits).toBe(2);
    }
  });
});

/* ------------------------------------------------------------------ returns */

const forwardOf = (side: Side) => (side === 'left' ? 1 : -1);

/** An opponent's shot that lands in the middle of `side`'s half of the table. */
function incomingShot(court: Court, side: Side) {
  const forward = forwardOf(side);
  const from = { x: centerX + forward * 220, y: table.top - 108 };
  const to = { x: centerX - forward * 0.55 * (table.right - centerX), y: table.top - BALL_RADIUS };
  const v = launchVelocity(from.x, from.y, to.x, to.y, 0.95, { vx: 0, vy: 0 });
  court.launch(from.x, from.y, v.vx, v.vy, side === 'left' ? 'right' : 'left');
}

/** Where that shot is at the top of its bounce, read from the scene's own forecast, and when (court time). */
function topOfBounce(court: Court) {
  const forecast = court.scene.forecast;
  let best = forecast.samples[0];
  for (let i = 0; i < forecast.count; i++) {
    const sample = forecast.samples[i];
    if (sample.bounces === 1 && (best.bounces !== 1 || sample.y < best.y)) best = sample;
  }
  return { x: best.x, y: best.y, at: court.t + best.t - forecast.age };
}

/** Strokes for the return tests: toward the far side and up, from a push to a full swing (stage units / s). */
type Swing = readonly [forward: number, vertical: number] | null;
const BLOCK: Swing = null;
const PUSH: Swing = [120, -80];
const DRIVE: Swing = [500, -330];
const SMASH: Swing = [700, -200];

/**
 * Receives an incoming shot at the top of its bounce, either with a paddle
 * held still just behind and below the ball (`swing` null), or with a stroke
 * through that point at the given velocity. Reports what became of the return.
 */
function receive(mode: RallyAssistMode, side: Side, swing: Swing, fps = 60, pace?: (frame: number) => number) {
  // The flight is planned once, on a court of its own, so every frame pacing is handed the very same stroke.
  const planning = new Court(mode, { [side]: AWAY[side] });
  incomingShot(planning, side);
  planning.step(1 / 240);
  const top = topOfBounce(planning);
  const forward = forwardOf(side);
  const meet = { x: top.x - forward * 14, y: top.y + 12 };
  const motion = swing ? stroke(meet.x, meet.y, forward * swing[0], swing[1], top.at) : hold(meet.x, meet.y);

  const court = new Court(mode, { [side]: motion });
  incomingShot(court, side);
  const far: Side = side === 'left' ? 'right' : 'left';
  const result = { court, crossed: false, landedFar: false, bouncedNear: false, at: { x: 0, y: 0, vx: 0, vy: 0 } };
  const seconds = 3.6;
  let frame = 0;
  while (court.t < seconds - 1e-9) {
    court.step(Math.min((1 / fps) * (pace ? pace(frame++) : 1), seconds - court.t));
    const ball = court.scene.ball;
    // The return has come to rest somewhere: nothing more to learn (and the next serve must not be mistaken for it).
    if (court.contacts.length > 0 && ball.state !== 'live') break;
    if (court.contacts.length > 0) {
      if ((ball.x - centerX) * forward > BALL_RADIUS) result.crossed = true;
      if (ball.bounces[far] > 0) result.landedFar = true;
      if (ball.bounces[side] > 0) result.bouncedNear = true;
    }
    // Where the ball is a moment after the return, for comparing one frame pacing with another.
    if (Math.abs(court.t - (top.at + 0.3)) < 1e-9) result.at = { x: ball.renderX, y: ball.renderY, vx: ball.vx, vy: ball.vy };
  }
  return { ...result, sampleAt: top.at + 0.3 };
}

describe('rally assist', () => {
  it('7 · valid return: a measured stroke clears the net and lands on the far half of the table, from either side', () => {
    for (const mode of RALLY_ASSIST_MODES) {
      const config = RALLY_ASSIST[mode];
      for (const side of SIDES) {
        const played = receive(mode, side, PUSH);
        expect(played.court.contacts).toHaveLength(1);
        expect(played.court.contacts[0]).toMatchObject({ side, kind: 'CORE' });
        expect(played.crossed).toBe(true);
        expect(played.landedFar).toBe(true);
        expect(played.bouncedNear).toBe(false);
        // Within the limits of the game: no return leaves the paddle faster than a rally can follow.
        expect(played.court.contacts[0].speed).toBeLessThanOrEqual(MAX_BALL_SPEED);
        expect(played.court.contacts[0].weight).toBeLessThanOrEqual(config.aimAssist);
        expect(played.court.contacts[0].pace).toBeLessThanOrEqual(config.paceAssist);
      }
    }

    // With assistance, a paddle merely held in the way and a full-blooded swing both land too: the block at a
    // moderate pace, the swing faster, and the harder swing never the slower ball.
    for (const mode of ['natural', 'cinematic'] as const) {
      for (const side of SIDES) {
        const blocked = receive(mode, side, BLOCK);
        const driven = receive(mode, side, DRIVE);
        const smashed = receive(mode, side, SMASH);
        for (const played of [blocked, driven, smashed]) {
          expect(played.court.contacts).toHaveLength(1);
          expect(played.crossed).toBe(true);
          expect(played.landedFar).toBe(true);
          expect(played.bouncedNear).toBe(false);
        }
        expect(blocked.court.contacts[0].speed).toBeGreaterThan(240);
        expect(blocked.court.contacts[0].speed).toBeLessThan(360);
        expect(driven.court.contacts[0].speed).toBeGreaterThan(blocked.court.contacts[0].speed + 25);
        expect(smashed.court.contacts[0].speed).toBeGreaterThanOrEqual(driven.court.contacts[0].speed - 1);
        expect(smashed.court.contacts[0].speed).toBeLessThanOrEqual(MAX_BALL_SPEED);
      }
    }

    // Precision leaves both exactly as the stroke made them: from this far back the block drops short and the
    // full swing sails long. Getting the ball onto the table is the performer's job there.
    for (const side of SIDES) {
      const blocked = receive('precision', side, BLOCK);
      expect(blocked.court.contacts[0]).toMatchObject({ weight: 0, pace: 0 });
      expect(blocked.landedFar).toBe(false);
      const driven = receive('precision', side, DRIVE);
      expect(driven.court.contacts[0]).toMatchObject({ weight: 0, pace: 0 });
      expect(driven.crossed).toBe(true);
      expect(driven.landedFar).toBe(false);
    }
  });

  it('8 · assist limit: aim assistance never exceeds its ceiling and never decides more than the stroke does', () => {
    const random = mulberry32(88);
    const between = (a: number, b: number) => a + (b - a) * random();
    const angle = (ax: number, ay: number, bx: number, by: number) =>
      Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by)))));
    const out = emptyStroke();

    for (const mode of RALLY_ASSIST_MODES) {
      const config = RALLY_ASSIST[mode];
      let assisted = 0;
      let highest = 0;
      for (let i = 0; i < 3000; i++) {
        const side: Side = random() < 0.5 ? 'left' : 'right';
        const forward = forwardOf(side);
        const heading = between(0, Math.PI * 2);
        const normal = between(0, Math.PI * 2);
        const paddleSpeed = random() < 0.25 ? 0 : between(0, 900);
        const ballSpeed = between(60, 500);
        const ballHeading = between(0, Math.PI * 2);
        const input: StrokeInput = {
          side,
          layout,
          config,
          ballX: centerX - forward * between(20, 330),
          ballY: table.top - between(30, 220),
          ballVx: Math.cos(ballHeading) * ballSpeed,
          ballVy: Math.sin(ballHeading) * ballSpeed,
          paddleVx: Math.cos(heading) * paddleSpeed,
          paddleVy: Math.sin(heading) * paddleSpeed,
          nx: Math.cos(normal),
          ny: Math.sin(normal),
          quality: between(0.2, 1),
          opponentX: random() < 0.5 ? null : centerX + forward * between(60, 500),
          random,
        };
        const s = resolveStroke(input, out);
        expect(s.weight).toBeGreaterThanOrEqual(0);
        expect(s.weight).toBeLessThanOrEqual(config.aimAssist + 1e-12);
        expect(s.pace).toBeGreaterThanOrEqual(0);
        expect(s.pace).toBeLessThanOrEqual(config.paceAssist + 1e-12);
        highest = Math.max(highest, s.weight);
        const physical = Math.hypot(s.physicalVx, s.physicalVy);
        const final = Math.hypot(s.vx, s.vy);
        // Direction and pace are helped together or not at all: a stroke aimed elsewhere gets neither.
        expect(s.weight === 0).toBe(s.pace === 0);
        if (s.weight === 0) {
          // No assistance: the ball leaves exactly as the stroke sent it.
          expect(s.vx).toBe(s.physicalVx);
          expect(s.vy).toBe(s.physicalVy);
          continue;
        }
        assisted += 1;
        expect(s.assistedValid).toBe(true);
        // The return stays nearer the stroke's own line than the assisted one, and its speed lies between the two.
        const whole = angle(s.physicalVx, s.physicalVy, s.assistedVx, s.assistedVy);
        expect(angle(s.physicalVx, s.physicalVy, s.vx, s.vy)).toBeLessThanOrEqual(whole / 2 + 1e-9);
        const target = Math.hypot(s.assistedVx, s.assistedVy);
        expect(final).toBeGreaterThanOrEqual(Math.min(physical, target) - 1e-6);
        expect(final).toBeLessThanOrEqual(Math.max(physical, target) + 1e-6);
        // A clean hit with a real swing behind it gets about half the ceiling, never more.
        if (input.quality > 0.99 && paddleSpeed > 260) expect(s.weight).toBeLessThanOrEqual(config.aimAssist * 0.505 + 1e-12);
      }
      if (mode === 'precision') {
        expect(assisted).toBe(0);
        expect(highest).toBe(0);
      } else {
        expect(assisted).toBeGreaterThan(500);
        expect(highest).toBeGreaterThan(config.aimAssist * 0.8);
      }
    }

    // A full swing away from the table, in every mode: the ball goes away from the table.
    for (const mode of RALLY_ASSIST_MODES) {
      for (const side of SIDES) {
        const forward = forwardOf(side);
        const s = resolveStroke(
          {
            side,
            layout,
            config: RALLY_ASSIST[mode],
            ballX: centerX - forward * 150,
            ballY: table.top - 100,
            ballVx: forward * -200,
            ballVy: 60,
            paddleVx: -forward * 600,
            paddleVy: 0,
            nx: -forward,
            ny: 0,
            quality: 1,
            opponentX: null,
            random,
          },
          out,
        );
        expect(s.vx * forward).toBeLessThan(0);
        expect(s.weight).toBe(0);
        expect(s.pace).toBe(0);
        expect(s.vx).toBe(s.physicalVx);
      }
    }
  });

  it('9 · two human hands: each hand plays its own paddle, and the stage agent keeps out', () => {
    // Left blocks a ball beside the net; right meets the return a moment later. Neither stroke holds the other up.
    for (const mode of RALLY_ASSIST_MODES) {
      const court = new Court(mode, { left: hold(540, 330), right: AWAY.right });
      const v = launchVelocity(680, 300, 540, 330 - TOUCH + 2, 0.4, { vx: 0, vy: 0 });
      court.launch(680, 300, v.vx, v.vy);
      court.run(0.6, 60, () => {
        if (court.contacts.length !== 1 || court.motions.right !== AWAY.right) return;
        const forecast = court.scene.forecast;
        const ahead = forecast.samples.slice(0, forecast.count).find((sample) => sample.t - forecast.age >= 0.12)!;
        court.motions.right = hold(ahead.x + 8, ahead.y + 10);
      });
      expect(court.contacts.map((contact) => contact.side)).toEqual(['left', 'right']);
      expect(court.contacts.every((contact) => contact.human)).toBe(true);
      // The second hand's hit lands inside the first hand's own lock-out, and still counts.
      expect(court.contacts[1].at - court.contacts[0].at).toBeLessThan(220);
      expect(court.scene.rallyHits).toBe(2);
      expect(court.scene.stats.blockedDoubleHits).toBe(0);
    }

    // The full pipeline with two simulated hands in a rally: the agent never takes either puppet.
    let frames = 0;
    runEngine('two', 6, (engine, now) => {
      if (now > 1500 && engine.scene.mode === 'hunt') engine.scene.setMode('rally', now);
      if (now < 2500) return;
      frames += 1;
      const { hands, agentSide } = engine.telemetry;
      expect(hands.left.tracked && hands.right.tracked).toBe(true);
      expect(agentSide).toBeNull();
      expect(hands.left.agent || hands.right.agent).toBe(false);
      expect(engine.paddles.left.human && engine.paddles.right.human).toBe(true);
    });
    expect(frames).toBeGreaterThan(100);

    // A hand that comes and goes: the agent may fill in while it is away, but never while it is there.
    runEngine('loss', 12, (engine, now) => {
      if (now > 1500 && engine.scene.mode === 'hunt') engine.scene.setMode('rally', now);
      for (const side of SIDES) expect(engine.telemetry.hands[side].tracked && engine.puppets[side].agentDriven).toBe(false);
    });
  });

  it('10 · frame independence: 30, 60 and 120 frames a second, and an uneven frame time, play the same stroke the same way', () => {
    const random = mulberry32(31);
    const uneven = () => 0.65 + 0.7 * random();
    for (const mode of RALLY_ASSIST_MODES) {
      for (const how of [BLOCK, PUSH, SMASH]) {
        const reference = receive(mode, 'left', how, 60);
        expect(reference.court.contacts).toHaveLength(1);
        const hit = reference.court.contacts[0];
        const runs = [receive(mode, 'left', how, 30), receive(mode, 'left', how, 120), receive(mode, 'left', how, 60, uneven), receive(mode, 'left', how, 144, uneven)];
        for (const run of runs) {
          expect(run.court.contacts).toHaveLength(1);
          const other = run.court.contacts[0];
          expect(other.kind).toBe(hit.kind);
          // Same contact point, same quality, same assistance, same speed off the paddle.
          expect(Math.hypot(other.x - hit.x, other.y - hit.y)).toBeLessThan(0.5);
          expect(Math.abs(other.quality - hit.quality)).toBeLessThan(0.02);
          expect(Math.abs(other.weight - hit.weight)).toBeLessThan(0.01);
          expect(Math.abs(other.speed - hit.speed)).toBeLessThan(hit.speed * 0.01);
          expect(run.crossed).toBe(reference.crossed);
          expect(run.landedFar).toBe(reference.landedFar);
        }
        // On a regular frame time the ball is in the same place at the same moment, to a fraction of a unit.
        for (const run of runs.slice(0, 2)) {
          expect(Math.hypot(run.at.x - reference.at.x, run.at.y - reference.at.y)).toBeLessThan(0.75);
          expect(Math.hypot(run.at.vx - reference.at.vx, run.at.vy - reference.at.vy)).toBeLessThan(4);
        }
      }
    }

    // And with no paddle at all, a bouncing ball follows exactly the same path at any frame rate.
    const flight = (fps: number, pace?: () => number) => {
      const court = new Court('natural', {});
      court.launch(700, 250, -160, -120);
      while (court.t < 1.5 - 1e-9) court.step(Math.min((1 / fps) * (pace ? pace() : 1), 1.5 - court.t));
      return court.scene.ball;
    };
    const base = flight(60);
    expect(base.bounces.left + base.bounces.right).toBeGreaterThan(0);
    for (const other of [flight(30), flight(120), flight(60, uneven), flight(144, uneven)]) {
      expect(Math.hypot(other.renderX - base.renderX, other.renderY - base.renderY)).toBeLessThan(0.05);
    }
  });
});

/* ------------------------------------------------------------------ whole rallies */

describe('rally simulation', () => {
  it('11 · rally simulation: a simulated player and the stage agent keep a rally going, and every count adds up', () => {
    for (const mode of ['natural', 'cinematic'] as const) {
      let contacts = 0;
      let human = 0;
      let agent = 0;
      let worstQuality = 1;
      let highestWeight = 0;
      let fastest = 0;
      let stats = null as SceneController['stats'] | null;
      let closestRepeat = Infinity;
      const results = [1, 2, 3].map((seed) => {
        let core = 0;
        let assisted = 0;
        const lastAt: Record<Side, number> = { left: -Infinity, right: -Infinity };
        const result = runRally({ mode, skill: 'sloppy', seed, seconds: 90, fps: 60 }, (scene) => {
          for (const contact of scene.contacts) {
            contacts += 1;
            if (contact.kind === 'CORE') core += 1;
            else assisted += 1;
            if (contact.human) human += 1;
            else agent += 1;
            worstQuality = Math.min(worstQuality, contact.quality);
            highestWeight = Math.max(highestWeight, contact.weight);
            fastest = Math.max(fastest, contact.speed);
            closestRepeat = Math.min(closestRepeat, contact.at - lastAt[contact.side]);
            lastAt[contact.side] = contact.at;
          }
          stats = scene.stats;
        });
        // The scene's own telemetry agrees with what was seen happening.
        expect(stats!.coreContacts).toBe(core);
        expect(stats!.assistedContacts).toBe(assisted);
        expect(stats!.attempts).toBe(core + assisted + stats!.misses);
        expect(stats!.longest).toBeGreaterThanOrEqual(stats!.averageLength);
        expect(stats!.averageQuality).toBeGreaterThan(0.5);
        expect(stats!.averageQuality).toBeLessThanOrEqual(1);
        expect(stats!.averageTravelMs).toBeGreaterThan(300);
        expect(stats!.averageTravelMs).toBeLessThan(2500);
        return result;
      });
      const total = combine(results);
      expect(total.rallies).toBeGreaterThanOrEqual(8);
      // The original game averaged about two hits a rally in this very scenario.
      expect(total.averageHits).toBeGreaterThan(4);
      expect(total.longestRally).toBeGreaterThanOrEqual(10);
      expect(total.doubleHits).toBe(0);
      // No paddle was ever credited twice within its lock-out, whatever came between.
      expect(closestRepeat).toBeGreaterThanOrEqual(220);
      expect(total.playerHits).toBeGreaterThan(20);
      expect(total.cpuHits).toBeGreaterThan(20);
      expect(human).toBeGreaterThan(20);
      expect(agent).toBeGreaterThan(20);
      expect(contacts).toBe(human + agent);
      expect(worstQuality).toBeGreaterThanOrEqual(0.14);
      expect(highestWeight).toBeLessThanOrEqual(RALLY_ASSIST[mode].aimAssist);
      // However the agent or the player swung, no ball left a paddle faster than the limit.
      expect(fastest).toBeGreaterThan(300);
      expect(fastest).toBeLessThanOrEqual(MAX_BALL_SPEED);
    }
  });

  it('12 · miss must exist: a paddle that is not there hits nothing, and forgiveness never turns every attempt into a hit', () => {
    // Nobody at the paddle: not one ball is returned, in any mode, and the agent does not take the player's serve.
    for (const mode of RALLY_ASSIST_MODES) {
      const absent = runRally({ mode, skill: 'absent', seed: 3, seconds: 30, fps: 60 });
      expect(absent.rallies).toBeGreaterThanOrEqual(5);
      expect(absent.playerHits).toBe(0);
      expect(absent.cpuHits).toBe(0);
      expect(absent.averageHits).toBe(0);
    }

    // The same 200 clumsy attempts in each mode: more forgiveness rescues more of them, but never all.
    const drill = RALLY_ASSIST_MODES.map((mode) => runServeDrill({ mode, skill: 'novice', serves: 200, seed: 5, fps: 60 }));
    const [precision, natural, cinematic] = drill;
    expect(natural.hits).toBeGreaterThan(precision.hits);
    expect(cinematic.hits).toBeGreaterThanOrEqual(natural.hits);
    expect(cinematic.hits).toBeLessThan(cinematic.serves);
    // What is rescued is the near miss. A paddle that was nowhere near the ball misses it exactly as often in every mode.
    expect(precision.cleanMisses).toBeGreaterThan(0);
    expect(natural.cleanMisses).toBe(precision.cleanMisses);
    expect(cinematic.cleanMisses).toBe(precision.cleanMisses);
    expect(precision.missWithin.tight).toBeGreaterThan(natural.missWithin.tight);

    // The stage agent is beatable too.
    const agent = combine([1, 2, 3].map((seed) => runRally({ mode: 'natural', skill: 'steady', seed, seconds: 90, fps: 60 })));
    expect(agent.cpuHits).toBeGreaterThan(50);
    expect(agent.endings.cpuMiss + agent.endings.cpuFault).toBeGreaterThan(0);
    expect(agent.cpuHits).toBeLessThan(agent.cpuAttempts);
  });
});

/* ------------------------------------------------------------------ the setting */

describe('rally assistance setting', () => {
  it('switches in the middle of a rally without disturbing the ball, the puppets or the counts', () => {
    let switched = 0;
    const engine = runEngine('lift', 9, (eng, now) => {
      if (now > 1500 && eng.scene.mode === 'hunt') eng.scene.setMode('rally', now);
      const { scene } = eng;
      // Twice while a ball is in the air: to Cinematic, then to Precision.
      const next = switched === 0 ? 'cinematic' : 'precision';
      if (switched < 2 && scene.ball.state === 'live' && now > 4200 + switched * 2600) {
        const ball = { ...scene.ball, bounces: { ...scene.ball.bounces }, trail: scene.ball.trail.map((point) => ({ ...point })) };
        const counts = { hits: scene.rallyHits, seconds: scene.rallySeconds, best: scene.bestRally, stats: { ...scene.stats }, events: scene.events.length };
        const rigs = { left: { ...eng.puppets.left.rig }, right: { ...eng.puppets.right.rig } };
        const agent = { side: eng.telemetry.agentSide, driven: eng.puppets.right.agentDriven };

        eng.applySettings({ ...eng.settings, rallyAssist: next });

        expect(scene.assist.mode).toBe(next);
        expect({ ...scene.ball, bounces: { ...scene.ball.bounces }, trail: scene.ball.trail.map((point) => ({ ...point })) }).toEqual(ball);
        expect({ hits: scene.rallyHits, seconds: scene.rallySeconds, best: scene.bestRally, stats: { ...scene.stats }, events: scene.events.length }).toEqual(counts);
        expect({ left: { ...eng.puppets.left.rig }, right: { ...eng.puppets.right.rig } }).toEqual(rigs);
        expect({ side: eng.telemetry.agentSide, driven: eng.puppets.right.agentDriven }).toEqual(agent);
        expect(scene.mode).toBe('rally');
        switched += 1;
      }
    });
    expect(switched).toBe(2);
    expect(engine.scene.assist).toBe(RALLY_ASSIST.precision);
    expect(engine.telemetry.rallyAssist).toBe('precision');
  });
});
