import { useCallback, useEffect, useRef, useSyncExternalStore, type RefCallback } from 'react';
import { CameraManager, type CameraSnapshot, type CameraStartOptions } from '../tracking/CameraManager';

export interface CameraController extends CameraSnapshot {
  /** Attach to the `<video>` that shows the stream. */
  videoRef: RefCallback<HTMLVideoElement>;
  /** The same element, for the tracker to read frames from. */
  video: () => HTMLVideoElement | null;
  start: (options?: CameraStartOptions) => Promise<void>;
  stop: () => void;
  flip: () => Promise<void>;
}

const SERVER_SNAPSHOT: CameraSnapshot = { status: 'idle', devices: [], deviceId: null, facing: 'user', track: null };

/** Binds a `CameraManager` to React: the snapshot is state, everything else stays imperative. */
export function useCamera(): CameraController {
  const managerRef = useRef<CameraManager | null>(null);
  const elementRef = useRef<HTMLVideoElement | null>(null);
  // StrictMode mounts effects twice; the manager is created lazily and re-created after a disposal.
  const manager = () => (managerRef.current ??= new CameraManager());

  const subscribe = useCallback((listener: () => void) => manager().subscribe(listener), []);
  const snapshot = useSyncExternalStore(subscribe, () => manager().getSnapshot(), () => SERVER_SNAPSHOT);

  useEffect(
    () => () => {
      managerRef.current?.dispose();
      managerRef.current = null;
    },
    [],
  );

  const videoRef = useCallback<RefCallback<HTMLVideoElement>>((element) => {
    elementRef.current = element;
    manager().setVideo(element);
  }, []);

  const video = useCallback(() => elementRef.current, []);
  const start = useCallback((options?: CameraStartOptions) => {
    // After a StrictMode re-creation the new manager has not met the element yet.
    manager().setVideo(elementRef.current);
    return manager().start(options);
  }, []);
  const stop = useCallback(() => manager().stop(), []);
  const flip = useCallback(() => {
    manager().setVideo(elementRef.current);
    return manager().flip();
  }, []);

  return { ...snapshot, videoRef, video, start, stop, flip };
}
