import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../../app/Engine';
import { fixed, type Telemetry } from '../../app/telemetry';
import { CHANNEL_LABEL, JOINT_RANGE } from '../../motion/PuppetMapping';
import { FINGER_NAMES, SIDES, type FingerName, type Side } from '../../types';
import { fitCanvas } from '../../utils/canvas';
import { clamp } from '../../utils/math';
import { CloseIcon } from '../Header/icons';

interface DebugPanelProps {
  engine: Engine;
  onClose: () => void;
}

/** Render frames kept in the plot: about five seconds at 60 fps. */
const HISTORY = 300;
const SERIES = [
  { key: 'raw', label: 'raw curl', color: '#9aa3a8' },
  { key: 'filtered', label: 'filtered curl', color: '#3ef0c2' },
  { key: 'target', label: 'target joint', color: '#ffd64a' },
  { key: 'rendered', label: 'rendered joint', color: '#ff6ec4' },
] as const;

const pad = (text: string, width: number) => text.padEnd(width);

/** The pipeline's timing budget and both hands' channels, as text. */
function describe(t: Telemetry): string {
  const lines: string[] = [];
  if (t.source === 'simulated') lines.push(`source       simulated hands · scenario "${t.simSegment}" · ${fixed(t.trackHz)} results/s`);
  else if (t.source === 'camera') {
    lines.push(
      `source       camera ${t.cameraWidth}×${t.cameraHeight} · ${fixed(t.cameraFps, 1)} fps delivered · capture→page ${fixed(t.captureDelayMs)} ms`,
      `model        ${t.backend || '–'} · ${t.trackerStatus}`,
      `tracking     ${fixed(t.trackHz, 1)} Hz · inference ${fixed(t.inferenceMs, 1)} ms · round trip ${fixed(t.roundTripMs, 1)} ms`,
      `latency      capture→pose target ${fixed(t.inputAgeMs)} ms · result age on screen ${fixed(t.sampleAgeMs)} ms`,
    );
  } else lines.push('source       none (camera off)');
  lines.push(
    `mapping      ${fixed(t.mappingMs, 2)} ms per result (features + filters + pose)`,
    `render       ${fixed(t.renderFps, 1)} fps · frame ${fixed(t.frameMs, 1)} ms · worst ${fixed(t.worstFrameMs)} ms · engine ${fixed(t.engineMs, 2)} ms`,
    `response     ${t.source === 'camera' ? `${fixed(t.responseMs)} ms capture→pose on screen` : 'n/a without a camera'}`,
    `assignment   ${t.assignment} · mode ${t.mode} · returns ${t.returns} · best rally ${t.bestRally}`,
    `tuning       finger ${fixed(t.fingerGain, 2)}× · palm ${fixed(t.palmGain, 2)}× · pinch ${fixed(t.pinchGain, 2)}× · smoothing ${fixed(t.smoothing, 2)}`,
  );
  for (const side of SIDES) {
    const h = t.hands[side];
    const who = h.agent ? 'AGENT' : h.tracked ? (h.visible ? 'TRACKED' : 'HOLD') : h.recovering ? 'RECOVER' : 'none';
    lines.push(
      '',
      `${side.toUpperCase()} puppet · ${who} · ${h.state} · gesture ${h.gesture} · paddle ${h.paddle}`,
      `  palm ${fixed(h.palmX, 3)}, ${fixed(h.palmY, 3)} · v ${fixed(h.speed, 2)}/s · roll ${fixed(h.roll)}° · size ${fixed(h.depth, 3)} · lift ${fixed(h.lift)} · follower lag ${fixed(h.followLagMs, 1)} ms`,
      `  pinch ${fixed(h.pinch, 2)} · fist ${fixed(h.fist, 2)} · handedness ${h.handedness ?? '–'} ${fixed(h.handednessScore, 2)} · paddle spin ${fixed(h.weaponSpin)}°/s`,
      `  ${pad('finger', 8)}${pad('raw', 7)}${pad('filt', 7)}${pad('target°', 9)}${pad('render°', 9)}joint`,
    );
    for (const finger of FINGER_NAMES) {
      const f = h.fingers[finger];
      lines.push(
        `  ${pad(finger, 8)}${pad(fixed(f.raw, 2), 7)}${pad(fixed(f.filtered, 2), 7)}${pad(fixed(f.targetAngle, 1), 9)}${pad(fixed(f.renderedAngle, 1), 9)}${f.channel ? CHANNEL_LABEL[f.channel] : '–'}${f.inFrame ? '' : '  (out of frame, held)'}`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * `?debug=1`: where the time goes between the camera and the screen, and what
 * every channel is doing. The plot overlays one finger's raw curl, filtered
 * curl, joint target and rendered joint on one time axis, so it is plain to
 * see whether any lag comes from the filter or from the follower.
 */
export function DebugPanel({ engine, onClose }: DebugPanelProps) {
  const [side, setSide] = useState<Side>('left');
  const [finger, setFinger] = useState<FingerName>('index');
  const text = useRef<HTMLPreElement>(null);
  const landmarks = useRef<HTMLPreElement>(null);
  const plot = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const update = (t: Telemetry) => {
      if (text.current) text.current.textContent = describe(t);
      const pre = landmarks.current;
      // Only spell out 21 landmarks while someone is looking at them.
      if (pre && pre.parentElement instanceof HTMLDetailsElement && pre.parentElement.open) {
        const hand = t.hands[side].visible ? engine.latestHand(side) : null;
        pre.textContent = hand
          ? hand.landmarks.map((p, i) => `${String(i).padStart(2)}  x ${p.x.toFixed(4)}  y ${p.y.toFixed(4)}  z ${(p.z ?? 0).toFixed(4)}`).join('\n')
          : 'no hand';
      }
    };
    update(engine.telemetry);
    return engine.subscribe('hud', update);
  }, [engine, side]);

  useEffect(() => {
    const history = new Float32Array(HISTORY * SERIES.length);
    let head = 0;
    const sample = (eng: Engine) => {
      const f = eng.telemetry.hands[side].fingers[finger];
      // Joint angles are put on the curl's 0..1 scale (straight finger … fully curled), so all four lines can be compared.
      const range = f.channel ? JOINT_RANGE[f.channel] : null;
      const unit = (angle: number) => (range ? clamp((angle - range[0]) / (range[1] - range[0]), -0.1, 1.1) : 0);
      const o = head * SERIES.length;
      history[o] = f.raw;
      history[o + 1] = f.filtered;
      history[o + 2] = unit(f.targetAngle);
      history[o + 3] = unit(f.renderedAngle);
      head = (head + 1) % HISTORY;

      const canvas = plot.current;
      if (!canvas) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 2 || height < 2) return;
      const ratio = fitCanvas(canvas, width, height, 2);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const level of [0, 0.5, 1]) {
        const y = height - 4 - level * (height - 8);
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
      SERIES.forEach((series, s) => {
        ctx.strokeStyle = series.color;
        ctx.lineWidth = s === 0 ? 1 : 1.4;
        ctx.beginPath();
        for (let i = 0; i < HISTORY; i++) {
          const value = history[((head + i) % HISTORY) * SERIES.length + s];
          const x = (i / (HISTORY - 1)) * width;
          const y = height - 4 - clamp(value, -0.1, 1.1) * (height - 8);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    };
    engine.debugView = sample;
    return () => {
      if (engine.debugView === sample) engine.debugView = null;
    };
  }, [engine, side, finger]);

  return (
    <aside className="debug" aria-label="Debug view">
      <header className="debug__head">
        <h2>DEBUG · pipeline</h2>
        <button type="button" className="icon-button" aria-label="Close debug view" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="debug__controls">
        <div className="segmented" role="group" aria-label="Hand">
          {SIDES.map((option) => (
            <button type="button" key={option} aria-pressed={side === option} onClick={() => setSide(option)}>
              {option}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Finger">
          {FINGER_NAMES.map((option) => (
            <button type="button" key={option} aria-pressed={finger === option} onClick={() => setFinger(option)}>
              {option}
            </button>
          ))}
        </div>
      </div>
      <canvas className="debug__plot" ref={plot} aria-label={`Raw, filtered, target and rendered values of the ${side} ${finger} finger`} />
      <ul className="debug__legend">
        {SERIES.map((series) => (
          <li key={series.key}>
            <i style={{ background: series.color }} />
            {series.label}
          </li>
        ))}
      </ul>
      <pre className="debug__text" ref={text} />
      <details className="debug__details">
        <summary>raw landmarks · {side} hand (view space)</summary>
        <pre className="debug__text" ref={landmarks} />
      </details>
    </aside>
  );
}
