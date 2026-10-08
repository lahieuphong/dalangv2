export type PuppetVariant = 'satria' | 'raja';

/** `painted`: the bright miniature over the camera. `shadow`: the dark, translucent leather on the stage. */
export type PuppetSkin = 'painted' | 'shadow';

export interface PuppetPalette {
  /** Outlines and solid black details. */
  ink: string;
  /** Tatahan: the punched perforations. */
  hole: string;
  /** The white of the eye. */
  eye: string;
  face: readonly [top: string, bottom: string];
  faceLight: string;
  /** Prada gilding, light → dark → light again for a metallic sheen. */
  gold: readonly [string, string, string, string];
  /** Darker gilding for the far arm. */
  goldShade: readonly [string, string];
  hair: string;
  kain: { base: string; motif: string; border: string; pattern: 'parang' | 'kawung' };
  /** Sashes, belt, front panel and necklace. */
  accent: { base: string; light: string };
  trousers: { base: string; motif: string };
  jewel: string;
  /** Headdress details. */
  crest: string;
  paddle: { face: string; rim: string; handle: string };
  /** The keris in the back hand. */
  blade: { metal: string; edge: string; hilt: string };
}

/** Stage-left hero: terracotta face, red parang kain, green sashes, a pointed crown. */
const satria: PuppetPalette = {
  ink: '#2a1108',
  hole: '#f8e9c0',
  eye: '#f6ead0',
  face: ['#B83D31', '#8A2620'],
  faceLight: '#d6674d',
  gold: ['#EDCC84', '#D5AE62', '#AE833E', '#DFB86A'],
  goldShade: ['#B48A4A', '#7A5326'],
  hair: '#170a05',
  kain: { base: '#A5322D', motif: '#D9B266', border: '#1E5E44', pattern: 'parang' },
  accent: { base: '#1F6B4A', light: '#3F9A70' },
  trousers: { base: '#712019', motif: '#D5AE62' },
  jewel: '#B33A30',
  crest: '#1F6B4A',
  paddle: { face: '#C8372B', rim: '#5d140f', handle: '#C99C58' },
  blade: { metal: '#B9BEC0', edge: '#EFE6C8', hilt: '#7A4A22' },
};

/** Stage-right rival: darker red face, oxblood kawung kain, red sashes, tall crown and praba. */
const raja: PuppetPalette = {
  ink: '#2a1108',
  hole: '#f8e9c0',
  eye: '#f6ead0',
  face: ['#AE372D', '#712019'],
  faceLight: '#cf5b44',
  gold: ['#E8C47A', '#C89A48', '#9C7031', '#D8AE60'],
  goldShade: ['#A97F42', '#6E4A1E'],
  hair: '#160804',
  kain: { base: '#712019', motif: '#D5AE62', border: '#1E3E59', pattern: 'kawung' },
  accent: { base: '#A5322D', light: '#C4553F' },
  trousers: { base: '#1E3E59', motif: '#D0A458' },
  jewel: '#244A68',
  crest: '#1E3E59',
  paddle: { face: '#C8372B', rim: '#5d140f', handle: '#C99C58' },
  blade: { metal: '#B9BEC0', edge: '#EFE6C8', hilt: '#7A4A22' },
};

/**
 * The same drawing as carved leather seen against the lamp: everything is a
 * shade of dark sepia, and only the perforations let the light through.
 */
const leather = {
  ink: '#0d0906',
  hole: '#ecd092',
  eye: '#cdb489',
  face: ['#3d2f21', '#2a1f15'],
  faceLight: '#6e5940',
  gold: ['#4e3d2b', '#3f3124', '#2b2017', '#47382b'],
  goldShade: ['#33271b', '#211810'],
  hair: '#0e0906',
  accent: { base: '#1b130c', light: '#58442f' },
  trousers: { base: '#2f2318', motif: '#7d6546' },
  jewel: '#957852',
  crest: '#17100a',
  paddle: { face: '#120c07', rim: '#060403', handle: '#2c2015' },
  blade: { metal: '#1c140d', edge: '#5d4a33', hilt: '#3a2b1d' },
} as const satisfies Omit<PuppetPalette, 'kain'>;

const satriaShadow: PuppetPalette = { ...leather, kain: { base: '#271d13', motif: '#73603f', border: '#120c07', pattern: 'parang' } };
const rajaShadow: PuppetPalette = { ...leather, kain: { base: '#221910', motif: '#775f40', border: '#120c07', pattern: 'kawung' } };

export const PALETTES: Record<PuppetSkin, Record<PuppetVariant, PuppetPalette>> = {
  painted: { satria, raja },
  shadow: { satria: satriaShadow, raja: rajaShadow },
};
