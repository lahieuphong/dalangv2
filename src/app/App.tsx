import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StageAudio } from '../audio/StageAudio';
import { CalibrationOverlay } from '../components/Calibration/CalibrationOverlay';
import { CameraView } from '../components/CameraView/CameraView';
import { DebugPanel } from '../components/DebugHUD/DebugPanel';
import { DiagHUD } from '../components/DebugHUD/DiagHUD';
import { FingerMonitor } from '../components/FingerMonitor/FingerMonitor';
import { Header } from '../components/Header/Header';
import { GestureGuide } from '../components/Settings/GestureGuide';
import { SettingsPanel } from '../components/Settings/SettingsPanel';
import { StatusHUD } from '../components/StatusHUD/StatusHUD';
import { TheaterStage } from '../components/TheaterStage/TheaterStage';
import { useAnimationFrame, useLatest } from '../hooks/useAnimationFrame';
import { useCamera } from '../hooks/useCamera';
import { useHandTracking } from '../hooks/useHandTracking';
import { useCompactLayout, useReducedMotion, useSettings } from '../hooks/usePreferences';
import type { SceneMode } from '../scene/SceneController';
import { loadCalibration } from '../tracking/Calibration';
import { Engine, type CoarseState } from './Engine';
import { QUALITY, readFlags } from './settings';

declare global {
  interface Window {
    /** Present with `?debug=1` or `?simulate=1`: the engine, for inspection and automated checks. */
    __dalang?: Engine;
  }
}

const INITIAL_COARSE: CoarseState = {
  held: { left: false, right: false },
  lost: { left: false, right: false },
  mode: 'hunt',
  agentSide: null,
  calibration: null,
  slowCamera: null,
};

type Panel = 'none' | 'settings' | 'guide';

/** What the stage tells the performer to try next, from what is actually going on. */
function stageHint(coarse: CoarseState, live: boolean): string | null {
  if (!live) return null;
  const hands = Number(coarse.held.left) + Number(coarse.held.right);
  if (hands === 0) return 'Raise a hand · every finger pulls a string';
  if (coarse.mode === 'hunt') return 'FLY HUNT · swat five flies to bring out the ball';
  if (coarse.agentSide) return 'RALLY · the flies play the other puppet';
  return 'RALLY · pinch to catch the ball and serve';
}

/**
 * Composition root. React holds only coarse UI state (which panels are open,
 * camera and model status, which puppets are held); everything that changes
 * per frame lives in the `Engine` and is drawn imperatively by the views.
 */
