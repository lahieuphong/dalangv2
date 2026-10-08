import type { HandDetection, HandFrame, Point, Side } from '../types';
import type { BackendMode, InferenceBackend } from './InferenceBackend';
import { FLOATS_PER_HAND, LANDMARKS_PER_HAND, type Delegate, type PackedHands } from './trackerProtocol';

/** On the main thread, never run inference more often than this, even when it is very cheap. */
const MAX_INFERENCE_FPS = 60;
/**
 * On the main thread, inference may use at most this share of the time. A
 * fast machine tracks every camera frame well inside it; a slow one is held
 * back so rendering always keeps a good part of the thread.
 */
const MAIN_THREAD_BUDGET = 0.6;
/** …but never throttle below this rate. */
const MAX_INFERENCE_INTERVAL_MS = 100;
/** The first calls include GPU warm-up (shader compilation) and must not skew the averages. */
const WARMUP_CALLS = 3;
/** A frame that has not come back after this long is given up on. */
const STALL_MS = 15000;

export interface TrackerStats {
  /** New frames delivered by the camera per second. */
  cameraFps: number;
  /** Results per second. */
  inferenceFps: number;
  /** Time the model needs for one frame, ms. */
  inferenceMs: number;
  /** From grabbing a frame until its result is back on the render thread, ms. */
  turnaroundMs: number;
  /** From the camera capturing a frame until the page can see it, ms (0 when the browser does not say). */
  captureDelayMs: number;
}

/** A backend being measured on live frames next to the one that is tracking. */
interface Audition {
  backend: InferenceBackend;
  durationMs: number;
  done: (roundTripMs: number) => void;
  busy: boolean;
  sentAt: number;
  calls: number;
  failures: number;
  measuringSince: number;
  roundTripMs: number;
}

/** Older browsers lack requestVideoFrameCallback even though the DOM types declare it. */
const supportsFrameCallback = (video: HTMLVideoElement) => typeof video.requestVideoFrameCallback === 'function';

const smooth = (average: number, value: number) => (average ? average + (value - average) * 0.1 : value);
/** Rate from a smoothed interval; averaging the intervals (not the rates) keeps uneven pacing from inflating it. */
const rate = (intervalMs: number) => (intervalMs > 0 ? 1000 / intervalMs : 0);

/**
 * Feeds camera frames to the hand model and hands the results to the render loop.
 *
 * Frames are never queued. Where `requestVideoFrameCallback` exists the
 * camera itself drives the tracker: each newly presented frame is offered
 * once. If the model is free it starts on that frame at once; if it is busy,
 * the frame only replaces the previous "waiting" one, so the model always
 * continues with the newest frame there is and everything older is dropped.
 *
 * On the main thread (the default: the shortest path from camera to pose),
 * inference runs right inside the frame callback, so its result drives the
 * very render frame that follows; a running time budget keeps it from
 * crowding out rendering. With a worker backend the render thread only
 * snapshots a frame and reads the answer later.
 */
export class HandTracker {
  readonly stats: TrackerStats = { cameraFps: 0, inferenceFps: 0, inferenceMs: 0, turnaroundMs: 0, captureDelayMs: 0 };
  /** Where inference runs right now. */
  mode: BackendMode;
  delegate: Delegate;
  /** Mirror landmarks into view space (matches the mirrored preview). */
  mirror = true;
  /** Called after every result, with fresh stats; used to decide whether another backend would serve better. */
  onReview: ((tracker: HandTracker, now: number) => void) | null = null;

  private backend: InferenceBackend;
  private blocking: boolean;
  private next: InferenceBackend | null = null;
  private candidate: Audition | null = null;
  private readonly onFatal: (error: unknown) => void;
  private video: HTMLVideoElement | null = null;
  private callbackHandle = 0;
  private latest: HandFrame | null = null;
  private unread = false;

  /** The newest camera frame not yet sent to the model. */
  private waiting = false;
  private waitingCapture = 0;
  private offeredMediaTime = -1;

  /** The one frame the model is working on. */
  private inFlight = false;
  private sentAt = 0;
  private sentCapture = 0;
  private sentAspect = 1;
  private sentMirror = true;

  private failures = 0;
  private calls = 0;
  private lastInferenceAt = -Infinity;
  private lastResultAt = -Infinity;
  private lastTimestamp = 0;
  private lastPresented = -1;
  private lastPresentedAt = 0;
  private cameraIntervalMs = 0;
  private resultIntervalMs = 0;
  /** Main-thread time spent on inference that the budget has not yet paid back, ms. */
  private debt = 0;
  private debtAt = 0;

