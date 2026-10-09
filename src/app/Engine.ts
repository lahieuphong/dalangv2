import type { StageAudio } from '../audio/StageAudio';
import { AgentPuppeteer } from '../motion/AgentPuppeteer';
import { GestureEngine } from '../motion/GestureEngine';
import { InteractionStateMachine } from '../motion/InteractionStateMachine';
import { PuppetController, type ControlEnvironment } from '../motion/PuppetController';
import { channelOfFinger, gainFromSetting } from '../motion/PuppetMapping';
import { CHANNEL_RIG_KEY, CHANNEL_STRING_JOINT, computeJoints, createJoints, facing, type PuppetJoints } from '../motion/PuppetRig';
import { CARRIERS, emptyPaddle, SceneController, type PaddleInput, type SceneMode } from '../scene/SceneController';
import { computeLayout, type StageLayout } from '../scene/StageProps';
import { CalibrationSession, saveCalibration, type CalibrationStep, type CalibrationStore } from '../tracking/Calibration';
import { HandAssigner } from '../tracking/HandAssignment';
import type { HandTracker } from '../tracking/HandTracker';
import { setTrackerThresholds } from '../tracking/InferenceBackend';
import { HandSimulator } from '../tracking/SimulatedHands';
import {
  FINGER_NAMES,
  JOINT_CHANNELS,
  SIDES,
  type HandDetection,
  type HandFrame,
  type Point,
  type Side,
  type TrackingStatus,
} from '../types';
import { average, boost, clamp, lerp } from '../utils/math';
import type { CameraFrame, StageFrame } from './frames';
import { QUALITY, type AppFlags, type QualityProfile, type Settings } from './settings';
import { createTelemetry, MOTION_SAMPLES, type HandTelemetry, type PaddleStatus, type Telemetry } from './telemetry';

/** Landmarks older than this are no longer drawn over the preview. */
const HAND_FRESH_MS = 220;
/** The HUDs refresh about five times a second; nothing readable changes faster. */
const HUD_INTERVAL_MS = 200;
const MOTION_INTERVAL_MS = 66;
/** A hand that comes back within this long "restores" tracking rather than starting anew. */
const RESTORE_WINDOW_MS = 5000;
/** A camera that keeps delivering fewer frames than this is worth telling the performer about. */
const SLOW_CAMERA_FPS = 22;
const SLOW_CAMERA_AFTER_MS = 3000;

/** What the engine needs from the page on every frame. */
export interface EngineInput {
  tracker: HandTracker | null;
  video: HTMLVideoElement | null;
  cameraActive: boolean;
  trackerStatus: TrackingStatus;
  reducedMotion: boolean;
}

/** The little React needs to know, reported only when it changes. */
export interface CoarseState {
  held: Record<Side, boolean>;
  lost: Record<Side, boolean>;
  mode: SceneMode;
  agentSide: Side | null;
  calibration: CalibrationStep | null;
  /** Frames per second the camera really delivers, when that is too few for fluid control; null otherwise. */
  slowCamera: number | null;
}

type Listener = (telemetry: Telemetry) => void;

interface PaddleMemory {
  x: number;
  y: number;
  angle: number;
  valid: boolean;
}

/**
 * The per-frame pipeline, kept entirely outside React:
 *
 *   camera frame → hand landmarker → hand assignment → per-finger features
 *     → filtering → gestures → pose mapping → display-rate followers
 *     → scene (props, agent) → rendering
 *
 * It owns no DOM. Views register themselves and are handed plain data; all
 * high-frequency state lives in plain objects that are mutated in place.
 */
