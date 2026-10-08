import type { Ref } from 'react';
import type { PuppetPalette } from './palettes';

/**
 * Wayang Kulit–inspired puppet artwork, drawn facing right with the feet on
 * y = 0 (see motion/PuppetRig.ts for the rig dimensions). The heads, arms and
 * hands come from DALANG V1; the body, legs and props are in BodyParts.tsx.
 *
 * Proportions follow the wayang purwa convention: a small profile head pushed
 * forward on a long slanting neck, a frontal chest with broad shoulders and a
 * narrow waist, a dodot whose back flap sweeps into a point, and very long
 * arms that reach the knees.
 *
 * Every part renders in two modes: painted, or `sil` (silhouette) where only
 * the outline shapes are emitted with no fill so they inherit one flat colour.
 * Painted artwork takes every colour from a palette, so the same drawing is
 * the bright miniature over the camera and the dark leather on the stage.
 *
 * Fine cream dots imitate tatahan, the punched perforations of leather
 * puppets; stacked strokes imitate sunggingan, the graded colour bands.
 */

/** Outline colour. Inherited from the puppet's root group (`color`), so one drawing serves every skin. */
export const INK = 'currentColor';
/** Perforation colour, likewise inherited (`--puppet-hole` on the root group). */
const HOLE_STYLE = { stroke: 'var(--puppet-hole)' } as const;

export interface ArtProps {
  /** Prefix for this puppet's gradient and pattern ids. */
  p: string;
  pal: PuppetPalette;
  sil: boolean;
}

interface ShapeProps {
  sil: boolean;
  d: string;
  fill: string;
  strokeWidth?: number;
}

export function Shape({ sil, d, fill, strokeWidth = 1.2 }: ShapeProps) {
  if (sil) return <path d={d} />;
  return <path d={d} fill={fill} stroke={INK} strokeWidth={strokeWidth} strokeLinejoin="round" />;
}

export function Dots({ d, color, size = 1.6, gap = 4.4 }: { d: string; color?: string; size?: number; gap?: number }) {
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      style={color ? undefined : HOLE_STYLE}
      strokeWidth={size}
      strokeLinecap="round"
      strokeDasharray={`0.01 ${gap}`}
    />
  );
}

export function Line({ d, color = INK, width = 0.9, opacity }: { d: string; color?: string; width?: number; opacity?: number }) {
  return (
    <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />
  );
}

/** Sunggingan: a darker band just inside an outline, clipped so it never spills outside. */
export function Band({ id, d, color, width = 7, opacity = 0.5 }: { id: string; d: string; color: string; width?: number; opacity?: number }) {
  return (
    <>
      <clipPath id={id}>
        <path d={d} />
      </clipPath>
      <path d={d} fill="none" stroke={color} strokeWidth={width} opacity={opacity} clipPath={`url(#${id})`} />
    </>
  );
}

export const TORSO =
  'M10 -306 C-8 -308 -28 -308 -44 -303 C-52 -300 -52 -290 -46 -280 C-38 -266 -30 -248 -24 -230 L20 -232 C27 -248 38 -264 48 -278 C54 -288 56 -298 50 -304 C42 -307 36 -307 30 -307 Z';
export const NECK =
  'M12 -305 C18 -318 26 -332 34 -344 L52 -336 C44 -326 36 -316 32 -305 Z';
const SATRIA_FACE =
  'M26 -394 L54 -396 C67 -384 83 -369 102 -355 C96 -350 90 -349 85 -350 C86 -347 87 -345 85 -343 L81 -342 C84 -340 84 -338 81 -336 C79 -333 77 -331 72 -331 C62 -331 50 -330 40 -334 L30 -344 C24 -360 22 -378 26 -394 Z';
const RAJA_FACE =
  'M27 -397 L52 -399 C61 -392 70 -381 80 -370 C88 -363 98 -358 108 -359 C107 -353 101 -350 93 -350 C92 -346 92 -343 89 -341 L84 -340 C86 -337 85 -333 81 -331 C71 -328 55 -328 42 -333 L31 -344 C25 -360 23 -381 27 -397 Z';
