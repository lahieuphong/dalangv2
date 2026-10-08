/**
 * Sizes a canvas' backing store for a CSS box, capping the pixel ratio so no
 * more pixels are painted than the display (or the quality preset) calls for.
 * Returns the ratio in use (backing-store pixels per CSS pixel).
 */
export function fitCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, maxPixelRatio: number): number {
  const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return ratio;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where media of the given size is drawn inside a box with `object-fit: cover`.
 * Landmarks are normalized to the media, so this is what maps them onto the
 * preview no matter how the box is sized or cropped.
 */
export function coverRect(boxWidth: number, boxHeight: number, mediaWidth: number, mediaHeight: number, out: Rect): Rect {
  if (!mediaWidth || !mediaHeight) {
    out.x = 0;
    out.y = 0;
    out.width = boxWidth;
    out.height = boxHeight;
    return out;
  }
  const scale = Math.max(boxWidth / mediaWidth, boxHeight / mediaHeight);
  out.width = mediaWidth * scale;
  out.height = mediaHeight * scale;
  out.x = (boxWidth - out.width) / 2;
  out.y = (boxHeight - out.height) / 2;
  return out;
}