export class Engine {
  readonly flags: AppFlags;
  readonly telemetry: Telemetry = createTelemetry();
  readonly puppets: Record<Side, PuppetController>;
  readonly gestures: Record<Side, GestureEngine> = { left: new GestureEngine(), right: new GestureEngine() };
  readonly machines: Record<Side, InteractionStateMachine> = { left: new InteractionStateMachine(), right: new InteractionStateMachine() };
  readonly joints: Record<Side, PuppetJoints> = { left: createJoints(), right: createJoints() };
  readonly paddles: Record<Side, PaddleInput> = { left: emptyPaddle(), right: emptyPaddle() };
  readonly assigner = new HandAssigner();
  readonly agent = new AgentPuppeteer();
  readonly simulator: HandSimulator | null;
  readonly scene: SceneController;

  settings: Settings;
  layout: StageLayout;
  calibration: CalibrationStore;
  /** The guided calibration, while it runs. */
  session: CalibrationSession | null = null;
  audio: StageAudio | null = null;
  soundOn = false;
  /** Size of the video as drawn in the preview (CSS px), for speeds in pixels. */
  readonly preview = { width: 640, height: 480 };

  /** Views. Each is handed plain data and draws it; none is required. */
  stageView: { render(frame: StageFrame): void } | null = null;
  cameraView: { render(frame: CameraFrame): void } | null = null;
  /** Called every render frame while the debug view is open. */
  debugView: ((engine: Engine, now: number) => void) | null = null;
  calibrationView: ((step: CalibrationStep, progress: number) => void) | null = null;
  onCoarse: ((state: CoarseState) => void) | null = null;

  private env: ControlEnvironment;
  private quality: QualityProfile;
  private readonly hudListeners = new Set<Listener>();
  private readonly fastListeners = new Set<Listener>();
  private readonly hands: Record<Side, HandDetection | null> = { left: null, right: null };
  private readonly handAt: Record<Side, number> = { left: -Infinity, right: -Infinity };
  private readonly wasTracking: Record<Side, boolean> = { left: false, right: false };
  private readonly lostAt: Record<Side, number> = { left: -Infinity, right: -Infinity };
  private readonly paddleMemory: Record<Side, PaddleMemory> = {
    left: { x: 0, y: 0, angle: 0, valid: false },
    right: { x: 0, y: 0, angle: 0, valid: false },
  };
  private readonly spin: Record<Side, number> = { left: 0, right: 0 };
  private readonly carryPoints: Point[] = Array.from({ length: CARRIERS }, () => ({ x: 0, y: 0 }));
  private readonly stageFrame: StageFrame;
  private readonly cameraFrame: CameraFrame;
  private aspect = 16 / 9;
  private frameReceived = 0;
  private frameAt = -Infinity;
  private agentSide: Side | null = null;
  private primary: Side | null = null;
  private hudAt = 0;
  private motionAt = 0;
  private worstPending = 0;
  private worstSince = 0;
  private slowSince = 0;
  private slowCamera: number | null = null;
  private coarseKey = '';
  private coarsePending = '';
  private coarseSince = 0;

  constructor(flags: AppFlags, settings: Settings, calibration: CalibrationStore) {
    this.flags = flags;
    this.settings = settings;
    this.calibration = calibration;
    this.layout = computeLayout(900);
    this.quality = QUALITY[settings.quality];
    this.env = this.buildEnvironment();
    this.puppets = { left: new PuppetController('left', this.env), right: new PuppetController('right', this.env) };
    this.scene = new SceneController(this.layout);
    this.simulator = flags.simulate
      ? new HandSimulator({
          script: flags.script,
          ...(flags.noise !== null ? { noise: flags.noise } : {}),
          ...(flags.simFps !== null ? { fps: flags.simFps } : {}),
        })
      : null;
    for (const side of SIDES) computeJoints(this.puppets[side].rig, side, this.joints[side]);

    this.stageFrame = {
      now: 0,
      dt: 0,
      layout: this.layout,
      quality: this.quality,
      rigs: { left: this.puppets.left.rig, right: this.puppets.right.rig },
      joints: this.joints,
      presence: { left: 0, right: 0 },
      handPresence: { left: 0, right: 0 },
      hands: { left: null, right: null },
      aspect: this.aspect,
      fingerMap: settings.fingerMap,
      agentSide: null,
      scene: this.scene,
      reducedMotion: false,
      debug: flags.debug,
    };
    this.cameraFrame = {
      now: 0,
      hands: this.stageFrame.hands,
      rigs: this.stageFrame.rigs,
      handPresence: this.stageFrame.handPresence,
      activity: { left: this.puppets.left.fingerActivity, right: this.puppets.right.fingerActivity },
      pinched: { left: false, right: false },
      fingerMap: settings.fingerMap,
      showSkeleton: settings.showSkeleton,
      showMiniPuppets: settings.showMiniPuppets,
      simulated: flags.simulate,
    };
    this.applySettings(settings);
  }

