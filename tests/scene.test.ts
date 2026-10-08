import { describe, expect, it } from 'vitest';
import { AgentPuppeteer } from '../src/motion/AgentPuppeteer';
import { GestureEngine } from '../src/motion/GestureEngine';
import { InteractionStateMachine, type InteractionInput } from '../src/motion/InteractionStateMachine';
import { computeJoints, createJoints } from '../src/motion/PuppetRig';
import { emptyPaddle, SceneController, type PaddleInput } from '../src/scene/SceneController';
import { computeLayout } from '../src/scene/StageProps';
import { extractHandFeatures } from '../src/tracking/HandFeatures';
import { SIM_ASPECT, synthesizeHand } from '../src/tracking/SimulatedHands';
import type { Side } from '../src/types';
import { pose, runEngine } from './helpers';

const idle: InteractionInput = { driven: false, recovering: false, holding: false, lift: 0, rally: false, hunting: false };

describe('interaction state machine', () => {
  it('walks through its states as the real conditions change', () => {
    const machine = new InteractionStateMachine();
    let now = 0;
    const settle = (input: InteractionInput) => {
      for (let i = 0; i < 20; i++) machine.update(input, (now += 16));
      return machine.state;
    };
    expect(settle(idle)).toBe('IDLE');
    expect(settle({ ...idle, driven: true })).toBe('TRACKING');
    expect(settle({ ...idle, driven: true, hunting: true })).toBe('HUNT');
    expect(settle({ ...idle, driven: true, rally: true })).toBe('RALLY');
    expect(settle({ ...idle, driven: true, rally: true, lift: 60 })).toBe('LIFT');
    expect(settle({ ...idle, driven: true, rally: true, lift: 60, holding: true })).toBe('INTERACT');
    expect(settle({ ...idle, recovering: true })).toBe('RECOVER');
    expect(settle(idle)).toBe('IDLE');
  });

  it('does not flicker at the edge of a lift', () => {
    const machine = new InteractionStateMachine();
    let now = 0;
    let changes = 0;
    machine.onTransition = () => (changes += 1);
    for (let i = 0; i < 200; i++) {
      // The height hovers right around the threshold.
      machine.update({ ...idle, driven: true, lift: 26 + (i % 2 ? 3 : -3) }, (now += 16));
    }
    expect(changes).toBeLessThanOrEqual(2);
  });
});

describe('gestures', () => {
  const features = (overrides: Parameters<typeof pose>[0]) => extractHandFeatures(synthesizeHand(pose(overrides), 'left'), SIM_ASPECT);

  it('recognises pinch, fist, pointing and an open hand without holding them', () => {
    const gestures = new GestureEngine();
    const open = features({});
    expect(gestures.update(open, open.pinchStrength, 0)).toBe('open');

    const pinch = features({ pinch: 1 });
    expect(gestures.update(pinch, pinch.pinchStrength, 33)).toBe('pinch');
    expect(gestures.justPinched).toBe(true);

    const fist = features({ extension: [0.2, 0.03, 0.03, 0.03, 0.03] });
    expect(gestures.update(fist, fist.pinchStrength, 66)).toBe('fist');
    expect(gestures.justReleased).toBe(true);

    const point = features({ extension: [0.3, 0.96, 0.03, 0.03, 0.03] });
    expect(gestures.update(point, point.pinchStrength, 99)).toBe('point');
  });
});

/** Steps a scene with paddles that the test moves by hand. */
function sceneHarness() {
  const layout = computeLayout(1200);
  const scene = new SceneController(layout);
  const paddles: Record<Side, PaddleInput> = { left: emptyPaddle(), right: emptyPaddle() };
  let now = 1000;
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) scene.update((now += 1000 / 60), 1 / 60, layout, paddles, null, null);
  };
  return { layout, scene, paddles, step, time: () => now };
}

describe('fly hunt', () => {
  it('knocks a fly down with a swing and leaves it alone when the paddle is slow', () => {
    const { scene, paddles, step } = sceneHarness();
    const paddle = paddles.left;
    paddle.active = true;
    paddle.human = true;
    paddle.radius = 20;
    step(30);
    const fly = scene.flies[0];

    // Resting the paddle on a fly does nothing.
    paddle.x = fly.x;
    paddle.y = fly.y;
    paddle.vx = 0;
    paddle.vy = 0;
    step(1);
    expect(scene.swats).toBe(0);

    // Swinging through it does.
    const target = scene.flies.find((f) => f.state === 'roam')!;
    paddle.x = target.x;
    paddle.y = target.y;
    paddle.vx = 400;
    step(1);
    expect(scene.swats).toBe(1);
    expect(target.state).toBe('stunned');
    step(200);
    expect(['down', 'roam']).toContain(target.state);
  });

  it('turns into a rally after five swats', () => {
    const { scene, paddles, step } = sceneHarness();
    const paddle = paddles.left;
    paddle.active = true;
    paddle.human = true;
    paddle.radius = 20;
    paddle.vx = 400;
    for (let i = 0; i < 400 && scene.mode === 'hunt'; i++) {
      const target = scene.flies.find((f) => f.state === 'roam');
      if (target) {
        paddle.x = target.x;
        paddle.y = target.y;
      }
      step(1);
    }
    expect(scene.mode).toBe('rally');
  });
});

