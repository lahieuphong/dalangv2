import { BALL_RADIUS, launchVelocity, type BallSample } from '../scene/BallPhysics';
import { DEFAULT_RALLY_ASSIST, planSwing, RALLY_ASSIST, type RallyAssistConfig, type RallyAssistMode } from '../scene/RallyAssist';
import type { SceneController } from '../scene/SceneController';
import type { StageLayout } from '../scene/StageProps';
import type { PuppetRig, Side } from '../types';
import { clamp, lerp, mulberry32, RAD, smoothstep } from '../utils/math';
import { emptyRig, facing, PUPPET } from './PuppetRig';

/** While it has not yet found a way to the ball, it looks again this often, ms. */
const REPLAN_MS = 80;
/** Limits on how it shuffles sideways: top speed (stage units / s) and acceleration (per s²). */
const WALK_SPEED = 430;
const WALK_ACCEL = 2600;
/** The stroke: this long before the ball arrives the paddle starts forward, and it carries on this long after. */
const SWING_SECONDS = 0.15;
const FOLLOW_SECONDS = 0.16;
/** The followers that carry its pose trail the target by about this much; the swing is timed ahead to match. */
const FOLLOWER_LAG = 0.018;

export type AgentPhase = 'ready' | 'anticipate' | 'swing' | 'follow' | 'recover';

/**
 * The stage's own puppeteer. When only one hand is playing, it picks up the
 * other puppet for the rally: it reads the ball's predicted flight, walks to
 * where it will come down, gets its paddle behind the ball and swings through
 * it toward the far half of the table.
 *
 * It only ever produces a pose target, the same thing a hand produces, and
 * that target goes through the same followers, the same swept collision and
 * the same stroke model as a human's. Nothing is teleported: it walks with a
 * speed and an acceleration limit, takes a moment to react to each shot, and
 * aims a little off, more so the longer a rally lasts, so a patient player
 * wins the point. The rally-assistance preset sets how steady it is.
 */
export class AgentPuppeteer {
  /** The pose the agent asks for this frame. */
  readonly rig: PuppetRig = emptyRig();
  /** Where it is trying to put the paddle (stage units), for the debug view. */
  readonly aim = { x: 0, y: 0 };
  /** True while it has a ball to go for. */
  chasing = false;
  phase: AgentPhase = 'ready';

  private config: RallyAssistConfig = RALLY_ASSIST[DEFAULT_RALLY_ASSIST];
  private readonly random = mulberry32(4242);
  private readonly plan = { valid: false, x: 0, y: 0, at: 0, dx: 0, dy: -1, swingX: 0, swingY: 0 };
  private readonly swing = { vx: 0, vy: 0 };
  private readonly shot = { vx: 0, vy: 0 };
  private planAt = 0;
  private reactAt = 0;
  private plannedFor = -1;
  private errorX = 0;
  private errorY = 0;
  private rootX: number | null = null;
  private rootSpeed = 0;
  private side: Side | null = null;

  /** Follows the rally-assistance preset: how quickly it reacts and how true its aim stays. */
  setAssist(mode: RallyAssistMode) {
    this.config = RALLY_ASSIST[mode];
  }

  /** Forgets where it stood, so it starts from the puppet's home the next time it is called in. */
  reset() {
    this.rootX = null;
    this.rootSpeed = 0;
    this.side = null;
    this.plan.valid = false;
    this.plannedFor = -1;
    this.chasing = false;
    this.phase = 'ready';
  }