  /* ---------------------------------------------------------------- configuration */

  applySettings(settings: Settings) {
    this.settings = settings;
    this.quality = QUALITY[settings.quality];
    this.assigner.swapped = settings.swapHands;
    setTrackerThresholds({ detection: settings.detectionConfidence, presence: settings.trackingConfidence, tracking: settings.trackingConfidence });
    // Only the rules of the next contact change: the ball in the air, the puppets and every count carry on.
    this.scene.setAssist(settings.rallyAssist);
    this.agent.setAssist(settings.rallyAssist);
    this.reconfigure();
    const t = this.telemetry;
    t.fingerGain = this.env.gains.finger;
    t.palmGain = this.env.gains.palm;
    t.pinchGain = this.env.gains.pinch;
    t.smoothing = settings.smoothing;
  }

  setStageWidth(width: number) {
    if (Math.abs(width - this.layout.width) < 0.5) return;
    this.layout = computeLayout(width);
    this.reconfigure();
  }

  setCalibration(store: CalibrationStore) {
    this.calibration = store;
    saveCalibration(store);
    this.reconfigure();
  }

  startCalibration() {
    this.session = new CalibrationSession();
  }

  skipCalibrationStep() {
    this.session?.advance();
  }

  cancelCalibration() {
    this.session = null;
  }

  /** The newest landmarks seen for the hand on a puppet (they may be stale; see `telemetry.hands[side].visible`). */
  latestHand(side: Side): HandDetection | null {
    return this.hands[side];
  }

  /** Subscribes to the ~5 Hz HUD refresh (`hud`) or to every tracking result (`fast`). */
  subscribe(rate: 'hud' | 'fast', listener: Listener): () => void {
    const set = rate === 'hud' ? this.hudListeners : this.fastListeners;
    set.add(listener);
    return () => void set.delete(listener);
  }

  private buildEnvironment(): ControlEnvironment {
    const s = this.settings;
    return {
      layout: this.layout,
      gains: {
        finger: gainFromSetting(s.fingerSensitivity),
        palm: gainFromSetting(s.palmSensitivity),
        pinch: gainFromSetting(s.pinchSensitivity),
        roll: gainFromSetting(s.rollSensitivity),
        depth: lerp(0.4, 1.6, clamp(s.depthSensitivity, 0, 1)),
      },
      fingerMap: s.fingerMap,
      smoothing: s.smoothing,
      invertY: s.invertY,
      holdMs: s.holdMs,
      calibration: this.calibration,
    };
  }

  private reconfigure() {
    this.env = this.buildEnvironment();
    for (const side of SIDES) this.puppets[side].configure(this.env);
  }

  /* ---------------------------------------------------------------- the frame */

