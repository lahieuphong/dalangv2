import type { BallSample, SceneController } from '../scene/SceneController';
import type { StageLayout } from '../scene/StageProps';
import type { PuppetRig, Side } from '../types';
import { clamp, mulberry32, RAD } from '../utils/math';
import { emptyRig, facing, PUPPET } from './PuppetRig';

/** How often the agent looks at the ball again (ms): its reaction time. */
const REPLAN_MS = 90;
/** How fast it can shuffle sideways, stage units per second. */
const WALK_SPEED = 430;
const SAMPLE_COUNT = 96;
const SAMPLE_STEP = 1 / 60;

/**
 * The stage's own puppeteer. When only one hand is playing, it picks up the
 * other puppet for the rally: it watches the ball, walks to where it will come
 * down and reaches the paddle out to meet it.
 *
 * It only ever produces a pose target, the same thing a hand produces, and
 * that target goes through the same followers and the same paddle physics.
 * It is deliberately fallible: its aim drifts further off the longer a rally
 * lasts, so a patient player wins the point.
 */
export class AgentPuppeteer {
  /** The pose the agent asks for this frame. */
  readonly rig: PuppetRig = emptyRig();
  /** Where it is trying to put the paddle (stage units), for the debug view. */
  readonly aim = { x: 0, y: 0 };
  /** True while it has a ball to go for. */
  chasing = false;

  private readonly random = mulberry32(4242);
  private readonly samples: BallSample[] = Array.from({ length: SAMPLE_COUNT }, () => ({ x: 0, y: 0, vy: 0, t: 0, bounces: 0 }));
  private readonly plan = { x: 0, y: 0, valid: false };
  private planAt = 0;
  private plannedFor = -1;
  private errorX = 0;
  private errorY = 0;
  private rootX: number | null = null;
  private side: Side | null = null;

  /** Forgets where it stood, so it starts from the puppet's home the next time it is called in. */
  reset() {
    this.rootX = null;
    this.side = null;
    this.plan.valid = false;
    this.chasing = false;
  }

  update(side: Side, now: number, dt: number, layout: StageLayout, scene: SceneController): PuppetRig {
    if (this.side !== side) {
      this.side = side;
      this.rootX = null;
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

    // Ready stance: paddle held out over its own half of the table.
    let aimX = this.rootX + shoulderOffset + flip * reach * 0.62;
    let aimY = shoulderY + 34 * s;
    let wantRoot = home;

    const ball = scene.ball;
    const mine = (x: number) => (x - layout.centerX) * flip < 0;
    this.chasing = false;
    if (ball.state === 'live') {
      // A new ball coming my way: take a fresh, slightly wrong, read of it.
      if (scene.rallyHits !== this.plannedFor) {
        this.plannedFor = scene.rallyHits;
        const spread = Math.min(44, 5 + 4.5 * scene.rallyHits);
        this.errorX = this.gaussian() * spread;
        this.errorY = this.gaussian() * spread * 0.7;
        this.planAt = 0;
      }
      if (now >= this.planAt) {
        this.planAt = now + REPLAN_MS;
        this.replan(layout, scene, mine, shoulderY, reach);
      }
      if (this.plan.valid && ball.lastHitter !== side) {
        this.chasing = true;
        aimX = this.plan.x + this.errorX;
        aimY = this.plan.y + this.errorY;
        // Step in behind the ball, then punch through it as it arrives.
        wantRoot = aimX - shoulderOffset - flip * reach * 0.62;
        if (Math.hypot(ball.x - aimX, ball.y - aimY) < 70) aimX += flip * 14;
      }
    } else {
      this.plan.valid = false;
    }

    const step = WALK_SPEED * dt;
    this.rootX += clamp(clamp(wantRoot, min, max) - this.rootX, -step, step);
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

  /** Picks the point of the predicted flight where the paddle should meet the ball. */
  private replan(layout: StageLayout, scene: SceneController, mine: (x: number) => boolean, shoulderY: number, reach: number) {
    const count = scene.predict(layout, SAMPLE_COUNT * SAMPLE_STEP, SAMPLE_STEP, this.samples);
    const ideal = shoulderY + reach * 0.08;
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < count; i++) {
      const sample = this.samples[i];
      if (!mine(sample.x) || sample.t < 0.1) continue;
      if (sample.y < shoulderY - reach * 0.8 || sample.y > shoulderY + reach * 0.5) continue;
      // Prefer the ball after it has bounced, near shoulder height, and sooner rather than later.
      const cost = Math.abs(sample.y - ideal) + (sample.bounces === 0 ? 60 : 0) + sample.t * 30;
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    this.plan.valid = best >= 0;
    if (best >= 0) {
      this.plan.x = this.samples[best].x;
      this.plan.y = this.samples[best].y;
    }
  }

  private gaussian() {
    const u = Math.max(1e-9, this.random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.random());
  }
}