  update(side: Side, now: number, dt: number, layout: StageLayout, scene: SceneController): PuppetRig {
    if (this.side !== side) {
      this.side = side;
      this.rootX = null;
      this.rootSpeed = 0;
    }
    const flip = facing(side);
    const s = layout.puppetScale;
    const [min, max] = layout.range[side];
    const home = layout.home[side];
    this.rootX ??= home;

    const shoulderY = layout.groundY + PUPPET.front.shoulder.y * s;
    const upper = PUPPET.front.upper * s;
    const fore = (PUPPET.front.fore + PUPPET.paddle.reach) * s;
    const reach = upper + fore;
    const shoulderOffset = flip * PUPPET.front.shoulder.x * s;
    const stand = reach * 0.6;

    // Ready stance: paddle held out over its own half of the table.
    let aimX = home + shoulderOffset + flip * stand;
    let aimY = shoulderY + 30 * s;
    let wantRoot = home;

    const ball = scene.ball;
    // Its ball to play: the other side's shot (never a serve dropped for the other side), or its own if that
    // is going to come down on its own side.
    const forecast = scene.forecast;
    const ownSide = (x: number) => (x - layout.centerX) * flip < 0;
    const fallingShort = ball.lastHitter === side && forecast.valid && forecast.count > 0 && ownSide(forecast.samples[forecast.count - 1].x);
    const incoming = ball.state === 'live' && (scene.toPlay(side, layout) || fallingShort);
    this.chasing = false;
    if (incoming) {
      // A new ball: a moment to react, and a fresh, slightly wrong, read of it.
      if (scene.rallyHits !== this.plannedFor) {
        this.plannedFor = scene.rallyHits;
        const cpu = this.config.cpu;
        const spread = Math.min(cpu.errorMax, cpu.error + cpu.errorGrowth * scene.rallyHits);
        this.errorX = this.gaussian() * spread;
        this.errorY = this.gaussian() * spread * 0.7;
        this.reactAt = now + cpu.reactionMs;
        this.planAt = 0;
        this.plan.valid = false;
      }
      // One plan per shot. The forecast is the ball's actual flight, so once a way to it is found there is
      // nothing to revise, and a committed stroke is a clean one.
      if (!this.plan.valid && now >= this.reactAt && now >= this.planAt) {
        this.planAt = now + REPLAN_MS;
        this.replan(side, now, layout, scene, shoulderY, reach, stand, ball.lastHitter === side);
      }
    } else if (ball.state !== 'live' || now - this.plan.at > FOLLOW_SECONDS * 1000) {
      this.plan.valid = false;
    }

    const plan = this.plan;
    if (plan.valid) {
      const remaining = (plan.at - now) / 1000 - FOLLOWER_LAG;
      if (remaining < -FOLLOW_SECONDS) plan.valid = false;
      else {
        this.chasing = incoming;
        // Meet the ball from behind, along the line the return should take, and swing through it.
        const behind = PUPPET.paddle.radius * s * 0.5;
        const contactX = plan.x - plan.dx * behind + this.errorX;
        const contactY = plan.y - plan.dy * behind + this.errorY;
        // Held half a swing back while it waits, drawn back the rest of the way as the ball comes in, then
        // through the contact point at the planned velocity: one unbroken path, with no jump where the swing starts.
        const windUp = smoothstep((2 * SWING_SECONDS - remaining) / SWING_SECONDS);
        const along = remaining > SWING_SECONDS ? -SWING_SECONDS * lerp(0.5, 1, windUp) : -Math.max(remaining, -0.11);
        aimX = contactX + plan.swingX * along;
        aimY = contactY + plan.swingY * along;
        wantRoot = contactX - shoulderOffset - flip * stand;
        this.phase = remaining > SWING_SECONDS ? 'anticipate' : remaining > 0 ? 'swing' : 'follow';
      }
    }
    if (!plan.valid) this.phase = ball.state === 'live' && ball.lastHitter === side ? 'recover' : 'ready';

    // Walk there: toward the spot, never faster than its legs, never changing speed faster than they can.
    const target = clamp(wantRoot, min, max);
    const wanted = clamp((target - this.rootX) * 9, -WALK_SPEED, WALK_SPEED);
    this.rootSpeed += clamp(wanted - this.rootSpeed, -WALK_ACCEL * dt, WALK_ACCEL * dt);
    this.rootX = clamp(this.rootX + this.rootSpeed * dt, min, max);
    this.aim.x = aimX;
    this.aim.y = aimY;

    // Lean into the reach a little. The lean moves the shoulder, so it is settled before the arm is solved.
    const lean = clamp((aimX - this.rootX) * flip * 0.02 - 2, -3, 7);
    const cosL = Math.cos(lean * RAD);
    const sinL = Math.sin(lean * RAD);
    const hx = PUPPET.front.shoulder.x - PUPPET.hip.x;
    const hy = PUPPET.front.shoulder.y - PUPPET.hip.y;
    const sx = this.rootX + flip * s * (PUPPET.hip.x + hx * cosL - hy * sinL);
    const sy = layout.groundY + s * (PUPPET.hip.y + hx * sinL + hy * cosL);

    // Two-bone reach from the shoulder to the aim point, elbow hanging below the line.
    const dx = (aimX - sx) * flip;
    const dy = aimY - sy;
    const distance = clamp(Math.hypot(dx, dy), Math.abs(upper - fore) + 2, reach - 1);
    const toward = Math.atan2(dx, dy);
    const inner = Math.acos(clamp((upper * upper + distance * distance - fore * fore) / (2 * upper * distance), -1, 1));
    const bend = Math.PI - Math.acos(clamp((upper * upper + fore * fore - distance * distance) / (2 * upper * fore), -1, 1));

    const t = now / 1000;
    const rig = this.rig;
    rig.x = this.rootX;
    rig.y = layout.groundY;
    rig.scale = s;
    rig.depth = 0.3;
    rig.bodyRotation = lean;
    rig.headRotation = ball.state === 'live' ? clamp((ball.y - (layout.groundY + PUPPET.neck.y * s)) * 0.035, -10, 10) : 2 * Math.sin(t * 0.7);
    // The arm hangs from a leaning body (and the controller lets hanging arms resist 40 % of a lean): undo both.
    rig.shoulderAngle = clamp((toward - inner) / RAD + 0.6 * lean, -30, 150);
    rig.elbowAngle = clamp(bend / RAD, -12, 150);
    rig.wristAngle = 0;
    rig.grip = 0.85;
    rig.backShoulderAngle = -30 + 4 * Math.sin(t * 1.3);
    rig.backElbowAngle = -26 + 5 * Math.sin(t * 0.9 + 1);
    rig.backWristAngle = 0;
    return rig;
  }