  tick(now: number, dt: number, input: EngineInput) {
    const started = performance.now();
    const { settings, scene, layout } = this;

    // 1. The newest tracking result, if one arrived since the last render frame. Nothing is ever queued.
    const { tracker, video } = input;
    let frame: HandFrame | null = null;
    if (this.simulator) frame = this.simulator.next(now);
    else if (tracker && input.cameraActive && video) {
      tracker.mirror = settings.mirror;
      tracker.attach(video);
      frame = tracker.take(now);
    } else tracker?.detach();
    if (frame) this.ingest(frame, now);

    // 2. Hands coming and going.
    const tracking = { left: this.puppets.left.isTracking(now), right: this.puppets.right.isTracking(now) };
    for (const side of SIDES) {
      if (this.wasTracking[side] && !tracking[side]) {
        this.lostAt[side] = now;
        this.gestures[side].reset();
        scene.log(now, `tracking lost / ${side} paused`);
      }
      this.wasTracking[side] = tracking[side];
    }
    if (this.primary && !tracking[this.primary]) this.primary = null;
    this.primary ??= tracking.left ? 'left' : tracking.right ? 'right' : null;

    // 3. The stage agent takes the free puppet for a rally when exactly one hand plays.
    const humans = Number(tracking.left) + Number(tracking.right);
    const agentSide: Side | null =
      settings.agentPartner && scene.mode === 'rally' && humans === 1 ? (tracking.left ? 'right' : 'left') : null;
    if (agentSide !== this.agentSide) {
      this.agent.reset();
      scene.log(now, agentSide ? 'agent · flies take the strings' : 'agent · strings released');
      this.agentSide = agentSide;
    }
    const agentRig = agentSide ? this.agent.update(agentSide, now, dt, layout, scene) : null;

    // 4. Pose targets, then the display-rate followers.
    const amplitude = input.reducedMotion ? 0.3 : 1;
    for (const side of SIDES) {
      const puppet = this.puppets[side];
      puppet.prepareTarget(now, dt, amplitude, side === agentSide ? agentRig : null);
      computeJoints(puppet.integrate(dt), side, this.joints[side]);
    }

    // 5. The scene reads the paddles; it never moves a puppet.
    for (const side of SIDES) this.updatePaddle(side, tracking[side], dt);
    const sceneStarted = performance.now();
    scene.update(now, dt, layout, this.paddles, agentSide, agentSide ? this.placeCarriers(agentSide) : null);
    this.telemetry.sceneMs = average(this.telemetry.sceneMs || 0, performance.now() - sceneStarted);
    // A stroke that landed shows in the puppet that made it. The paddle is where it was; only the rest of the figure answers.
    if (!input.reducedMotion) for (const contact of scene.contacts) this.puppets[contact.side].recoil(contact.power);
    if (this.audio && this.soundOn) for (const cue of scene.cues) this.audio.cue(cue.kind, cue.pan, cue.strength);
    scene.cues.length = 0;

    // 6. What each puppet is doing, as one word.
    for (const side of SIDES) {
      const puppet = this.puppets[side];
      const paddle = this.paddles[side];
      this.machines[side].update(
        {
          driven: tracking[side] || puppet.agentDriven,
          recovering: puppet.isRecovering(now),
          holding: scene.holding[side],
          lift: puppet.lift,
          rally: scene.rallyLive,
          hunting: scene.mode === 'hunt' && tracking[side] && (scene.nearFly[side] || Math.hypot(paddle.vx, paddle.vy) > 170),
        },
        now,
      );
    }

    // 7. Draw.
    const stage = this.stageFrame;
    stage.now = now;
    stage.dt = dt;
    stage.layout = layout;
    stage.quality = this.quality;
    stage.aspect = this.aspect;
    stage.fingerMap = settings.fingerMap;
    stage.agentSide = agentSide;
    stage.reducedMotion = input.reducedMotion;
    for (const side of SIDES) {
      const puppet = this.puppets[side];
      stage.presence[side] = puppet.presence;
      stage.handPresence[side] = puppet.handPresence;
      stage.hands[side] = now - this.handAt[side] < HAND_FRESH_MS ? this.hands[side] : null;
    }
    this.stageView?.render(stage);

    const camera = this.cameraFrame;
    camera.now = now;
    camera.fingerMap = settings.fingerMap;
    camera.showSkeleton = settings.showSkeleton;
    camera.showMiniPuppets = settings.showMiniPuppets;
    camera.pinched.left = this.gestures.left.pinched;
    camera.pinched.right = this.gestures.right.pinched;
    this.cameraView?.render(camera);

    // 8. Calibration, measurements, and the few things React wants to hear about.
    this.updateCalibration();
    this.measure(now, dt, input, tracking, started);
    this.debugView?.(this, now);
    this.reportCoarse(now, tracking);
  }

