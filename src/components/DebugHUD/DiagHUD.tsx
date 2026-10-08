import { useEffect, useRef } from 'react';
import type { Engine } from '../../app/Engine';
import { fixed, type HandTelemetry, type Telemetry } from '../../app/telemetry';
import { FINGER_NAMES, type Side } from '../../types';
import { useTextWriter } from '../StatusHUD/StatusHUD';

interface DiagHUDProps {
  engine: Engine;
  /** Compact: only the essential rows. */
  collapsed: boolean;
  onToggle: () => void;
}

type RowKey =
  | 'rate'
  | 'camera'
  | 'inference'
  | 'age'
  | 'response'
  | 'gesture'
  | 'assign'
  | 'tuning'
  | 'pinch'
  | 'velocity'
  | 'spin'
  | 'paddle'
  | 'returns'
  | 'rally';

/** [key, label, shown when compact] */
const ROWS: readonly (readonly [RowKey, string, boolean])[] = [
  ['rate', 'render / track', true],
  ['camera', 'camera', false],
  ['inference', 'inference', true],
  ['age', 'sample age', true],
  ['response', 'response', false],
  ['gesture', 'gesture', true],
  ['assign', 'assign', false],
  ['tuning', 'sens / smooth', false],
  ['pinch', 'pinch', false],
  ['velocity', 'palm vel', false],
  ['spin', 'weapon spin', false],
  ['paddle', 'paddle', true],
  ['returns', 'returns', true],
  ['rally', 'rally time', false],
];

const LETTERS = ['T', 'I', 'M', 'R', 'P'] as const;

function handLine(side: Side, hand: HandTelemetry): string {
  if (hand.agent) return `[ai] ${side} puppet · agent`;
  if (hand.tracked && hand.visible) return `[ok] ${side} hand tracked`;
  if (hand.tracked || hand.recovering) return `[!!] ${side} hand lost`;
  return `[--] ${side} hand`;
}

/**
 * The engineering readout at the right of the camera, styled as a terminal.
 * Render rate and tracking rate are separate measurements and are shown side
 * by side; nothing here is assumed or hard-coded.
 */
export function DiagHUD({ engine, collapsed, onToggle }: DiagHUDProps) {
  const lines = useRef<Partial<Record<Side, HTMLDivElement | null>>>({});
  const status = useRef<HTMLSpanElement>(null);
  const values = useRef<Partial<Record<RowKey, HTMLSpanElement | null>>>({});
  const bars = useRef<(HTMLElement | null)[]>([]);
  const log = useRef<HTMLOListElement>(null);
  const logKey = useRef('');
  const write = useTextWriter();

  useEffect(() => {
    const update = (t: Telemetry) => {
      for (const side of ['left', 'right'] as const) {
        const element = lines.current[side];
        const hand = t.hands[side];
        write(element ?? null, handLine(side, hand));
        if (element) element.dataset.tone = hand.agent ? 'ai' : hand.tracked && hand.visible ? 'ok' : hand.tracked || hand.recovering ? 'warn' : 'off';
      }
      const hand = t.primary ? t.hands[t.primary] : null;
      write(status.current, (hand ? hand.state : 'idle').toLowerCase());

      const v = values.current;
      // Two independent rates: how often the screen is drawn, and how often a new hand pose arrives.
      write(v.rate ?? null, `${fixed(t.renderFps)} / ${fixed(t.trackHz)} Hz`);
      write(v.camera ?? null, t.source === 'simulated' ? 'simulated' : t.cameraWidth ? `${fixed(t.cameraFps)} fps · ${t.cameraWidth}×${t.cameraHeight}` : '–');
      write(v.inference ?? null, Number.isFinite(t.inferenceMs) ? `${fixed(t.inferenceMs, 1)} ms` : '–');
      write(v.age ?? null, Number.isFinite(t.sampleAgeMs) ? `${fixed(t.sampleAgeMs)} ms` : '–');
      write(v.response ?? null, t.source === 'camera' && Number.isFinite(t.inputAgeMs) ? `${fixed(t.responseMs)} ms` : '–');
      write(v.gesture ?? null, hand && hand.gesture !== 'none' ? hand.gesture : '–');
      write(v.assign ?? null, t.assignment);
      write(v.tuning ?? null, `${fixed(t.fingerGain, 2)}× / ${fixed(t.smoothing, 2)}`);
      write(v.pinch ?? null, hand ? fixed(hand.pinch, 2) : '–');
      write(v.velocity ?? null, hand ? `${fixed(hand.speed, 2)} /s` : '–');
      write(v.spin ?? null, hand ? `${fixed(hand.weaponSpin)} deg/s` : '–');
      write(v.paddle ?? null, hand ? hand.paddle : 'idle');
      write(v.returns ?? null, String(t.returns));
      write(v.rally ?? null, `${fixed(t.rallySeconds, 1)} s`);

      FINGER_NAMES.forEach((finger, i) => {
        const bar = bars.current[i];
        if (!bar) return;
        const f = hand?.fingers[finger];
        bar.style.transform = `scaleX(${(f ? 1 - f.filtered : 0).toFixed(3)})`;
        bar.dataset.active = f && f.activity > 0.3 ? '1' : '0';
      });

      // The event log only touches the DOM when a new line arrived.
      const list = log.current;
      if (list) {
        const last = t.events[t.events.length - 1];
        const key = last ? `${t.events.length}:${last.at}:${last.text}` : '';
        if (key !== logKey.current) {
          logKey.current = key;
          list.replaceChildren(
            ...t.events.slice(-4).map((event) => {
              const item = document.createElement('li');
              item.textContent = `${event.at.toFixed(1)}s ${event.text}`;
              return item;
            }),
          );
        }
      }
    };
    update(engine.telemetry);
    return engine.subscribe('hud', update);
  }, [engine, write, collapsed]);

  return (
    <section className={`hud hud--diag${collapsed ? ' is-collapsed' : ''}`} aria-label="Diagnostics">
      <button type="button" className="hud__head" onClick={onToggle} aria-expanded={!collapsed} title={collapsed ? 'Show all rows' : 'Show fewer rows'}>
        <span className="hud__line">
          <span className="hud__prompt">puppet@dalang:~$</span> watch
        </span>
      </button>
      <div className="hud__line hud__tone" ref={(el) => void (lines.current.left = el)} data-tone="off">
        [--] left hand
      </div>
      <div className="hud__line hud__tone" ref={(el) => void (lines.current.right = el)} data-tone="off">
        [--] right hand
      </div>
      <div className="hud__rule" />
      <div className="hud__line">
        <span className="hud__key hud__key--teal">status:</span> <span ref={status}>idle</span>
        <span className="hud__cursor" aria-hidden="true">
          _
        </span>
      </div>
      <div className="hud__rule" />
      {ROWS.filter(([, , essential]) => essential || !collapsed).map(([key, label]) => (
        <div className="hud__row" key={key}>
          <span>{label}</span>
          <span ref={(el) => void (values.current[key] = el)}>–</span>
        </div>
      ))}
      <div className="hud__line hud__key--teal">$ finger.input [{LETTERS.join(' ')}]</div>
      <div className="hud__fingers" aria-hidden="true">
        {LETTERS.map((letter, i) => (
          <span key={letter}>
            <i ref={(el) => void (bars.current[i] = el)} />
          </span>
        ))}
      </div>
      {!collapsed && <ol className="hud__log" ref={log} aria-label="Recent events" />}
    </section>
  );
}
