import { describe, expect, it } from 'vitest';
import { calibratedCurl, CalibrationSession } from '../src/tracking/Calibration';
import { HandAssigner } from '../src/tracking/HandAssignment';
import { extractHandFeatures } from '../src/tracking/HandFeatures';
import { OneEuroFilter } from '../src/tracking/OneEuroFilter';
import { SIM_ASPECT, synthesizeHand } from '../src/tracking/SimulatedHands';
import { HandFeatureFilter, SpikeGuard } from '../src/tracking/TrackingFilters';
import { mulberry32 } from '../src/utils/math';
import { pose, standardDeviation } from './helpers';

const left = (x: number, y = 0.6) => synthesizeHand(pose({ x, y }), 'left');
const right = (x: number, y = 0.6) => synthesizeHand(pose({ x, y }), 'right');

describe('hand assignment', () => {
  it('gives each hand the puppet on its side of the view', () => {
    const assigner = new HandAssigner();
    const a = left(0.3);
    const b = right(0.7);
    // The order MediaPipe reports hands in must not matter.
    const assigned = assigner.assign([b, a], 0);
    expect(assigned.left).toBe(a);
    expect(assigned.right).toBe(b);
  });

  it('keeps each hand on its puppet while the hands cross over', () => {
    const assigner = new HandAssigner();
    let t = 0;
    for (let step = 0; step <= 60; step++) {
      const k = step / 60;
      // The left hand travels to the right of the right hand and stays there.
      const a = left(0.3 + 0.45 * k, 0.55);
      const b = right(0.7 - 0.45 * k, 0.66);
      const assigned = assigner.assign(step % 2 ? [a, b] : [b, a], (t += 33));
      expect(assigned.left).toBe(a);
      expect(assigned.right).toBe(b);
    }
  });

  it('ignores a mislabelled frame', () => {
    const assigner = new HandAssigner();
    assigner.assign([left(0.3), right(0.7)], 0);
    const a = left(0.31);
    const b = right(0.69);
    // For one frame the model swaps its left / right labels.
    a.handedness = 'right';
    a.naturalSide = 'right';
    b.handedness = 'left';
    b.naturalSide = 'left';
    const assigned = assigner.assign([a, b], 33);
    expect(assigned.left).toBe(a);
    expect(assigned.right).toBe(b);
  });

  it('leaves the remaining hand alone when the other drops out, and takes it back in the same place', () => {
    const assigner = new HandAssigner();
    assigner.assign([left(0.3), right(0.7)], 0);
    const only = right(0.66);
    let assigned = assigner.assign([only], 33);
    expect(assigned.right).toBe(only);
    expect(assigned.left).toBeNull();

    const back = left(0.34);
    const still = right(0.66);
    assigned = assigner.assign([still, back], 400);
    expect(assigned.left).toBe(back);
    expect(assigned.right).toBe(still);
  });

  it('counts one hand reported twice as one hand', () => {
    const assigner = new HandAssigner();
    const a = left(0.3);
    const twin = left(0.302);
    twin.handednessScore = 0.6;
    const assigned = assigner.assign([twin, a], 0);
    expect(assigned.left).toBe(a);
    expect(assigned.right).toBeNull();
  });

  it('can hand the puppets over the other way round', () => {
    const assigner = new HandAssigner();
    assigner.swapped = true;
    const a = left(0.3);
    const b = right(0.7);
    const assigned = assigner.assign([a, b], 0);
    expect(assigned.left).toBe(b);
    expect(assigned.right).toBe(a);
  });
});