export function App() {
  const flags = useMemo(() => readFlags(), []);
  const [settings, updateSettings] = useSettings();
  const camera = useCamera();
  const reducedMotion = useReducedMotion();
  const compact = useCompactLayout();
  const cameraLive = camera.status === 'requesting' || camera.status === 'active';
  const tracking = useHandTracking(!flags.simulate && cameraLive, flags);

  const engineRef = useRef<Engine | null>(null);
  engineRef.current ??= new Engine(flags, settings, loadCalibration());
  const engine = engineRef.current;

  const [coarse, setCoarse] = useState(INITIAL_COARSE);
  const [panel, setPanel] = useState<Panel>('none');
  const [debugOpen, setDebugOpen] = useState(flags.debug);
  const [soundOn, setSoundOn] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [calibrated, setCalibrated] = useState(() => Object.keys(engine.calibration).length > 0);
  // null follows the layout: overlays start compact on small screens and can be toggled either way.
  const [statusCollapsed, setStatusCollapsed] = useState<boolean | null>(null);
  const [diagCollapsed, setDiagCollapsed] = useState<boolean | null>(null);
  const [fingersExpanded, setFingersExpanded] = useState(false);
  const audioRef = useRef<StageAudio | null>(null);

  useEffect(() => engine.applySettings(settings), [engine, settings]);

  useEffect(() => {
    engine.onCoarse = setCoarse;
    if (flags.debug || flags.simulate) window.__dalang = engine;
    return () => {
      engine.onCoarse = null;
      if (window.__dalang === engine) delete window.__dalang;
    };
  }, [engine, flags]);

  // A finished or cancelled calibration shows up as the session going away.
  const wasCalibrating = useRef(false);
  useEffect(() => {
    if (wasCalibrating.current && coarse.calibration === null) setCalibrated(Object.keys(engine.calibration).length > 0);
    wasCalibrating.current = coarse.calibration !== null;
  }, [engine, coarse.calibration]);

  /* ---------------------------------------------------------------- camera */

  const startCamera = camera.start;
  const stopCamera = camera.stop;
  const deviceRef = useLatest(settings.deviceId);
  const start = useCallback(() => startCamera({ deviceId: deviceRef.current }), [startCamera, deviceRef]);

  // Start the camera by itself only when permission was already granted; otherwise
  // wait for the visitor to press "Start camera". Also react to permission changes.
  const cameraStatusRef = useLatest(camera.status);
  const cameraEnabledRef = useLatest(settings.cameraEnabled);
  useEffect(() => {
    if (flags.simulate || !navigator.permissions?.query) return;
    let cancelled = false;
    let permission: PermissionStatus | null = null;
    const onChange = () => {
      const status = cameraStatusRef.current;
      if (permission?.state === 'granted' && cameraEnabledRef.current && (status === 'idle' || status === 'denied')) void start();
    };
    navigator.permissions
      .query({ name: 'camera' as PermissionName })
      .then((result) => {
        if (cancelled) return;
        permission = result;
        result.addEventListener('change', onChange);
        onChange();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      permission?.removeEventListener('change', onChange);
    };
  }, [flags.simulate, start, cameraStatusRef, cameraEnabledRef]);

  const enableCamera = useCallback(() => {
    updateSettings({ cameraEnabled: true });
    void start();
  }, [updateSettings, start]);

  const setCameraOn = useCallback(
    (on: boolean) => {
      updateSettings({ cameraEnabled: on });
      if (on) void start();
      else stopCamera();
    },
    [updateSettings, start, stopCamera],
  );

  const selectDevice = useCallback(
    (deviceId: string | null) => {
      updateSettings({ deviceId, cameraEnabled: true });
      void startCamera({ deviceId });
    },
    [updateSettings, startCamera],
  );

  /* ---------------------------------------------------------------- sound, fullscreen */

  const toggleSound = useCallback(() => {
    if (!StageAudio.isSupported()) return;
    audioRef.current ??= new StageAudio();
    engine.audio = audioRef.current;
    const next = !soundOn;
    if (next) void audioRef.current.start();
    else audioRef.current.stop();
    engine.soundOn = next;
    setSoundOn(next);
  }, [engine, soundOn]);

  useEffect(
    () => () => {
      audioRef.current?.dispose();
      audioRef.current = null;
      engine.audio = null;
    },
    [engine],
  );

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  /* ---------------------------------------------------------------- stage */

  const setMode = useCallback((mode: SceneMode) => engine.scene.setMode(mode, performance.now()), [engine]);

  const calibrate = useCallback(() => {
    engine.startCalibration();
    setPanel('none');
  }, [engine]);

  const resetCalibration = useCallback(() => {
    engine.setCalibration({});
    setCalibrated(false);
  }, [engine]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The one animation loop: tracking → assignment → motion → scene → render.
  const live = useLatest({ cameraActive: camera.status === 'active', trackerStatus: tracking.status, reducedMotion });
  const video = camera.video;
  useAnimationFrame((now, dt) => {
    const state = live.current;
    engine.tick(now, dt, {
      tracker: tracking.trackerRef.current,
      video: video(),
      cameraActive: state.cameraActive,
      trackerStatus: state.trackerStatus,
      reducedMotion: state.reducedMotion,
    });
  });

  const track = camera.track;
  const cameraMode = track?.width ? `${track.width}×${track.height} · ${Math.round(track.frameRate ?? 0)} fps` : null;
  const showHuds = flags.hud;
  const sourceLive = camera.status === 'active' || flags.simulate;

  return (
    <div className={`app${debugOpen ? ' app--debug' : ''}${panel === 'settings' ? ' app--settings' : ''}`}>
      <h1 className="visually-hidden">DALANG V2: a Wayang shadow theatre performed with both hands</h1>
      <Header
        cameraStatus={camera.status}
        trackingStatus={tracking.status}
        cameraMode={cameraMode}
        simulated={flags.simulate}
        soundOn={soundOn}
        soundAvailable={StageAudio.isSupported()}
        fullscreen={fullscreen}
        fullscreenAvailable={typeof document !== 'undefined' && document.fullscreenEnabled === true}
        debugOpen={debugOpen}
        settingsOpen={panel === 'settings'}
        onSettings={() => setPanel((current) => (current === 'settings' ? 'none' : 'settings'))}
        onFullscreen={toggleFullscreen}
        onSound={toggleSound}
        onDebug={() => setDebugOpen((open) => !open)}
      />

      <main className="theatre">
        <CameraView
          engine={engine}
          camera={camera}
          mirror={settings.mirror}
          simulated={flags.simulate}
          trackingStatus={tracking.status}
          held={coarse.held}
          lost={coarse.lost}
          slowCamera={coarse.slowCamera}
          pixelRatio={QUALITY[settings.quality].pixelRatio}
          onStart={enableCamera}
        >
          {showHuds && settings.showStatusHud && (
            <StatusHUD engine={engine} collapsed={statusCollapsed ?? compact} onToggle={() => setStatusCollapsed((value) => !(value ?? compact))} />
          )}
          {showHuds && settings.showDiagHud && (
            <DiagHUD engine={engine} collapsed={diagCollapsed ?? compact} onToggle={() => setDiagCollapsed((value) => !(value ?? compact))} />
          )}
          {showHuds && settings.showFingerMonitor && (
            <FingerMonitor engine={engine} expanded={fingersExpanded} onToggle={() => setFingersExpanded((value) => !value)} />
          )}
          {coarse.calibration && coarse.calibration !== 'done' && (
            <CalibrationOverlay
              engine={engine}
              step={coarse.calibration}
              onSkip={() => engine.skipCalibrationStep()}
              onCancel={() => engine.cancelCalibration()}
            />
          )}
        </CameraView>
        <TheaterStage engine={engine} quality={settings.quality} mode={coarse.mode} onMode={setMode} hint={showHuds ? stageHint(coarse, sourceLive) : null} />
      </main>

      {panel === 'settings' && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          camera={camera}
          simulated={flags.simulate}
          calibrated={calibrated}
          fullscreen={fullscreen}
          fullscreenAvailable={typeof document !== 'undefined' && document.fullscreenEnabled === true}
          onCamera={setCameraOn}
          onDevice={selectDevice}
          onFullscreen={toggleFullscreen}
          onCalibrate={calibrate}
          onResetCalibration={resetCalibration}
          onGuide={() => setPanel('guide')}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'guide' && <GestureGuide fingerMap={settings.fingerMap} onClose={() => setPanel('none')} />}
      {debugOpen && <DebugPanel engine={engine} onClose={() => setDebugOpen(false)} />}
    </div>
  );
}
