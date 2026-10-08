import { useEffect, useRef } from 'react';
import type { Engine } from '../../app/Engine';
import type { FingerTelemetry, Telemetry } from '../../app/telemetry';
import { CHANNEL_LABEL } from '../../motion/PuppetMapping';
import { FINGER_NAMES, SIDES, type FingerName, type Side } from '../../types';
import { useTextWriter } from '../StatusHUD/StatusHUD';

interface FingerMonitorProps {
  engine: Engine;
  /** Expanded shows both hands; otherwise only the hand that is performing. */
  expanded: boolean;
  onToggle: () => void;
}

const LABEL: Record<FingerName, string> = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Pinky' };

/** A finger reads as straight below this curl, and as fully curled above the second value. */
const EXTENDED = 0.15;
const CURLED = 0.62;

interface RowRefs {
  row: HTMLDivElement | null;
  bar: HTMLElement | null;
  value: HTMLSpanElement | null;
  state: HTMLSpanElement | null;
  joint: HTMLSpanElement | null;
}

const emptyRow = (): RowRefs => ({ row: null, bar: null, value: null, state: null, joint: null });

function describe(finger: FingerTelemetry, tracked: boolean): { value: string; state: string; tone: string } {
  // "No hand" and "a straight finger" are different facts and must not look alike.
  if (!tracked) return { value: '—', state: 'NO HAND', tone: 'off' };
  const percent = `${Math.round(finger.filtered * 100)}%`;
  if (!finger.inFrame) return { value: percent, state: 'OUT', tone: 'held' };
  if (finger.filtered < EXTENDED) return { value: percent, state: 'EXT', tone: 'ext' };
  return { value: percent, state: finger.filtered < CURLED ? 'BENT' : 'CURL', tone: 'curl' };
}

/**
 * Finger Control Monitor: for each hand, every finger's curl (0–100 %), its
 * state, and the puppet joint it drives. The bars follow the tracker frame by
 * frame; the text is refreshed at reading speed.
 */
export function FingerMonitor({ engine, expanded, onToggle }: FingerMonitorProps) {
  const rows = useRef<Record<Side, Record<FingerName, RowRefs>>>({
    left: { thumb: emptyRow(), index: emptyRow(), middle: emptyRow(), ring: emptyRow(), pinky: emptyRow() },
    right: { thumb: emptyRow(), index: emptyRow(), middle: emptyRow(), ring: emptyRow(), pinky: emptyRow() },
  });
  const hands = useRef<Partial<Record<Side, HTMLDivElement | null>>>({});
  const titles = useRef<Partial<Record<Side, HTMLSpanElement | null>>>({});
  const write = useTextWriter();

  useEffect(() => {
    // Bars: every tracking result, compositor-only (a transform, no layout).
    const fast = (t: Telemetry) => {
      for (const side of SIDES) {
        const hand = t.hands[side];
        for (const finger of FINGER_NAMES) {
          const bar = rows.current[side][finger].bar;
          if (bar) bar.style.transform = `scaleX(${(hand.tracked ? hand.fingers[finger].filtered : 0).toFixed(3)})`;
        }
      }
    };
    // Text, states and layout: about five times a second.
    const slow = (t: Telemetry) => {
      for (const side of SIDES) {
        const hand = t.hands[side];
        const container = hands.current[side];
        // Collapsed: only the performing hand (or the left one while nobody plays).
        const shown = expanded || side === (t.primary ?? 'left');
        if (container) container.hidden = !shown;
        if (!shown) continue;
        write(titles.current[side] ?? null, hand.tracked ? (hand.visible ? 'TRACKED' : 'HOLD') : hand.agent ? 'AGENT' : 'NO HAND');
        for (const finger of FINGER_NAMES) {
          const refs = rows.current[side][finger];
          const f = hand.fingers[finger];
          const text = describe(f, hand.tracked);
          write(refs.value, text.value);
          write(refs.state, text.state);
          write(refs.joint, f.channel ? CHANNEL_LABEL[f.channel] : '—');
          if (refs.row) {
            refs.row.dataset.tone = text.tone;
            refs.row.dataset.active = hand.tracked && f.activity > 0.3 ? '1' : '0';
          }
        }
      }
      fast(t);
    };
    slow(engine.telemetry);
    const offFast = engine.subscribe('fast', fast);
    const offSlow = engine.subscribe('hud', slow);
    return () => {
      offFast();
      offSlow();
    };
  }, [engine, expanded, write]);

  return (
    <section className={`fingers${expanded ? ' is-expanded' : ''}`} aria-label="Finger control monitor">
      <button type="button" className="fingers__head" onClick={onToggle} aria-expanded={expanded} title={expanded ? 'Show one hand' : 'Show both hands'}>
        <span>FINGER CONTROL</span>
        <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      <div className="fingers__hands">
        {SIDES.map((side) => (
          <div className="fingers__hand" key={side} ref={(el) => void (hands.current[side] = el)}>
            <div className="fingers__title">
              <span>{side.toUpperCase()} HAND</span>
              <span ref={(el) => void (titles.current[side] = el)}>NO HAND</span>
            </div>
            {FINGER_NAMES.map((finger) => {
              const refs = rows.current[side][finger];
              return (
                <div className="fingers__row" key={finger} ref={(el) => void (refs.row = el)} data-tone="off" data-active="0">
                  <span className="fingers__name">{LABEL[finger]}</span>
                  <span className="fingers__bar">
                    <i ref={(el) => void (refs.bar = el)} />
                  </span>
                  <span className="fingers__value" ref={(el) => void (refs.value = el)}>
                    —
                  </span>
                  <span className="fingers__state" ref={(el) => void (refs.state = el)}>
                    NO HAND
                  </span>
                  <span className="fingers__joint" ref={(el) => void (refs.joint = el)}>
                    —
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
