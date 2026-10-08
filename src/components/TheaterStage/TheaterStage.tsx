import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Engine } from '../../app/Engine';
import type { StageFrame } from '../../app/frames';
import { QUALITY } from '../../app/settings';
import { DustField } from '../../scene/AmbientEffects';
import { paintBackdrop } from '../../scene/Backdrop';
import { drawHandSilhouette } from '../../scene/HandSilhouette';
import type { SceneMode } from '../../scene/SceneController';
import { createShadowHand, drawStageFront, placeShadowHand, type ShadowHand } from '../../scene/StageFx';
import { computeLayout, STAGE_HEIGHT, stageWidthFor } from '../../scene/StageProps';
import { SIDES, type QualityPreset, type Side } from '../../types';
import { fitCanvas } from '../../utils/canvas';
import { lerp } from '../../utils/math';
import { useElementSize } from '../../hooks/useElementSize';
import { PuppetFigure, type PuppetFigureHandle } from '../PuppetRig/PuppetFigure';

interface TheaterStageProps {
  engine: Engine;
  quality: QualityPreset;
  mode: SceneMode;
  onMode: (mode: SceneMode) => void;
  /** A short prompt shown at the top of the stage, or null. */
  hint: string | null;
}

/** The hand-shadow canvases cover this many palm lengths around the palm centre. */
const HAND_BOX = 5.2;
/** How dark the hand's shadow is on the screen. */
const HAND_SHADE = 0.24;

/**
 * The lit screen. Four layers, back to front:
 *
 *   1. backdrop canvas   parchment, moon, mountains, table (painted once per size)
 *   2. hand canvases     the puppeteer's hand as a soft shadow above each puppet
 *   3. SVG               the two articulated puppets
 *   4. effects canvas    strings, flies, ball, dust
 *
 * React only renders the structure. Every frame is drawn imperatively from
 * the engine's `StageFrame`.
 */