  /** One tracking result: assignment, features, filtering, mapping. */
  private ingest(frame: HandFrame, now: number) {
    const clock = performance.now();
    const t = this.telemetry;
    this.aspect = frame.aspect;
    this.frameAt = now;
    this.frameReceived = frame.received;
    if (!this.simulator) t.inputAgeMs = average(t.inputAgeMs || 0, Math.max(0, clock - frame.time));

    const assigned = this.assigner.assign(frame.hands, now);
    for (const side of SIDES) {
      const hand = assigned[side];
      const puppet = this.puppets[side];
      const pickedUp = puppet.observe(hand, frame.aspect, now, this.env, frame.time);
      if (!hand || !puppet.features) continue;
      this.hands[side] = hand;
      this.handAt[side] = now;
      this.gestures[side].update(puppet.features, boost(puppet.features.pinchStrength, this.env.gains.pinch), now);
      this.session?.feed(side, puppet.measured, now);
      if (pickedUp) {
        if (this.audio && this.soundOn) this.audio.knock(side);
        this.scene.log(now, now - this.lostAt[side] < RESTORE_WINDOW_MS ? 'tracking restored' : `${side} hand tracked`);
      }
    }
    t.mappingMs = average(t.mappingMs || 0, performance.now() - clock);
    this.fillHands(now);
    for (const listener of this.fastListeners) listener(t);
  }

  /** Where the paddle is, how fast it travels and spins, and what the pinch is doing. */
  private updatePaddle(side: Side, human: boolean, dt: number) {
    const joints = this.joints[side];
    const paddle = this.paddles[side];
    const memory = this.paddleMemory[side];
    if (memory.valid && dt > 0) {
      paddle.vx += ((joints.paddle.x - memory.x) / dt - paddle.vx) * 0.6;
      paddle.vy += ((joints.paddle.y - memory.y) / dt - paddle.vy) * 0.6;
      this.spin[side] += (Math.abs(joints.paddleAngle - memory.angle) / dt - this.spin[side]) * 0.2;
    }
    memory.x = joints.paddle.x;
    memory.y = joints.paddle.y;
    memory.angle = joints.paddleAngle;
    memory.valid = true;
    paddle.x = joints.paddle.x;
    paddle.y = joints.paddle.y;
    paddle.radius = joints.paddleRadius;
    paddle.human = human;
    paddle.active = human || this.puppets[side].agentDriven;
    const gesture = this.gestures[side];
    paddle.grabbing = human && gesture.pinched;
    paddle.justGrabbed = human && gesture.justPinched;
    paddle.justReleased = gesture.justReleased;
    // Edges are consumed here: gestures update at the tracking rate, this runs at the display rate.
    gesture.justPinched = false;
    gesture.justReleased = false;
  }

  /** The agent's five flies hover above the puppet, each over the joint its string is tied to. */
  private placeCarriers(side: Side): Point[] {
    const joints = this.joints[side];
    const flip = facing(side);
    const s = this.layout.puppetScale;
    const top = Math.max(24, joints.crown.y - 130 * s);
    JOINT_CHANNELS.forEach((channel, i) => {
      const joint = joints[CHANNEL_STRING_JOINT[channel]];
      const point = this.carryPoints[i];
      point.x = clamp(lerp(joints.crown.x, joint.x, 0.55) + flip * (i - 2) * 9 * s, 14, this.layout.width - 14);
      point.y = top + (i % 2) * 16 * s + Math.max(0, (joint.y - joints.crown.y) * 0.06);
    });
    return this.carryPoints;
  }