const UPPER_ARM =
  'M-11 -1 C-11 -15 11 -15 11 -1 C10 34 7 74 6 104 C6 112 -6 112 -6 104 C-7 74 -10 34 -11 -1 Z';
const FOREARM =
  'M-6 -6 C-6 28 -5 64 -4 98 C-4 104 4 104 4 98 C5 64 6 28 6 -6 C6 -12 -6 -12 -6 -6 Z';
export const SHIN_BACK =
  'M-55 -84 C-59 -62 -59 -42 -56 -22 L-45 -22 C-43 -42 -40 -62 -37 -84 Z';
export const SHIN_FRONT =
  'M61 -84 C63 -62 66 -42 66 -22 L78 -22 C80 -42 80 -64 80 -84 Z';

export const drop = (x: number, y: number, size = 1) =>
  `M${x} ${y} c${-2 * size} ${3 * size} ${-2 * size} ${6 * size} 0 ${8 * size} c${2 * size} ${-2 * size} ${2 * size} ${-5 * size} 0 ${-8 * size}z`;

/* ------------------------------------------------------------------------ */
/* Paint definitions                                                         */
/* ------------------------------------------------------------------------ */

export function PuppetDefs({ p, pal }: { p: string; pal: PuppetPalette }) {
  const wave = 'M0 8 C2.5 2 5.5 2 8 8 S13.5 14 16 8';
  return (
    <defs>
      <linearGradient id={`${p}-gold`} x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0" stopColor={pal.gold[0]} />
        <stop offset="0.42" stopColor={pal.gold[1]} />
        <stop offset="0.78" stopColor={pal.gold[2]} />
        <stop offset="1" stopColor={pal.gold[3]} />
      </linearGradient>
      <linearGradient id={`${p}-limb`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={pal.gold[2]} />
        <stop offset="0.42" stopColor={pal.gold[0]} />
        <stop offset="0.72" stopColor={pal.gold[1]} />
        <stop offset="1" stopColor={pal.gold[2]} />
      </linearGradient>
      <linearGradient id={`${p}-shade`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={pal.goldShade[1]} />
        <stop offset="0.45" stopColor={pal.goldShade[0]} />
        <stop offset="1" stopColor={pal.goldShade[1]} />
      </linearGradient>
      <linearGradient id={`${p}-face`} x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor={pal.face[0]} />
        <stop offset="1" stopColor={pal.face[1]} />
      </linearGradient>
      <linearGradient id={`${p}-accent`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={pal.accent.light} />
        <stop offset="0.6" stopColor={pal.accent.base} />
        <stop offset="1" stopColor={pal.accent.base} />
      </linearGradient>
      <linearGradient id={`${p}-rod`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#120a06" />
        <stop offset="0.42" stopColor="#4a3020" />
        <stop offset="1" stopColor="#160d08" />
      </linearGradient>
      <linearGradient id={`${p}-crest`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={pal.crest} stopOpacity="0.85" />
        <stop offset="1" stopColor={pal.crest} />
      </linearGradient>
      {pal.kain.pattern === 'parang' ? (
        /* Parang batik: diagonal rows of S-shaped bands. */
        <pattern id={`${p}-kain`} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)">
          <rect width="16" height="16" fill={pal.kain.base} />
          <path d={wave} fill="none" stroke={pal.kain.motif} strokeWidth="2.8" />
          <path d={wave} fill="none" stroke={pal.kain.base} strokeWidth="0.9" />
          <circle cx="4" cy="13.4" r="1.05" fill={pal.kain.motif} />
          <circle cx="12" cy="2.6" r="1.05" fill={pal.kain.motif} />
        </pattern>
      ) : (
        /* Kawung batik: four-petal palm-fruit motif on a diagonal grid. */
        <pattern id={`${p}-kain`} width="13" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="13" height="13" fill={pal.kain.base} />
          <g fill={pal.kain.motif}>
            <ellipse cx="6.5" cy="2.9" rx="2" ry="2.9" />
            <ellipse cx="6.5" cy="10.1" rx="2" ry="2.9" />
            <ellipse cx="2.9" cy="6.5" rx="2.9" ry="2" />
            <ellipse cx="10.1" cy="6.5" rx="2.9" ry="2" />
          </g>
          <circle cx="6.5" cy="6.5" r="0.9" fill={pal.kain.base} />
          <circle cx="0" cy="0" r="1" fill={pal.kain.motif} />
          <circle cx="13" cy="13" r="1" fill={pal.kain.motif} />
        </pattern>
      )}
      {/* Cindhe: small lozenges for the trousers. */}
      <pattern id={`${p}-cindhe`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" fill={pal.trousers.base} />
        <path d="M3.5 1.4 L5.6 3.5 L3.5 5.6 L1.4 3.5 Z" fill={pal.trousers.motif} opacity="0.85" />
      </pattern>
      {/* Pleated wiron fold: fine stripes in the border colour. */}
      <pattern id={`${p}-wiron`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
        <rect width="5" height="5" fill={pal.kain.border} />
        <rect width="1.4" height="5" fill={pal.gold[1]} opacity="0.9" />
      </pattern>
    </defs>
  );
}

/* ------------------------------------------------------------------------ */
/* Body                                                                      */
/* ------------------------------------------------------------------------ */

export function PrabaArt({ p, pal, sil }: ArtProps) {
  return (
    <g>
      <Shape
        sil={sil}
        fill={`url(#${p}-gold)`}
        d="M-22 -306 C-42 -330 -68 -344 -96 -342 C-116 -340 -128 -324 -124 -306 C-120 -292 -106 -284 -92 -286 C-102 -296 -103 -308 -93 -314 C-81 -320 -64 -314 -52 -302 C-44 -294 -35 -288 -26 -286 Z"
      />
      {!sil && (
        <>
          <path
            d="M-32 -301 C-50 -320 -72 -332 -94 -330 C-108 -328 -116 -318 -114 -306 C-108 -313 -100 -318 -90 -319 C-74 -320 -56 -310 -42 -296 Z"
            fill={pal.kain.base}
            stroke={INK}
            strokeWidth={0.8}
          />
          <Dots d="M-28 -303 C-46 -325 -70 -337 -94 -337 C-110 -336 -120 -324 -119 -310" />
          {[
            [-62, -323],
            [-80, -327],
            [-98, -324],
          ].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r={2.7} fill={pal.accent.light} stroke={pal.gold[0]} strokeWidth={0.9} />
          ))}
          <Line d="M-92 -286 C-101 -292 -101 -303 -92 -305 C-85 -306 -83 -298 -89 -296" color={pal.gold[0]} width={1.3} />
        </>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------------ */
/* Heads                                                                     */
/* ------------------------------------------------------------------------ */

export function SatriaHead({ p, pal, sil }: ArtProps) {
  const gold = `url(#${p}-gold)`;
  return (
    <g>
      <Shape sil={sil} fill={pal.hair} d="M28 -398 C12 -394 5 -378 8 -361 C10 -349 18 -339 30 -336 L36 -346 C28 -360 26 -380 30 -396 Z" />
      {/* Gelung supit urang: hair bun with two backward "shrimp claw" curls */}
      <Shape
        sil={sil}
        fill={pal.hair}
        d="M-28 -416 C-46 -416 -60 -405 -62 -392 C-62 -383 -54 -379 -47 -383 C-42 -387 -46 -394 -51 -392 C-47 -401 -37 -405 -25 -403 Z"
      />
      <Shape
        sil={sil}
        fill={pal.hair}
        d="M-12 -445 C-30 -458 -54 -452 -62 -436 C-66 -426 -60 -417 -51 -419 C-44 -421 -45 -431 -52 -431 C-46 -440 -30 -441 -18 -431 Z"
      />
      <Shape
        sil={sil}
        fill={pal.hair}
        d="M54 -399 C59 -415 53 -432 39 -443 C23 -454 0 -454 -15 -446 C-28 -438 -34 -425 -32 -411 C-30 -400 -20 -394 -6 -396 L28 -401 Z"
      />
      {/* Jungkat comb lying along the front of the bun */}
      <Shape sil={sil} fill={gold} d="M44 -414 C52 -420 56 -430 55 -440 C49 -434 44 -426 40 -419 Z" />
      <Shape
        sil={sil}
        fill={gold}
        d="M-16 -437 C-30 -437 -40 -428 -42 -417 C-43 -409 -38 -403 -31 -403 C-34 -409 -32 -415 -26 -417 C-30 -411 -26 -405 -20 -405 C-14 -411 -11 -424 -16 -437 Z"
      />
      {!sil && (
        <>
          <Line d="M-16 -440 C-32 -450 -50 -446 -56 -434" color={pal.gold[1]} opacity={0.6} />
          <Line d="M-30 -410 C-44 -410 -54 -402 -56 -392" color={pal.gold[1]} opacity={0.6} />
          <Dots d="M50 -414 C48 -428 38 -440 22 -446 C8 -450 -6 -448 -16 -442" color={pal.gold[0]} size={1.8} />
          <Dots d="M30 -404 C12 -404 -6 -404 -22 -408" color={pal.gold[0]} size={1.5} gap={4} />
          <path d="M-20 -430 C-28 -428 -34 -422 -34 -415 C-30 -419 -26 -421 -22 -420 Z" fill={pal.accent.base} />
          <circle cx={-24} cy={-426} r={1.3} fill={INK} />
          <Line d="M46 -420 C50 -426 52 -432 52 -437" color={pal.accent.base} width={1.2} />
        </>
      )}

      {/* Face: refined profile with the long, pointed nose of a satria */}
      <Shape
        sil={sil}
        fill={`url(#${p}-face)`}
        d={SATRIA_FACE}
      />
      {!sil && (
        <>
          <Band id={`${p}-face-band`} d={SATRIA_FACE} color={pal.face[1]} width={7} opacity={0.6} />
          <Line d="M57 -391 C69 -380 84 -367 98 -357" color={pal.faceLight} width={2.4} opacity={0.55} />
          <Line d="M89 -352.5 C91 -354.5 94 -354.5 95.5 -352.5" />
          <Line d="M80.5 -342.3 L86 -343.4" />
          <path d="M58 -369 C64 -374.5 74 -373 83 -366 C74 -365.5 64 -365.5 58 -369 Z" fill={pal.eye} stroke={INK} strokeWidth={1} />
          <circle cx={76} cy={-368.3} r={1.7} fill={INK} />
          <Line d="M56.5 -369.5 C64 -376.5 75 -375 84.5 -366" width={1.6} />
          <path d="M51 -378 C61 -385 74 -382 86 -372.5 C74 -378.5 62 -380.5 51 -376 Z" fill={INK} />
          <Line d="M32 -382 C27 -372 27 -360 31 -351 C33 -347 31 -343 27 -345" color={pal.hair} width={3.2} />
          <Dots d="M42 -338 C52 -334.5 62 -334 70 -334.5" color={pal.faceLight} size={1.2} gap={3.6} />
        </>
      )}

      {/* Jamang diadem */}
      <Shape sil={sil} fill={gold} d="M24 -405 C36 -406 48 -404 59 -399 L57 -390 C46 -395 35 -397 24 -397 Z" />
      {!sil && (
        <>
          <Line d="M25 -401 C36 -402 47 -400.5 57.5 -395" color={pal.accent.base} width={2} />
          <Dots d="M26 -401 C36 -402 46 -400.6 56 -395.6" size={1.3} gap={3.6} />
        </>
      )}

      {/* Sumping ear ornament, earring */}
      <Shape
        sil={sil}
        fill={gold}
        d="M35 -372 C22 -378 4 -372 -10 -360 C-20 -352 -26 -340 -28 -330 C-18 -338 -6 -346 8 -352 C18 -356 28 -358 35 -360 Z"
      />
      {!sil && (
        <>
          <path
            d="M30 -368 C18 -371 4 -366 -6 -357 C-13 -351 -18 -344 -20 -338 C-12 -344 -2 -350 10 -355 C18 -358 25 -360 30 -362 Z"
            fill={pal.accent.base}
          />
          <Dots d="M30 -365 C16 -365 2 -358 -14 -342" size={1.5} gap={3.8} />
          <Line d="M35 -362 L34.5 -352" color={pal.gold[1]} width={1.2} />
          <path d={drop(34.5, -352, 0.9)} fill={gold} stroke={INK} strokeWidth={0.5} />
          <circle cx={35} cy={-366} r={4.2} fill={gold} stroke={INK} strokeWidth={0.9} />
          <circle cx={35} cy={-366} r={1.8} fill={pal.jewel} />
        </>
      )}
    </g>
  );
}

export function RajaHead({ p, pal, sil }: ArtProps) {
  const gold = `url(#${p}-gold)`;
  return (
    <g>
      <Shape sil={sil} fill={pal.hair} d="M28 -398 C12 -394 5 -378 8 -361 C10 -349 18 -339 30 -336 L36 -346 C28 -360 26 -380 30 -396 Z" />
      {/* Loose curling hair down the back */}
      <Shape
        sil={sil}
        fill={pal.hair}
        d="M16 -374 C-2 -362 -12 -344 -14 -326 C-15 -314 -10 -305 -2 -307 C3 -309 1 -316 -3 -316 C-2 -327 5 -340 16 -350 Z"
      />
      <Shape
        sil={sil}
        fill={pal.hair}
        d="M10 -356 C-6 -346 -18 -330 -22 -314 C-24 -305 -18 -298 -11 -301 C-7 -303 -9 -309 -13 -308 C-11 -320 -3 -333 9 -342 Z"
      />
      {/* Plume sweeping back from the crown */}
      <Shape
        sil={sil}
        fill={`url(#${p}-crest)`}
        d="M22 -436 C6 -447 -16 -449 -33 -439 C-44 -431 -47 -416 -40 -405 C-35 -412 -26 -417 -16 -417 C-5 -417 8 -414 20 -409 Z"
      />
      {/* Makutha crown, its peak curling backward */}
      <Shape
        sil={sil}
        fill={gold}
        d="M22 -402 C16 -424 13 -448 14 -466 C14 -476 10 -482 3 -487 C16 -490 29 -485 39 -475 C51 -463 62 -450 64 -432 C65 -418 61 -408 60 -400 Z"
      />
      {/* Garuda mungkur: a backward-facing garuda at the base of the crown */}
      <Shape
        sil={sil}
        fill={gold}
        d="M22 -416 C5 -418 -13 -416 -28 -405 C-37 -398 -41 -387 -37 -378 C-33 -384 -27 -387 -20 -385 C-24 -379 -22 -372 -16 -370 C-10 -379 1 -389 22 -396 Z"
      />
      {!sil && (
        <>
          <Dots d="M-6 -340 C-9 -330 -10 -320 -8 -312 M-14 -328 C-17 -320 -18 -312 -16 -306" color={pal.gold[0]} size={1.8} gap={6} />
          <Line d="M-38 -409 C-44 -419 -38 -431 -28 -431 C-20 -431 -18 -423 -24 -421" color={pal.gold[0]} width={1.2} />
          <Dots d="M18 -435 C4 -443 -14 -444 -28 -437" color={pal.gold[0]} size={1.6} />
          <Line d="M21.5 -411 C34 -413.5 48 -412.5 60.5 -408" color={pal.kain.base} width={5} />
          <Dots d="M23 -411.2 C34 -413.4 48 -412.4 59 -408.4" size={1.4} gap={3.6} />
          {[
            [26, -428],
            [37, -431],
            [48, -430],
            [58, -425],
          ].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r={2.8} fill={pal.jewel} stroke={pal.gold[0]} strokeWidth={0.8} />
          ))}
          <Line d="M17 -447 C30 -452 46 -450 60 -443" color={pal.crest} width={3.6} />
          <Dots d="M18 -447.2 C30 -451.8 46 -449.8 59 -443.4" color={pal.gold[0]} size={1.4} gap={3.4} />
          <Line d="M18 -462 C24 -470 32 -474 40 -472" color={pal.kain.base} width={2.4} />
          <Line d="M30 -416 C27 -436 28 -456 32 -470" opacity={0.35} width={0.7} />
          <Line d="M48 -414 C50 -432 50 -450 46 -464" opacity={0.35} width={0.7} />
          <circle cx={6} cy={-484} r={2.4} fill={pal.jewel} stroke={pal.gold[0]} strokeWidth={0.8} />
          <path
            d="M14 -411 C0 -411 -14 -407 -24 -399 C-30 -394 -32 -388 -30 -383 C-25 -388 -18 -391 -10 -392 C0 -395 8 -399 14 -402 Z"
            fill={pal.kain.base}
          />
          <circle cx={-22} cy={-396} r={1.6} fill={INK} />
          <Line d="M-37 -378 C-40 -372 -36 -368 -32 -370" color={pal.gold[0]} width={1.2} />
        </>
      )}

      {/* Face: bolder, upturned profile with a round eye and a curled moustache */}
      <Shape
        sil={sil}
        fill={`url(#${p}-face)`}
        d={RAJA_FACE}
      />
      {!sil && (
        <>
          <Band id={`${p}-face-band`} d={RAJA_FACE} color={pal.face[1]} width={7} opacity={0.6} />
          <Line d="M55 -394 C64 -385 72 -375 82 -367 C90 -361 98 -360 104 -360" color={pal.faceLight} width={2.4} opacity={0.5} />
          <circle cx={68} cy={-371} r={5.4} fill={pal.eye} stroke={INK} strokeWidth={1.2} />
          <circle cx={70.2} cy={-371} r={2.7} fill={INK} />
          <Line d="M61 -374 C64 -379 72 -380 76 -374" width={1.8} />
          <path d="M55 -382 C63 -390 76 -388 85 -378 C76 -384 64 -385 55 -379 Z" fill={INK} />
          <Line d="M95 -353 C97 -355 100 -355 101.5 -353" />
          <path d="M93 -350 C86 -349 77 -348.5 70 -350 C66 -351 64 -354 66 -357 C67 -353.5 70 -352.5 74 -352.6 C80 -352.6 87 -352 93 -350 Z" fill={INK} />
          <Line d="M84 -340 L89 -341.5" width={1} />
          <Dots d="M44 -336 C56 -331.5 70 -330.5 81 -333" color={INK} size={1.7} gap={3} />
          <Dots d="M46 -340 C56 -336 66 -335.5 74 -337" color={INK} size={1.4} gap={3.2} />
        </>
      )}

      {/* Jamang with three turida points */}
      <Shape sil={sil} fill={gold} d="M23 -406 L60 -401 L58 -392 L23 -397 Z" />
      <Shape sil={sil} fill={gold} d="M29 -405 L33 -415 L37 -404.5 Z M40 -404 L45 -414 L49 -403 Z M51 -402.5 L57 -411 L59.5 -401.5 Z" />
      {!sil && <Line d="M24 -401.5 L58.5 -396.5" color={pal.kain.base} width={2} />}

      {/* Sumping, larger and more flamboyant than the satria's */}
      <Shape
        sil={sil}
        fill={gold}
        d="M34 -373 C20 -381 -2 -378 -18 -364 C-30 -354 -36 -338 -36 -326 C-26 -336 -14 -344 2 -350 C14 -355 26 -358 34 -360 Z"
      />
      {!sil && (
        <>
          <path
            d="M29 -369 C16 -374 0 -371 -12 -361 C-21 -354 -26 -344 -28 -336 C-19 -344 -8 -350 4 -354 C14 -357 22 -359 29 -362 Z"
            fill={pal.accent.base}
          />
          <Dots d="M29 -365 C14 -366 -2 -360 -20 -342" size={1.5} gap={3.8} />
          <Line d="M34 -361 L33.5 -351" color={pal.gold[1]} width={1.2} />
          <path d={drop(33.5, -351, 0.9)} fill={gold} stroke={INK} strokeWidth={0.5} />
          <circle cx={34} cy={-366} r={4.6} fill={gold} stroke={INK} strokeWidth={0.9} />
          <circle cx={34} cy={-366} r={2} fill={pal.jewel} />
        </>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------------ */
/* Arms: drawn hanging straight down from their own pivot at (0, 0)          */
/* ------------------------------------------------------------------------ */

interface LimbProps extends ArtProps {
  far: boolean;
}

export function UpperArmArt({ p, pal, sil, far }: LimbProps) {
  return (
    <g>
      <Shape
        sil={sil}
        fill={far ? `url(#${p}-shade)` : `url(#${p}-limb)`}
        d={UPPER_ARM}
      />
      {/* Kelat bahu armband with a small naga wing */}
      <Shape sil={sil} fill={`url(#${p}-gold)`} d="M-9 16 C-17 10 -24 10 -30 4 C-28 13 -22 20 -10 27 Z" />
      {!sil && (
        <>
          <Band id={`${p}-${far ? 'b' : 'f'}-upper-band`} d={UPPER_ARM} color={far ? pal.goldShade[1] : pal.gold[2]} width={6} />
          <path d="M-12 18 C-17 14.5 -21 13.5 -25 10 C-22.5 16 -18 19.5 -12 23 Z" fill={pal.accent.base} />
          <path d="M-10.6 15 C-4 13 4 12 10.4 13 L9.7 30 C3 29 -3 30 -9.9 32 Z" fill={pal.accent.base} stroke={INK} strokeWidth={0.9} />
          <Line d="M-10.4 16.5 C-4 14.5 4 13.5 10.3 14.5" color={pal.gold[0]} width={1.4} />
          <Line d="M-9.8 30.5 C-3 28.5 3 27.5 9.6 28.5" color={pal.gold[0]} width={1.4} />
          <Dots d="M-8.6 22.6 L8.8 21.4" size={1.5} gap={3.4} />
          <Line d="M5 40 C4 60 3 80 2 98" opacity={0.35} width={0.7} />
          <Dots d="M-1 40 C-1 60 -1 80 0 96" size={1.1} gap={5} />
        </>
      )}
    </g>
  );
}

export function ForearmArt({ p, pal, sil, far }: LimbProps) {
  return (
    <g>
      <Shape
        sil={sil}
        fill={far ? `url(#${p}-shade)` : `url(#${p}-limb)`}
        d={FOREARM}
      />
      {!sil && (
        <>
          <Band id={`${p}-${far ? 'b' : 'f'}-fore-band`} d={FOREARM} color={far ? pal.goldShade[1] : pal.gold[2]} width={4} />
          <path d="M-5.4 82 L5.4 82 L4.9 95 L-4.9 95 Z" fill={`url(#${p}-gold)`} stroke={INK} strokeWidth={0.8} />
          <Line d="M-5.1 88.5 L5.1 88.5" color={pal.accent.base} width={2} />
          <circle r={2.6} fill={pal.gold[2]} stroke={INK} strokeWidth={0.8} />
          <circle r={0.9} fill={INK} />
        </>
      )}
    </g>
  );
}

interface HandArtProps extends LimbProps {
  /** The four-finger blade's group, curled at the knuckles by the rig. */
  fingersRef?: Ref<SVGGElement>;
  fingersTransform?: string;
}

/**
 * A long, elegant wayang hand: four fingers held together as one blade that
 * can curl at the knuckles, and a thumb turned out from the palm.
 */
export function HandArt({ p, sil, far, fingersRef, fingersTransform }: HandArtProps) {
  const fill = far ? `url(#${p}-shade)` : `url(#${p}-limb)`;
  return (
    <g>
      <g ref={fingersRef} transform={fingersTransform}>
        <Shape sil={sil} fill={fill} d="M-5.6 19.5 C-4.5 34 -2 46 2 56 C3.5 59 6.5 58 6.8 54 C7 44 6.5 32 6.1 19.5 Z" />
        {!sil && (
          <>
            <Line d="M-1.6 24 C-0.6 36 0.8 46 3.2 54" width={0.55} opacity={0.5} />
            <Line d="M1.8 23 C2.8 34 3.8 44 5 52" width={0.55} opacity={0.5} />
          </>
        )}
      </g>
      <Shape
        sil={sil}
        fill={fill}
        d="M-4.5 -3 C-6 6 -6.5 14 -5.5 22 L6 22 C9 21 13 22 17.5 25 C19.5 26 20 24 18.5 22.5 C14 18 9.5 12 5.5 6 C5 2 4.5 -1 4.5 -3 Z"
      />
      {!sil && <Line d="M7 21 C10 20.5 13.5 21.5 16.5 23.5" width={0.55} opacity={0.45} />}
    </g>
  );
}
