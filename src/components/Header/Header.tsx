import type { CameraStatus, TrackingStatus } from '../../types';
import { DebugIcon, FullscreenIcon, GearIcon, KayonMark, SoundIcon } from './icons';

interface HeaderProps {
  cameraStatus: CameraStatus;
  trackingStatus: TrackingStatus;
  /** The mode the camera really delivers, e.g. "640×480 · 30 fps". */
  cameraMode: string | null;
  simulated: boolean;
  soundOn: boolean;
  soundAvailable: boolean;
  fullscreen: boolean;
  fullscreenAvailable: boolean;
  debugOpen: boolean;
  settingsOpen: boolean;
  onSettings: () => void;
  onFullscreen: () => void;
  onSound: () => void;
  onDebug: () => void;
}

type Tone = 'live' | 'wait' | 'off' | 'warn';

function cameraLabel({ cameraStatus, trackingStatus, cameraMode, simulated }: HeaderProps): { tone: Tone; text: string; detail: string | null } {
  if (simulated) return { tone: 'wait', text: 'SIMULATION', detail: 'synthetic hands' };
  switch (cameraStatus) {
    case 'active':
      if (trackingStatus === 'loading') return { tone: 'wait', text: 'LOADING MODEL', detail: cameraMode };
      if (trackingStatus === 'error') return { tone: 'warn', text: 'TRACKER ERROR', detail: cameraMode };
      return { tone: 'live', text: 'CAMERA LIVE', detail: cameraMode };
    case 'requesting':
      return { tone: 'wait', text: 'STARTING CAMERA', detail: null };
    case 'denied':
      return { tone: 'warn', text: 'CAMERA BLOCKED', detail: null };
    case 'unsupported':
      return { tone: 'warn', text: 'NO CAMERA API', detail: null };
    case 'insecure':
      return { tone: 'warn', text: 'HTTPS REQUIRED', detail: null };
    case 'error':
      return { tone: 'warn', text: 'CAMERA ERROR', detail: null };
    default:
      return { tone: 'off', text: 'CAMERA OFF', detail: null };
  }
}

/** The thin top bar: identity on the left, camera state and four controls on the right. */
export function Header(props: HeaderProps) {
  const status = cameraLabel(props);
  return (
    <header className="header">
      <div className="header__brand">
        <KayonMark />
        <span className="header__name">DALANG V2</span>
        <span className="header__tagline">Interactive Shadow Theatre</span>
      </div>
      <div className="header__tools">
        <span className={`header__status header__status--${status.tone}`} role="status">
          <span className="header__dot" aria-hidden="true" />
          <span>{status.text}</span>
          {status.detail && <span className="header__detail">{status.detail}</span>}
        </span>
        <button type="button" className="header__button" aria-label="Settings" aria-pressed={props.settingsOpen} title="Settings" onClick={props.onSettings}>
          <GearIcon />
        </button>
        {props.fullscreenAvailable && (
          <button
            type="button"
            className="header__button"
            aria-label={props.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            aria-pressed={props.fullscreen}
            title="Fullscreen"
            onClick={props.onFullscreen}
          >
            <FullscreenIcon active={props.fullscreen} />
          </button>
        )}
        {props.soundAvailable && (
          <button
            type="button"
            className="header__button"
            aria-label={props.soundOn ? 'Turn sound off' : 'Turn sound on'}
            aria-pressed={props.soundOn}
            title="Sound"
            onClick={props.onSound}
          >
            <SoundIcon on={props.soundOn} />
          </button>
        )}
        <button type="button" className="header__button" aria-label="Debug view" aria-pressed={props.debugOpen} title="Debug" onClick={props.onDebug}>
          <DebugIcon />
        </button>
      </div>
    </header>
  );
}
