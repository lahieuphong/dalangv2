import type { GestureName, HandFeatures } from '../types';

/**
 * High-level gestures on top of the continuous finger channels. They only
 * *add* behaviour (grabbing a prop, a label in the HUD): no gesture ever
 * switches off or overrides a finger's own joint. Each uses hysteresis, so a
 * hand hovering at a threshold does not chatter, and none needs to be held:
 * the state changes on the frame the threshold is crossed.
 */

interface Band {
  enter: number;
  release: number;
}

const PINCH: Band = { enter: 0.62, release: 0.45 };
const FIST: Band = { enter: 0.7, release: 0.5 };
const OPEN: Band = { enter: 0.82, release: 0.7 };

const latch = (active: boolean, value: number, band: Band) => (active ? value > band.release : value >= band.enter);

export class GestureEngine {
  gesture: GestureName = 'none';
  pinched = false;
  fist = false;
  pointing = false;
  open = false;
  /** True only on the update in which the pinch closed / opened. */
  justPinched = false;
  justReleased = false;
  /** When the current pinch began (ms), or 0. */
  pinchedAt = 0;

  reset() {
    const wasPinched = this.pinched;
    this.gesture = 'none';
    this.pinched = false;
    this.fist = false;
    this.pointing = false;
    this.open = false;
    this.justPinched = false;
    // Losing the hand lets go of whatever it held.
    this.justReleased = wasPinched;
    this.pinchedAt = 0;
  }

  /** `pinch` is the effective pinch strength (after the pinch sensitivity gain), 0..1. */
  update(features: HandFeatures, pinch: number, now: number): GestureName {
    const wasPinched = this.pinched;
    this.pinched = latch(wasPinched, pinch, PINCH);
    this.justPinched = this.pinched && !wasPinched;
    this.justReleased = !this.pinched && wasPinched;
    if (this.justPinched) this.pinchedAt = now;
    if (!this.pinched) this.pinchedAt = 0;

    this.fist = latch(this.fist, features.fistStrength, FIST);
    this.open = latch(this.open, Math.min(features.openness, 1 - features.thumb.curl * 0.5), OPEN);

    const others = Math.min(features.middle.curl, features.ring.curl, features.pinky.curl);
    this.pointing = this.pointing ? features.index.curl < 0.45 && others > 0.4 : features.index.curl < 0.3 && others > 0.55;

    this.gesture = this.pinched ? 'pinch' : this.fist ? 'fist' : this.pointing ? 'point' : this.open ? 'open' : 'none';
    return this.gesture;
  }
}
