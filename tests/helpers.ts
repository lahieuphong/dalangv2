import { Engine } from '../src/app/Engine';
import { DEFAULT_SETTINGS, type AppFlags, type Settings } from '../src/app/settings';
import type { SimScript } from '../src/tracking/SimulatedHands';
import { synthesizeHand, type HandPose } from '../src/tracking/SimulatedHands';
import type { Side } from '../src/types';

export const OPEN: readonly number[] = [0.96, 0.96, 0.96, 0.96, 0.96];

export const pose = (overrides: Partial<HandPose> = {}): HandPose => ({ x: 0.3, y: 0.6, tilt: 0, size: 0.17, extension: OPEN, pinch: 0, ...overrides });

/** A hand with exactly one finger bent to `extension` and the other four open. */
export function oneFinger(finger: number, extension: number, side: Side = 'left') {
  const fingers = [...OPEN];
  fingers[finger] = extension;
  return synthesizeHand(pose({ extension: fingers }), side);
}

export const flags = (script: SimScript, noise: number | null = 0): AppFlags => ({
  debug: false,
  simulate: true,
  script,
  noise,
  simFps: null,
  tracker: null,
  delegate: null,
  hud: true,
});

/**
 * Runs the whole pipeline headlessly on a simulated scenario: the same engine
 * the page runs, stepped at 60 fps with no views attached. `each` is called
 * after every frame.
 */
export function runEngine(
  script: SimScript,
  seconds: number,
  each?: (engine: Engine, now: number) => void,
  options: { noise?: number | null; settings?: Partial<Settings>; fps?: number } = {},
): Engine {
  const engine = new Engine({ ...flags(script, options.noise ?? 0), simFps: options.fps ?? null }, { ...DEFAULT_SETTINGS, ...options.settings }, {});
  const dt = 1 / 60;
  // Start well away from zero, like a real page clock.
  let now = 1000;
  for (let i = 0; i < seconds * 60; i++) {
    now += dt * 1000;
    engine.tick(now, dt, { tracker: null, video: null, cameraActive: false, trackerStatus: 'ready', reducedMotion: false });
    each?.(engine, now);
  }
  return engine;
}

/** Tracks the smallest and largest value seen for each named number. */
export class Ranges<K extends string> {
  private readonly min = new Map<K, number>();
  private readonly max = new Map<K, number>();

  add(key: K, value: number) {
    this.min.set(key, Math.min(this.min.get(key) ?? Infinity, value));
    this.max.set(key, Math.max(this.max.get(key) ?? -Infinity, value));
  }

  span(key: K) {
    return (this.max.get(key) ?? 0) - (this.min.get(key) ?? 0);
  }
}

export function standardDeviation(values: readonly number[]) {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
}
