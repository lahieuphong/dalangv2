import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { createHandLandmarker } from './createHandLandmarker';
import { packHands, thresholdOptions, type TrackerRequest, type TrackerResponse } from './trackerProtocol';

/**
 * Hand tracking off the main thread. The page sends one camera frame at a
 * time and never a second one before the answer to the first, so nothing can
 * queue up here: every frame this worker sees is the newest one there was.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<TrackerRequest>) => void) | null;
  postMessage(message: TrackerResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

let landmarker: HandLandmarker | null = null;
let lastTimestamp = 0;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function init(request: Extract<TrackerRequest, { type: 'init' }>) {
  try {
    landmarker?.close();
    landmarker = null;
    const created = await createHandLandmarker(request.sources, {
      allowGpu: request.allowGpu,
      moduleRuntime: true,
      thresholds: request.thresholds,
      canvas: new OffscreenCanvas(1, 1),
    });
    landmarker = created.landmarker;
    scope.postMessage({ type: 'ready', delegate: created.delegate });
  } catch (error) {
    scope.postMessage({ type: 'failed', message: describe(error) });
  }
}

function detect(request: Extract<TrackerRequest, { type: 'frame' }>) {
  const { image } = request;
  const started = performance.now();
  try {
    if (!landmarker) throw new Error('Hand landmarker is not ready');
    // MediaPipe requires strictly increasing timestamps.
    const timestamp = Math.max(request.timestamp, lastTimestamp + 1);
    lastTimestamp = timestamp;
    const hands = packHands(landmarker.detectForVideo(image, timestamp));
    scope.postMessage({ type: 'result', hands, inferenceMs: performance.now() - started }, [hands.points.buffer]);
  } catch (error) {
    scope.postMessage({ type: 'error', message: describe(error) });
  } finally {
    image.close();
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'init') void init(request);
  else if (request.type === 'configure') void landmarker?.setOptions(thresholdOptions(request.thresholds)).catch(() => undefined);
  else detect(request);
};
