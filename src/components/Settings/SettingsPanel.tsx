import type { ReactNode } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../../app/settings';
import type { CameraController } from '../../hooks/useCamera';
import { CHANNEL_LABEL, gainFromSetting } from '../../motion/PuppetMapping';
import { FINGER_NAMES, JOINT_CHANNELS, type FingerMap, type FingerName, type JointChannel, type QualityPreset } from '../../types';
import { CloseIcon } from '../Header/icons';

interface SettingsPanelProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  camera: CameraController;
  simulated: boolean;
  calibrated: boolean;
  fullscreen: boolean;
  fullscreenAvailable: boolean;
  onCamera: (on: boolean) => void;
  onDevice: (deviceId: string | null) => void;
  onFullscreen: () => void;
  onCalibrate: () => void;
  onResetCalibration: () => void;
  onGuide: () => void;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings__section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className="settings__toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

interface SliderProps {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

function Slider({ label, hint, value, min = 0, max = 1, step = 0.05, format, onChange }: SliderProps) {
  return (
    <label className="settings__slider">
      <span className="settings__slider-head">
        <span>{label}</span>
        <output>{format(value)}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

const gain = (value: number) => `${gainFromSetting(value).toFixed(2)}×`;
const percent = (value: number) => `${Math.round(value * 100)}%`;
const QUALITY_LABEL: Record<QualityPreset, string> = { performance: 'Performance', balanced: 'Balanced', quality: 'Quality' };
const QUALITY_HINT: Record<QualityPreset, string> = {
  performance: 'Fewest pixels and no secondary effects. Tracking and every control stay exactly the same.',
  balanced: 'Soft hand shadows, translucent leather and a little dust in the lamp light.',
  quality: 'Full-resolution canvases and a cast shadow behind each puppet.',
};
const FINGER_LABEL: Record<FingerName, string> = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Pinky' };

/** Gives `finger` to `channel`; the joint that had it takes the finger this one gives up, so the mapping stays one-to-one. */
function remap(map: FingerMap, channel: JointChannel, finger: FingerName): FingerMap {
  const next = { ...map };
  const previous = JOINT_CHANNELS.find((other) => map[other] === finger);
  if (previous && previous !== channel) next[previous] = map[channel];
  next[channel] = finger;
  return next;
}

/**
 * Everything adjustable, in one drawer, so the stage itself stays clear.
 * Sensitivity (how far the puppet moves) and smoothing (how firmly a resting
 * hand is held still) are separate controls and never stand in for each other.
 */
export function SettingsPanel(props: SettingsPanelProps) {
  const { settings, onChange, camera } = props;
  const cameraOn = camera.status === 'active' || camera.status === 'requesting';
  const cameraUsable = !props.simulated && camera.status !== 'unsupported' && camera.status !== 'insecure';
  const mode = camera.track?.width ? `${camera.track.width}×${camera.track.height} · ${Math.round(camera.track.frameRate ?? 0)} fps` : null;

  return (
    <aside className="settings" aria-label="Settings">
      <header className="settings__head">
        <h2>Settings</h2>
        <button type="button" className="icon-button" aria-label="Close settings" onClick={props.onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="settings__scroll">
        <Section title="Camera">
          <div className="settings__actions">
            <button type="button" className="button button--primary" disabled={!cameraUsable} onClick={() => props.onCamera(!cameraOn)}>
              {cameraOn ? 'Stop camera' : 'Start camera'}
            </button>
            {camera.devices.length < 2 && cameraOn && (
              <button type="button" className="button" onClick={() => void camera.flip()}>
                Flip front / back
              </button>
            )}
          </div>
          {props.simulated && <p className="settings__note">Simulation mode is on: synthetic hands replace the camera.</p>}
          {mode && <p className="settings__note">Delivering {mode}</p>}
          {camera.devices.length > 1 && (
            <label className="settings__field">
              <span>Camera</span>
              <select value={camera.deviceId ?? settings.deviceId ?? ''} onChange={(event) => props.onDevice(event.target.value || null)}>
                {camera.devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Toggle label="Mirror" hint="Show the preview like a mirror" checked={settings.mirror} onChange={(mirror) => onChange({ mirror })} />
          <Toggle label="Tracking overlay" hint="Draw the 21 landmarks of each hand" checked={settings.showSkeleton} onChange={(showSkeleton) => onChange({ showSkeleton })} />
        </Section>

        <Section title="Tracking">
          <Slider
            label="Finger sensitivity"
            hint="How far a joint turns for a given bend of its finger"
            value={settings.fingerSensitivity}
            format={gain}
            onChange={(fingerSensitivity) => onChange({ fingerSensitivity })}
          />
          <Slider
            label="Palm sensitivity"
            hint="How far the puppet travels for a given movement of the hand"
            value={settings.palmSensitivity}
            format={gain}
            onChange={(palmSensitivity) => onChange({ palmSensitivity })}
          />
          <Slider
            label="Pinch sensitivity"
            hint="How early the grip closes as thumb and index approach"
            value={settings.pinchSensitivity}
            format={gain}
            onChange={(pinchSensitivity) => onChange({ pinchSensitivity })}
          />
          <Slider
            label="Smoothing"
            hint="How firmly a resting hand is held still. It never slows a real movement."
            value={settings.smoothing}
            format={percent}
            onChange={(smoothing) => onChange({ smoothing })}
          />
          <details className="settings__more">
            <summary>More</summary>
            <Slider label="Lean sensitivity" hint="Wrist roll → lean of the body" value={settings.rollSensitivity} format={gain} onChange={(rollSensitivity) => onChange({ rollSensitivity })} />
            <Slider label="Depth sensitivity" hint="Distance to the camera → size of the puppet" value={settings.depthSensitivity} format={percent} onChange={(depthSensitivity) => onChange({ depthSensitivity })} />
            <Slider
              label="Detection threshold"
              hint="How sure the model must be before it reports a new hand"
              min={0.3}
              max={0.9}
              value={settings.detectionConfidence}
              format={(value) => value.toFixed(2)}
              onChange={(detectionConfidence) => onChange({ detectionConfidence })}
            />
            <Slider
              label="Tracking threshold"
              hint="Below this the model looks for the hand again instead of following it"
              min={0.3}
              max={0.9}
              value={settings.trackingConfidence}
              format={(value) => value.toFixed(2)}
              onChange={(trackingConfidence) => onChange({ trackingConfidence })}
            />
            <Slider
              label="Hold after loss"
              hint="How long a pose is kept when the hand drops out, before the puppet eases to rest"
              min={100}
              max={1000}
              step={50}
              value={settings.holdMs}
              format={(value) => `${value} ms`}
              onChange={(holdMs) => onChange({ holdMs })}
            />
          </details>
        </Section>

        <Section title="Display">
          <Toggle label="Hand skeleton" checked={settings.showSkeleton} onChange={(showSkeleton) => onChange({ showSkeleton })} />
          <Toggle label="Miniature puppets" hint="A small puppet and its strings on each hand" checked={settings.showMiniPuppets} onChange={(showMiniPuppets) => onChange({ showMiniPuppets })} />
          <Toggle label="Finger values" hint="Finger Control Monitor" checked={settings.showFingerMonitor} onChange={(showFingerMonitor) => onChange({ showFingerMonitor })} />
          <Toggle label="Status HUD" checked={settings.showStatusHud} onChange={(showStatusHud) => onChange({ showStatusHud })} />
          <Toggle label="Debug HUD" hint="Tracking and render measurements" checked={settings.showDiagHud} onChange={(showDiagHud) => onChange({ showDiagHud })} />
          {props.fullscreenAvailable && <Toggle label="Fullscreen" checked={props.fullscreen} onChange={props.onFullscreen} />}
          <div className="settings__field">
            <span>Quality</span>
            <div className="segmented" role="group" aria-label="Quality preset">
              {(Object.keys(QUALITY_LABEL) as QualityPreset[]).map((quality) => (
                <button type="button" key={quality} aria-pressed={settings.quality === quality} onClick={() => onChange({ quality })}>
                  {QUALITY_LABEL[quality]}
                </button>
              ))}
            </div>
          </div>
          <p className="settings__note">{QUALITY_HINT[settings.quality]}</p>
        </Section>

        <Section title="Interaction">
          <Toggle label="Swap puppet assignment" hint="The hand on the left takes the right puppet" checked={settings.swapHands} onChange={(swapHands) => onChange({ swapHands })} />
          <Toggle label="Invert vertical control" hint="Lowering the hand lifts the puppet" checked={settings.invertY} onChange={(invertY) => onChange({ invertY })} />
          <Toggle label="Stage partner" hint="With one hand, the flies play the other puppet in a rally" checked={settings.agentPartner} onChange={(agentPartner) => onChange({ agentPartner })} />
          <details className="settings__more">
            <summary>Finger mapping</summary>
            {JOINT_CHANNELS.map((channel) => (
              <label className="settings__field" key={channel}>
                <span>{CHANNEL_LABEL[channel]}</span>
                <select value={settings.fingerMap[channel]} onChange={(event) => onChange({ fingerMap: remap(settings.fingerMap, channel, event.target.value as FingerName) })}>
                  {FINGER_NAMES.map((finger) => (
                    <option key={finger} value={finger}>
                      {FINGER_LABEL[finger]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button type="button" className="button" onClick={() => onChange({ fingerMap: DEFAULT_SETTINGS.fingerMap })}>
              Restore default mapping
            </button>
          </details>
          <div className="settings__actions">
            <button type="button" className="button" onClick={props.onCalibrate}>
              {props.calibrated ? 'Recalibrate' : 'Calibrate hands'}
            </button>
            <button type="button" className="button" disabled={!props.calibrated} onClick={props.onResetCalibration}>
              Reset calibration
            </button>
            <button type="button" className="button" onClick={props.onGuide}>
              Gesture guide
            </button>
          </div>
          <p className="settings__note">
            {props.calibrated
              ? 'Calibrated: finger ranges and hand travel are fitted to your hands and saved on this device.'
              : 'Not calibrated: built-in ranges are used. Calibration takes about ten seconds and is optional.'}
          </p>
        </Section>

        <button type="button" className="button settings__reset" onClick={() => onChange({ ...DEFAULT_SETTINGS, cameraEnabled: settings.cameraEnabled, deviceId: settings.deviceId })}>
          Restore all defaults
        </button>
      </div>
    </aside>
  );
}
