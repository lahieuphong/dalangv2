import { useImperativeHandle, useMemo, useRef, type CSSProperties, type Ref } from 'react';
import { idleRig } from '../../motion/PuppetMapping';
import { PUPPET, RIG_TRANSFORM_KEYS, rigTransforms, type RigTransforms } from '../../motion/PuppetRig';
import { computeLayout } from '../../scene/StageProps';
import type { PuppetRig, Side } from '../../types';
import { BackSashArt, CrownArt, FanArt, FrontSashArt, KainArt, KerisArt, LegArt, PaddleArt, TorsoArt } from './BodyParts';
import { PALETTES, type PuppetPalette, type PuppetSkin, type PuppetVariant } from './palettes';
import { ForearmArt, HandArt, PrabaArt, PuppetDefs, RajaHead, SatriaHead, UpperArmArt } from './PuppetArt';

export interface PuppetFigureHandle {
  /** Poses the figure. Only the transforms that actually changed touch the DOM. */
  apply(rig: PuppetRig): void;
  setOpacity(opacity: number): void;
}

interface PuppetFigureProps {
  side: Side;
  skin: PuppetSkin;
  /** Unique prefix for this figure's gradient, pattern and clip ids. */
  idPrefix: string;
  /** Render only the outline shapes, in one flat colour. */
  silhouette?: boolean;
  /** DOM id of the root group, so a `<use>` can reference the posed figure. */
  id?: string;
  ref?: Ref<PuppetFigureHandle>;
}

const VARIANT: Record<Side, PuppetVariant> = { left: 'satria', right: 'raja' };

type GroupKey = keyof RigTransforms;
type Bind = (key: GroupKey, slot?: number) => (el: SVGGElement | null) => void;

interface ArmProps {
  far: boolean;
  p: string;
  pal: PuppetPalette;
  sil: boolean;
  initial: RigTransforms;
  bind: Bind;
}

