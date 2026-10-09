import { DEFAULT_FINGER_MAP } from '../motion/PuppetMapping';
import { DEFAULT_RALLY_ASSIST, RALLY_ASSIST_MODES, type RallyAssistMode } from '../scene/RallyAssist';
import { isSimScript, type SimScript } from '../tracking/SimulatedHands';
import { FINGER_NAMES, JOINT_CHANNELS, type FingerMap, type FingerName, type QualityPreset } from '../types';

export interface Settings {
  /* Camera */
  cameraEnabled: boolean;
  /** Preferred camera; null lets the browser choose. */
  deviceId: string | null;
  mirror: boolean;

  /* Tracking */
  /** MediaPipe thresholds, 0.3..0.9. */
  detectionConfidence: number;
  trackingConfidence: number;
  /** Gains, each 0..1 on its slider (0.5 = default). Sensitivity is how far the puppet moves, never how slowly. */
  fingerSensitivity: number;
  palmSensitivity: number;
  pinchSensitivity: number;
  rollSensitivity: number;
  depthSensitivity: number;
  /** Filtering, 0..1: how firmly a resting hand is held still. */
  smoothing: number;
  /** How long a pose is held after the hand drops out before the puppet eases back to rest, ms. */
  holdMs: number;

  /* Display */
  showSkeleton: boolean;
  showMiniPuppets: boolean;
  showFingerMonitor: boolean;
  showStatusHud: boolean;
  showDiagHud: boolean;
  quality: QualityPreset;

  /* Interaction */
  swapHands: boolean;
  invertY: boolean;
  /** Let the stage agent pick up the free puppet for a rally when only one hand plays. */
  agentPartner: boolean;
  /** How forgiving a paddle contact is and how much a return is nudged toward the table. */
  rallyAssist: RallyAssistMode;
  fingerMap: FingerMap;
}

/** Bumped when the defaults change meaningfully, so old saved values don't mask them. */
const STORAGE_KEY = 'dalangv2.settings.v1';

function defaultQuality(): QualityPreset {
  if (typeof window === 'undefined') return 'balanced';
  const small = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const cores = navigator.hardwareConcurrency ?? 8;
  return small || cores <= 4 ? 'performance' : 'balanced';
}

export const DEFAULT_SETTINGS: Settings = {
  cameraEnabled: true,
  deviceId: null,
  mirror: true,
  detectionConfidence: 0.55,
  trackingConfidence: 0.5,
  // Tuned so the defaults are already fast and lively; no slider is needed to get a responsive puppet.
  fingerSensitivity: 0.5,
  palmSensitivity: 0.5,
  pinchSensitivity: 0.5,
  rollSensitivity: 0.5,
  depthSensitivity: 0.5,
  smoothing: 0.3,
  holdMs: 300,
  showSkeleton: true,
  showMiniPuppets: true,
  showFingerMonitor: true,
  showStatusHud: true,
  showDiagHud: true,
  quality: defaultQuality(),
  swapHands: false,
  invertY: false,
  agentPartner: true,
  rallyAssist: DEFAULT_RALLY_ASSIST,
  fingerMap: DEFAULT_FINGER_MAP,
};

const QUALITIES: readonly QualityPreset[] = ['performance', 'balanced', 'quality'];

const inRange = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && value >= min && value <= max;

function parseFingerMap(value: unknown): FingerMap {
  if (!value || typeof value !== 'object') return DEFAULT_FINGER_MAP;
  const record = value as Record<string, unknown>;
  const map = {} as FingerMap;
  const used = new Set<FingerName>();
  for (const channel of JOINT_CHANNELS) {
    const finger = record[channel] as FingerName;
    // Every joint needs its own finger: a mapping that reuses one is not a mapping.
    if (!FINGER_NAMES.includes(finger) || used.has(finger)) return DEFAULT_FINGER_MAP;
    used.add(finger);
    map[channel] = finger;
  }
  return map;
}

