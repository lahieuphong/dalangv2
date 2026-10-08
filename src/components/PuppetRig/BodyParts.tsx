import type { Ref } from 'react';
import { PUPPET } from '../../motion/PuppetRig';
import { RAD } from '../../utils/math';
import { Band, Dots, drop, INK, Line, NECK, Shape, SHIN_BACK, SHIN_FRONT, TORSO, type ArtProps } from './PuppetArt';

/**
 * The parts of the puppet that the V2 rig articulates: the body split into
 * torso, three layers of cloth and two jointed legs, plus the crown, the
 * ornament behind the head, the paddle and the keris. Drawn facing right with
 * the soles on y = 0, in the same coordinates as PuppetArt.tsx.
 */

/* ------------------------------------------------------------------------ */
/* Torso                                                                     */
/* ------------------------------------------------------------------------ */

/** Neck, the frontal V-shaped torso with broad shoulders, the necklace and the belt. */
export function TorsoArt({ p, pal, sil }: ArtProps) {
  const gold = `url(#${p}-gold)`;
  const accent = `url(#${p}-accent)`;
  return (
    <g>
      <Shape sil={sil} fill={`url(#${p}-limb)`} d={NECK} />
      <Shape sil={sil} fill={gold} d={TORSO} />
      {!sil && (
        <>
          <Band id={`${p}-torso-band`} d={TORSO} color={pal.gold[2]} width={9} />
          <Band id={`${p}-neck-band`} d={NECK} color={pal.gold[2]} width={5} />
          <Line d="M48 -284 C38 -275 26 -273 14 -277" opacity={0.45} width={0.8} />
          <Line d="M-40 -284 C-30 -276 -18 -274 -6 -277" opacity={0.3} width={0.8} />
          <Line d="M6 -276 C6 -264 5 -252 3 -240" opacity={0.25} width={0.8} />
          <Dots d="M-41 -280 C-34 -265 -28 -250 -24.5 -238" size={1.3} gap={4} />
          <Dots d="M44 -279 C36 -265 28 -251 22.5 -240" size={1.3} gap={4} />
          {/* Kalung necklace, ulur chain and pendants */}
          <Shape
            sil={false}
            fill={accent}
            strokeWidth={0.9}
            d="M-36 -304 C-14 -286 22 -282 50 -301 C49 -296 47 -292 44 -289 C22 -276 -12 -278 -32 -297 Z"
          />
          <Dots d="M-31 -299.5 C-10 -285 20 -282 45 -295" color={pal.gold[0]} size={2.2} gap={4} />
          {[
            [-18, -284],
            [-5, -280.5],
            [8, -279.5],
            [21, -280.5],
            [33, -284],
          ].map(([x, y]) => (
            <path key={x} d={drop(x, y, 0.8)} fill={gold} stroke={INK} strokeWidth={0.5} />
          ))}
          <Dots d="M8 -278 C7 -268 7 -258 8 -250" color={pal.gold[0]} size={1.9} gap={3.4} />
          <path d="M8 -251 L12.5 -244 L8 -237 L3.5 -244 Z" fill={gold} stroke={INK} strokeWidth={0.7} />
          <circle cx={8} cy={-244} r={1.6} fill={pal.jewel} />
        </>
      )}

      {/* Belt with buckle */}
      <Shape sil={sil} fill={accent} d="M-28 -246 C-10 -242 10 -244 28 -249 L26 -226 C9 -222 -10 -222 -27 -224 Z" />
      {!sil && (
        <>
          <Line d="M-27.6 -240.5 C-10 -237 10 -239 27.4 -243.5" color={pal.gold[0]} width={1.3} />
          <Line d="M-27.2 -229.5 C-10 -226.5 10 -227.5 26.4 -231.5" color={pal.gold[0]} width={1.3} />
          <Dots d="M-25 -235 C-10 -232 10 -233 24 -237" size={1.4} gap={3.8} />
          <ellipse cx={23} cy={-236} rx={4.6} ry={6.8} fill={gold} stroke={INK} strokeWidth={0.8} />
          <circle cx={23} cy={-236} r={2} fill={pal.jewel} />
        </>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------------ */
/* Cloth: three layers that swing together about the belt                    */
/* ------------------------------------------------------------------------ */

/** Back sash, flowing behind the legs. */
export function BackSashArt({ p, pal, sil }: ArtProps) {
  return (
    <g>
      <Shape
        sil={sil}
        fill={`url(#${p}-accent)`}
        d="M-24 -238 C-48 -230 -74 -212 -92 -194 C-104 -182 -112 -168 -118 -154 L-108 -157 L-112 -145 C-98 -162 -80 -184 -64 -200 C-52 -212 -38 -222 -22 -226 Z"
      />
      {!sil && <Line d="M-27 -233 C-52 -221 -82 -196 -106 -160" color={pal.gold[0]} width={1.1} opacity={0.8} />}
    </g>
  );
}

const HEM = 'C-86 -112 -64 -110 -40 -110 C-12 -110 30 -112 62 -116';

/** Dodot: the long kain whose back flap sweeps out into a point, and the pleated wiron fold at the front. */
export function KainArt({ p, pal, sil }: ArtProps) {
  return (
    <g>
      <Shape
        sil={sil}
        fill={`url(#${p}-kain)`}
        d={`M-26 -230 C-42 -212 -64 -186 -86 -162 C-98 -148 -108 -134 -114 -118 L-100 -116 ${HEM} C70 -150 52 -200 24 -232 Z`}
      />
      <Shape sil={sil} fill={`url(#${p}-wiron)`} d="M24 -232 C46 -202 62 -160 64 -116 L50 -114 C48 -156 36 -196 16 -230 Z" />
      {!sil && (
        <>
          <Line d="M-8 -226 C-18 -194 -32 -156 -46 -114" opacity={0.3} width={0.8} />
          <Line d="M6 -226 C10 -190 18 -152 26 -112" opacity={0.3} width={0.8} />
          <Line d={`M-100 -116 ${HEM}`} color={pal.kain.border} width={5.5} />
          <Line d={`M-100 -116 ${HEM}`} color={pal.gold[1]} width={1.4} />
          <Line d="M-26 -230 C-42 -212 -64 -186 -86 -162 C-98 -148 -108 -134 -114 -118" color={pal.kain.border} width={4.5} />
          <Line d="M-25 -231 C-41 -213 -63 -187 -85 -163 C-97 -149 -107 -135 -113 -119" color={pal.gold[1]} width={1.2} />
          <Dots d="M-24 -222 C-40 -204 -60 -180 -80 -158 C-90 -146 -98 -134 -104 -122" size={1.4} gap={4} />
          <Dots d="M-94 -113 C-70 -108 -30 -107 10 -108 C30 -109 44 -110 56 -112" size={1.3} gap={4.2} />
        </>
      )}
    </g>
  );
}

/** Rapek front panel with its uncal pendant, and the front sash; they hang over the belt. */
export function FrontSashArt({ p, pal, sil }: ArtProps) {
  const gold = `url(#${p}-gold)`;
  const accent = `url(#${p}-accent)`;
  return (
    <g>
      <Shape sil={sil} fill={accent} d="M-2 -226 C3 -180 9 -120 13 -62 L20 -44 L27 -62 C31 -120 36 -180 31 -228 Z" />
      {!sil && (
        <>
          <Line d="M2 -222 C6 -180 11 -122 15.5 -66 L20 -54 L24.5 -66 C28 -122 32 -180 28 -224" color={pal.gold[0]} width={1.1} />
          <Dots d="M15 -220 C16.5 -170 18.5 -112 20 -64" size={1.4} gap={4.2} />
          <circle cx={20} cy={-42} r={2.4} fill={gold} stroke={INK} strokeWidth={0.6} />
          <Dots d="M4 -222 C3 -200 3 -172 4 -151" color={pal.gold[0]} size={2.4} gap={4} />
          <circle cx={4} cy={-144} r={4.6} fill={gold} stroke={INK} strokeWidth={0.8} />
          <circle cx={4} cy={-144} r={2} fill={pal.jewel} />
          <path d={drop(4, -139.5, 1.1)} fill={gold} stroke={INK} strokeWidth={0.6} />
        </>
      )}
      <Shape
        sil={sil}
        fill={accent}
        d="M26 -242 C48 -238 66 -224 78 -206 C86 -194 90 -180 92 -166 L84 -172 L82 -158 C78 -178 68 -198 54 -212 C44 -222 34 -228 24 -230 Z"
      />
      {!sil && <Line d="M28 -238 C50 -232 68 -216 82 -194 C86 -186 89 -176 90 -170" color={pal.gold[0]} width={1.1} opacity={0.85} />}
    </g>
  );
}

/* ------------------------------------------------------------------------ */
/* Legs: thigh → shin → foot, each turning about its own pin                 */
/* ------------------------------------------------------------------------ */

interface LegProps extends ArtProps {
  far: boolean;
  thighRef?: Ref<SVGGElement>;
  shinRef?: Ref<SVGGElement>;
  footRef?: Ref<SVGGElement>;
  thighTransform?: string;
  shinTransform?: string;
  footTransform?: string;
}

interface LegShapes {
  /** Patterned trousers. They run up under the kain so a swinging leg never shows a cut edge. */
  thigh: string;
  cuff: string;
  cuffDots: string;
  shin: string;
  shinLine: string;
  anklet: string;
  ankletLine: string;
  foot: string;
  toes: string;
}

const BACK_LEG: LegShapes = {
  thigh: 'M-63 -194 L-25 -192 C-25 -160 -29 -112 -34 -80 L-58 -80 C-62 -112 -64 -160 -63 -194 Z',
  cuff: 'M-59.5 -87 L-32.5 -87 L-33.5 -78 L-58.5 -78 Z',
  cuffDots: 'M-56.5 -82.5 L-35 -82.5',
  shin: SHIN_BACK,
  shinLine: 'M-41 -70 C-42 -56 -44 -44 -46 -32',
  anklet: 'M-58 -32 C-53 -30 -48 -30 -44 -32 L-43.5 -22 C-48 -20 -53 -20 -57.5 -22 Z',
  ankletLine: 'M-57.6 -27 C-53 -25.5 -48 -25.5 -43.8 -27',
  foot: 'M-56 -24 C-63 -17 -67 -9 -66 -3 C-65 0 -61 0 -57 0 L-9 0 C-3 0 -1 -3 -5 -6 C-15 -10 -31 -15 -45 -24 Z',
  toes: 'M-15 -3.5 L-14 0 M-21 -5 L-20 0 M-27 -6.5 L-26 0',
};

const FRONT_LEG: LegShapes = {
  thigh: 'M49 -194 L87 -192 C86 -160 83 -112 82 -80 L58 -80 C54 -112 50 -160 49 -194 Z',
  cuff: 'M56.5 -87 L83.5 -87 L82.5 -78 L57.5 -78 Z',
  cuffDots: 'M59.5 -82.5 L81 -82.5',
  shin: SHIN_FRONT,
  shinLine: 'M77 -72 C77 -58 76 -46 75 -34',
  anklet: 'M64 -32 C69 -30 74 -30 79 -32 L79 -22 C74 -20 69 -20 64.5 -22 Z',
  ankletLine: 'M64.3 -27 C69 -25.5 74 -25.5 78.9 -27',
  foot: 'M66 -24 C60 -17 57 -9 58 -3 C59 0 63 0 67 0 L119 0 C125 0 127 -3 123 -6 C113 -10 95 -15 78 -24 Z',
  toes: 'M107 -3.5 L108 0 M101 -5 L102 0 M95 -6.5 L96 0',
};

export function LegArt({ p, pal, sil, far, thighRef, shinRef, footRef, thighTransform, shinTransform, footTransform }: LegProps) {
  const leg = far ? BACK_LEG : FRONT_LEG;
  const gold = `url(#${p}-gold)`;
  const limb = `url(#${p}-limb)`;
  const tag = far ? 'b' : 'f';
  return (
    <g ref={thighRef} transform={thighTransform}>
      <g ref={shinRef} transform={shinTransform}>
        <Shape sil={sil} fill={limb} d={leg.shin} />
        {!sil && (
          <>
            <Band id={`${p}-shin-${tag}-band`} d={leg.shin} color={pal.gold[2]} width={5} />
            <Line d={leg.shinLine} opacity={0.4} width={0.7} />
          </>
        )}
        <g ref={footRef} transform={footTransform}>
          <Shape sil={sil} fill={gold} d={leg.foot} />
          {!sil && <Line d={leg.toes} width={0.7} opacity={0.7} />}
        </g>
        {!sil && (
          <>
            <Shape sil={false} fill={gold} strokeWidth={0.9} d={leg.anklet} />
            <Line d={leg.ankletLine} color={pal.accent.base} width={1.8} />
          </>
        )}
      </g>
      <Shape sil={sil} fill={`url(#${p}-cindhe)`} d={leg.thigh} />
      {!sil && (
        <>
          <Shape sil={false} fill={gold} strokeWidth={0.9} d={leg.cuff} />
          <Dots d={leg.cuffDots} size={1.4} gap={3.4} />
        </>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------------ */
/* Headdress                                                                 */
/* ------------------------------------------------------------------------ */

const CROWN = 'M25 -404 C21 -422 25 -441 33 -456 C36 -464 37.5 -474 38 -484 C39.5 -474 42 -464 46 -456 C55 -442 60 -421 58 -399 Z';

/** A tall, tiered crown tapering to a finial, worn above the diadem. */
export function CrownArt({ p, pal, sil }: ArtProps) {
  return (
    <g>
      <Shape sil={sil} fill={`url(#${p}-gold)`} d={CROWN} />
      {sil ? (
        <circle cx={38} cy={-488} r={3.4} />
      ) : (
        <>
          <Band id={`${p}-crown-band`} d={CROWN} color={pal.gold[2]} width={6} />
          <Line d="M24 -416 C35 -420 47 -419 59 -414" color={pal.crest} width={3.4} />
          <Dots d="M25 -416 C35 -420 47 -419 58 -414" size={1.3} gap={3.4} />
          <Line d="M26 -432 C35 -437 46 -436 57 -431" color={pal.accent.base} width={2.6} />
          <Dots d="M27 -432 C35 -437 46 -436 56 -431" color={pal.gold[0]} size={1.2} gap={3.2} />
          <Line d="M31 -448 C36 -452 43 -452 50 -448" color={pal.crest} width={2.2} />
          <Line d="M35 -462 C37 -464 40 -464 43 -462" color={pal.gold[2]} width={1.6} />
          {[
            [31, -424],
            [41, -426],
            [51, -423],
          ].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r={2.2} fill={pal.jewel} stroke={pal.gold[0]} strokeWidth={0.7} />
          ))}
          <circle cx={38} cy={-488} r={3.4} fill={`url(#${p}-gold)`} stroke={INK} strokeWidth={0.9} />
          <circle cx={38} cy={-488} r={1.3} fill={pal.jewel} />
        </>
      )}
    </g>
  );
}

const point = (cx: number, cy: number, x: number, y: number, tilt: number) => {
  const cos = Math.cos(tilt * RAD);
  const sin = Math.sin(tilt * RAD);
  return `${(cx + x * cos - y * sin).toFixed(1)} ${(cy + x * sin + y * cos).toFixed(1)}`;
};

/** A tilted oval edged with a ring of small flame-like points. */
function spikedOval(cx: number, cy: number, rx: number, ry: number, tilt: number, spikes: number, depth: number): string {
  const parts: string[] = [];
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * 2 * Math.PI;
    const mid = ((i + 0.5) / spikes) * 2 * Math.PI;
    parts.push(`${i === 0 ? 'M' : 'L'}${point(cx, cy, rx * Math.cos(a), ry * Math.sin(a), tilt)}`);
    parts.push(`L${point(cx, cy, (rx + depth) * Math.cos(mid), (ry + depth) * Math.sin(mid), tilt)}`);
  }
  return `${parts.join(' ')} Z`;
}

function oval(cx: number, cy: number, rx: number, ry: number, tilt: number): string {
  return `M${point(cx, cy, rx, 0, tilt)} A${rx} ${ry} ${tilt} 1 0 ${point(cx, cy, -rx, 0, tilt)} A${rx} ${ry} ${tilt} 1 0 ${point(cx, cy, rx, 0, tilt)} Z`;
}

const FAN = { cx: -56, cy: -412, rx: 40, ry: 64, tilt: -26 } as const;
const FAN_OUTLINE = spikedOval(FAN.cx, FAN.cy, FAN.rx, FAN.ry, FAN.tilt, 34, 9);
const FAN_RIM = oval(FAN.cx, FAN.cy, FAN.rx - 2, FAN.ry - 2, FAN.tilt);
const FAN_FIELD = oval(FAN.cx, FAN.cy, FAN.rx - 10, FAN.ry - 12, FAN.tilt);
const FAN_HEART = oval(FAN.cx, FAN.cy, FAN.rx - 22, FAN.ry - 30, FAN.tilt);
const FAN_STEM = 'M-6 -350 C-18 -362 -26 -374 -30 -388 L-14 -394 C-10 -380 -2 -368 8 -360 Z';

/** The fan-shaped ornament behind the head: a flamed oval, ringed and pierced. */
export function FanArt({ p, pal, sil }: ArtProps) {
  if (sil) {
    return (
      <g>
        <path d={FAN_STEM} />
        <path d={FAN_OUTLINE} />
      </g>
    );
  }
  return (
    <g>
      <Shape sil={false} fill={`url(#${p}-gold)`} d={FAN_STEM} strokeWidth={0.9} />
      <Shape sil={false} fill={`url(#${p}-gold)`} d={FAN_OUTLINE} strokeWidth={1} />
      <path d={FAN_RIM} fill={pal.accent.base} stroke={INK} strokeWidth={0.8} />
      <path d={FAN_FIELD} fill={`url(#${p}-kain)`} stroke={pal.gold[1]} strokeWidth={1.4} />
      <path d={FAN_HEART} fill={pal.accent.base} stroke={pal.gold[0]} strokeWidth={1.2} />
      <Dots d={oval(FAN.cx, FAN.cy, FAN.rx - 5.5, FAN.ry - 6.5, FAN.tilt)} size={1.6} gap={4.6} />
      <Dots d={oval(FAN.cx, FAN.cy, FAN.rx - 16, FAN.ry - 21, FAN.tilt)} color={pal.gold[0]} size={1.4} gap={4} />
      <circle cx={FAN.cx} cy={FAN.cy} r={4.4} fill={`url(#${p}-gold)`} stroke={INK} strokeWidth={0.8} />
      <circle cx={FAN.cx} cy={FAN.cy} r={1.9} fill={pal.jewel} />
    </g>
  );
}

/* ------------------------------------------------------------------------ */
/* Props, drawn in hand coordinates: wrist pin at (0, 0), the hand along +y  */
/* ------------------------------------------------------------------------ */

/** The paddle held in the front hand. */
export function PaddleArt({ pal, sil }: Pick<ArtProps, 'pal' | 'sil'>) {
  const { reach, radius } = PUPPET.paddle;
  const handle = `M-2.6 10 L2.6 10 L3.4 ${reach - radius + 4} L-3.4 ${reach - radius + 4} Z`;
  if (sil) {
    return (
      <g>
        <path d={handle} />
        <circle cx={0} cy={reach} r={radius} />
      </g>
    );
  }
  return (
    <g>
      <path d={handle} fill={pal.paddle.handle} stroke={INK} strokeWidth={0.9} />
      <circle cx={0} cy={reach} r={radius} fill={pal.paddle.face} stroke={pal.paddle.rim} strokeWidth={2.2} />
      <path
        d={`M${-radius * 0.62} ${reach - radius * 0.42} A${radius * 0.76} ${radius * 0.76} 0 0 1 ${radius * 0.3} ${reach - radius * 0.7}`}
        fill="none"
        stroke={pal.hole}
        strokeWidth={1.6}
        strokeLinecap="round"
        opacity={0.28}
      />
    </g>
  );
}

const KERIS_BLADE =
  'M-5 20 C-10 36 3 46 -3 62 C-8 78 4 88 -2 104 C-6 118 2 132 0 154 C7 132 6 118 4 104 C10 88 0 78 4 62 C10 46 -1 36 5 20 Z';
const KERIS_GUARD = 'M-10 15 L9 12 L11 19 L-9 22 Z';
const KERIS_HILT = 'M-3.6 15 C-6.5 9 -5.5 2 -1 -2 C3.5 -3.5 6 1 4.6 6.5 C4 9.5 3.8 12.5 3.8 15 Z';

/** The keris in the back hand, its wavy blade tilted back and down. */
export function KerisArt({ pal, sil }: Pick<ArtProps, 'pal' | 'sil'>) {
  return (
    <g transform={`rotate(${PUPPET.sword.tilt})`}>
      <Shape sil={sil} fill={pal.blade.metal} d={KERIS_BLADE} strokeWidth={0.9} />
      {!sil && <Line d="M0 26 C-4 40 4 48 0 62 C-4 76 4 86 0 100 C-2 114 1 128 0 146" color={pal.blade.edge} width={0.9} opacity={0.7} />}
      <Shape sil={sil} fill={pal.blade.hilt} d={KERIS_GUARD} strokeWidth={0.9} />
      <Shape sil={sil} fill={pal.blade.hilt} d={KERIS_HILT} strokeWidth={0.9} />
    </g>
  );
}
