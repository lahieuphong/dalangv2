import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Runs `callback(now, dt)` on every animation frame for the lifetime of the
 * component. A single loop: the latest callback is read through a ref, so the
 * loop is never restarted on re-render. `dt` is in seconds and capped so a
 * backgrounded tab doesn't produce a huge step.
 */
export function useAnimationFrame(callback: (now: number, dt: number) => void) {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      callbackRef.current(now, dt);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
}

/** Mirrors a value into a ref so long-lived loops always see the latest render's value. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