/** Reads saved preferences, ignoring anything malformed. Permission state is never stored. */
export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    const d = DEFAULT_SETTINGS;
    const flag = (key: keyof Settings) => (typeof saved[key] === 'boolean' ? (saved[key] as boolean) : (d[key] as boolean));
    const unit = (key: keyof Settings) => (inRange(saved[key], 0, 1) ? (saved[key] as number) : (d[key] as number));
    return {
      cameraEnabled: flag('cameraEnabled'),
      deviceId: typeof saved.deviceId === 'string' ? saved.deviceId : null,
      mirror: flag('mirror'),
      detectionConfidence: inRange(saved.detectionConfidence, 0.3, 0.9) ? saved.detectionConfidence : d.detectionConfidence,
      trackingConfidence: inRange(saved.trackingConfidence, 0.3, 0.9) ? saved.trackingConfidence : d.trackingConfidence,
      fingerSensitivity: unit('fingerSensitivity'),
      palmSensitivity: unit('palmSensitivity'),
      pinchSensitivity: unit('pinchSensitivity'),
      rollSensitivity: unit('rollSensitivity'),
      depthSensitivity: unit('depthSensitivity'),
      smoothing: unit('smoothing'),
      holdMs: inRange(saved.holdMs, 100, 1000) ? saved.holdMs : d.holdMs,
      showSkeleton: flag('showSkeleton'),
      showMiniPuppets: flag('showMiniPuppets'),
      showFingerMonitor: flag('showFingerMonitor'),
      showStatusHud: flag('showStatusHud'),
      showDiagHud: flag('showDiagHud'),
      quality: QUALITIES.includes(saved.quality as QualityPreset) ? (saved.quality as QualityPreset) : d.quality,
      swapHands: flag('swapHands'),
      invertY: flag('invertY'),
      agentPartner: flag('agentPartner'),
      rallyAssist: RALLY_ASSIST_MODES.includes(saved.rallyAssist as RallyAssistMode) ? (saved.rallyAssist as RallyAssistMode) : d.rallyAssist,
      fingerMap: parseFingerMap(saved.fingerMap),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode, quota); preferences simply won't persist.
  }
}

/* ------------------------------------------------------------------ rendering cost */

/**
 * What each quality preset costs. Presets only trade secondary rendering
 * effects; they never remove a puppet, a prop or a finger channel.
 */
export interface QualityProfile {
  /** Upper limit for the canvas pixel ratio. */
  pixelRatio: number;
  /** Soften the hand's shadow on the screen with a blur. */
  softShadows: boolean;
  /** Let the lamp glow through the leather a little (group opacity). */
  translucent: boolean;
  /** Each puppet also casts a blurred shadow onto the screen. */
  castShadows: boolean;
  /** Dust motes drifting in the lamp light. */
  dust: number;
  /** Paper grain and stains painted into the backdrop, 0..1. */
  paperDetail: number;
}

export const QUALITY: Record<QualityPreset, QualityProfile> = {
  performance: { pixelRatio: 1.25, softShadows: false, translucent: false, castShadows: false, dust: 0, paperDetail: 0.45 },
  balanced: { pixelRatio: 1.75, softShadows: true, translucent: true, castShadows: false, dust: 16, paperDetail: 0.8 },
  quality: { pixelRatio: 2.5, softShadows: true, translucent: true, castShadows: true, dust: 30, paperDetail: 1 },
};

/* ------------------------------------------------------------------ URL flags */

export interface AppFlags {
  /** `?debug=1`: the full engineering view (raw vs filtered, target vs rendered, timings). */
  debug: boolean;
  /** `?simulate=1`: drive the puppets with synthetic hands instead of the camera. */
  simulate: boolean;
  /** `?script=index` …: which simulated scenario to play (default: the whole reel). */
  script: SimScript;
  /** `?noise=0.002`: simulated landmark noise, in frame units. */
  noise: number | null;
  /** `?fps=15`: simulated tracker rate, to see how the puppets move when results are sparse. */
  simFps: number | null;
  /** `?tracker=main` / `?tracker=worker`: pin where the hand model runs, for comparison. */
  tracker: 'main' | 'worker' | null;
  /** `?delegate=cpu` / `?delegate=gpu`: force the model onto one delegate, for comparison. */
  delegate: 'cpu' | 'gpu' | null;
  /** `?hud=0`: start with every overlay hidden (clean screenshots). */
  hud: boolean;
}

export function readFlags(search = window.location.search): AppFlags {
  const params = new URLSearchParams(search);
  const on = (key: string) => params.has(key) && params.get(key) !== '0';
  const delegate = params.get('delegate');
  const tracker = params.get('tracker');
  const script = params.get('script') ?? params.get('simulate');
  const noise = Number.parseFloat(params.get('noise') ?? '');
  const fps = Number.parseFloat(params.get('fps') ?? '');
  return {
    debug: on('debug'),
    simulate: on('simulate'),
    script: isSimScript(script) ? script : 'show',
    noise: Number.isFinite(noise) && noise >= 0 ? noise : null,
    simFps: Number.isFinite(fps) && fps >= 5 && fps <= 120 ? fps : null,
    tracker: tracker === 'main' || tracker === 'worker' ? tracker : null,
    delegate: delegate === 'cpu' || delegate === 'gpu' ? delegate : null,
    hud: params.get('hud') !== '0',
  };
}
