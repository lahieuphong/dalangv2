import { SIDES, type AssignedHands, type HandDetection, type Point, type Side } from '../types';
import { clamp, distance2D } from '../utils/math';
import { LANDMARK, palmCenter } from './FingerGeometry';

/** A slot that saw its hand this recently is still considered "owned" by that hand. */
const RECENT_MS = 450;
/** Cost per unit of palm travel (normalized frame units) for continuing an existing track. */
const CONTINUITY_WEIGHT = 3.2;
/** Flat cost for starting a fresh track on an empty slot. */
const NEW_TRACK_COST = 0.55;
/**
 * Screen side is the main signal for a new hand: like a mirror, a hand on the
 * right of the preview takes the puppet on the right of the stage.
 */
const SCREEN_SIDE_WEIGHT = 1.2;
/** Handedness only breaks ties for hands near the middle of the frame. */
const HANDEDNESS_WEIGHT = 0.25;
/** Two detections whose palms are closer than this share of a hand length are one hand seen twice. */
const DUPLICATE_RATIO = 0.35;

interface SlotState {
  palm: Point | null;
  /** Palm travel per millisecond over the last two sightings, for motion-continuity prediction. */
  velocity: Point;
  lastSeen: number;
}

interface Candidate {
  hand: HandDetection;
  palm: Point;
  /** 0..1 confidence of the handedness label. */
  certainty: number;
}

export interface SlotDebug {
  palm: Point | null;
  ageMs: number;
}

const emptySlot = (): SlotState => ({ palm: null, velocity: { x: 0, y: 0 }, lastSeen: -Infinity });

const handSpan = (hand: HandDetection) => distance2D(hand.landmarks[LANDMARK.WRIST], hand.landmarks[LANDMARK.MIDDLE_MCP]);

/** MediaPipe now and then reports one physical hand twice; keep the more confident of the two. */
function dropDuplicates(hands: HandDetection[]): HandDetection[] {
  if (hands.length < 2) return hands;
  const kept: HandDetection[] = [];
  for (const hand of hands) {
    const palm = palmCenter(hand.landmarks);
    const twin = kept.findIndex(
      (other) => distance2D(palm, palmCenter(other.landmarks)) < DUPLICATE_RATIO * Math.min(handSpan(hand), handSpan(other)),
    );
    if (twin < 0) kept.push(hand);
    else if (hand.handednessScore > kept[twin].handednessScore) kept[twin] = hand;
  }
  return kept;
}

/**
 * Keeps each physical hand bound to the same puppet across frames.
 *
 * A newly raised hand goes to the puppet on its side of the (mirrored)
 * preview, so raising your right hand moves the puppet on the right of the
 * screen; MediaPipe handedness is one feature among several and only settles
 * hands right in the middle. Once a hand is tracked, continuity (distance from
 * where that puppet's hand was heading) dominates, so crossing hands or a
 * mislabelled frame never swaps puppets, and a hand that drops out for a
 * moment comes back to the puppet it left.
 */
export class HandAssigner {
  /** Hands the left puppet to the hand on the right of the view and vice versa. */
  swapped = false;

  private slots: Record<Side, SlotState> = { left: emptySlot(), right: emptySlot() };

  reset() {
    this.slots = { left: emptySlot(), right: emptySlot() };
  }

  assign(hands: HandDetection[], now: number): AssignedHands {
    const candidates: Candidate[] = dropDuplicates(hands)
      .slice(0, 2)
      .map((hand) => ({
        hand,
        palm: palmCenter(hand.landmarks),
        certainty: clamp((hand.handednessScore - 0.5) * 2, 0, 1),
      }));

    const chosen: Record<Side, Candidate | null> = { left: null, right: null };
    if (candidates.length === 2) {
      const [a, b] = candidates;
      const straight = this.cost(a, 'left', now) + this.cost(b, 'right', now);
      const crossed = this.cost(a, 'right', now) + this.cost(b, 'left', now);
      chosen.left = straight <= crossed ? a : b;
      chosen.right = straight <= crossed ? b : a;
    } else if (candidates.length === 1) {
      const [a] = candidates;
      chosen[this.cost(a, 'left', now) <= this.cost(a, 'right', now) ? 'left' : 'right'] = a;
    }

    for (const side of SIDES) {
      const candidate = chosen[side];
      if (!candidate) continue;
      const slot = this.slots[side];
      const elapsed = now - slot.lastSeen;
      if (slot.palm && elapsed > 0 && elapsed < RECENT_MS) {
        slot.velocity.x = (candidate.palm.x - slot.palm.x) / elapsed;
        slot.velocity.y = (candidate.palm.y - slot.palm.y) / elapsed;
      } else {
        slot.velocity.x = 0;
        slot.velocity.y = 0;
      }
      slot.palm = candidate.palm;
      slot.lastSeen = now;
    }

    const left = chosen.left?.hand ?? null;
    const right = chosen.right?.hand ?? null;
    return this.swapped ? { left: right, right: left } : { left, right };
  }

  debugState(now: number): Record<Side, SlotDebug> {
    const describe = (slot: SlotState): SlotDebug => ({ palm: slot.palm, ageMs: now - slot.lastSeen });
    return { left: describe(this.slots.left), right: describe(this.slots.right) };
  }

  private cost(candidate: Candidate, side: Side, now: number): number {
    const slot = this.slots[side];
    const elapsed = now - slot.lastSeen;
    const recent = slot.palm !== null && elapsed < RECENT_MS;
    let cost = NEW_TRACK_COST;
    if (recent && slot.palm) {
      // Where this slot's hand should be by now if it kept moving the way it was (capped, so a glitch cannot fling it).
      const lead = Math.min(elapsed, 80);
      const expected = { x: slot.palm.x + slot.velocity.x * lead, y: slot.palm.y + slot.velocity.y * lead };
      cost = distance2D(candidate.palm, expected) * CONTINUITY_WEIGHT;
    }

    // 0 at the puppet's own edge of the preview, 1 at the opposite edge.
    const distanceFromOwnEdge = side === 'left' ? candidate.palm.x : 1 - candidate.palm.x;
    cost += distanceFromOwnEdge * (recent ? 0.05 : SCREEN_SIDE_WEIGHT);

    if (candidate.hand.naturalSide !== null && candidate.hand.naturalSide !== side) {
      cost += (recent ? 0.1 : HANDEDNESS_WEIGHT) * candidate.certainty;
    }
    return cost;
  }
}
