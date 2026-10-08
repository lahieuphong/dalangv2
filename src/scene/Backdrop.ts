import { lerp, mulberry32 } from '../utils/math';
import type { StageLayout } from './StageProps';

/**
 * Paints the stage's backdrop once per size: aged parchment lit from the
 * centre, a full moon, ink-wash mountains, the low table and the vignette.
 * Everything is procedural (no image assets) and seeded, so it looks the same
 * on every paint; because it is a separate, static layer it costs nothing
 * while the puppets move.
 */

const INK = '78, 46, 20';

interface Painter {
  ctx: CanvasRenderingContext2D;
  /** Canvas pixels per stage unit. */
  k: number;
  width: number;
  height: number;
  random: () => number;
}

function parchment({ ctx, width, height }: Painter) {
  const cx = width / 2;
  const cy = height * 0.47;
  const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(width, height) * 0.6);
  base.addColorStop(0, '#fff8d8');
  base.addColorStop(0.1, '#fdecb2');
  base.addColorStop(0.26, '#f5d48e');
  base.addColorStop(0.46, '#e7b66a');
  base.addColorStop(0.68, '#d09650');
  base.addColorStop(0.86, '#ab7139');
  base.addColorStop(1, '#7f4f25');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
}

/** Soft blotches, darker toward the edges: the mottling of old paper. */
function stains(p: Painter, detail: number) {
  const { ctx, width, height, random } = p;
  const count = Math.round(40 + 170 * detail);
  for (let i = 0; i < count; i++) {
    const x = random() * width;
    const y = random() * height;
    const edge = Math.min(1, Math.hypot((x - width / 2) / (width / 2), (y - height / 2) / (height / 2)));
    const radius = lerp(0.03, 0.2, random()) * height;
    const light = random() < 0.32 - edge * 0.2;
    const alpha = light ? lerp(0.03, 0.1, random()) : lerp(0.025, 0.065, random()) + edge * 0.06;
    const blot = ctx.createRadialGradient(x, y, 0, x, y, radius);
    blot.addColorStop(0, light ? `rgba(255, 240, 190, ${alpha})` : `rgba(${INK}, ${alpha})`);
    blot.addColorStop(1, light ? 'rgba(255, 240, 190, 0)' : `rgba(${INK}, 0)`);
    ctx.fillStyle = blot;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

/** Fine scratches and fibres. */
function fibres(p: Painter, detail: number) {
  const { ctx, width, height, random, k } = p;
  ctx.lineCap = 'round';
  const count = Math.round(260 * detail);
  for (let i = 0; i < count; i++) {
    const x = random() * width;
    const y = random() * height;
    const length = lerp(6, 46, random()) * k;
    const angle = random() * Math.PI;
    ctx.strokeStyle = random() < 0.5 ? `rgba(${INK}, ${lerp(0.03, 0.09, random())})` : `rgba(255, 244, 205, ${lerp(0.03, 0.08, random())})`;
    ctx.lineWidth = lerp(0.4, 1.1, random()) * k;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(angle) * length * 0.5 + (random() - 0.5) * 6 * k,
      y + Math.sin(angle) * length * 0.5 + (random() - 0.5) * 6 * k,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
    );
    ctx.stroke();
  }
}

/** One ink-wash ridge: a jagged silhouette that fades downward into mist. */
function ridge(p: Painter, x0: number, x1: number, base: number, peaks: readonly (readonly [at: number, height: number])[], alpha: number) {
  const { ctx, k, random } = p;
  const top = Math.max(...peaks.map(([, h]) => h));
  ctx.beginPath();
  ctx.moveTo(x0 * k, base * k);
  let px = x0;
  let py = base;
  const knots: [number, number][] = [[x0, base], ...peaks.map(([at, h]) => [lerp(x0, x1, at), base - h] as [number, number]), [x1, base]];
  for (let i = 1; i < knots.length; i++) {
    const [nx, ny] = knots[i];
    // Break each slope into a few uneven steps, like a dry brush.
    const steps = 5;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const jx = lerp(px, nx, t) + (s < steps ? (random() - 0.5) * 7 : 0);
      const jy = lerp(py, ny, t) + (s < steps ? (random() - 0.5) * 9 : 0);
      ctx.lineTo(jx * k, jy * k);
    }
    px = nx;
    py = ny;
  }
  ctx.closePath();
  const wash = ctx.createLinearGradient(0, (base - top) * k, 0, base * k);
  wash.addColorStop(0, `rgba(${INK}, ${alpha})`);
  wash.addColorStop(0.55, `rgba(${INK}, ${alpha * 0.45})`);
  wash.addColorStop(1, `rgba(${INK}, 0)`);
  ctx.fillStyle = wash;
  ctx.fill();
}

