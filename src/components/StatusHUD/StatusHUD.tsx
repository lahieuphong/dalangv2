import { useCallback, useEffect, useRef } from 'react';
import type { Engine } from '../../app/Engine';
import { fixed, MOTION_SAMPLES, type Telemetry } from '../../app/telemetry';
import { fitCanvas } from '../../utils/canvas';
import { clamp } from '../../utils/math';

interface StatusHUDProps {
  engine: Engine;
  collapsed: boolean;
  onToggle: () => void;
}

/** Writes text only when it changed: a HUD that repaints identical glyphs is wasted work. */
export function useTextWriter() {
  const last = useRef(new WeakMap<HTMLElement, string>());
  return useCallback((element: HTMLElement | null, value: string) => {
    if (!element || last.current.get(element) === value) return;
    last.current.set(element, value);
    element.textContent = value;
  }, []);
}

function drawSparkline(canvas: HTMLCanvasElement, t: Telemetry) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 2 || height < 2) return;
  const ratio = fitCanvas(canvas, width, height, 2);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  let peak = 240;
  for (let i = 0; i < MOTION_SAMPLES; i++) peak = Math.max(peak, t.motion[i]);
  ctx.strokeStyle = 'rgba(255, 110, 196, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < MOTION_SAMPLES; i++) {
    // The ring's oldest sample sits at the write head.
    const value = t.motion[(t.motionHead + i) % MOTION_SAMPLES];
    const x = (i / (MOTION_SAMPLES - 1)) * width;
    const y = height - 1.5 - (value / peak) * (height - 3);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * The status panel at the top left of the camera: what the stage agent is
 * running, what the performing hand's puppet is doing, and how much the hand
 * is moving. Every value comes from the engine's telemetry.
 */
export function StatusHUD({ engine, collapsed, onToggle }: StatusHUDProps) {
  const agent = useRef<HTMLElement>(null);
  const status = useRef<HTMLElement>(null);
  const input = useRef<HTMLSpanElement>(null);
  const position = useRef<HTMLSpanElement>(null);
  const positionDot = useRef<HTMLElement>(null);
  const motion = useRef<HTMLSpanElement>(null);
  const motionBar = useRef<HTMLElement>(null);
  const energy = useRef<HTMLSpanElement>(null);
  const energyBar = useRef<HTMLElement>(null);
  const handedness = useRef<HTMLSpanElement>(null);
  const spark = useRef<HTMLCanvasElement>(null);
  const write = useTextWriter();

  useEffect(() => {
    const update = (t: Telemetry) => {
      const hand = t.primary ? t.hands[t.primary] : null;
      write(agent.current, `${t.mode === 'hunt' ? 'FLY HUNT' : 'RALLY'}${t.agentSide ? ' · CPU' : ''}`);
      const state = hand ? hand.state : t.hands.left.recovering || t.hands.right.recovering ? 'RECOVER' : 'IDLE';
      write(status.current, state);
      if (status.current) status.current.dataset.state = state;
      const left = t.hands.left.tracked;
      const right = t.hands.right.tracked;
      write(input.current, left && right ? 'BOTH HANDS' : left ? 'LEFT HAND' : right ? 'RIGHT HAND' : 'NO HAND');

      write(position.current, hand ? fixed(hand.palmX, 2) : '–');
      if (positionDot.current) positionDot.current.style.left = `${clamp(hand ? hand.palmX : 0.5, 0, 1) * 100}%`;
      write(motion.current, hand ? `${fixed(hand.speedPx)} px/s` : '–');
      if (motionBar.current) motionBar.current.style.transform = `scaleX(${clamp(hand ? hand.speedPx / 900 : 0, 0, 1).toFixed(3)})`;
      write(energy.current, `${fixed(t.energy * 100)}%`);
      if (energyBar.current) energyBar.current.style.transform = `scaleX(${clamp(t.energy, 0, 1).toFixed(3)})`;
      // MediaPipe reports one score per hand: how sure it is of left versus right. It is shown as exactly that.
      write(handedness.current, hand?.handedness ? `${hand.handedness.toUpperCase()} ${fixed(hand.handednessScore, 2)}` : '–');
      if (spark.current) drawSparkline(spark.current, t);
    };
    update(engine.telemetry);
    return engine.subscribe('hud', update);
  }, [engine, write, collapsed]);

  return (
    <section className={`hud hud--status${collapsed ? ' is-collapsed' : ''}`} aria-label="Status">
      <button type="button" className="hud__head" onClick={onToggle} aria-expanded={!collapsed} title={collapsed ? 'Expand' : 'Collapse'}>
        <span className="hud__line">
          <span className="hud__key hud__key--teal">AGENT:</span> <b ref={agent}>FLY HUNT</b>
        </span>
        <span className="hud__line">
          <span className="hud__key">STATUS:</span>{' '}
          <b className="hud__state" ref={status} data-state="IDLE">
            IDLE
          </b>
        </span>
        <span className="hud__line hud__dim">
          INPUT / <span ref={input}>NO HAND</span>
        </span>
      </button>
      {!collapsed && (
        <div className="hud__body">
          <div className="hud__row">
            <span>POSITION</span>
            <span ref={position}>–</span>
          </div>
          <div className="hud__track">
            <i ref={positionDot} />
          </div>
          <div className="hud__row">
            <span>MOTION</span>
            <span ref={motion}>–</span>
          </div>
          <div className="hud__bar">
            <i ref={motionBar} />
          </div>
          <div className="hud__row">
            <span>ENERGY</span>
            <span ref={energy}>0%</span>
          </div>
          <div className="hud__bar hud__bar--pink">
            <i ref={energyBar} />
          </div>
          <div className="hud__row" title="MediaPipe's confidence that this is a left or a right hand">
            <span>HANDEDNESS</span>
            <span ref={handedness}>–</span>
          </div>
          <canvas className="hud__spark" ref={spark} aria-hidden="true" />
        </div>
      )}
    </section>
  );
}
