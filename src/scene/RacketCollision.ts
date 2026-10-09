import { clamp, smoothstep } from '../utils/math';

/**
 * Swept contact between the ball and a paddle.
 *
 * The paddle is a disc, exactly as drawn. Around it lie three regions for the
 * ball's centre, all measured from the paddle's centre:
 *
 *   core         up to `core` = paddle radius + ball radius: the two discs
 *                really touch. Always a hit.
 *   forgiveness  from there out to `forgiveness`: the ball would pass just
 *                clear of the paddle. Counted as a hit, with a lower contact
 *                quality, at the moment the ball is nearest: only a ball that
 *                is about to miss is rescued, and it is never moved.
 *   beyond       a miss, in every mode.
 *
 * Everything is tested along the motion of both ball and paddle over a step,
 * not at its end, so a ball that crosses the paddle between two frames (or a
 * paddle that sweeps through the ball) cannot slip past.
 */

export type ContactKind = 'CORE' | 'ASSIST';

export interface ContactZones {
  /** Paddle radius + ball radius: centre distance at which the discs touch. */
  core: number;
  /** Outer edge of the forgiveness ring (≥ core). */
  forgiveness: number;
  /**
   * Latency lead: the forgiveness ring also covers the stretch the paddle is
   * about to sweep, this far ahead of its centre. It makes up for the few
   * frames the drawn paddle trails the hand; zero for a paddle at rest.
   */
  leadX: number;
  leadY: number;
}

export interface SweptContact {
  kind: ContactKind;
  /** Fraction of the step at which contact happens, 0..1. */
  time: number;
  /** Distance from the paddle's centre to the ball's at contact. */
  distance: number;
  /** Distance from the ball to the nearest point of the paddle's centre-to-lead stretch (equal to `distance` without a lead). */
  gap: number;
  /**
   * How far off-centre the contact is: the distance at which the ball's path
   * would have passed the paddle's centre had nothing stopped it. Zero is a
   * hit square on the middle of the paddle.
   */
  offset: number;
  /** Unit vector from the paddle (or its lead point) to the ball at contact. */
  nx: number;
  ny: number;
  /** 0..1: how far along the latency lead the contact was made (0 = at the paddle itself). */
  lead: number;
}

const EPSILON = 1e-6;

/** Quality of a contact made exactly where the two discs touch: the seam between core and forgiveness. */
const EDGE_QUALITY = 0.62;
const WORST_QUALITY = 0.2;

/**
 * Contact quality, 0..1, continuous everywhere. It is judged by how far
 * off-centre the ball's path meets the paddle: 1 through the middle, easing to
 * 0.62 for a ball that only just clips the rim, and on down to 0.2 at the
 * outer edge of the forgiveness ring. A rescued contact never rates above the
 * rim, and one made on the latency lead is marked down further.
 */
export function contactQuality(contact: SweptContact, zones: ContactZones): number {
  if (contact.kind === 'CORE') {
    const sweet = zones.core * 0.45;
    if (contact.offset <= sweet) return 1;
    return 1 - (1 - EDGE_QUALITY) * smoothstep((contact.offset - sweet) / (zones.core - sweet));
  }
  const ring = Math.max(EPSILON, zones.forgiveness - zones.core);
  const quality = EDGE_QUALITY - (EDGE_QUALITY - WORST_QUALITY) * smoothstep((contact.gap - zones.core) / ring);
  return Math.min(EDGE_QUALITY, quality) * (1 - 0.3 * clamp(contact.lead, 0, 1));
}