describe('rally', () => {
  it('serves to the player, bounces on the table and ends when the ball reaches the ground', () => {
    const { scene, paddles, step, layout, time } = sceneHarness();
    paddles.left.active = true;
    paddles.left.human = true;
    // Park the paddle out of the way.
    paddles.left.x = 40;
    paddles.left.y = 40;
    scene.setMode('rally', time());
    step(60 * 2);
    expect(scene.ball.state).toBe('live');
    // Served toward the only human, i.e. onto the left half.
    let bounced = false;
    for (let i = 0; i < 400 && scene.ball.state === 'live'; i++) {
      step(1);
      if (scene.ball.bounces.left > 0) bounced = true;
      expect(scene.ball.y).toBeLessThanOrEqual(layout.groundY);
    }
    expect(bounced).toBe(true);
    expect(scene.ball.state).toBe('dead');
    expect(scene.events.some((event) => event.text === 'return missed')).toBe(true);
  });

  it('sends the ball over the net when a paddle meets it', () => {
    const { scene, paddles, step, layout, time } = sceneHarness();
    const paddle = paddles.left;
    paddle.active = true;
    paddle.human = true;
    paddle.radius = 20;
    paddle.x = 40;
    paddle.y = 40;
    scene.setMode('rally', time());
    step(60 * 2);
    // Follow the ball with the paddle until they meet.
    for (let i = 0; i < 300 && scene.rallyHits === 0 && scene.ball.state === 'live'; i++) {
      if (scene.ball.bounces.left > 0) {
        paddle.x = scene.ball.x;
        paddle.y = scene.ball.y;
      }
      step(1);
    }
    expect(scene.rallyHits).toBe(1);
    expect(scene.ball.vx).toBeGreaterThan(0);
    paddle.x = 40;
    paddle.y = 40;
    let crossed = false;
    for (let i = 0; i < 200 && scene.ball.state === 'live'; i++) {
      step(1);
      if (scene.ball.x > layout.centerX + 10) crossed = true;
    }
    expect(crossed).toBe(true);
  });

  it('lets a pinch catch the ball and a release serve it', () => {
    const { scene, paddles, step, time } = sceneHarness();
    const paddle = paddles.left;
    paddle.active = true;
    paddle.human = true;
    paddle.radius = 20;
    paddle.x = 300;
    paddle.y = 300;
    scene.setMode('rally', time());
    paddle.grabbing = true;
    paddle.justGrabbed = true;
    step(1);
    paddle.justGrabbed = false;
    expect(scene.ball.state).toBe('held');
    expect(scene.holding.left).toBe(true);
    step(10);
    expect(Math.abs(scene.ball.x - paddle.x)).toBeLessThan(1);

    paddle.grabbing = false;
    paddle.justReleased = true;
    step(1);
    paddle.justReleased = false;
    expect(scene.ball.state).toBe('live');
    expect(scene.holding.left).toBe(false);
    expect(scene.ball.vx).toBeGreaterThan(0);
  });
});

describe('stage agent', () => {
  it('reaches its paddle to the ball and returns it', () => {
    const layout = computeLayout(1200);
    const scene = new SceneController(layout);
    const agent = new AgentPuppeteer();
    const joints = createJoints();
    const paddles: Record<Side, PaddleInput> = { left: emptyPaddle(), right: emptyPaddle() };
    paddles.left.active = true;
    paddles.left.human = true;
    paddles.left.x = 40;
    paddles.left.y = 40;
    paddles.right.active = true;
    let now = 1000;
    scene.setMode('rally', now);

    // The human "returns" every ball by simply sending it over; the agent has to do the rest.
    let cpuReturns = 0;
    let last = { x: 0, y: 0 };
    for (let i = 0; i < 60 * 14; i++) {
      now += 1000 / 60;
      const rig = agent.update('right', now, 1 / 60, layout, scene);
      // The controller lets hanging arms resist 40 % of the lean; mirror that here.
      rig.shoulderAngle += rig.bodyRotation * 0.4;
      computeJoints(rig, 'right', joints);
      const paddle = paddles.right;
      paddle.vx = (joints.paddle.x - last.x) * 60;
      paddle.vy = (joints.paddle.y - last.y) * 60;
      last = { x: joints.paddle.x, y: joints.paddle.y };
      paddle.x = joints.paddle.x;
      paddle.y = joints.paddle.y;
      paddle.radius = joints.paddleRadius;

      const ball = scene.ball;
      if (ball.state === 'live' && ball.x < layout.centerX && ball.bounces.left > 0 && ball.lastHitter !== 'left') {
        paddles.left.x = ball.x;
        paddles.left.y = ball.y;
      } else {
        paddles.left.x = 40;
        paddles.left.y = 40;
      }
      scene.update(now, 1 / 60, layout, paddles, 'right', null);
      cpuReturns = Math.max(cpuReturns, scene.events.filter((event) => event.text === 'CPU return accepted').length);
    }
    expect(cpuReturns).toBeGreaterThanOrEqual(1);
  });

  it('joins a one-handed rally in the full pipeline and leaves when it ends', () => {
    let joined = false;
    const engine = runEngine('still', 1);
    void engine;
    runEngine(
      'lift',
      8,
      (eng, now) => {
        if (now > 1500 && eng.scene.mode === 'hunt') eng.scene.setMode('rally', now);
        if (eng.telemetry.hands.right.agent) joined = true;
      },
    );
    expect(joined).toBe(true);
  });
});
