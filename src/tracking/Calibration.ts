import { FINGER_NAMES, SIDES, type FingerName, type HandFeatures, type Side } from '../types';
import { clamp } from '../utils/math';

/**
 * Per-hand calibration: what "open" and "closed" look like for this hand at
 * this camera angle, and the part of the view the hand comfortably moves in.
 * Everything is optional; without it the built-in ranges are used.
 */

export interface PalmRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface HandCalibration {
  /** Raw curl of each finger with the hand naturally open. */
  open: Record<FingerName, number>;
  /** Raw curl of each finger with the hand closed. */
  closed: Record<FingerName, number>;
  palm: PalmRange | null;
}

export type CalibrationStore = Partial<Record<Side, HandCalibration>>;

const STORAGE_KEY = 'dalangv2.calibration.v1';
/** A finger whose measured range is narrower than this was not really exercised: keep the default for it. */
const MIN_CURL_SPAN = 0.25;
/** The palm must have covered at least this much of the view for its range to be used. */
const MIN_PALM_SPAN = { x: 0.14, y: 0.12 } as const;

/** Maps a raw curl onto 0..1 between this hand's measured open and closed poses. */
export function calibratedCurl(raw: number, open: number, closed: number): number {
  const low = open + 0.02;
  const high = closed - 0.03;
  if (high - low < MIN_CURL_SPAN) return raw;
  return clamp((raw - low) / (high - low), 0, 1);
}

/** Rescales the raw finger curls in place. Derived signals must be recomputed afterwards. */
export function applyCalibration(features: HandFeatures, calibration: HandCalibration | null | undefined) {
  if (!calibration) return;
  for (const finger of FINGER_NAMES) {
    const f = features[finger];
    f.curl = calibratedCurl(f.curl, calibration.open[finger], calibration.closed[finger]);
    f.extension = 1 - f.curl;
  }
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function parseFingers(value: unknown): Record<FingerName, number> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const out = {} as Record<FingerName, number>;
  for (const finger of FINGER_NAMES) {
    const v = record[finger];
    if (!isNumber(v)) return null;
    out[finger] = clamp(v, 0, 1);
  }
  return out;
}

function parsePalm(value: unknown): PalmRange | null {
  if (!value || typeof value !== 'object') return null;
  const { minX, maxX, minY, maxY } = value as Record<string, unknown>;
  if (!isNumber(minX) || !isNumber(maxX) || !isNumber(minY) || !isNumber(maxY)) return null;
  return { minX, maxX, minY, maxY };
}

export function loadCalibration(): CalibrationStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const store: CalibrationStore = {};
    for (const side of SIDES) {
      const entry = saved[side] as Record<string, unknown> | undefined;
      if (!entry) continue;
      const open = parseFingers(entry.open);
      const closed = parseFingers(entry.closed);
      if (open && closed) store[side] = { open, closed, palm: parsePalm(entry.palm) };
    }
    return store;
  } catch {
    return {};
  }
}

