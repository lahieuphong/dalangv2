import { describe, expect, it } from 'vitest';
import type { Engine } from '../src/app/Engine';
import { DEFAULT_FINGER_MAP } from '../src/motion/PuppetMapping';
import { CHANNEL_RIG_KEY, type ControlKey } from '../src/motion/PuppetRig';
import { JOINT_CHANNELS, type FingerName, type InteractionState, type JointChannel } from '../src/types';
import { Ranges, runEngine, standardDeviation } from './helpers';

/**
 * End-to-end: simulated landmarks through assignment, features, filtering,
 * gestures, mapping and followers, to the rendered rig. These are the
 * acceptance scenarios, run headlessly on the real engine.
 */

const JOINT_KEYS = JOINT_CHANNELS.map((channel) => CHANNEL_RIG_KEY[channel]);

/** How far every arm joint of the left puppet travels over one scenario. */
function jointTravel(script: FingerName) {
  const ranges = new Ranges<ControlKey>();
  // Skip the pickup, then watch two full bend-and-release cycles.
  runEngine(script, 6, (engine, now) => {
    if (now < 1600) return;
    for (const key of JOINT_KEYS) ranges.add(key, engine.puppets.left.rig[key]);
  });
  return ranges;
}

describe('one finger at a time (acceptance tests 3–7)', () => {
  (Object.entries(DEFAULT_FINGER_MAP) as [JointChannel, FingerName][]).forEach(([channel, finger]) => {
    it(`${finger} only → ${channel} moves, the other joints stay put`, () => {
      const travel = jointTravel(finger);
      expect(travel.span(CHANNEL_RIG_KEY[channel])).toBeGreaterThan(25);
      for (const other of JOINT_CHANNELS) {
        // Measured: 0.0° everywhere, except the wrist, which a fully curling index nudges by 3.5° as its tip passes the thumb.
        if (other !== channel) expect(travel.span(CHANNEL_RIG_KEY[other])).toBeLessThan(4);
      }
    });
  });

  it('never mistakes a single bent finger for a fist or a pinch', () => {
    for (const finger of ['index', 'middle', 'ring', 'pinky'] as const) {
      runEngine(finger, 4, (engine) => {
        expect(engine.gestures.left.fist).toBe(false);
        expect(engine.gestures.left.pinched).toBe(false);
      });
    }
  });
});

describe('hand detection and two hands (acceptance tests 1–2)', () => {
  it('picks the puppet up within a few frames of the hand appearing', () => {
    let pickedUpAt = Infinity;
    runEngine('still', 1, (engine, now) => {
      if (engine.puppets.left.handPresence > 0.9) pickedUpAt = Math.min(pickedUpAt, now);
    });
    // The first simulated result arrives on the first frame (t ≈ 1017 ms).
    expect(pickedUpAt - 1017).toBeLessThan(150);
  });

  it('drives two puppets independently with two hands', () => {
    const left = new Ranges<ControlKey>();
    const right = new Ranges<ControlKey>();
    const engine = runEngine('two', 12, (eng, now) => {
      if (now < 1500) return;
      for (const key of ['x', 'shoulderAngle', 'backElbowAngle'] as const) {
        left.add(key, eng.puppets.left.rig[key]);
        right.add(key, eng.puppets.right.rig[key]);
      }
    });
    expect(engine.telemetry.hands.left.tracked).toBe(true);
    expect(engine.telemetry.hands.right.tracked).toBe(true);
    for (const ranges of [left, right]) {
      expect(ranges.span('x')).toBeGreaterThan(40);
      expect(ranges.span('shoulderAngle')).toBeGreaterThan(30);
      expect(ranges.span('backElbowAngle')).toBeGreaterThan(30);
    }
    // Each puppet keeps to its own side of the table.
    expect(engine.puppets.left.rig.x).toBeLessThan(engine.layout.centerX);
    expect(engine.puppets.right.rig.x).toBeGreaterThan(engine.layout.centerX);
  });

  it('does not swap puppets when the hands cross', () => {
    // The left hand always carries a higher palm (y 0.54) than the right (0.66) in this scenario.
    runEngine('cross', 12, (engine, now) => {
      if (now < 1400) return;
      const left = engine.puppets.left.features;
      const right = engine.puppets.right.features;
      expect(left && right).toBeTruthy();
      expect(left!.palmY).toBeLessThan(0.6);
      expect(right!.palmY).toBeGreaterThan(0.6);
    });
  });
});

describe('pinch (acceptance test 8)', () => {
  it('closes the grip continuously and releases again', () => {
    const grips: number[] = [];
    let pinched = 0;
    let released = 0;
    let was = false;
    runEngine('pinch', 6.5, (engine, now) => {
      if (now < 1300) return;
      grips.push(engine.puppets.left.rig.grip);
      const is = engine.gestures.left.pinched;
      if (is && !was) pinched += 1;
      if (!is && was) released += 1;
      was = is;
    });
    expect(Math.max(...grips)).toBeGreaterThan(0.9);
    expect(Math.min(...grips)).toBeLessThan(0.15);
    // Continuous: the grip never jumps by more than a small step from one frame to the next.
    for (let i = 1; i < grips.length; i++) expect(Math.abs(grips[i] - grips[i - 1])).toBeLessThan(0.12);
    expect(pinched).toBeGreaterThanOrEqual(2);
    expect(released).toBeGreaterThanOrEqual(1);
  });
});

