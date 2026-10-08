/**
 * Draws a hand as a solid silhouette from its 21 landmarks: a forearm stub,
 * the palm and five thick fingers. Used for the hand's shadow on the stage
 * and for the stand-in hand in simulation mode.
 *
 * `points` holds x,y pairs in canvas pixels. Everything is painted fully
 * opaque in the current fill and stroke colour (overlapping strokes would
 * otherwise show through each other); transparency is applied to the layer.
 */

const PALM = [0, 1, 2, 5, 9, 13, 17] as const;
const FINGERS: readonly (readonly [chain: readonly number[], width: number])[] = [
  [[1, 2, 3, 4], 0.3],
  [[5, 6, 7, 8], 0.25],
  [[9, 10, 11, 12], 0.26],
  [[13, 14, 15, 16], 0.24],
  [[17, 18, 19, 20], 0.2],
];

export function drawHandSilhouette(ctx: CanvasRenderingContext2D, points: Float32Array, palmLength: number, forearm = 0.9) {
  const x = (i: number) => points[i * 2];
  const y = (i: number) => points[i * 2 + 1];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Forearm: continues from the wrist, away from the knuckles.
  if (forearm > 0) {
    let dx = x(0) - x(9);
    let dy = y(0) - y(9);
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    ctx.lineWidth = palmLength * 0.78;
    ctx.beginPath();
    ctx.moveTo(x(0) + dx * palmLength * 0.2, y(0) + dy * palmLength * 0.2);
    ctx.lineTo(x(0) + dx * palmLength * forearm, y(0) + dy * palmLength * forearm);
    ctx.stroke();
  }

  ctx.lineWidth = palmLength * 0.26;
  ctx.beginPath();
  PALM.forEach((id, i) => (i === 0 ? ctx.moveTo(x(id), y(id)) : ctx.lineTo(x(id), y(id))));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  for (const [chain, width] of FINGERS) {
    ctx.lineWidth = palmLength * width;
    ctx.beginPath();
    ctx.moveTo(x(chain[0]), y(chain[0]));
    for (let i = 1; i < chain.length; i++) ctx.lineTo(x(chain[i]), y(chain[i]));
    ctx.stroke();
  }
}
