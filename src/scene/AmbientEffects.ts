import { mulberry32 } from '../utils/math';

interface Mote {
  x: number;
  y: number;
  drift: number;
  phase: number;
  size: number;
}

/**
 * Dust drifting in the lamp light. Purely decorative: it is drawn behind
 * nothing that matters, costs a handful of arcs per frame and is switched off
 * entirely in the Performance preset.
 */
export class DustField {
  private motes: Mote[] = [];

  /** Sets how many motes there are; the same seeds are reused so nothing pops when the count changes. */
  resize(count: number) {
    if (this.motes.length === count) return;
    const random = mulberry32(90210);
    this.motes = Array.from({ length: count }, () => ({
      x: random(),
      y: random() * 0.86,
      drift: 0.4 + random() * 1.2,
      phase: random() * Math.PI * 2,
      size: 0.7 + random() * 1.5,
    }));
  }

  /** `k` is canvas pixels per stage unit; `time` is in seconds. */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, k: number, time: number) {
    if (this.motes.length === 0) return;
    for (const mote of this.motes) {
      const x = ((mote.x + time * mote.drift * 0.004) % 1) * width;
      const y = (mote.y + 0.025 * Math.sin(time * 0.21 * mote.drift + mote.phase)) * height;
      const twinkle = 0.5 + 0.5 * Math.sin(time * 0.9 * mote.drift + mote.phase);
      ctx.globalAlpha = 0.08 + 0.2 * twinkle;
      ctx.beginPath();
      ctx.arc(x, y, mote.size * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