  private updateCalibration() {
    const session = this.session;
    if (!session) return;
    this.calibrationView?.(session.step, session.progress);
    if (session.step !== 'done') return;
    this.session = null;
    this.setCalibration(session.result(this.calibration));
    this.scene.log(performance.now(), 'calibration saved');
  }

  /* ---------------------------------------------------------------- measurement */

  /** Per-hand values that change with every tracking result. */
  private fillHands(now: number) {
    const map = this.settings.fingerMap;
    for (const side of SIDES) {
      const puppet = this.puppets[side];
      const hand = this.telemetry.hands[side];
      const features = puppet.features;
      const tracked = puppet.isTracking(now);
      hand.tracked = tracked;
      hand.visible = now - this.handAt[side] < HAND_FRESH_MS;
      if (!features) continue;
      const raw = puppet.rawFeatures;
      for (const finger of FINGER_NAMES) {
        const f = hand.fingers[finger];
        f.raw = raw[finger].curl;
        f.filtered = features[finger].curl;
        f.inFrame = features[finger].inFrame;
        f.activity = puppet.fingerActivity[finger];
        f.channel = channelOfFinger(map, finger);
      }
      const detection = this.hands[side];
      hand.handedness = detection?.handedness ?? null;
      hand.handednessScore = detection?.handednessScore ?? 0;
      hand.palmX = features.palmX;
      hand.palmY = features.palmY;
      hand.speed = Math.hypot(puppet.palmVelocity.x, puppet.palmVelocity.y);
      hand.speedPx = Math.hypot(puppet.palmVelocity.x * this.preview.width, puppet.palmVelocity.y * this.preview.height);
      hand.pinch = boost(features.pinchStrength, this.env.gains.pinch);
      hand.fist = features.fistStrength;
      hand.roll = features.roll;
      hand.depth = features.size;
    }
  }

  private measure(now: number, dt: number, input: EngineInput, tracking: Record<Side, boolean>, started: number) {
    const t = this.telemetry;
    const frameMs = dt * 1000;
    if (frameMs > 0) t.frameMs = average(t.frameMs || 0, frameMs);
    this.worstPending = Math.max(this.worstPending, frameMs);
    if (now - this.worstSince > 1000) {
      t.worstFrameMs = this.worstPending;
      this.worstPending = 0;
      this.worstSince = now;
    }
    const live = now - this.frameAt < 500;
    if (live && !this.simulator) t.sampleAgeMs = average(t.sampleAgeMs || 0, Math.max(0, performance.now() - this.frameReceived));
    t.engineMs = average(t.engineMs || 0, performance.now() - started);

    // Per-frame hand values: state, joint angles, what the paddle is doing.
    for (const side of SIDES) {
      const puppet = this.puppets[side];
      const hand = t.hands[side];
      hand.tracked = tracking[side];
      hand.visible = now - this.handAt[side] < HAND_FRESH_MS;
      hand.recovering = puppet.isRecovering(now);
      hand.agent = puppet.agentDriven;
      hand.state = this.machines[side].state;
      hand.gesture = tracking[side] ? this.gestures[side].gesture : 'none';
      hand.lift = puppet.lift;
      hand.followLagMs = puppet.follow.lagMs;
      hand.weaponSpin = this.spin[side];
      let paddle: PaddleStatus = 'idle';
      if (puppet.agentDriven) paddle = 'cpu';
      else if (hand.recovering) paddle = 'recover';
      else if (tracking[side]) paddle = this.gestures[side].pinched ? 'armed' : 'follow';
      hand.paddle = paddle;
      if (!tracking[side]) {
        hand.speed = 0;
        hand.speedPx = 0;
      }
      for (const finger of FINGER_NAMES) {
        const f = hand.fingers[finger];
        if (!f.channel) continue;
        const key = CHANNEL_RIG_KEY[f.channel];
        f.targetAngle = puppet.target[key];
        f.renderedAngle = puppet.rig[key];
      }
    }

    const primary = this.primary ? t.hands[this.primary] : null;
    if (now - this.motionAt >= MOTION_INTERVAL_MS) {
      this.motionAt = now;
      t.motion[t.motionHead] = primary ? primary.speedPx : 0;
      t.motionHead = (t.motionHead + 1) % MOTION_SAMPLES;
      // Energy: palm travel and finger movement together, remembered for about a second.
      let liveliness = 0;
      if (primary && this.primary) {
        const activity = this.puppets[this.primary].fingerActivity;
        const fingers = (activity.thumb + activity.index + activity.middle + activity.ring + activity.pinky) / 5;
        liveliness = clamp(0.55 * (primary.speed / 1.2) + 0.45 * fingers * 1.6, 0, 1);
      }
      t.energy += (liveliness - t.energy) * (liveliness > t.energy ? 0.35 : 0.07);
    }

    if (now - this.hudAt < HUD_INTERVAL_MS) return;
    this.hudAt = now;
    this.refreshTelemetry(input);
    for (const listener of this.hudListeners) listener(t);
  }

