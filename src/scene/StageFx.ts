import type { StageFrame } from '../app/frames';
import { CHANNEL_STRING_JOINT, facing } from '../motion/PuppetRig';
import { FINGERTIPS, LANDMARK, LANDMARK_COUNT, palmCenter } from '../tracking/FingerGeometry';
import { FINGER_NAMES, JOINT_CHANNELS, SIDES, type Side } from '../types';
import { clamp } from '../utils/math';
import { BALL_RADIUS, CARRIERS, type Ball, type Fly, type Impact } from './SceneController';

/**
 * The stage's moving odds and ends, drawn on canvas each frame: the strings
 * between hand and puppet, the flies, the ball, and the little bursts where
 * things touch. All positions are in stage units; `k` converts to pixels.
 */

/** Where the puppeteer's hand shadow falls above a puppet, and the 21 landmarks placed there. */
export interface ShadowHand {
  visible: boolean;
  /** 0..1 */
  alpha: number;
  /** Palm centre and palm length, stage units. */
  x: number;
  y: number;
  palm: number;
  /** x,y pairs in stage units. */
  points: Float32Array;
}

export const createShadowHand = (): ShadowHand => ({ visible: false, alpha: 0, x: 0, y: 0, palm: 60, points: new Float32Array(LANDMARK_COUNT * 2) });

/** Palm length of the shadow hand at full puppet size, stage units. */
const SHADOW_PALM = 84;

/**
 * Places the tracked hand above its puppet, in the pose it really has, so the
 * shadow on the screen curls its fingers when the puppeteer does and each
 * string starts at the fingertip that pulls it.
 */
export function placeShadowHand(frame: StageFrame, side: Side, out: ShadowHand): ShadowHand {
  const hand = frame.hands[side];
  const presence = frame.handPresence[side];
  out.visible = hand !== null && presence > 0.02;
  out.alpha = presence;
  if (!hand) return out;

  const lm = hand.landmarks;
  const centre = palmCenter(lm);
  const wrist = lm[LANDMARK.WRIST];
  const knuckle = lm[LANDMARK.MIDDLE_MCP];
  const span = Math.hypot((knuckle.x - wrist.x) * frame.aspect, knuckle.y - wrist.y) || 0.15;
  const scale = frame.layout.puppetScale / 0.8;
  const palm = SHADOW_PALM * scale;
  const joints = frame.joints[side];
  out.palm = palm;
  // The hand hangs just above the puppet's head, a little toward the way it faces, so it is not hidden behind
  // the figure; lifted high, it leaves the top of the screen.
  out.x = joints.crown.x + facing(side) * 46 * scale;
  out.y = Math.max(palm * 0.7, joints.crown.y - palm * 0.42);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    out.points[i * 2] = out.x + (((lm[i].x - centre.x) * frame.aspect) / span) * palm;
    out.points[i * 2 + 1] = out.y + ((lm[i].y - centre.y) / span) * palm;
  }
  return out;
}

const STRING = '34, 21, 10';

function drawStrings(ctx: CanvasRenderingContext2D, frame: StageFrame, k: number, shadows: Record<Side, ShadowHand>) {
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, 1.15 * k);
  for (const side of ['left', 'right'] as const) {
    const joints = frame.joints[side];
    const shadow = shadows[side];
    if (shadow.visible) {
      // One string per finger, from the fingertip to the far end of the bone it turns.
      ctx.strokeStyle = `rgba(${STRING}, ${(0.78 * shadow.alpha).toFixed(3)})`;
      ctx.beginPath();
      for (const channel of JOINT_CHANNELS) {
        const tip = FINGERTIPS[FINGER_NAMES.indexOf(frame.fingerMap[channel])];
        const joint = joints[CHANNEL_STRING_JOINT[channel]];
        ctx.moveTo(shadow.points[tip * 2] * k, shadow.points[tip * 2 + 1] * k);
        ctx.lineTo(joint.x * k, joint.y * k);
      }
      ctx.stroke();
    } else if (frame.agentSide === side) {
      // The agent's strings are carried by flies.
      ctx.strokeStyle = `rgba(${STRING}, ${(0.78 * frame.presence[side]).toFixed(3)})`;
      ctx.beginPath();
      for (const fly of frame.scene.flies) {
        if (fly.state !== 'carry' || fly.slot >= CARRIERS) continue;
        const joint = joints[CHANNEL_STRING_JOINT[JOINT_CHANNELS[fly.slot]]];
        ctx.moveTo(fly.x * k, fly.y * k);
        ctx.lineTo(joint.x * k, joint.y * k);
      }
      ctx.stroke();
    }
  }
}

