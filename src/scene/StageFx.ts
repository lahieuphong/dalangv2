import type { StageFrame } from '../app/frames';
import { CHANNEL_STRING_JOINT, facing } from '../motion/PuppetRig';
import { FINGERTIPS, LANDMARK, LANDMARK_COUNT, palmCenter } from '../tracking/FingerGeometry';
import { FINGER_NAMES, JOINT_CHANNELS, type Side } from '../types';
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

  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#150e07';
  ctx.beginPath();
  ctx.arc(ball.x * k, ball.y * k, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(236, 206, 140, 0.55)';
  ctx.lineWidth = Math.max(0.8, 0.9 * k);
  ctx.beginPath();
  ctx.arc(ball.x * k, ball.y * k, r * 0.62, ball.angle - 2.4, ball.angle - 1.2);
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

/** Draws everything that sits in front of the puppets. The canvas must already be cleared. */
export function drawStageFront(ctx: CanvasRenderingContext2D, frame: StageFrame, k: number, shadows: Record<Side, ShadowHand>) {
  const { scene, layout } = frame;
  drawStrings(ctx, frame, k, shadows);
  const flyScale = 1.05 * (layout.puppetScale / 0.8);
  for (const fly of scene.flies) drawFly(ctx, fly, k, flyScale);
  drawBall(ctx, scene.ball, k, frame.now);
  drawImpacts(ctx, scene.impacts, k, frame.now);
}