  /** The slow-changing half of the telemetry, refreshed with the HUDs. */
  private refreshTelemetry(input: EngineInput) {
    const t = this.telemetry;
    const { tracker, video } = input;
    t.source = this.simulator ? 'simulated' : input.cameraActive ? 'camera' : 'none';
    t.simSegment = this.simulator?.segment ?? '';
    t.trackerStatus = this.simulator ? 'ready' : input.trackerStatus;
    t.renderFps = t.frameMs ? 1000 / t.frameMs : NaN;
    if (this.simulator) {
      t.backend = 'synthetic landmarks';
      t.cameraFps = NaN;
      t.trackHz = this.simulator.fps;
      t.inferenceMs = NaN;
      t.roundTripMs = NaN;
      t.inputAgeMs = NaN;
      t.sampleAgeMs = NaN;
      t.captureDelayMs = NaN;
    } else if (tracker && input.cameraActive) {
      const stats = tracker.stats;
      t.backend = `${tracker.mode} · ${tracker.delegate}`;
      t.cameraFps = stats.cameraFps || NaN;
      t.trackHz = stats.inferenceFps || NaN;
      t.inferenceMs = stats.inferenceMs || NaN;
      t.roundTripMs = stats.turnaroundMs || NaN;
      t.captureDelayMs = stats.captureDelayMs || NaN;
    } else {
      t.backend = '';
      t.cameraFps = NaN;
      t.trackHz = NaN;
      t.inferenceMs = NaN;
      t.roundTripMs = NaN;
      t.inputAgeMs = NaN;
      t.sampleAgeMs = NaN;
      t.captureDelayMs = NaN;
    }
    t.cameraWidth = video?.videoWidth ?? 0;
    t.cameraHeight = video?.videoHeight ?? 0;

    // A webcam in dim light quietly drops to half its frame rate or less; no amount of software gets those frames back.
    const clock = performance.now();
    if (t.source === 'camera' && Number.isFinite(t.cameraFps) && t.cameraFps < SLOW_CAMERA_FPS) {
      this.slowSince ||= clock;
      this.slowCamera = clock - this.slowSince > SLOW_CAMERA_AFTER_MS ? Math.round(t.cameraFps) : null;
    } else {
      this.slowSince = 0;
      this.slowCamera = null;
    }

    const primary = this.primary;
    t.primary = primary;
    const lag = primary ? this.puppets[primary].follow.lagMs : 0;
    // Capture → pose on screen. With simulated hands there is no capture, so only the followers remain.
    t.responseMs = (Number.isFinite(t.inputAgeMs) ? t.inputAgeMs : 0) + lag;

    const label = (side: Side) => {
      const hand = t.hands[side];
      if (hand.agent) return 'CPU';
      if (!hand.tracked) return '–';
      return hand.handedness ? hand.handedness[0].toUpperCase() : '?';
    };
    t.assignment = `${label('left')}→left  ${label('right')}→right`;

    const { scene } = this;
    t.mode = scene.mode;
    t.ball = scene.ball.state;
    t.returns = scene.mode === 'hunt' ? scene.swats : scene.rallyHits;
    t.rallySeconds = scene.rallySeconds;
    t.bestRally = scene.bestRally;
    t.agentSide = this.agentSide;
    t.rallyAssist = scene.assist.mode;
    t.rally = scene.stats;
    t.lastContact = scene.lastContact;
    t.events = scene.events;
  }