function drawFly(ctx: CanvasRenderingContext2D, fly: Fly, k: number, scale: number) {
  const s = k * scale;
  ctx.save();
  ctx.translate(fly.x * k, fly.y * k);
  ctx.rotate(fly.angle);
  ctx.scale(s, s);

  // Wings: two translucent blades, beating while it flies, folded back when it sits.
  const flying = fly.state === 'roam' || fly.state === 'carry' || fly.state === 'held' || fly.state === 'stunned';
  const beat = flying ? Math.abs(Math.sin(fly.wing)) : 0;
  ctx.fillStyle = 'rgba(58, 42, 26, 0.42)';
  for (const sign of [-1, 1]) {
    ctx.save();
    ctx.translate(1.5, -1.5);
    ctx.rotate(flying ? -Math.PI / 2 + sign * (0.25 + 0.9 * beat) : Math.PI + sign * 0.16);
    ctx.beginPath();
    ctx.ellipse(8, 0, 9, 3.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Abdomen, thorax, head.
  ctx.fillStyle = '#1b120a';
  ctx.beginPath();
  ctx.ellipse(-5, 0.6, 6.4, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(2.4, 0, 3.6, 3.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(6.6, 0.3, 2.3, 0, Math.PI * 2);
  ctx.fill();
  // Bands across the abdomen.
  ctx.strokeStyle = 'rgba(206, 170, 104, 0.6)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const x of [-8, -5.4, -2.8]) {
    ctx.moveTo(x, -2.6);
    ctx.lineTo(x, 3.4);
  }
  ctx.stroke();
  // Legs.
  ctx.strokeStyle = '#1b120a';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (const x of [-3, 0.5, 3.5]) {
    ctx.moveTo(x, 2.4);
    ctx.lineTo(x - 1.2, 6.2);
  }
  ctx.stroke();
  ctx.restore();
}

function drawBall(ctx: CanvasRenderingContext2D, ball: Ball, k: number, now: number) {
  if (ball.state === 'none') return;
  const r = BALL_RADIUS * k;
  // A dead ball fades where it fell.
  const alpha = ball.state === 'dead' ? clamp(1 - (now - ball.stateAt) / 1300, 0, 1) : 1;
  if (alpha <= 0) return;

  if (ball.state === 'live' && ball.trail.length > 1) {
    // The streak behind a moving ball: a tapering ribbon along its recent path.
    ctx.lineCap = 'round';
    for (let i = ball.trail.length - 1; i > 0; i--) {
      const a = ball.trail[i];
      const b = ball.trail[i - 1];
      const t = 1 - i / ball.trail.length;
      ctx.strokeStyle = `rgba(24, 15, 8, ${(0.32 * t).toFixed(3)})`;
      ctx.lineWidth = r * 2 * (0.25 + 0.7 * t);
      ctx.beginPath();
      ctx.moveTo(a.x * k, a.y * k);
      ctx.lineTo(b.x * k, b.y * k);
      ctx.stroke();
    }
  }

  // Drawn where the ball is at this display frame: the physics state carried over the part of a step still owed.
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#150e07';
  ctx.beginPath();
  ctx.arc(ball.renderX * k, ball.renderY * k, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(236, 206, 140, 0.55)';
  ctx.lineWidth = Math.max(0.8, 0.9 * k);
  ctx.beginPath();
  ctx.arc(ball.renderX * k, ball.renderY * k, r * 0.62, ball.angle - 2.4, ball.angle - 1.2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const IMPACT_MS = 380;

function drawImpacts(ctx: CanvasRenderingContext2D, impacts: readonly Impact[], k: number, now: number) {
  for (const impact of impacts) {
    const t = (now - impact.at) / IMPACT_MS;
    if (t < 0 || t >= 1) continue;
    const fade = 1 - t;
    const reach = (impact.kind === 'bounce' ? 9 : 20) * (0.6 + 0.6 * impact.strength) * k;
    const x = impact.x * k;
    const y = impact.y * k;
    ctx.strokeStyle = impact.kind === 'swat' ? `rgba(40, 24, 10, ${(0.75 * fade).toFixed(3)})` : `rgba(255, 250, 226, ${(0.9 * fade).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, 1.5 * k * fade);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const rays = impact.kind === 'bounce' ? 5 : 8;
    for (let i = 0; i < rays; i++) {
      // A bounce only splashes upward, off the table.
      const a = impact.kind === 'bounce' ? Math.PI + ((i + 0.5) / rays) * Math.PI : (i / rays) * Math.PI * 2 + 0.3;
      const inner = reach * (0.35 + 0.5 * t);
      const outer = reach * (0.6 + 0.9 * t);
      ctx.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
      ctx.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
    }
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ ?debug=1 */

const DEBUG = {
  racket: 'rgba(62, 240, 194, 0.95)',
  core: 'rgba(255, 214, 74, 0.95)',
  forgiveness: 'rgba(255, 110, 196, 0.9)',
  path: 'rgba(120, 200, 255, 0.9)',
  miss: 'rgba(255, 96, 80, 0.95)',
  text: 'rgba(255, 255, 255, 0.96)',
  plate: 'rgba(12, 8, 4, 0.72)',
} as const;
/** How long the last contact stays marked on the stage, ms. */
const CONTACT_MARK_MS = 1600;

/** A line of small text on a dark plate, so it reads against the lit screen. */
function debugLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string = DEBUG.text) {
  const width = ctx.measureText(text).width;
  ctx.fillStyle = DEBUG.plate;
  ctx.fillRect(x - 3, y - size * 0.72, width + 6, size * 1.44);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * The ball game as the physics sees it, drawn over the stage:
 *
 *   green   the racket: the disc the collider uses, which is the paddle as drawn
 *   yellow  core zone: where the ball's centre is when ball and racket touch
 *   pink    forgiveness zone, stretched along the racket's motion by the latency lead
 *   blue    the ball's predicted flight (ticks 100 and 200 ms ahead), its velocity,
 *           and the point where it will pass nearest each racket
 *
 * with the outcome of each racket's last attempt (CORE, ASSIST or MISS) and
 * the quality and the assist weights (aim, pace) of the last contact.
 */
function drawRallyDebug(ctx: CanvasRenderingContext2D, frame: StageFrame, k: number) {
  const { scene, now } = frame;
  const ball = scene.ball;
  const size = Math.max(9, 10 * k);
  const line = Math.max(1, 1.2 * k);
  ctx.save();
  ctx.font = `${size.toFixed(1)}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'round';
  ctx.lineWidth = line;

  // The predicted flight: the very steps the live ball will take.
  const forecast = scene.forecast;
  if (ball.state === 'live' && forecast.valid) {
    ctx.strokeStyle = DEBUG.path;
    ctx.setLineDash([2 * k, 5 * k]);
    ctx.beginPath();
    ctx.moveTo(ball.renderX * k, ball.renderY * k);
    for (let i = 0; i < forecast.count; i++) {
      const sample = forecast.samples[i];
      if (sample.t - forecast.age > 0) ctx.lineTo(sample.x * k, sample.y * k);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Where it will be in 100 and 200 ms.
    for (const ahead of [0.1, 0.2]) {
      let nearest = -1;
      for (let i = 0; i < forecast.count && nearest < 0; i++) if (forecast.samples[i].t - forecast.age >= ahead) nearest = i;
      if (nearest < 0) continue;
      const sample = forecast.samples[nearest];
      ctx.beginPath();
      ctx.arc(sample.x * k, sample.y * k, 3.2 * k, 0, Math.PI * 2);
      ctx.stroke();
      debugLabel(ctx, `${ahead * 1000}`, sample.x * k + 6 * k, sample.y * k - 8 * k, size, DEBUG.path);
    }
    // Velocity: an arrow a tenth of a second long, and the speed.
    const tipX = (ball.renderX + ball.vx * 0.1) * k;
    const tipY = (ball.renderY + ball.vy * 0.1) * k;
    ctx.strokeStyle = DEBUG.text;
    ctx.beginPath();
    ctx.moveTo(ball.renderX * k, ball.renderY * k);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    debugLabel(ctx, `${Math.round(Math.hypot(ball.vx, ball.vy))} u/s`, tipX + 5 * k, tipY, size);
  }

  for (const side of SIDES) {
    const zones = scene.zones[side];
    if (frame.presence[side] < 0.05 || zones.core <= 0) continue;
    const joints = frame.joints[side];
    const x = joints.paddle.x * k;
    const y = joints.paddle.y * k;

    ctx.strokeStyle = DEBUG.racket;
    ctx.beginPath();
    ctx.arc(x, y, joints.paddleRadius * k, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([5 * k, 4 * k]);
    ctx.strokeStyle = DEBUG.core;
    ctx.beginPath();
    ctx.arc(x, y, zones.core * k, 0, Math.PI * 2);
    ctx.stroke();

    if (zones.forgiveness > zones.core) {
      // A capsule: the ring around the racket, and around every point of the stretch it is about to sweep.
      const lead = Math.hypot(zones.leadX, zones.leadY);
      const heading = lead > 0.01 ? Math.atan2(zones.leadY, zones.leadX) : 0;
      const reach = zones.forgiveness * k;
      ctx.strokeStyle = DEBUG.forgiveness;
      ctx.beginPath();
      if (lead > 0.01) {
        ctx.arc(x, y, reach, heading + Math.PI / 2, heading - Math.PI / 2);
        ctx.arc(x + zones.leadX * k, y + zones.leadY * k, reach, heading - Math.PI / 2, heading + Math.PI / 2);
        ctx.closePath();
      } else ctx.arc(x, y, reach, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Where the ball will pass nearest this racket if it stays where it is.
    const arrival = scene.arrival[side];
    if (arrival.valid) {
      const ax = arrival.x * k;
      const ay = arrival.y * k;
      const arm = 6 * k;
      ctx.strokeStyle = DEBUG.path;
      ctx.beginPath();
      ctx.moveTo(ax - arm, ay);
      ctx.lineTo(ax + arm, ay);
      ctx.moveTo(ax, ay - arm);
      ctx.lineTo(ax, ay + arm);
      ctx.stroke();
      debugLabel(ctx, `${Math.round(arrival.t * 1000)} ms`, ax + arm + 3 * k, ay + 9 * k, size, DEBUG.path);
    }

    const outcome = scene.lastOutcome[side];
    debugLabel(ctx, `${scene.phase[side]} · ${outcome ?? '–'}`, x - zones.core * k, y + (zones.forgiveness + 11) * k, size, outcome === 'MISS' ? DEBUG.miss : DEBUG.text);
  }

  // The last valid contact: where it happened, and what kind it was.
  const last = scene.lastContact;
  if (last && now - last.at < CONTACT_MARK_MS) {
    const color = last.kind === 'CORE' ? DEBUG.core : DEBUG.forgiveness;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(last.x * k, last.y * k, BALL_RADIUS * k, 0, Math.PI * 2);
    ctx.stroke();
    debugLabel(ctx, `${last.kind} q ${last.quality.toFixed(2)} · aim ${last.weight.toFixed(2)} · pace ${last.pace.toFixed(2)}`, last.x * k + 10 * k, last.y * k - 12 * k, size, color);
  }

  // The ball again, as an outline on top, so no label can hide it.
  if (ball.state === 'live') {
    ctx.strokeStyle = DEBUG.text;
    ctx.beginPath();
    ctx.arc(ball.renderX * k, ball.renderY * k, BALL_RADIUS * k, 0, Math.PI * 2);
    ctx.stroke();
  }

  // The rally in two lines.
  const stats = scene.stats;
  const left = 10 * k;
  let top = 14 * k;
  debugLabel(
    ctx,
    `RALLY ASSIST ${scene.assist.mode.toUpperCase()} · hits ${scene.rallyHits} · ${scene.rallySeconds.toFixed(1)} s · last side ${last ? last.side.toUpperCase() : '–'}`,
    left,
    top,
    size,
  );
  top += size * 1.6;
  debugLabel(
    ctx,
    `rallies ${stats.rallies} · longest ${stats.longest} · core ${stats.coreContacts} · assisted ${stats.assistedContacts} · missed ${stats.misses}/${stats.attempts}`,
    left,
    top,
    size,
  );
  ctx.restore();
}

/** Draws everything that sits in front of the puppets. The canvas must already be cleared. */
export function drawStageFront(ctx: CanvasRenderingContext2D, frame: StageFrame, k: number, shadows: Record<Side, ShadowHand>) {
  const { scene, layout } = frame;
  drawStrings(ctx, frame, k, shadows);
  const flyScale = 1.05 * (layout.puppetScale / 0.8);
  for (const fly of scene.flies) drawFly(ctx, fly, k, flyScale);
  drawBall(ctx, scene.ball, k, frame.now);
  drawImpacts(ctx, scene.impacts, k, frame.now);
  if (frame.debug) drawRallyDebug(ctx, frame, k);
}
