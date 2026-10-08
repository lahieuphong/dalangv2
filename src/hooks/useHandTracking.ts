import { useEffect, useRef, useState, type RefObject } from 'react';
import { HandTracker } from '../tracking/HandTracker';
import {
  acquireInferenceBackend,
  discardInferenceBackend,
  forceCpuDelegate,
  workerAvailable,
  type BackendLease,
  type BackendMode,
  type InferenceBackend,
} from '../tracking/InferenceBackend';
import type { TrackingStatus } from '../types';

export interface HandTracking {
  status: TrackingStatus;
  /** The live tracker. Read it from the animation loop; it is null until the model is ready. */
  trackerRef: RefObject<HandTracker | null>;
}

/** Overrides for comparisons (`?tracker=`, `?delegate=`); null leaves the choice to the app. */
export interface TrackingPreference {
  tracker: 'main' | 'worker' | null;
  delegate: 'cpu' | 'gpu' | null;
}

/**
 * Where the model runs. The main thread is the shortest path from a camera
 * frame to a pose, so tracking starts there. That only pays off while the
 * model is cheap, though: once a single inference keeps costing about two
 * display frames, every result makes the stage stutter. Then the model is also
 * started in a worker and auditioned on the live frames, next to normal
 * tracking. Tracking moves to the worker, which keeps rendering smooth,
 * unless the worker's round trip turns out far longer than what the main
 * thread needs at that same moment (a worker is easily starved on a busy
 * machine, and then the main thread is the lesser evil).
 */
const SLOW_MAIN_MS = 32;
const SLOW_FOR_MS = 6000;
const AUDITION_MS = 3000;
const WORKER_ROUND_TRIP_LIMIT = 2;

/** Where tracking settled this session, so switching the camera off and on does not repeat the trial. */
let settledMode: BackendMode | null = null;

const note = (message: string) => {
  if (import.meta.env.DEV) console.info(`[hand-tracking] ${message}`);
};

/**
 * Loads the hand model while `enabled` and exposes a tracker that the render
 * loop attaches to the video and reads from. Per-frame hand data never
 * touches React state; only the coarse loading status does.
 */
export function useHandTracking(enabled: boolean, preference?: TrackingPreference): HandTracking {
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [generation, setGeneration] = useState(0);
  const trackerRef = useRef<HandTracker | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const leases = new Map<BackendMode, BackendLease>();
    const acquire = (mode: BackendMode) => {
      const lease = acquireInferenceBackend(mode);
      leases.set(mode, lease);
      return lease.promise;
    };
    const release = (mode: BackendMode) => {
      leases.get(mode)?.release();
      leases.delete(mode);
    };

    if (preference?.delegate === 'cpu') forceCpuDelegate();
    const pinned: BackendMode | null =
      preference?.tracker === 'main' ? 'main-thread' : preference?.tracker === 'worker' ? 'worker' : null;
    let mode: BackendMode = pinned ?? settledMode ?? 'main-thread';
    if (mode === 'worker' && !workerAvailable()) mode = 'main-thread';
    const adaptive = pinned === null && settledMode === null && mode === 'main-thread' && workerAvailable();

    setStatus((current) => (current === 'ready' ? current : 'loading'));

    acquire(mode).then(
      (primary) => {
        if (cancelled) return;
        let active: InferenceBackend = primary;
        const tracker = new HandTracker(primary, (error) => {
          if (import.meta.env.DEV) console.warn('[hand-tracking] inference keeps failing, stepping down', error);
          tracker.dispose();
          trackerRef.current = null;
          const next = discardInferenceBackend(active);
          if (next && next !== active.mode) settledMode = next;
          if (next) setGeneration((value) => value + 1);
          else setStatus('error');
        });

        if (adaptive) {
          let watching = true;
          let slowSince = 0;
          tracker.onReview = (current, now) => {
            if (!watching) return;
            if (current.stats.inferenceMs <= SLOW_MAIN_MS) {
              slowSince = 0;
              return;
            }
            if (!slowSince) slowSince = now;
            if (now - slowSince < SLOW_FOR_MS) return;
            watching = false;
            note(`the model costs ${current.stats.inferenceMs.toFixed(0)} ms per frame on the main thread; auditioning a worker`);
            acquire('worker').then(
              (worker) => {
                if (cancelled) return;
                current.audition(worker, AUDITION_MS, (roundTrip) => {
                  if (cancelled) return;
                  const mainCost = current.stats.inferenceMs;
                  if (roundTrip <= mainCost * WORKER_ROUND_TRIP_LIMIT) {
                    note(`worker round trip ${roundTrip.toFixed(0)} ms against ${mainCost.toFixed(0)} ms: moving to the worker`);
                    current.switchTo(worker);
                    active = worker;
                    settledMode = 'worker';
                    release('main-thread');
                  } else {
                    note(`worker round trip ${roundTrip.toFixed(0)} ms against ${mainCost.toFixed(0)} ms: staying on the main thread`);
                    settledMode = 'main-thread';
                    release('worker');
                  }
                });
              },
              () => {
                settledMode = 'main-thread';
              },
            );
          };
        }

        trackerRef.current = tracker;
        setStatus('ready');
      },
      (error: unknown) => {
        if (cancelled) return;
        if (import.meta.env.DEV) console.error('[hand-tracking] could not load the hand landmarker', error);
        setStatus('error');
      },
    );

    return () => {
      cancelled = true;
      trackerRef.current?.dispose();
      trackerRef.current = null;
      for (const lease of leases.values()) lease.release();
      setStatus('idle');
    };
  }, [enabled, preference, generation]);

  return { status, trackerRef };
}