describe('fast movement (acceptance test 9)', () => {
  it('follows a hand shaking at 1.4 Hz without lagging, overshooting or flying off', () => {
    let worstLag = 0;
    const xs: number[] = [];
    const engine = runEngine('fast', 5, (eng, now) => {
      if (now < 1500) return;
      const puppet = eng.puppets.left;
      worstLag = Math.max(worstLag, Math.abs(puppet.target.x - puppet.rig.x));
      xs.push(puppet.rig.x);
      const [min, max] = eng.layout.range.left;
      expect(puppet.rig.x).toBeGreaterThanOrEqual(min - 1);
      expect(puppet.rig.x).toBeLessThanOrEqual(max + 1);
      expect(Number.isFinite(puppet.rig.shoulderAngle)).toBe(true);
    });
    const [min, max] = engine.layout.range.left;
    // The puppet really travels (most of its range), and the rendered root stays close behind its target.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan((max - min) * 0.7);
    expect(worstLag).toBeLessThan(26);
    expect(engine.puppets.left.follow.lagMs).toBeLessThan(25);
  });
});

describe('still hand (acceptance test 10)', () => {
  it('holds the puppet steady against realistic landmark noise', () => {
    const x: number[] = [];
    const shoulder: number[] = [];
    const backElbow: number[] = [];
    runEngine(
      'still',
      6,
      (engine, now) => {
        if (now < 2500) return;
        const rig = engine.puppets.left.rig;
        x.push(rig.x);
        shoulder.push(rig.shoulderAngle);
        backElbow.push(rig.backElbowAngle);
      },
      { noise: 0.0012 },
    );
    // Stage units and degrees, one standard deviation, on a 1200-unit-wide stage.
    expect(standardDeviation(x)).toBeLessThan(0.6);
    expect(standardDeviation(shoulder)).toBeLessThan(0.9);
    expect(standardDeviation(backElbow)).toBeLessThan(0.9);
  });
});

describe('tracking loss and recovery (acceptance test 11)', () => {
  it('holds the pose, eases to rest without a jump, and comes back to the same puppet', () => {
    const states = new Set<InteractionState>();
    let lastX: number | null = null;
    let worstStepWhileLost = 0;
    let lostFrames = 0;
    let returnedAt = 0;
    let inHandAt = 0;
    let loggedLoss = false;
    // The stage partner is switched off here: with it on, the flies would (rightly) pick the dropped puppet up mid-rally.
    const watch = (eng: Engine, now: number) => {
      loggedLoss ||= eng.scene.events.some((event) => event.text.includes('tracking lost'));
      if (now < 1500) return;
      const left = eng.puppets.left;
      states.add(eng.machines.left.state);
      const tracking = left.isTracking(now);
      if (!tracking) {
        lostFrames += 1;
        if (lastX !== null) worstStepWhileLost = Math.max(worstStepWhileLost, Math.abs(left.rig.x - lastX));
        returnedAt = 0;
        inHandAt = 0;
      } else if (lostFrames > 0) {
        returnedAt ||= now;
        if (left.handPresence > 0.9) inHandAt ||= now;
      }
      lastX = left.rig.x;
      // The right hand never left: its puppet must stay held the whole time.
      expect(eng.puppets.right.isTracking(now)).toBe(true);
      expect(eng.machines.right.state).not.toBe('IDLE');
    };
    const engine = runEngine('loss', 9.5, watch, { settings: { agentPartner: false } });
    expect(lostFrames).toBeGreaterThan(60);
    expect(states.has('RECOVER')).toBe(true);
    // No teleport: while the hand is gone the puppet is first held, then glides; it never jumps.
    expect(worstStepWhileLost).toBeLessThan(3);
    // Reacquisition is quick: fully back in hand within 150 ms of the hand reappearing.
    expect(inHandAt - returnedAt).toBeLessThan(150);
    // By the end the left hand is back, on the left puppet.
    expect(engine.telemetry.hands.left.tracked).toBe(true);
    expect(loggedLoss).toBe(true);
  });
});

describe('sparse tracking (a webcam in dim light)', () => {
  /** How unevenly the rendered puppet moves during a steady rise of the hand: 0 is perfectly even. */
  const roughness = (fps: number) => {
    const steps: number[] = [];
    let last: number | null = null;
    runEngine(
      'lift',
      5.5,
      (engine, now) => {
        const y = engine.puppets.left.rig.y;
        // The middle of the second rise, where the hand moves at a steady speed.
        if (now > 4700 && now < 5300 && last !== null) steps.push(y - last);
        last = y;
      },
      { fps },
    );
    const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
    const stalled = steps.filter((step) => Math.abs(step) < Math.abs(mean) * 0.3).length / steps.length;
    return { spread: Math.sqrt(steps.reduce((sum, step) => sum + (step - mean) ** 2, 0) / steps.length) / Math.abs(mean), stalled };
  };

  it('moves evenly at 30 results a second', () => {
    expect(roughness(30).spread).toBeLessThan(0.1);
  });

  it('still moves without stopping and starting at 15 results a second', () => {
    // Measured: 0.16 with rate-aware followers and prediction; 0.72, with a quarter of all frames stalled, without.
    const { spread, stalled } = roughness(15);
    expect(spread).toBeLessThan(0.3);
    expect(stalled).toBe(0);
  });
});

describe('lift', () => {
  it('raises the puppet off the ground and reports LIFT', () => {
    let highest = 0;
    const states = new Set<InteractionState>();
    runEngine('lift', 4, (engine) => {
      highest = Math.max(highest, engine.puppets.left.lift);
      states.add(engine.machines.left.state);
    });
    expect(highest).toBeGreaterThan(120);
    expect(states.has('LIFT')).toBe(true);
  });
});