/** Closest points of segment P (p → p + d, parameter s) and segment Q (q → q + e, parameter t). */
function closestOnSegments(px: number, py: number, dx: number, dy: number, qx: number, qy: number, ex: number, ey: number, out: { s: number; t: number }) {
  const rx = px - qx;
  const ry = py - qy;
  const a = dx * dx + dy * dy;
  const e = ex * ex + ey * ey;
  const f = ex * rx + ey * ry;
  let s = 0;
  let t = 0;
  if (a <= EPSILON && e <= EPSILON) {
    // Both are points.
  } else if (a <= EPSILON) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = dx * rx + dy * ry;
    if (e <= EPSILON) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dx * ex + dy * ey;
      const denominator = a * e - b * b;
      s = denominator > EPSILON ? clamp((b * f - c * e) / denominator, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  out.s = s;
  out.t = t;
}

const scratch = { s: 0, t: 0 };

/**
 * Tests one step of motion. `(bx0, by0) → (bx1, by1)` is the ball's centre,
 * `(px0, py0) → (px1, py1)` the paddle's; both move in a straight line over
 * the step (the step is a few milliseconds, so an arc is a chord to well
 * under a unit). Works in the paddle's frame, where only the ball moves.
 *
 * @param approached  whether the ball was closing on the paddle in an earlier
 *                    step of this pass. A forgiveness contact is only made at
 *                    a true nearest point: the ball came in, and is about to
 *                    leave. A ball that merely starts out inside the ring,
 *                    already moving away, is not one.
 * @returns the contact, written into `out`, or null. `closing` reports
 *          whether the ball ends this step still approaching.
 */
export function sweepContact(
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
  px0: number,
  py0: number,
  px1: number,
  py1: number,
  zones: ContactZones,
  approached: boolean,
  out: SweptContact & { closing: boolean },
): SweptContact | null {
  // Ball relative to the paddle: from D0, along E.
  const d0x = bx0 - px0;
  const d0y = by0 - py0;
  const ex = bx1 - px1 - d0x;
  const ey = by1 - py1 - d0y;
  const start = Math.hypot(d0x, d0y);
  const end = Math.hypot(d0x + ex, d0y + ey);
  out.closing = end < start - EPSILON;
  out.lead = 0;

  // 1. Core: the first moment the centres are `core` apart.
  const core = zones.core;
  let time = -1;
  if (start <= core) time = 0;
  else {
    const a = ex * ex + ey * ey;
    const b = d0x * ex + d0y * ey;
    const c = start * start - core * core;
    const discriminant = b * b - a * c;
    if (a > EPSILON && b < 0 && discriminant >= 0) {
      const root = (-b - Math.sqrt(discriminant)) / a;
      if (root >= 0 && root <= 1) time = root;
    }
  }
  if (time >= 0) {
    const cx = d0x + ex * time;
    const cy = d0y + ey * time;
    const distance = Math.hypot(cx, cy);
    out.kind = 'CORE';
    out.time = time;
    out.distance = distance;
    out.gap = distance;
    // The perpendicular distance from the paddle's centre to the line the ball is travelling along.
    const travel = Math.hypot(ex, ey);
    out.offset = travel > EPSILON ? Math.min(start, Math.abs(d0x * ey - d0y * ex) / travel) : start;
    if (distance > EPSILON) {
      out.nx = cx / distance;
      out.ny = cy / distance;
    } else {
      // Dead centre: push back along the way the ball came.
      const speed = Math.hypot(ex, ey);
      out.nx = speed > EPSILON ? -ex / speed : 0;
      out.ny = speed > EPSILON ? -ey / speed : -1;
    }
    return out;
  }

  // 2. Forgiveness: the nearest the ball comes to the paddle, or to the stretch just ahead of it.
  if (zones.forgiveness <= core) return null;
  closestOnSegments(d0x, d0y, ex, ey, 0, 0, zones.leadX, zones.leadY, scratch);
  const nearest = scratch.s;
  const ax = zones.leadX * scratch.t;
  const ay = zones.leadY * scratch.t;
  const cx = d0x + ex * nearest - ax;
  const cy = d0y + ey * nearest - ay;
  const gap = Math.hypot(cx, cy);
  if (gap > zones.forgiveness) return null;
  // Still coming closer at the end of the step: wait, it may yet reach the core.
  if (nearest >= 1 - EPSILON) return null;
  if (nearest <= EPSILON && !approached) return null;

  out.kind = 'ASSIST';
  out.time = nearest;
  out.distance = Math.hypot(d0x + ex * nearest, d0y + ey * nearest);
  out.gap = gap;
  out.offset = gap;
  out.lead = scratch.t;
  if (gap > EPSILON) {
    out.nx = cx / gap;
    out.ny = cy / gap;
  } else {
    out.nx = 0;
    out.ny = -1;
  }
  return out;
}

export const emptyContact = (): SweptContact & { closing: boolean } => ({ kind: 'CORE', time: 0, distance: 0, gap: 0, offset: 0, nx: 0, ny: -1, lead: 0, closing: false });
