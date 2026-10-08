import { describe, expect, it } from 'vitest';
import {
  articulateFromHand,
  DEFAULT_FINGER_MAP,
  gainFromSetting,
  palmMapping,
  stagePosition,
  type MappingContext,
} from '../src/motion/PuppetMapping';
import { CHANNEL_RIG_KEY, emptyRig } from '../src/motion/PuppetRig';
import { computeLayout } from '../src/scene/StageProps';
import { extractHandFeatures } from '../src/tracking/HandFeatures';
import { SIM_ASPECT, synthesizeHand } from '../src/tracking/SimulatedHands';
import { JOINT_CHANNELS, type FingerMap, type FingerName, type JointChannel } from '../src/types';
import { oneFinger, pose } from './helpers';

const layout = computeLayout(1200);
const context = (fingerMap: FingerMap = DEFAULT_FINGER_MAP): MappingContext => ({
  side: 'left',
  layout,
  gains: { finger: gainFromSetting(0.5), palm: gainFromSetting(0.5), pinch: gainFromSetting(0.5), roll: gainFromSetting(0.5), depth: 1 },
  fingerMap,
  palm: palmMapping('left', null),
  invertY: false,
});

const rigFor = (hand: ReturnType<typeof synthesizeHand>, ctx = context()) => articulateFromHand(extractHandFeatures(hand, SIM_ASPECT), ctx, emptyRig());

const FINGER_INDEX: Record<FingerName, number> = { thumb: 0, index: 1, middle: 2, ring: 3, pinky: 4 };

describe('finger → joint mapping', () => {
  const open = rigFor(synthesizeHand(pose(), 'left'));

  JOINT_CHANNELS.forEach((channel) => {
    const finger = DEFAULT_FINGER_MAP[channel];
    it(`${finger} drives ${channel} and nothing else`, () => {
      const bent = rigFor(oneFinger(FINGER_INDEX[finger], 0.04));
      const moved = Math.abs(bent[CHANNEL_RIG_KEY[channel]] - open[CHANNEL_RIG_KEY[channel]]);
      expect(moved).toBeGreaterThan(20);
      for (const other of JOINT_CHANNELS) {
        if (other === channel) continue;
        expect(Math.abs(bent[CHANNEL_RIG_KEY[other]] - open[CHANNEL_RIG_KEY[other]])).toBeLessThan(2.5);
      }
      expect(Math.abs(bent.bodyRotation - open.bodyRotation)).toBeLessThan(0.5);
    });
  });

  it('responds to a slight bend: no threshold has to be crossed first', () => {
    for (const channel of JOINT_CHANNELS) {
      const finger = DEFAULT_FINGER_MAP[channel];
      const slight = rigFor(oneFinger(FINGER_INDEX[finger], 0.84));
      expect(Math.abs(slight[CHANNEL_RIG_KEY[channel]] - open[CHANNEL_RIG_KEY[channel]])).toBeGreaterThan(3);
    }
  });

  it('turns each joint further the more its finger bends', () => {
    for (const channel of JOINT_CHANNELS) {
      const finger = DEFAULT_FINGER_MAP[channel];
      const key = CHANNEL_RIG_KEY[channel];
      const half = Math.abs(rigFor(oneFinger(FINGER_INDEX[finger], 0.5))[key] - open[key]);
      const full = Math.abs(rigFor(oneFinger(FINGER_INDEX[finger], 0.04))[key] - open[key]);
      expect(full).toBeGreaterThan(half + 5);
    }
  });

  it('closes the grip continuously as the pinch closes', () => {
    let previous = -1;
    for (let amount = 0; amount <= 1.0001; amount += 0.2) {
      const grip = rigFor(synthesizeHand(pose({ pinch: amount }), 'left')).grip;
      expect(grip).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = grip;
    }
    expect(rigFor(synthesizeHand(pose({ pinch: 0 }), 'left')).grip).toBeLessThan(0.15);
    expect(rigFor(synthesizeHand(pose({ pinch: 1 }), 'left')).grip).toBeGreaterThan(0.9);
  });

  it('leans the body with the roll of the wrist, in the direction the puppet faces', () => {
    const forward = rigFor(synthesizeHand(pose({ tilt: 24 }), 'left'));
    const back = rigFor(synthesizeHand(pose({ tilt: -24 }), 'left'));
    expect(forward.bodyRotation).toBeGreaterThan(8);
    expect(back.bodyRotation).toBeLessThan(-8);
  });

  it('follows a custom finger map', () => {
    // Swap the jobs of the index and little fingers.
    const map: FingerMap = { ...DEFAULT_FINGER_MAP, frontShoulder: 'pinky', backElbow: 'index' };
    const ctx = context(map);
    const openMapped = rigFor(synthesizeHand(pose(), 'left'), ctx);
    const pinky = rigFor(oneFinger(4, 0.04), ctx);
    expect(Math.abs(pinky.shoulderAngle - openMapped.shoulderAngle)).toBeGreaterThan(20);
    expect(Math.abs(pinky.backElbowAngle - openMapped.backElbowAngle)).toBeLessThan(2.5);
    const moved = (channel: JointChannel) => Math.abs(rigFor(oneFinger(1, 0.04), ctx)[CHANNEL_RIG_KEY[channel]] - openMapped[CHANNEL_RIG_KEY[channel]]);
    expect(moved('backElbow')).toBeGreaterThan(20);
  });
});

describe('palm → stage position', () => {
  const position = (x: number, y: number, ctx = context()) => {
    const out = { x: 0, y: 0 };
    stagePosition(x, y, ctx, out);
    return out;
  };

  it('moves with the smallest palm movement around home', () => {
    const home = position(0.3, 0.62);
    const nudged = position(0.305, 0.62);
    expect(nudged.x - home.x).toBeGreaterThan(2);
    // In the air the same holds vertically; right at the ground the feet grip a little first.
    expect(position(0.3, 0.5).y - position(0.3, 0.495).y).toBeGreaterThan(2);
    expect(position(0.3, 0.62).y - position(0.3, 0.6).y).toBeGreaterThan(2);
  });

  it('stands on the ground at home and lifts as the hand rises', () => {
    expect(position(0.3, 0.62).y).toBeCloseTo(layout.groundY, 0);
    expect(position(0.3, 0.4).y).toBeLessThan(layout.groundY - 100);
  });

  it('never leaves its own side of the table, however far the hand goes', () => {
    const [min, max] = layout.range.left;
    for (const x of [-0.5, 0, 0.5, 1, 1.5]) {
      const p = position(x, 0.6);
      expect(p.x).toBeGreaterThanOrEqual(min - 0.01);
      expect(p.x).toBeLessThanOrEqual(max + 0.01);
    }
    expect(position(0.3, -2).y).toBeGreaterThanOrEqual(layout.groundY - layout.maxLift - 0.01);
    expect(position(0.3, 3).y).toBeLessThanOrEqual(layout.groundY + layout.maxCrouch + 0.01);
  });

  it('can be inverted vertically', () => {
    const ctx = { ...context(), invertY: true };
    expect(position(0.3, 0.8, ctx).y).toBeLessThan(layout.groundY - 50);
  });
});
