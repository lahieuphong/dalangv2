import type { InteractionState } from '../types';

/**
 * What one puppet is doing, as a single word for the HUD and for anything
 * that wants to react to it. The state is derived from real conditions every
 * frame; the machine only adds the hysteresis and short dwell times that keep
 * it from flickering.
 *
 *   IDLE      nobody holds the puppet
 *   TRACKING  a hand holds it, standing on the ground
 *   LIFT      a hand has lifted it off the ground
 *   HUNT      it is swinging at, or closing in on, a fly
 *   RALLY     the ball is in play
 *   INTERACT  its pinch is holding a prop
 *   RECOVER   tracking was lost; the pose is held, then eased back to rest
 */

export interface InteractionInput {
  /** A hand (or the stage agent) is driving the puppet right now. */
  driven: boolean;
  /** The hand dropped out and the puppet has not settled back yet. */
  recovering: boolean;
  /** The pinch is holding a prop. */
  holding: boolean;
  /** Height of the soles above the ground, stage units. */
  lift: number;
  /** The ball is live and this puppet is part of the rally. */
  rally: boolean;
  /** A fly is within reach, or the paddle is being swung, while flies are about. */
  hunting: boolean;
}

const LIFT_ENTER = 26;
const LIFT_EXIT = 12;

/** A candidate state must persist this long (ms) before it replaces the current one. */
const DWELL: Record<InteractionState, number> = {
  IDLE: 0,
  TRACKING: 140,
  LIFT: 80,
  HUNT: 120,
  RALLY: 0,
  INTERACT: 0,
  RECOVER: 0,
};

export interface Transition {
  from: InteractionState;
  to: InteractionState;
  at: number;
}

export class InteractionStateMachine {
  state: InteractionState = 'IDLE';
  /** When the current state was entered (ms). */
  since = 0;
  /** Called on every change of state. */
  onTransition: ((transition: Transition) => void) | null = null;

  private candidate: InteractionState = 'IDLE';
  private candidateSince = 0;

  reset(now: number) {
    this.state = 'IDLE';
    this.since = now;
    this.candidate = 'IDLE';
    this.candidateSince = now;
  }

  update(input: InteractionInput, now: number): InteractionState {
    const next = this.evaluate(input);
    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateSince = now;
    }
    if (next !== this.state && now - this.candidateSince >= DWELL[next]) {
      const from = this.state;
      this.state = next;
      this.since = now;
      this.onTransition?.({ from, to: next, at: now });
    }
    return this.state;
  }

  /** Priority, highest first: loss of tracking, a held prop, a lift, the rally, the hunt, plain tracking. */
  private evaluate(input: InteractionInput): InteractionState {
    if (!input.driven) return input.recovering ? 'RECOVER' : 'IDLE';
    if (input.holding) return 'INTERACT';
    const lifted = input.lift > (this.state === 'LIFT' ? LIFT_EXIT : LIFT_ENTER);
    if (lifted) return 'LIFT';
    if (input.rally) return 'RALLY';
    if (input.hunting) return 'HUNT';
    return 'TRACKING';
  }
}