/** Shoulder → elbow → wrist chain; each joint rotates about its own pin. The hand carries the prop. */
function Arm({ far, p, pal, sil, initial, bind }: ArmProps) {
  const arm = far ? PUPPET.back : PUPPET.front;
  const upper: GroupKey = far ? 'backUpper' : 'frontUpper';
  const fore: GroupKey = far ? 'backFore' : 'frontFore';
  const hand: GroupKey = far ? 'backHand' : 'frontHand';
  return (
    <g transform={`translate(${arm.shoulder.x} ${arm.shoulder.y})`}>
      <g ref={bind(upper)} transform={initial[upper]}>
        <UpperArmArt p={p} pal={pal} sil={sil} far={far} />
        <g transform={`translate(0 ${arm.upper})`}>
          <g ref={bind(fore)} transform={initial[fore]}>
            <ForearmArt p={p} pal={pal} sil={sil} far={far} />
            <g transform={`translate(0 ${arm.fore})`}>
              <g ref={bind(hand)} transform={initial[hand]}>
                {far ? <KerisArt pal={pal} sil={sil} /> : <PaddleArt pal={pal} sil={sil} />}
                <HandArt
                  p={p}
                  pal={pal}
                  sil={sil}
                  far={far}
                  fingersRef={far ? undefined : bind('frontFingers')}
                  fingersTransform={far ? `rotate(-40 ${PUPPET.knuckle.x} ${PUPPET.knuckle.y})` : initial.frontFingers}
                />
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}

/**
 * One Wayang puppet as an articulated SVG rig. The pose is driven imperatively
 * through `apply(rig)` from the animation loop, never through React renders.
 *
 * Layering, back to front: ornament and back arm, back sash, legs, kain,
 * torso, front sash, head, front arm. The upper-body layers share the lean
 * and the cloth layers share the swing, so they can interleave with the legs.
 */
export function PuppetFigure({ side, skin, idPrefix, silhouette = false, id, ref }: PuppetFigureProps) {
  const variant = VARIANT[side];
  const pal = PALETTES[skin][variant];
  const p = idPrefix;
  const sil = silhouette;
  const root = useRef<SVGGElement | null>(null);
  const groups = useRef(new Map<GroupKey, SVGGElement[]>());
  const applied = useRef<Partial<RigTransforms>>({});
  const scratch = useRef<Partial<RigTransforms>>({});
  const initial = useMemo(() => rigTransforms(side, idleRig(side, 0, 0, computeLayout(900))), [side]);

  const bind = useMemo<Bind>(() => {
    const cache = new Map<string, (el: SVGGElement | null) => void>();
    return (key, slot = 0) => {
      const cacheKey = `${key}:${slot}`;
      let callback = cache.get(cacheKey);
      if (!callback) {
        let current: SVGGElement | null = null;
        callback = (el) => {
          const list = groups.current.get(key) ?? [];
          if (current) list.splice(list.indexOf(current), 1);
          if (el) list.push(el);
          current = el;
          groups.current.set(key, list);
          if (key === 'root') root.current = el;
          // A freshly mounted group shows its initial transform; forget what was applied before.
          delete applied.current[key];
        };
        cache.set(cacheKey, callback);
      }
      return callback;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      apply(rig) {
        const next = rigTransforms(side, rig, scratch.current);
        const last = applied.current;
        for (const key of RIG_TRANSFORM_KEYS) {
          const value = next[key];
          if (last[key] === value) continue;
          last[key] = value;
          const list = groups.current.get(key);
          if (list) for (const el of list) el.setAttribute('transform', value);
        }
      },
      setOpacity(opacity) {
        root.current?.setAttribute('opacity', opacity.toFixed(3));
      },
    }),
    [side],
  );

  const art = { p, pal, sil };
  const style = { '--puppet-hole': pal.hole } as CSSProperties;
  return (
    <g ref={bind('root')} id={id} transform={initial.root} color={pal.ink} style={style}>
      {!sil && <PuppetDefs p={p} pal={pal} />}

      <g ref={bind('upper', 0)} transform={initial.upper}>
        <g ref={bind('fan')} transform={initial.fan}>
          <FanArt {...art} />
        </g>
        {variant === 'raja' && <PrabaArt {...art} />}
        <Arm far p={p} pal={pal} sil={sil} initial={initial} bind={bind} />
      </g>

      <g ref={bind('cloth', 0)} transform={initial.cloth}>
        <BackSashArt {...art} />
      </g>

      <LegArt
        {...art}
        far
        thighRef={bind('backLeg')}
        shinRef={bind('backShin')}
        footRef={bind('backFoot')}
        thighTransform={initial.backLeg}
        shinTransform={initial.backShin}
        footTransform={initial.backFoot}
      />
      <LegArt
        {...art}
        far={false}
        thighRef={bind('frontLeg')}
        shinRef={bind('frontShin')}
        footRef={bind('frontFoot')}
        thighTransform={initial.frontLeg}
        shinTransform={initial.frontShin}
        footTransform={initial.frontFoot}
      />

      <g ref={bind('cloth', 1)} transform={initial.cloth}>
        <KainArt {...art} />
      </g>
      <g ref={bind('upper', 1)} transform={initial.upper}>
        <TorsoArt {...art} />
      </g>
      <g ref={bind('cloth', 2)} transform={initial.cloth}>
        <FrontSashArt {...art} />
      </g>

      <g ref={bind('upper', 2)} transform={initial.upper}>
        <g ref={bind('head')} transform={initial.head}>
          {variant === 'raja' ? (
            <RajaHead {...art} />
          ) : (
            <>
              <SatriaHead {...art} />
              <CrownArt {...art} />
            </>
          )}
        </g>
        <Arm far={false} p={p} pal={pal} sil={sil} initial={initial} bind={bind} />
      </g>
    </g>
  );
}
