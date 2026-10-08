import { useEffect, useRef } from 'react';
import type { Engine } from '../../app/Engine';
import { CALIBRATION_STEPS, type CalibrationStep } from '../../tracking/Calibration';

interface CalibrationOverlayProps {
  engine: Engine;
  step: CalibrationStep;
  onSkip: () => void;
  onCancel: () => void;
}

const COPY: Record<CalibrationStep, { title: string; body: string }> = {
  show: { title: 'Show your hand', body: 'Bring one or both hands into the picture, palm toward the camera.' },
  open: { title: 'Open your fingers', body: 'Hold your hand naturally open for a moment. This becomes 0 % for each finger.' },
  fist: { title: 'Close your hand', body: 'Make a loose fist and hold it. This becomes 100 % for each finger.' },
  range: { title: 'Move around', body: 'Sweep your hand to the edges of the area you want to play in: left, right, up and down.' },
  done: { title: 'Calibrated', body: 'Your finger ranges and playing area are saved on this device.' },
};

const VISIBLE_STEPS: readonly CalibrationStep[] = CALIBRATION_STEPS.filter((step) => step !== 'done');

/**
 * The short guided calibration, shown over the camera. Each step only
 * advances while the hand really holds the pose, any step can be skipped, and
 * the whole thing can be cancelled without changing anything.
 */
export function CalibrationOverlay({ engine, step, onSkip, onCancel }: CalibrationOverlayProps) {
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    const update = (_: CalibrationStep, progress: number) => {
      if (bar.current) bar.current.style.transform = `scaleX(${progress.toFixed(3)})`;
    };
    engine.calibrationView = update;
    return () => {
      if (engine.calibrationView === update) engine.calibrationView = null;
    };
  }, [engine]);

  const copy = COPY[step];
  const index = VISIBLE_STEPS.indexOf(step);
  return (
    <div className="calibration" role="dialog" aria-label="Calibration">
      <p className="calibration__count">
        CALIBRATION · STEP {Math.max(1, index + 1)} / {VISIBLE_STEPS.length}
      </p>
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
      <div className="calibration__bar">
        <i ref={bar} />
      </div>
      <div className="calibration__actions">
        <button type="button" className="button" onClick={onSkip}>
          Skip this step
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