  private reportCoarse(now: number, tracking: Record<Side, boolean>) {
    if (!this.onCoarse) return;
    const lostLeft = this.puppets.left.isRecovering(now);
    const lostRight = this.puppets.right.isRecovering(now);
    const step = this.session?.step ?? null;
    const key = `${+tracking.left}${+tracking.right}${+lostLeft}${+lostRight}${this.scene.mode}${this.agentSide ?? '-'}${step ?? '-'}${this.slowCamera ?? '-'}`;
    if (key !== this.coarsePending) {
      this.coarsePending = key;
      this.coarseSince = now;
    }
    // Reported only once it has settled, so a flickering hand does not re-render the page.
    if (key === this.coarseKey || now - this.coarseSince < 120) return;
    this.coarseKey = key;
    this.onCoarse({
      held: { left: tracking.left, right: tracking.right },
      lost: { left: lostLeft, right: lostRight },
      mode: this.scene.mode,
      agentSide: this.agentSide,
      calibration: step,
      slowCamera: this.slowCamera,
    });
  }

  /** A plain snapshot of the pipeline, for automated checks (`window.__dalang.snapshot()`). */
  snapshot() {
    const t = this.telemetry;
    const hand = (side: Side) => {
      const h: HandTelemetry = t.hands[side];
      const puppet = this.puppets[side];
      return {
        tracked: h.tracked,
        agent: h.agent,
        state: h.state,
        gesture: h.gesture,
        pinch: h.pinch,
        lift: h.lift,
        curl: Object.fromEntries(FINGER_NAMES.map((finger) => [finger, h.fingers[finger].filtered])),
        rig: { ...puppet.rig },
        target: { ...puppet.target },
        paddle: { x: this.joints[side].paddle.x, y: this.joints[side].paddle.y },
      };
    };
    return {
      source: t.source,
      segment: t.simSegment,
      renderFps: t.renderFps,
      frameMs: t.frameMs,
      worstFrameMs: t.worstFrameMs,
      engineMs: t.engineMs,
      sceneMs: t.sceneMs,
      mappingMs: t.mappingMs,
      trackHz: t.trackHz,
      cameraFps: t.cameraFps,
      camera: `${t.cameraWidth}x${t.cameraHeight}`,
      inferenceMs: t.inferenceMs,
      roundTripMs: t.roundTripMs,
      inputAgeMs: t.inputAgeMs,
      sampleAgeMs: t.sampleAgeMs,
      captureDelayMs: t.captureDelayMs,
      responseMs: t.responseMs,
      backend: t.backend,
      mode: t.mode,
      returns: t.returns,
      agentSide: t.agentSide,
      rally: {
        assist: this.scene.assist.mode,
        hits: this.scene.rallyHits,
        seconds: this.scene.rallySeconds,
        ...this.scene.stats,
        lastContact: this.scene.lastContact ? { ...this.scene.lastContact } : null,
        lastOutcome: { ...this.scene.lastOutcome },
      },
      stageWidth: this.layout.width,
      left: hand('left'),
      right: hand('right'),
    };
  }
}