  constructor(backend: InferenceBackend, onFatal: (error: unknown) => void) {
    this.backend = backend;
    this.mode = backend.mode;
    this.delegate = backend.delegate;
    this.blocking = backend.mode === 'main-thread';
    this.onFatal = onFatal;
  }

  /** Starts following a video element (idempotent). */
  attach(video: HTMLVideoElement) {
    if (this.video === video) return;
    this.detach();
    this.video = video;
    if (supportsFrameCallback(video)) this.callbackHandle = video.requestVideoFrameCallback(this.onVideoFrame);
  }

  detach() {
    const video = this.video;
    if (video && this.callbackHandle && supportsFrameCallback(video)) video.cancelVideoFrameCallback(this.callbackHandle);
    this.video = null;
    this.callbackHandle = 0;
    this.offeredMediaTime = -1;
    this.lastPresented = -1;
    this.waiting = false;
  }

  dispose() {
    this.detach();
    this.onReview = null;
    this.next = null;
    this.candidate = null;
    this.latest = null;
    this.unread = false;
    this.inFlight = false;
  }

  /** Moves tracking to another backend at the next frame boundary; its averages start afresh. */
  switchTo(backend: InferenceBackend) {
    this.next = backend;
    if (!this.inFlight) this.adopt();
  }

  /**
   * Measures another backend on the live camera frames for `durationMs`,
   * next to normal tracking and without using its results, then reports its
   * average round trip (Infinity if it keeps failing). Tracking itself is
   * not interrupted, so trying a backend costs the puppeteer nothing.
   */
  audition(backend: InferenceBackend, durationMs: number, done: (roundTripMs: number) => void) {
    this.candidate = { backend, durationMs, done, busy: false, sentAt: 0, calls: 0, failures: 0, measuringSince: 0, roundTripMs: 0 };
  }

  /**
   * Called once per render frame. Returns the newest result exactly once
   * (null when nothing new arrived). Without frame callbacks, this is also
   * where new camera frames are noticed.
   */
  take(now: number): HandFrame | null {
    const video = this.video;
    if (video && !supportsFrameCallback(video)) this.offer(now, now, video.currentTime);
    if (this.inFlight && performance.now() - this.sentAt > STALL_MS) {
      this.inFlight = false;
      this.onFatal(new Error('Hand tracking stopped responding'));
    }
    if (!this.unread) return null;
    this.unread = false;
    return this.latest;
  }

  private onVideoFrame = (now: number, metadata: VideoFrameCallbackMetadata) => {
    const video = this.video;
    if (!video) return;
    this.callbackHandle = video.requestVideoFrameCallback(this.onVideoFrame);

    const stats = this.stats;
    if (this.lastPresented >= 0) {
      const frames = metadata.presentedFrames - this.lastPresented;
      if (frames > 0 && now > this.lastPresentedAt) {
        this.cameraIntervalMs = smooth(this.cameraIntervalMs, (now - this.lastPresentedAt) / frames);
        stats.cameraFps = rate(this.cameraIntervalMs);
      }
    }
    this.lastPresented = metadata.presentedFrames;
    this.lastPresentedAt = now;

    const captured = metadata.captureTime;
    if (captured !== undefined && captured <= now) stats.captureDelayMs = smooth(stats.captureDelayMs, Math.min(now - captured, 500));
    this.offer(now, Math.min(captured ?? metadata.expectedDisplayTime ?? now, now), metadata.mediaTime);
    this.feedCandidate(video, now);
  };

  private feedCandidate(video: HTMLVideoElement, now: number) {
    const candidate = this.candidate;
    if (!candidate || candidate.busy) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return;
    candidate.busy = true;
    candidate.sentAt = performance.now();
    const timestamp = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    candidate.backend.detect(video, timestamp, this.onCandidateResult);
  }

  private onCandidateResult = (hands: PackedHands | null) => {
    const candidate = this.candidate;
    if (!candidate) return;
    candidate.busy = false;
    const now = performance.now();
    if (!hands) {
      candidate.failures += 1;
      if (candidate.failures < 3) return;
      this.candidate = null;
      candidate.done(Infinity);
      return;
    }
    candidate.calls += 1;
    if (candidate.calls <= WARMUP_CALLS) return;
    if (!candidate.measuringSince) candidate.measuringSince = now;
    candidate.roundTripMs = smooth(candidate.roundTripMs, now - candidate.sentAt);
    if (now - candidate.measuringSince < candidate.durationMs) return;
    this.candidate = null;
    candidate.done(candidate.roundTripMs);
  };

  /** A new camera frame exists: it replaces any frame still waiting, then the model is started if it is free. */
  private offer(now: number, captureTime: number, mediaTime: number) {
    if (mediaTime === this.offeredMediaTime) return;
    this.offeredMediaTime = mediaTime;
    this.waiting = true;
    this.waitingCapture = captureTime;
    this.pump(now);
  }

