import { useCallback, useRef, useState, type RefCallback } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tracks an element's content-box size in CSS pixels. Returns a ref callback
 * to attach and the latest size; the size only changes identity when a
 * dimension really changes, so layout work is not repeated needlessly.
 */
export function useElementSize<T extends Element>(): [RefCallback<T>, ElementSize] {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback<RefCallback<T>>((element) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element) return;
    const measure = (width: number, height: number) =>
      setSize((current) => (Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5 ? current : { width, height }));
    const rect = element.getBoundingClientRect();
    measure(rect.width, rect.height);
    observer.current = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) measure(box.width, box.height);
    });
    observer.current.observe(element);
  }, []);

  return [ref, size];
}
