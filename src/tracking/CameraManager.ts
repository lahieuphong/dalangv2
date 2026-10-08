import type { CameraStatus } from '../types';

export type Facing = 'user' | 'environment';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface CameraSnapshot {
  status: CameraStatus;
  devices: CameraDevice[];
  /** The device actually streaming, when the browser reports it. */
  deviceId: string | null;
  facing: Facing;
  /** What the camera really delivers (resolution, frame rate); never assumed from the request. */
  track: MediaTrackSettings | null;
}

export interface CameraStartOptions {
  deviceId?: string | null;
  facing?: Facing;
}

const RETRYABLE = new Set(['OverconstrainedError', 'NotReadableError', 'AbortError']);

/**
 * Fresh frames matter more than resolution for hand control, and the model
 * only looks at a small crop anyway. So: first insist on a 50+ fps mode at
 * about 640×480, then settle for 30 fps at that size, then anything at all.
 * A phone held upright simply delivers the same mode turned on its side.
 */
function attempts(target: MediaTrackConstraints): MediaStreamConstraints[] {
  const size = { width: { ideal: 640 }, height: { ideal: 480 } };
  return [
    { video: { ...target, ...size, frameRate: { min: 50, ideal: 60 } }, audio: false },
    { video: { ...target, ...size, frameRate: { ideal: 30 } }, audio: false },
    { video: { ...target }, audio: false },
    { video: true, audio: false },
  ];
}

const mediaSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';

function initialStatus(): CameraStatus {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure';
  return mediaSupported() ? 'idle' : 'unsupported';
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Owns the webcam stream and its lifecycle: permission states, stale requests
 * (StrictMode remounts, rapid toggles), switching devices, unplugged cameras
 * and track cleanup. Framework-free; React reads it through `subscribe` /
 * `getSnapshot`.
 */
export class CameraManager {
  private snapshot: CameraSnapshot = { status: initialStatus(), devices: [], deviceId: null, facing: 'user', track: null };
  private readonly listeners = new Set<() => void>();
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private request = 0;
  private lastOptions: CameraStartOptions = {};
  private disposed = false;

  constructor() {
    if (mediaSupported()) navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** The element the stream plays in. Safe to call before or after `start`. */
  setVideo(video: HTMLVideoElement | null) {
    if (this.video === video) return;
    if (this.video) this.video.srcObject = null;
    this.video = video;
    if (video && this.stream) {
      video.srcObject = this.stream;
      void video.play().catch(() => undefined);
    }
  }

  async start(options: CameraStartOptions = {}): Promise<void> {
    if (this.disposed) return;
    if (this.snapshot.status === 'insecure') return;
    if (!mediaSupported()) {
      this.update({ status: 'unsupported' });
      return;
    }
    const request = ++this.request;
    this.lastOptions = options;
    stopStream(this.stream);
    this.stream = null;
    const facing = options.facing ?? this.snapshot.facing;
    this.update({ status: 'requesting', facing });

    try {
      const stream = await this.open(options.deviceId ?? null, facing);
      if (request !== this.request || this.disposed) {
        stopStream(stream);
        return;
      }
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      track?.addEventListener('ended', () => {
        if (this.stream !== stream) return;
        this.stream = null;
        this.update({ status: 'error', track: null });
      });
      if (this.video) {
        this.video.srcObject = stream;
        await this.video.play().catch(() => undefined);
      }
      if (request !== this.request) return;
      const settings = track?.getSettings() ?? null;
      this.update({ status: 'active', track: settings, deviceId: settings?.deviceId ?? options.deviceId ?? null });
      // Labels are only readable once permission has been granted.
      void this.refreshDevices();
    } catch (error) {
      if (request !== this.request) return;
      const name = error instanceof DOMException ? error.name : '';
      this.update({ status: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error', track: null });
      if (import.meta.env.DEV) console.warn('[camera]', error);
    }
  }

  stop() {
    this.request += 1;
    stopStream(this.stream);
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    const status = this.snapshot.status;
    this.update({ status: status === 'unsupported' || status === 'insecure' ? status : 'idle', track: null });
  }

  /** Front ↔ back camera on a phone or tablet. */
  flip() {
    return this.start({ facing: this.snapshot.facing === 'user' ? 'environment' : 'user' });
  }

  async refreshDevices(): Promise<void> {
    if (!mediaSupported() || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const devices = all
        .filter((device) => device.kind === 'videoinput' && device.deviceId)
        .map((device, i) => ({ deviceId: device.deviceId, label: device.label || `Camera ${i + 1}` }));
      this.update({ devices });
    } catch {
      // Enumeration is best-effort; the default camera still works without it.
    }
  }

  dispose() {
    this.disposed = true;
    this.request += 1;
    stopStream(this.stream);
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    if (mediaSupported()) navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChange);
    this.listeners.clear();
  }

  private async open(deviceId: string | null, facing: Facing): Promise<MediaStream> {
    const target: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: facing };
    let lastError: unknown = new Error('No camera mode could be opened');
    for (const constraints of attempts(target)) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
        if (!(error instanceof DOMException) || !RETRYABLE.has(error.name)) throw error;
      }
    }
    throw lastError;
  }

  /** A camera plugged back in after the stream ended is picked up again by itself. */
  private onDeviceChange = () => {
    void this.refreshDevices();
    if (this.snapshot.status === 'error') void this.start(this.lastOptions);
  };

  private update(patch: Partial<CameraSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