export function TheaterStage({ engine, quality, mode, onMode, hint }: TheaterStageProps) {
  const [boxRef, size] = useElementSize<HTMLDivElement>();
  const backdropRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const handRefs = useRef<Partial<Record<Side, HTMLCanvasElement | null>>>({});
  const figures = useRef<Partial<Record<Side, PuppetFigureHandle | null>>>({});
  const profile = QUALITY[quality];
  const stageWidth = stageWidthFor(size.width, size.height);
  const layout = useMemo(() => computeLayout(stageWidth), [stageWidth]);

  useLayoutEffect(() => {
    engine.setStageWidth(stageWidth);
  }, [engine, stageWidth]);

  // The backdrop is static: painted when the size or the quality changes, never per frame.
  useEffect(() => {
    const canvas = backdropRef.current;
    if (!canvas || size.width < 2 || size.height < 2) return;
    fitCanvas(canvas, size.width, size.height, profile.pixelRatio);
    paintBackdrop(canvas, layout, profile.paperDetail);
  }, [size.width, size.height, layout, profile.pixelRatio, profile.paperDetail]);

  useEffect(() => {
    const dust = new DustField();
    const shadows: Record<Side, ShadowHand> = { left: createShadowHand(), right: createShadowHand() };
    const lastOpacity: Record<Side, number> = { left: -1, right: -1 };
    const lastHand: Record<Side, { opacity: number; transform: string; box: number }> = {
      left: { opacity: -1, transform: '', box: 0 },
      right: { opacity: -1, transform: '', box: 0 },
    };

    const view = {
      render(frame: StageFrame) {
        const fx = fxRef.current;
        if (!fx || size.height < 2) return;
        // CSS pixels per stage unit: the stage is always exactly 600 units tall.
        const k = size.height / STAGE_HEIGHT;
        const { quality: q } = frame;

        for (const side of SIDES) {
          const figure = figures.current[side];
          if (figure) {
            figure.apply(frame.rigs[side]);
            // A puppet nobody holds stands a little dimmer; leather lets some lamp light through.
            const opacity = Math.round(lerp(0.74, 1, frame.presence[side]) * (q.translucent ? 0.93 : 1) * 100) / 100;
            if (opacity !== lastOpacity[side]) {
              lastOpacity[side] = opacity;
              figure.setOpacity(opacity);
            }
          }

          // The hand's shadow: a small canvas moved to where the hand hangs above the puppet.
          const shadow = placeShadowHand(frame, side, shadows[side]);
          const canvas = handRefs.current[side];
          if (!canvas) continue;
          const memory = lastHand[side];
          const opacity = shadow.visible ? Math.round(shadow.alpha * HAND_SHADE * 100) / 100 : 0;
          if (opacity !== memory.opacity) {
            memory.opacity = opacity;
            canvas.style.opacity = String(opacity);
          }
          if (!shadow.visible) continue;
          const box = Math.round(shadow.palm * HAND_BOX * k);
          if (box !== memory.box) {
            memory.box = box;
            canvas.style.width = `${box}px`;
            canvas.style.height = `${box}px`;
          }
          const ratio = fitCanvas(canvas, box, box, Math.min(q.pixelRatio, 1.5));
          const half = (shadow.palm * HAND_BOX) / 2;
          const transform = `translate3d(${((shadow.x - half) * k).toFixed(1)}px, ${((shadow.y - half) * k).toFixed(1)}px, 0)`;
          if (transform !== memory.transform) {
            memory.transform = transform;
            canvas.style.transform = transform;
          }
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const scale = ratio * k;
          ctx.setTransform(scale, 0, 0, scale, -(shadow.x - half) * scale, -(shadow.y - half) * scale);
          ctx.fillStyle = '#2b1809';
          ctx.strokeStyle = '#2b1809';
          drawHandSilhouette(ctx, shadow.points, shadow.palm);
        }

        const ratio = fitCanvas(fx, size.width, size.height, q.pixelRatio);
        const ctx = fx.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, fx.width, fx.height);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        dust.resize(frame.reducedMotion ? 0 : q.dust);
        ctx.fillStyle = '#fff6d6';
        dust.draw(ctx, size.width, size.height, k, frame.now / 1000);
        drawStageFront(ctx, frame, k, shadows);
      },
    };
    engine.stageView = view;
    return () => {
      if (engine.stageView === view) engine.stageView = null;
    };
  }, [engine, size.width, size.height]);

  return (
    <section className="stage" ref={boxRef} aria-label="Shadow theatre stage">
      <canvas className="stage__layer stage__backdrop" ref={backdropRef} aria-hidden="true" />
      {SIDES.map((side) => (
        <canvas
          key={side}
          className={profile.softShadows ? 'stage__hand stage__hand--soft' : 'stage__hand'}
          ref={(el) => void (handRefs.current[side] = el)}
          aria-hidden="true"
        />
      ))}
      <svg
        className="stage__layer stage__puppets"
        viewBox={`0 0 ${layout.width} ${STAGE_HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="Two Wayang shadow puppets facing each other across a low table"
      >
        {profile.castShadows && (
          <>
            <defs>
              <filter id="stage-cast-shadow" x="-30%" y="-20%" width="160%" height="150%" colorInterpolationFilters="sRGB">
                <feColorMatrix type="matrix" values="0 0 0 0 0.16  0 0 0 0 0.09  0 0 0 0 0.03  0 0 0 0.34 0" />
                <feGaussianBlur stdDeviation="7" />
              </filter>
            </defs>
            {SIDES.map((side) => (
              <use key={side} href={`#stage-puppet-${side}`} filter="url(#stage-cast-shadow)" transform="translate(11 9)" />
            ))}
          </>
        )}
        {SIDES.map((side) => (
          <PuppetFigure
            key={side}
            side={side}
            skin="shadow"
            idPrefix={`st-${side}`}
            id={`stage-puppet-${side}`}
            ref={(handle) => void (figures.current[side] = handle)}
          />
        ))}
      </svg>
      <canvas className="stage__layer stage__fx" ref={fxRef} aria-hidden="true" />

      {hint && <p className="stage__hint">{hint}</p>}
      <div className="stage__mode" role="group" aria-label="Stage mode">
        <button type="button" className="stage__mode-button" aria-pressed={mode === 'hunt'} onClick={() => onMode('hunt')}>
          FLY HUNT
        </button>
        <button type="button" className="stage__mode-button" aria-pressed={mode === 'rally'} onClick={() => onMode('rally')}>
          RALLY
        </button>
      </div>
    </section>
  );
}