export function saveCalibration(store: CalibrationStore) {
  try {
    if (Object.keys(store).length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage can be unavailable (private mode, quota); the calibration then lasts for this visit only.
  }
}

/* ------------------------------------------------------------------ guided session */

export type CalibrationStep = 'show' | 'open' | 'fist' | 'range' | 'done';

export const CALIBRATION_STEPS: readonly CalibrationStep[] = ['show', 'open', 'fist', 'range', 'done'];

/** How long each pose has to be held, in seconds of valid samples. */
const HOLD_SECONDS: Record<Exclude<CalibrationStep, 'done'>, number> = { show: 0.6, open: 1.2, fist: 1.0, range: 4 };

interface Accumulator {
  sum: Record<FingerName, number>;
  count: number;
}

const emptyFingers = (): Record<FingerName, number> => ({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });
const emptyAccumulator = (): Accumulator => ({ sum: emptyFingers(), count: 0 });

interface SideSamples {
  open: Accumulator;
  closed: Accumulator;
  palm: PalmRange | null;
}

const emptySamples = (): SideSamples => ({ open: emptyAccumulator(), closed: emptyAccumulator(), palm: null });

/**
 * The short guided calibration: show a hand, open it, close it, then move it
 * around. It is fed the *raw* (uncalibrated, unfiltered) features of every
 * tracked frame and only advances while the hand really holds the asked pose.
 */
export class CalibrationSession {
  step: CalibrationStep = 'show';
  /** Progress through the current step, 0..1. */
  progress = 0;

  private held = 0;
  private lastFeed = 0;
  private readonly samples: Record<Side, SideSamples> = { left: emptySamples(), right: emptySamples() };

  /** Feeds one tracked frame of one hand. `now` is in milliseconds. */
  feed(side: Side, raw: HandFeatures, now: number) {
    if (this.step === 'done') return;
    // Both hands may feed within the same frame; time only advances once per frame.
    const dt = this.lastFeed && now > this.lastFeed ? Math.min((now - this.lastFeed) / 1000, 0.1) : 0;
    if (now > this.lastFeed) this.lastFeed = now;
    const samples = this.samples[side];
    const meanCurl = (raw.index.curl + raw.middle.curl + raw.ring.curl + raw.pinky.curl) / 4;

    let valid = true;
    if (this.step === 'open') {
      valid = meanCurl < 0.3;
      if (valid) this.accumulate(samples.open, raw);
    } else if (this.step === 'fist') {
      valid = meanCurl > 0.55;
      if (valid) this.accumulate(samples.closed, raw);
    } else if (this.step === 'range') {
      const palm = (samples.palm ??= { minX: raw.palmX, maxX: raw.palmX, minY: raw.palmY, maxY: raw.palmY });
      palm.minX = Math.min(palm.minX, raw.palmX);
      palm.maxX = Math.max(palm.maxX, raw.palmX);
      palm.minY = Math.min(palm.minY, raw.palmY);
      palm.maxY = Math.max(palm.maxY, raw.palmY);
    }

    if (valid) this.held += dt;
    this.progress = clamp(this.held / HOLD_SECONDS[this.step], 0, 1);
    if (this.progress >= 1) this.advance();
  }

  /** Moves on without waiting (the "skip" button); a skipped step keeps its defaults. */
  advance() {
    const index = CALIBRATION_STEPS.indexOf(this.step);
    this.step = CALIBRATION_STEPS[Math.min(index + 1, CALIBRATION_STEPS.length - 1)];
    this.held = 0;
    this.progress = 0;
  }

  /** What was measured, merged over an existing calibration. Sides that were never seen keep theirs. */
  result(previous: CalibrationStore = {}): CalibrationStore {
    const store: CalibrationStore = { ...previous };
    for (const side of SIDES) {
      const samples = this.samples[side];
      const hasCurls = samples.open.count > 0 && samples.closed.count > 0;
      const palm =
        samples.palm && samples.palm.maxX - samples.palm.minX >= MIN_PALM_SPAN.x && samples.palm.maxY - samples.palm.minY >= MIN_PALM_SPAN.y
          ? samples.palm
          : null;
      if (!hasCurls && !palm) continue;
      const before = previous[side];
      store[side] = {
        open: hasCurls ? this.mean(samples.open) : (before?.open ?? emptyFingers()),
        closed: hasCurls ? this.mean(samples.closed) : (before?.closed ?? { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 }),
        palm: palm ?? before?.palm ?? null,
      };
    }
    return store;
  }

  private accumulate(target: Accumulator, raw: HandFeatures) {
    for (const finger of FINGER_NAMES) target.sum[finger] += raw[finger].curl;
    target.count += 1;
  }

  private mean(source: Accumulator): Record<FingerName, number> {
    const out = emptyFingers();
    for (const finger of FINGER_NAMES) out[finger] = source.sum[finger] / source.count;
    return out;
  }
}
