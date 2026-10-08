import type { HandLandmarker } from '@mediapipe/tasks-vision';
import {
  DEFAULT_THRESHOLDS,
  packHands,
  thresholdOptions,
  type Delegate,
  type PackedHands,
  type TrackerRequest,
  type TrackerResponse,
  type TrackerSource,
  type TrackerThresholds,
} from './trackerProtocol';

const MEDIAPIPE_VERSION = '1.0.1';

const resolve = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href;

/** Served from our own origin first (see scripts/setup-mediapipe.mjs); the public CDN is only a fallback. */
const sources = (): TrackerSource[] => [
  { wasm: resolve('mediapipe/wasm'), model: resolve('models/hand_landmarker.task') },
  {
    wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
    model: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
];

/** Receives one result, or null when that frame could not be processed. */
export type DetectCallback = (hands: PackedHands | null, inferenceMs: number) => void;

export type BackendMode = 'main-thread' | 'worker';

/**
 * Runs the hand model on a video's current frame.
 *
 * - `main-thread`: `detect` blocks and calls back before it returns. This is
 *   the shortest path from a camera frame to a pose, and the default.
 * - `worker`: inference happens on another thread; `detect` returns at once
 *   and the callback fires later. Rendering is never blocked, at the price
 *   of a slightly longer and less predictable round trip, so it is used
 *   where the main thread cannot afford the model (see useHandTracking).
 */
export interface InferenceBackend {
  readonly mode: BackendMode;
  readonly delegate: Delegate;
  /** Never call again before the callback of the previous call has fired. */
  detect(video: HTMLVideoElement, timestamp: number, done: DetectCallback): void;
  /** Applies new confidence thresholds to the running model. */
  configure(thresholds: TrackerThresholds): void;
  close(): void;
}

const canSnapshot = typeof VideoFrame === 'function';

const workerSupported = () =>
  typeof Worker === 'function' &&
  typeof OffscreenCanvas === 'function' &&
  (canSnapshot || typeof createImageBitmap === 'function');

class WorkerBackend implements InferenceBackend {
  readonly mode = 'worker';
  readonly delegate: Delegate;
  private readonly worker: Worker;
  private pending: DetectCallback | null = null;
  private closed = false;

  constructor(worker: Worker, delegate: Delegate) {
    this.worker = worker;
    this.delegate = delegate;
    worker.onmessage = (event: MessageEvent<TrackerResponse>) => {
      const message = event.data;
      if (message.type === 'result') this.settle(message.hands, message.inferenceMs);
      else if (message.type === 'error') {
        if (import.meta.env.DEV) console.warn('[hand-tracking] inference failed in the worker:', message.message);
        this.settle(null, 0);
      }
    };
    worker.onerror = () => this.settle(null, 0);
  }

  detect(video: HTMLVideoElement, timestamp: number, done: DetectCallback) {
    this.pending = done;
    if (!canSnapshot) {
      createImageBitmap(video).then(
        (bitmap) => this.send(bitmap, timestamp),
        () => this.settle(null, 0),
      );
      return;
    }
    let frame: VideoFrame;
    try {
      // A handle to the frame the video is showing right now: no pixel copy on this thread.
      frame = new VideoFrame(video, { timestamp: Math.round(timestamp * 1000) });
    } catch {
      this.settle(null, 0);
      return;
    }
    this.send(frame, timestamp);
  }

  configure(thresholds: TrackerThresholds) {
    if (this.closed) return;
    const request: TrackerRequest = { type: 'configure', thresholds };
    this.worker.postMessage(request);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.pending = null;
    this.worker.terminate();
  }

  private send(image: VideoFrame | ImageBitmap, timestamp: number) {
    if (this.closed) {
      image.close();
      return;
    }
    const request: TrackerRequest = { type: 'frame', image, timestamp };
    this.worker.postMessage(request, [image]);
  }

  private settle(hands: PackedHands | null, inferenceMs: number) {
    const done = this.pending;
    this.pending = null;
    done?.(hands, inferenceMs);
  }
}

class MainThreadBackend implements InferenceBackend {
  readonly mode = 'main-thread';
  readonly delegate: Delegate;
  private readonly landmarker: HandLandmarker;
  private closed = false;

  constructor(landmarker: HandLandmarker, delegate: Delegate) {
    this.landmarker = landmarker;
    this.delegate = delegate;
  }

  detect(video: HTMLVideoElement, timestamp: number, done: DetectCallback) {
    const started = performance.now();
    let hands: PackedHands | null = null;
    try {
      hands = packHands(this.landmarker.detectForVideo(video, timestamp));
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[hand-tracking] inference failed:', error);
    }
    done(hands, performance.now() - started);
  }

  configure(thresholds: TrackerThresholds) {
    if (this.closed) return;
    void this.landmarker.setOptions(thresholdOptions(thresholds)).catch(() => undefined);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.landmarker.close();
  }
}

function startWorker(allowGpu: boolean): Promise<WorkerBackend> {
  return new Promise((resolveBackend, reject) => {
    const worker = new Worker(new URL('./tracker.worker.ts', import.meta.url), { type: 'module' });
    const fail = (message: string) => {
      worker.terminate();
      reject(new Error(message));
    };
    worker.onmessage = (event: MessageEvent<TrackerResponse>) => {
      const message = event.data;
      if (message.type === 'ready') resolveBackend(new WorkerBackend(worker, message.delegate));
      else if (message.type === 'failed') fail(message.message);
    };
    worker.onerror = (event) => fail(event.message || 'The tracking worker could not start');
    const request: TrackerRequest = { type: 'init', sources: sources(), allowGpu, thresholds };
    worker.postMessage(request);
  });
}

const CLOSE_DELAY_MS = 4000;

interface Shared {
  promise: Promise<InferenceBackend>;
  refs: number;
  closeTimer: number | undefined;
}

const shared = new Map<BackendMode, Shared>();
const gpuUnavailable: Record<BackendMode, boolean> = { 'main-thread': false, worker: false };
let workerUnavailable = false;
let thresholds: TrackerThresholds = DEFAULT_THRESHOLDS;

/** Sets the confidence thresholds for every model, running or yet to be created. */
export function setTrackerThresholds(next: TrackerThresholds) {
  if (next.detection === thresholds.detection && next.presence === thresholds.presence && next.tracking === thresholds.tracking) return;
  thresholds = { ...next };
  for (const entry of shared.values()) entry.promise.then((backend) => backend.configure(thresholds)).catch(() => undefined);
}

/** Whether tracking can run in a worker here (and has not already failed there). */
export const workerAvailable = () => !workerUnavailable && workerSupported();

/** Pins every backend created from now on to the CPU delegate (`?delegate=cpu`, for comparisons). */
export function forceCpuDelegate() {
  gpuUnavailable['main-thread'] = true;
  gpuUnavailable.worker = true;
}

async function createBackend(mode: BackendMode): Promise<InferenceBackend> {
  let backend: InferenceBackend;
  if (mode === 'worker') {
    backend = await startWorker(!gpuUnavailable.worker);
  } else {
    // Loaded on demand so the theatre paints before any ML code is fetched.
    const { createHandLandmarker } = await import('./createHandLandmarker');
    const created = await createHandLandmarker(sources(), { allowGpu: !gpuUnavailable[mode], moduleRuntime: false, thresholds });
    backend = new MainThreadBackend(created.landmarker, created.delegate);
  }
  // The CPU delegate came from the very same files, so it is the GPU that failed.
  if (backend.delegate === 'CPU') gpuUnavailable[mode] = true;
  if (import.meta.env.DEV) console.info(`[hand-tracking] model ready: ${mode}, ${backend.delegate} delegate`);
  return backend;
}

export interface BackendLease {
  promise: Promise<InferenceBackend>;
  release(): void;
}

/**
 * Shares one inference backend per mode across the app. Leases are
 * ref-counted and a model is closed a few seconds after its last release, so
 * React StrictMode's mount → unmount → mount cycle never builds a second one.
 */
export function acquireInferenceBackend(mode: BackendMode): BackendLease {
  let entry = shared.get(mode);
  if (!entry) {
    const created: Shared = { promise: createBackend(mode), refs: 0, closeTimer: undefined };
    created.promise.catch(() => {
      if (mode === 'worker') workerUnavailable = true;
      if (shared.get(mode) === created) shared.delete(mode);
    });
    shared.set(mode, created);
    entry = created;
  }
  const held = entry;
  held.refs += 1;
  window.clearTimeout(held.closeTimer);

  let released = false;
  return {
    promise: held.promise,
    release() {
      if (released) return;
      released = true;
      held.refs -= 1;
      if (held.refs > 0) return;
      held.closeTimer = window.setTimeout(() => {
        if (held.refs > 0) return;
        if (shared.get(mode) === held) shared.delete(mode);
        held.promise.then((backend) => backend.close()).catch(() => undefined);
      }, CLOSE_DELAY_MS);
    },
  };
}

/**
 * Called when a backend keeps failing at inference time. Steps down one
 * level (GPU → CPU, then worker → main thread) and returns the mode to try
 * next, or null when nothing is left.
 */
export function discardInferenceBackend(failed: InferenceBackend): BackendMode | null {
  const mode = failed.mode;
  let next: BackendMode | null = mode;
  if (failed.delegate === 'GPU') gpuUnavailable[mode] = true;
  else if (mode === 'worker') {
    workerUnavailable = true;
    next = 'main-thread';
  } else next = null;
  const entry = shared.get(mode);
  shared.delete(mode);
  entry?.promise.then((backend) => backend.close()).catch(() => undefined);
  return next;
}
