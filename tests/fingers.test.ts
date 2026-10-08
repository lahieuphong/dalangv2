import { describe, expect, it } from 'vitest';
import { extractHandFeatures } from '../src/tracking/HandFeatures';
import { SIM_ASPECT, synthesizeHand } from '../src/tracking/SimulatedHands';
import { FINGER_NAMES } from '../src/types';
import { oneFinger, OPEN, pose } from './helpers';

const features = (hand: ReturnType<typeof synthesizeHand>) => extractHandFeatures(hand, SIM_ASPECT);

describe('per-finger geometry', () => {
  it('reads an open hand as five straight fingers', () => {
    const f = features(synthesizeHand(pose(), 'left'));
    for (const finger of FINGER_NAMES) expect(f[finger].curl).toBeLessThan(0.12);
    expect(f.fistStrength).toBe(0);
    expect(f.pinchStrength).toBeLessThan(0.05);
    expect(f.openness).toBeGreaterThan(0.9);
  });

  FINGER_NAMES.forEach((finger, index) => {
    it(`bending only the ${finger} changes only the ${finger}`, () => {
      const open = features(synthesizeHand(pose(), 'left'));
      const bent = features(oneFinger(index, 0.04));
      expect(bent[finger].curl).toBeGreaterThan(0.6);
      for (const other of FINGER_NAMES) {
        if (other === finger) continue;
        // The other four must not move at all: each finger is measured from its own landmarks.
        expect(Math.abs(bent[other].curl - open[other].curl)).toBeLessThan(0.02);
      }
      // One finger folding is neither a fist nor a pinch.
      expect(bent.fistStrength).toBe(0);
      expect(bent.pinchStrength).toBeLessThan(0.12);
    });
  });

  it('grows continuously with the bend, with no dead zone at the start', () => {
    for (let finger = 0; finger < 5; finger++) {
      let previous = -1;
      for (let extension = 0.96; extension >= 0; extension -= 0.04) {
        const curl = features(oneFinger(finger, extension))[FINGER_NAMES[finger]].curl;
        expect(curl).toBeGreaterThanOrEqual(previous - 1e-6);
        previous = curl;
      }
      const slight = features(oneFinger(finger, 0.86))[FINGER_NAMES[finger]].curl;
      const open = features(oneFinger(finger, 0.96))[FINGER_NAMES[finger]].curl;
      // A tenth of the travel is already clearly visible.
      expect(slight - open).toBeGreaterThan(0.04);
    }
  });

  it('does not change when the hand moves toward or away from the camera', () => {
    const fingers = [0.5, 0.3, 0.7, 0.4, 0.6];
    const near = features(synthesizeHand(pose({ size: 0.27, extension: fingers }), 'left'));
    const far = features(synthesizeHand(pose({ size: 0.1, extension: fingers }), 'left'));
    for (const finger of FINGER_NAMES) expect(near[finger].curl).toBeCloseTo(far[finger].curl, 2);
    expect(near.pinchDistance).toBeCloseTo(far.pinchDistance, 2);
    expect(near.size).toBeGreaterThan(far.size * 2);
  });

  it('measures the same hand the same way on either side', () => {
    const fingers = [0.5, 0.3, 0.7, 0.4, 0.6];
    const left = features(synthesizeHand(pose({ extension: fingers }), 'left'));
    const right = features(synthesizeHand(pose({ x: 0.7, extension: fingers }), 'right'));
    for (const finger of FINGER_NAMES) expect(left[finger].curl).toBeCloseTo(right[finger].curl, 3);
  });
});

describe('pinch', () => {
  it('rises over the whole approach of thumb and index, long before they touch', () => {
    let previous = -1;
    const strengths: number[] = [];
    for (let amount = 0; amount <= 1.0001; amount += 0.1) {
      const strength = features(synthesizeHand(pose({ pinch: amount }), 'left')).pinchStrength;
      expect(strength).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = strength;
      strengths.push(strength);
    }
    expect(strengths[0]).toBeLessThan(0.05);
    expect(strengths[5]).toBeGreaterThan(0.25);
    expect(strengths[5]).toBeLessThan(0.85);
    expect(strengths[10]).toBeGreaterThan(0.95);
  });
});

describe('fingers out of view', () => {
  it('flags a fingertip outside the frame instead of trusting it', () => {
    const inView = features(synthesizeHand(pose({ y: 0.6 }), 'left'));
    const clipped = features(synthesizeHand(pose({ y: 0.14 }), 'left'));
    for (const finger of FINGER_NAMES) expect(inView[finger].inFrame).toBe(true);
    expect(clipped.middle.inFrame).toBe(false);
    expect(clipped.index.inFrame).toBe(false);
  });

  it('keeps a fully open hand open when the fingers are extended', () => {
    const f = features(synthesizeHand(pose({ extension: OPEN }), 'right'));
    expect(f.openness).toBeGreaterThan(0.9);
  });
});