function mountains(p: Painter, layout: StageLayout) {
  const w = layout.width;
  const horizon = layout.groundY - 92;
  // Left range: the tall one behind the hero.
  ridge(p, -30, w * 0.4, horizon + 26, [[0.12, 150], [0.26, 262], [0.37, 208], [0.5, 246], [0.63, 160], [0.8, 118], [0.92, 54]], 0.36);
  ridge(p, -20, w * 0.3, horizon + 40, [[0.2, 120], [0.42, 196], [0.6, 132], [0.82, 70]], 0.3);
  // Right range: lower and further away.
  ridge(p, w * 0.62, w + 30, horizon + 18, [[0.14, 40], [0.32, 104], [0.48, 150], [0.62, 116], [0.78, 172], [0.9, 120]], 0.27);
  ridge(p, w * 0.74, w + 20, horizon + 34, [[0.2, 60], [0.5, 112], [0.76, 82]], 0.24);
}

/** A tiered meru tower and a few birds: small silhouettes that give the distance a scale. */
function silhouettes(p: Painter, layout: StageLayout) {
  const { ctx, k } = p;
  const x = layout.width * 0.86;
  const y = layout.groundY - 196;
  ctx.fillStyle = `rgba(${INK}, 0.34)`;
  for (let tier = 0; tier < 5; tier++) {
    const half = (15 - tier * 2.4) * k;
    const top = (y - tier * 9) * k;
    ctx.beginPath();
    ctx.moveTo(x * k - half, top + 5 * k);
    ctx.quadraticCurveTo(x * k, top + 1.5 * k, x * k + half, top + 5 * k);
    ctx.lineTo(x * k + half * 0.55, top - 1 * k);
    ctx.lineTo(x * k - half * 0.55, top - 1 * k);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillRect((x - 2.4) * k, (y - 2) * k, 4.8 * k, 34 * k);

  ctx.strokeStyle = `rgba(${INK}, 0.4)`;
  ctx.lineWidth = 1.1 * k;
  ctx.lineCap = 'round';
  const birds: readonly (readonly [number, number, number])[] = [
    [0.69, 96, 7],
    [0.725, 112, 5],
    [0.66, 122, 4.5],
    [0.27, 78, 5.5],
  ];
  for (const [at, by, span] of birds) {
    const bx = layout.width * at;
    ctx.beginPath();
    ctx.moveTo((bx - span) * k, (by - span * 0.35) * k);
    ctx.quadraticCurveTo((bx - span * 0.4) * k, (by - span * 0.75) * k, bx * k, by * k);
    ctx.quadraticCurveTo((bx + span * 0.4) * k, (by - span * 0.75) * k, (bx + span) * k, (by - span * 0.35) * k);
    ctx.stroke();
  }
}

function moon(p: Painter, layout: StageLayout) {
  const { ctx, k, random } = p;
  const x = layout.moon.x * k;
  const y = layout.moon.y * k;
  const r = layout.moon.r * k;

  const halo = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 2.7);
  halo.addColorStop(0, 'rgba(255, 246, 196, 0.6)');
  halo.addColorStop(0.4, 'rgba(255, 240, 180, 0.22)');
  halo.addColorStop(1, 'rgba(255, 240, 180, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(x - r * 2.8, y - r * 2.8, r * 5.6, r * 5.6);

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const disc = ctx.createRadialGradient(x - r * 0.28, y - r * 0.2, r * 0.05, x, y, r);
  disc.addColorStop(0, '#fffbe0');
  disc.addColorStop(0.5, '#fbe89c');
  disc.addColorStop(0.86, '#f1cd6c');
  disc.addColorStop(1, '#dfb152');
  ctx.fillStyle = disc;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  // Maria: soft, darker seas.
  for (let i = 0; i < 16; i++) {
    const a = random() * Math.PI * 2;
    const d = Math.sqrt(random()) * r * 0.82;
    const mx = x + Math.cos(a) * d;
    const my = y + Math.sin(a) * d;
    const mr = lerp(0.1, 0.32, random()) * r;
    const sea = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
    sea.addColorStop(0, `rgba(196, 146, 58, ${lerp(0.1, 0.24, random())})`);
    sea.addColorStop(1, 'rgba(196, 146, 58, 0)');
    ctx.fillStyle = sea;
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(190, 138, 54, 0.4)';
  ctx.lineWidth = 1.2 * k;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  // A thin wisp of cloud drawn across the moon's lower edge.
  ctx.strokeStyle = `rgba(${INK}, 0.5)`;
  ctx.lineWidth = 1.6 * k;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.26, y + r * 0.86);
  ctx.quadraticCurveTo(x, y + r * 0.96, x + r * 0.3, y + r * 0.84);
  ctx.stroke();
}

/** The lamp behind the screen: a pool of near-white light in the middle of the stage. */
function lampGlow({ ctx, width, height }: Painter) {
  const x = width / 2;
  const y = height * 0.52;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, height * 0.5);
  glow.addColorStop(0, 'rgba(255, 253, 240, 0.9)');
  glow.addColorStop(0.3, 'rgba(255, 250, 226, 0.5)');
  glow.addColorStop(0.7, 'rgba(255, 244, 204, 0.12)');
  glow.addColorStop(1, 'rgba(255, 244, 204, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

/** The low table with its little net. It is a collider in the scene and static artwork here. */
function table(p: Painter, layout: StageLayout) {
  const { ctx, k } = p;
  const { left, right, top, thickness, netTop } = layout.table;
  const ground = layout.groundY;
  const width = right - left;
  const wood = '#2f1f11';
  const edge = '#6e4c2a';

  const shade = ctx.createRadialGradient(layout.centerX * k, (ground + 4) * k, 0, layout.centerX * k, (ground + 4) * k, width * 0.72 * k);
  shade.addColorStop(0, `rgba(${INK}, 0.26)`);
  shade.addColorStop(1, `rgba(${INK}, 0)`);
  ctx.save();
  ctx.translate(0, (ground + 4) * k);
  ctx.scale(1, 0.16);
  ctx.translate(0, -(ground + 4) * k);
  ctx.fillStyle = shade;
  ctx.fillRect((left - width * 0.4) * k, (ground - width) * k, width * 1.8 * k, width * 2 * k);
  ctx.restore();

  ctx.globalAlpha = 0.94;
  const leg = 6.5;
  const inset = 11;
  // Far pair of legs, lighter, a touch inside the near pair.
  ctx.fillStyle = '#5a4026';
  for (const x of [left + inset + 13, right - inset - 13 - leg * 0.8]) ctx.fillRect(x * k, (top + thickness) * k, leg * 0.8 * k, (ground - top - thickness - 5) * k);
  ctx.fillStyle = wood;
  for (const x of [left + inset, right - inset - leg]) ctx.fillRect(x * k, (top + thickness) * k, leg * k, (ground - top - thickness) * k);
  // Stretcher.
  ctx.fillRect((left + inset) * k, (top + (ground - top) * 0.74) * k, (width - inset * 2) * k, 4.2 * k);
  // Apron with a shallow carved arch.
  ctx.beginPath();
  ctx.moveTo((left + inset) * k, (top + thickness) * k);
  ctx.lineTo((right - inset) * k, (top + thickness) * k);
  ctx.lineTo((right - inset) * k, (top + thickness + 9) * k);
  ctx.quadraticCurveTo(layout.centerX * k, (top + thickness + 2) * k, (left + inset) * k, (top + thickness + 9) * k);
  ctx.closePath();
  ctx.fill();
  // The top slab, with upturned ends.
  ctx.beginPath();
  ctx.moveTo((left - 8) * k, (top - 2) * k);
  ctx.lineTo((left - 2) * k, top * k);
  ctx.lineTo((right + 2) * k, top * k);
  ctx.lineTo((right + 8) * k, (top - 2) * k);
  ctx.lineTo((right + 6) * k, (top + thickness) * k);
  ctx.lineTo((left - 6) * k, (top + thickness) * k);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1 * k;
  ctx.beginPath();
  ctx.moveTo((left - 2) * k, (top + 0.8) * k);
  ctx.lineTo((right + 2) * k, (top + 0.8) * k);
  ctx.stroke();

  // The net: a post with fine cross-ties.
  ctx.strokeStyle = '#2a1b0e';
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.moveTo(layout.centerX * k, top * k);
  ctx.lineTo(layout.centerX * k, (netTop - 3) * k);
  ctx.stroke();
  ctx.lineWidth = 0.9 * k;
  ctx.beginPath();
  for (let y = top - 3; y > netTop; y -= 3.6) {
    ctx.moveTo((layout.centerX - 3.4) * k, y * k);
    ctx.lineTo((layout.centerX + 3.4) * k, y * k);
  }
  ctx.stroke();
}

function vignette(p: Painter, layout: StageLayout) {
  const { ctx, width, height, k } = p;
  // The ground: a faint darker band the puppets stand on.
  const ground = ctx.createLinearGradient(0, (layout.groundY - 26) * k, 0, height);
  ground.addColorStop(0, `rgba(${INK}, 0)`);
  ground.addColorStop(0.45, `rgba(${INK}, 0.12)`);
  ground.addColorStop(1, 'rgba(46, 24, 8, 0.36)');
  ctx.fillStyle = ground;
  ctx.fillRect(0, (layout.groundY - 26) * k, width, height);

  const shade = ctx.createRadialGradient(width / 2, height * 0.5, Math.min(width, height) * 0.42, width / 2, height * 0.5, Math.hypot(width, height) * 0.58);
  shade.addColorStop(0, 'rgba(38, 18, 6, 0)');
  shade.addColorStop(0.7, 'rgba(38, 18, 6, 0.17)');
  shade.addColorStop(1, 'rgba(26, 12, 4, 0.5)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  // Scorched edges.
  for (const [x0, y0, x1, y1] of [
    [0, 0, 0, height * 0.07],
    [0, height, 0, height * 0.95],
    [0, 0, width * 0.035, 0],
    [width, 0, width * 0.965, 0],
  ]) {
    const burn = ctx.createLinearGradient(x0, y0, x1, y1);
    burn.addColorStop(0, 'rgba(24, 11, 4, 0.42)');
    burn.addColorStop(1, 'rgba(24, 11, 4, 0)');
    ctx.fillStyle = burn;
    ctx.fillRect(0, 0, width, height);
  }
}

/** Fine grain over everything, blended so mid-grey leaves the paper untouched. */
function grain(p: Painter, detail: number) {
  const { ctx, width, height, random } = p;
  const size = 160;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tileCtx = tile.getContext('2d');
  if (!tileCtx) return;
  const image = tileCtx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 128 + (random() - 0.5) * 150;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  tileCtx.putImageData(image, 0, 0);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.16 * detail;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** Paints the whole backdrop into `canvas` at its current backing-store size. `detail` is 0..1. */
export function paintBackdrop(canvas: HTMLCanvasElement, layout: StageLayout, detail: number) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  const painter: Painter = { ctx, k: canvas.height / layout.height, width: canvas.width, height: canvas.height, random: mulberry32(18510) };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  parchment(painter);
  stains(painter, detail);
  fibres(painter, detail);
  mountains(painter, layout);
  silhouettes(painter, layout);
  lampGlow(painter);
  moon(painter, layout);
  table(painter, layout);
  vignette(painter, layout);
  grain(painter, detail);
}