describe('noise-aware One Euro filter', () => {
  const NOISE = 0.015;

  const run = (signal: (i: number) => number, samples: number) => {
    const random = mulberry32(7);
    const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());
    const filter = new OneEuroFilter(1.5, 6, 3);
    filter.noise = NOISE;
    const input: number[] = [];
    const output: number[] = [];
    for (let i = 0; i < samples; i++) {
      const value = signal(i) + gaussian() * NOISE;
      input.push(value);
      output.push(filter.filter(value, i / 30));
    }
    return { input, output };
  };

  it('holds a resting signal at least twice as steady as it arrives', () => {
    const { input, output } = run(() => 0.4, 300);
    // At rest the filter's cutoff alone removes about 63 % of the jitter; snaps on rare 3 σ samples give a little back.
    expect(standardDeviation(output.slice(60))).toBeLessThan(standardDeviation(input.slice(60)) * 0.5);
  });

  it('lets a deliberate change through on the frame it is seen', () => {
    const { output } = run((i) => (i < 60 ? 0.2 : 0.7), 70);
    // The step lands at sample 60: most of it must already be there, and all of it two frames later.
    expect(output[60]).toBeGreaterThan(0.2 + 0.5 * 0.7);
    expect(output[62]).toBeGreaterThan(0.2 + 0.5 * 0.9);
    expect(Math.max(...output)).toBeLessThan(0.7 + 4 * NOISE);
  });

  it('follows a steady movement without falling behind', () => {
    // A finger curling at 1.5 / s: a lag of one frame would be an error of 0.05.
    const { output } = run((i) => Math.min(1, i * 0.05), 20);
    for (let i = 4; i < 18; i++) expect(Math.abs(output[i] - i * 0.05)).toBeLessThan(0.05);
  });
});

describe('spike guard', () => {
  it('halves a single-frame glitch and passes a movement that keeps going', () => {
    const guard = new SpikeGuard();
    expect(guard.apply(0.2, 0.3)).toBe(0.2);
    expect(guard.apply(0.9, 0.3)).toBeCloseTo(0.55);
    expect(guard.apply(0.2, 0.3)).toBe(0.2);

    guard.reset();
    guard.apply(0.2, 0.3);
    guard.apply(0.9, 0.3);
    // The next frame confirms the jump: it is taken in full.
    expect(guard.apply(0.95, 0.3)).toBe(0.95);
  });
});

describe('feature filter', () => {
  it('holds a finger at its last trusted value while it is out of frame', () => {
    const filter = new HandFeatureFilter();
    const seen = extractHandFeatures(synthesizeHand(pose({ extension: [0.96, 0.5, 0.96, 0.96, 0.96] }), 'left'), SIM_ASPECT);
    const before = filter.filter(seen, 0, 0.3).index.curl;

    const guessed = extractHandFeatures(synthesizeHand(pose({ extension: [0.96, 0.02, 0.96, 0.96, 0.96] }), 'left'), SIM_ASPECT);
    guessed.index.inFrame = false;
    const during = filter.filter(guessed, 1 / 30, 0.3);
    // The model's guess says "fully curled"; the filter must not believe it.
    expect(during.index.curl).toBeCloseTo(before, 6);
    expect(during.index.inFrame).toBe(false);
  });
});

describe('calibration', () => {
  it('maps a hand’s own open and closed poses onto 0 and 1', () => {
    expect(calibratedCurl(0.1, 0.1, 0.8)).toBe(0);
    expect(calibratedCurl(0.8, 0.1, 0.8)).toBe(1);
    expect(calibratedCurl(0.45, 0.1, 0.8)).toBeCloseTo(0.508, 2);
  });

  it('leaves a finger alone when its range was never really exercised', () => {
    expect(calibratedCurl(0.3, 0.2, 0.3)).toBe(0.3);
  });

  it('walks through its steps only while the asked pose is held', () => {
    const session = new CalibrationSession();
    const open = extractHandFeatures(synthesizeHand(pose(), 'left'), SIM_ASPECT);
    const fist = extractHandFeatures(synthesizeHand(pose({ extension: [0.2, 0.05, 0.05, 0.05, 0.05] }), 'left'), SIM_ASPECT);
    let now = 0;
    const hold = (features: typeof open, seconds: number) => {
      for (let i = 0; i < seconds * 30; i++) session.feed('left', features, (now += 33.3));
    };

    hold(open, 1);
    expect(session.step).toBe('open');
    // A fist is not what the "open" step asks for: no progress.
    hold(fist, 2);
    expect(session.step).toBe('open');
    hold(open, 1.5);
    expect(session.step).toBe('fist');
    hold(fist, 1.3);
    expect(session.step).toBe('range');
    session.advance();
    expect(session.step).toBe('done');

    const store = session.result();
    expect(store.left).toBeDefined();
    expect(store.left!.closed.index).toBeGreaterThan(store.left!.open.index + 0.5);
    expect(store.right).toBeUndefined();
  });
});