  private pump(now: number) {
    const video = this.video;
    if (!video || !this.waiting || this.inFlight) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return;
    if (this.blocking && !this.affordable(now)) return;

    this.waiting = false;
    this.inFlight = true;
    this.lastInferenceAt = now;
    this.sentAt = performance.now();
    this.sentCapture = this.waitingCapture;
    this.sentAspect = video.videoWidth / video.videoHeight;
    this.sentMirror = this.mirror;
    // MediaPipe requires strictly increasing timestamps.
    const timestamp = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    this.backend.detect(video, timestamp, this.onResult);
  }

  /**
   * Main-thread budget on a running average rather than per frame: each call
   * adds its cost as debt, time pays it back at the budget rate. Frames are
   * skipped only while in debt.
   */
  private affordable(now: number) {
    if (now - this.lastInferenceAt < 1000 / MAX_INFERENCE_FPS - 1) return false;
    this.debt = Math.max(0, this.debt - (now - this.debtAt) * MAIN_THREAD_BUDGET);
    this.debtAt = now;
    const overdue = now - this.lastInferenceAt >= MAX_INFERENCE_INTERVAL_MS;
    return this.debt <= this.stats.inferenceMs || overdue;
  }

  private adopt() {
    const backend = this.next;
    if (!backend) return;
    this.next = null;
    this.backend = backend;
    this.mode = backend.mode;
    this.delegate = backend.delegate;
    this.blocking = backend.mode === 'main-thread';
    this.calls = 0;
    this.failures = 0;
    this.debt = 0;
    this.resultIntervalMs = 0;
    this.stats.inferenceMs = 0;
    this.stats.turnaroundMs = 0;
    this.stats.inferenceFps = 0;
  }

  private onResult = (hands: PackedHands | null, inferenceMs: number) => {
    if (!this.inFlight) return;
    this.inFlight = false;
    const now = performance.now();

    if (!hands) {
      this.failures += 1;
      if (this.failures === 3) this.onFatal(new Error('Hand tracking keeps failing'));
    } else {
      this.failures = 0;
      this.calls += 1;
      if (this.calls > WARMUP_CALLS) {
        const stats = this.stats;
        const cost = Math.min(inferenceMs, 200);
        stats.inferenceMs = smooth(stats.inferenceMs, cost);
        stats.turnaroundMs = smooth(stats.turnaroundMs, Math.min(now - this.sentAt, 500));
        if (this.blocking) this.debt += cost;
        const elapsed = now - this.lastResultAt;
        if (elapsed > 0 && elapsed < 1000) {
          this.resultIntervalMs = smooth(this.resultIntervalMs, elapsed);
          stats.inferenceFps = rate(this.resultIntervalMs);
        }
      }
      this.lastResultAt = now;
      this.latest = toFrame(hands, this.sentAspect, this.sentMirror, this.sentCapture, now);
      this.unread = true;
      this.onReview?.(this, now);
    }

    if (this.next) this.adopt();
    // Off the main thread there is no reason to wait for the next camera frame:
    // if a newer one arrived while the model was busy, start on it right away.
    if (!this.blocking) this.pump(now);
  };
}

function toFrame(packed: PackedHands, aspect: number, mirror: boolean, time: number, received: number): HandFrame {
  const { points } = packed;
  const hands: HandDetection[] = [];
  for (let h = 0; h < packed.count; h++) {
    let o = h * FLOATS_PER_HAND;
    const landmarks: Point[] = [];
    for (let i = 0; i < LANDMARKS_PER_HAND; i++, o += 3) {
      landmarks.push({ x: mirror ? 1 - points[o] : points[o], y: points[o + 1], z: points[o + 2] });
    }
    let worldLandmarks: Point[] | null = null;
    if (!Number.isNaN(points[o])) {
      worldLandmarks = [];
      for (let i = 0; i < LANDMARKS_PER_HAND; i++, o += 3) {
        worldLandmarks.push({ x: mirror ? -points[o] : points[o], y: points[o + 1], z: points[o + 2] });
      }
    }
    const label = packed.labels[h];
    // On the raw (unmirrored) camera frame, the Tasks API labels the user's
    // physical hand directly; verified with a real webcam.
    const handedness: Side | null = label < 0 ? null : label === 1 ? 'right' : 'left';
    // With a mirrored preview your left hand appears on the left, next to the left puppet.
    const naturalSide: Side | null = handedness && (mirror ? handedness : handedness === 'left' ? 'right' : 'left');
    hands.push({ landmarks, worldLandmarks, handedness, naturalSide, handednessScore: packed.scores[h] });
  }
  return { hands, aspect, time, received };
}