  /**
   * Picks where along the ball's predicted flight to meet it, and the line
   * the return should take from there. It reads the scene's own forecast, so
   * it is looking at exactly the path the ball will fly.
   */
  private replan(side: Side, now: number, layout: StageLayout, scene: SceneController, shoulderY: number, reach: number, stand: number, ownShot: boolean) {
    const forecast = scene.forecast;
    const plan = this.plan;
    if (!forecast.valid) {
      plan.valid = false;
      return;
    }
    const flip = facing(side);
    const s = layout.puppetScale;
    const { table, centerX } = layout;
    const [min, max] = layout.range[side];
    const rootX = this.rootX ?? layout.home[side];
    const shoulderOffset = flip * PUPPET.front.shoulder.x * s;
    // Best met a little above the net, on the way up to or down from the top of its bounce.
    const ideal = table.top - 92 * s;
    let best: BallSample | null = null;
    let bestCost = Infinity;
    for (let i = 0; i < forecast.count; i++) {
      const sample = forecast.samples[i];
      const ahead = sample.t - forecast.age;
      if (ahead < 0.1 || (sample.x - centerX) * flip > -6) continue;
      // Its own shot may only be played again once it has come back off the table.
      if (ownShot && sample.bounces === 0) continue;
      if (sample.y < shoulderY - reach * 0.78 || sample.y > table.top - 24 * s) continue;
      // Can it get there? Its feet have a top speed; a spot it cannot walk to in time is no plan.
      const root = clamp(sample.x - shoulderOffset - flip * stand, min, max);
      const stretch = Math.abs(sample.x - shoulderOffset - flip * stand - root);
      if (stretch > reach * 0.34) continue;
      const late = Math.max(0, Math.abs(root - rootX) / WALK_SPEED - ahead - 0.08);
      const cost = Math.abs(sample.y - ideal) + (sample.bounces === 0 ? 70 : 0) + ahead * 26 + stretch * 0.6 + late * 900;
      if (cost < bestCost) {
        bestCost = cost;
        best = sample;
      }
    }
    if (!best) {
      plan.valid = false;
      return;
    }
    plan.valid = true;
    plan.x = best.x;
    plan.y = best.y;
    plan.at = now + (best.t - forecast.age) * 1000;

    // The return it has in mind: an arc onto the middle of the far half.
    const half = table.right - centerX;
    const targetX = centerX + flip * half * 0.55;
    const scale = Math.sqrt(s / 0.8);
    const time = clamp(Math.abs(targetX - best.x) / (255 * scale), 0.6, 1.15);
    launchVelocity(best.x, best.y, targetX, table.top - BALL_RADIUS, time, this.shot);
    const speed = Math.hypot(this.shot.vx, this.shot.vy) || 1;
    plan.dx = this.shot.vx / speed;
    plan.dy = this.shot.vy / speed;
    // The swing that makes the stroke send the ball that way: a longer shot needs more behind it.
    planSwing(side, plan.dx, plan.dy, speed, Math.hypot(best.vx, best.vy), s, this.swing);
    plan.swingX = this.swing.vx;
    plan.swingY = this.swing.vy;
  }

  private gaussian() {
    const u = Math.max(1e-9, this.random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.random());
  }
}
