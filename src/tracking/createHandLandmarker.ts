import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { thresholdOptions, type Delegate, type TrackerSource, type TrackerThresholds } from './trackerProtocol';

export interface CreatedLandmarker {
  landmarker: HandLandmarker;
  delegate: Delegate;
}

interface Options {
  /** Try the GPU delegate first; the CPU delegate is always the fallback. */
  allowGpu: boolean;
  /** Load the ES-module build of the WASM runtime (needed inside a module worker). */
  moduleRuntime: boolean;
  thresholds: TrackerThresholds;
  /** Rendering surface for MediaPipe; required in a worker, where there is no document. */
  canvas?: OffscreenCanvas;
}

/**
 * Builds the hand landmarker from the first source that works, GPU before
 * CPU. Used on the page and in the tracking worker alike.
 */
export async function createHandLandmarker(sources: readonly TrackerSource[], options: Options): Promise<CreatedLandmarker> {
  const delegates: Delegate[] = options.allowGpu ? ['GPU', 'CPU'] : ['CPU'];
  let lastError: unknown = new Error('Hand landmarker could not be created');

  for (const source of sources) {
    for (const delegate of delegates) {
      try {
        const fileset = await FilesetResolver.forVisionTasks(source.wasm, options.moduleRuntime);
        const landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: source.model, delegate },
          canvas: options.canvas,
          runningMode: 'VIDEO',
          numHands: 2,
          ...thresholdOptions(options.thresholds),
        });
        return { landmarker, delegate };
      } catch (error) {
        lastError = error;
        if (import.meta.env.DEV) console.warn(`[hand-tracking] ${delegate} delegate failed`, error);
      }
    }
  }
  throw lastError;
}
