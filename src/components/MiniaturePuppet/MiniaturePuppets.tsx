import { useImperativeHandle, useRef, type Ref } from 'react';
import { computeJoints, copyRig, createJoints, emptyRig, PUPPET, type PuppetJoints } from '../../motion/PuppetRig';
import { SIDES, type PuppetRig, type Side } from '../../types';
import { PuppetFigure, type PuppetFigureHandle } from '../PuppetRig/PuppetFigure';

export interface MiniaturePuppetsHandle {
  /**
   * Poses one miniature on the hand that holds it and returns where its
   * joints ended up, in preview pixels, so the strings can be drawn to them.
   *
   * @param rig         the puppet's pose on the stage (every joint is shared)
   * @param palmX,palmY the palm centre in preview pixels
   * @param palmLength  wrist → middle knuckle, preview pixels
   */
  place(side: Side, rig: PuppetRig, palmX: number, palmY: number, palmLength: number, opacity: number): PuppetJoints;
  hide(side: Side): void;
}

interface MiniaturePuppetsProps {
  /** Size of the preview in CSS pixels; the SVG uses the same units. */
  width: number;
  height: number;
  ref?: Ref<MiniaturePuppetsHandle>;
}

/** A miniature stands about this many palm lengths tall: roughly the size of the hand that holds it. */
const HEIGHT_IN_PALMS = 2.15;
/** The palm sits at the miniature's chest. */
const CHEST = -PUPPET.chest.y;

/**
 * The two miniature puppets drawn over the camera, one on each hand. They are
 * the same articulated rig as the stage puppets, in colour: only the root is
 * different (it rides on the palm). Every joint, the lean, the legs and the
 * props show exactly the pose the stage shows, so what the fingers do can be
 * read right where the hand is.
 */
export function MiniaturePuppets({ width, height, ref }: MiniaturePuppetsProps) {
  const figures = useRef<Partial<Record<Side, PuppetFigureHandle | null>>>({});
  const rigs = useRef<Record<Side, PuppetRig>>({ left: emptyRig(), right: emptyRig() });
  const joints = useRef<Record<Side, PuppetJoints>>({ left: createJoints(), right: createJoints() });
  const opacity = useRef<Record<Side, number>>({ left: -1, right: -1 });

  useImperativeHandle(
    ref,
    () => {
      const setOpacity = (side: Side, value: number) => {
        const rounded = Math.round(value * 50) / 50;
        if (rounded === opacity.current[side]) return;
        opacity.current[side] = rounded;
        figures.current[side]?.setOpacity(rounded);
      };
      return {
        place(side, rig, palmX, palmY, palmLength, alpha) {
          const mini = copyRig(rig, rigs.current[side]);
          const scale = (palmLength * HEIGHT_IN_PALMS) / PUPPET.height;
          mini.scale = scale;
          mini.x = palmX;
          mini.y = palmY + CHEST * scale;
          figures.current[side]?.apply(mini);
          setOpacity(side, alpha);
          return computeJoints(mini, side, joints.current[side]);
        },
        hide(side) {
          setOpacity(side, 0);
        },
      };
    },
    [],
  );

  return (
    <svg className="camera__layer camera__puppets" viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`} aria-hidden="true">
      {SIDES.map((side) => (
        <g key={side} className="camera__puppet">
          <PuppetFigure side={side} skin="painted" idPrefix={`mini-${side}`} ref={(handle) => void (figures.current[side] = handle)} />
        </g>
      ))}
    </svg>
  );
}
