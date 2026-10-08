import { useEffect, useRef, type ReactNode } from 'react';
import type { Engine } from '../../app/Engine';
import type { CameraFrame } from '../../app/frames';
import type { CameraController } from '../../hooks/useCamera';
import { useElementSize } from '../../hooks/useElementSize';
import { LANDMARK, LANDMARK_COUNT } from '../../tracking/FingerGeometry';
import { SIM_ASPECT } from '../../tracking/SimulatedHands';
import { SIDES, type Side, type TrackingStatus } from '../../types';
import { coverRect, fitCanvas, type Rect } from '../../utils/canvas';
import { clamp } from '../../utils/math';
import { drawSimulatedBackdrop, drawSimulatedHand, drawSkeleton, drawStrings, type OverlayHand } from '../HandOverlay/drawOverlay';
import { MiniaturePuppets, type MiniaturePuppetsHandle } from '../MiniaturePuppet/MiniaturePuppets';

interface CameraViewProps {
  engine: Engine;
  camera: CameraController;
  mirror: boolean;
  simulated: boolean;
  trackingStatus: TrackingStatus;
  held: Record<Side, boolean>;
  lost: Record<Side, boolean>;
  /** Frames per second the camera delivers, when that is too few; null otherwise. */
  slowCamera: number | null;
  /** Pixel-ratio cap from the quality preset. */
  pixelRatio: number;
  onStart: () => void;
  /** HUDs and other overlays, positioned over the preview. */
  children?: ReactNode;
}

interface Notice {
  title: string;
  body: string;
  action: string | null;
  busy?: boolean;
}

/** What to tell the visitor while there is no live picture to look at. */
function notice(status: CameraController['status'], tracking: TrackingStatus): Notice | null {
  switch (status) {
    case 'idle':
      return {
        title: 'Start the camera to perform',
        body: 'Each hand holds one puppet, and every finger pulls its own string. The video is processed on this device and never uploaded.',
        action: 'Start camera',
      };
    case 'requesting':
      return { title: 'Waiting for the camera…', body: 'Allow camera access when your browser asks.', action: null, busy: true };
    case 'denied':
      return {
        title: 'Camera access is blocked',
        body: 'Allow the camera for this site in your browser’s address bar or site settings, then try again.',
        action: 'Try again',
      };
    case 'unsupported':
      return { title: 'This browser cannot open a camera', body: 'Use a current version of Chrome, Edge, Safari or Firefox.', action: null };
    case 'insecure':
      return { title: 'A secure connection is needed', body: 'Browsers only allow camera access over HTTPS or on localhost.', action: null };
    case 'error':
      return { title: 'The camera stopped', body: 'It may be unplugged or in use by another app. Reconnect it and try again.', action: 'Try again' };
    case 'active':
      if (tracking === 'loading') return { title: 'Loading the hand model…', body: 'About 8 MB, once. It is cached after the first visit.', action: null, busy: true };
      if (tracking === 'error') {
        return { title: 'Hand tracking could not start', body: 'The model or its WebAssembly runtime failed to load. Check your connection and reload.', action: null };
      }
      return null;
  }
}

/**
 * The live camera with its tracking overlay. Three stacked layers share one
 * box and one coordinate system (CSS pixels of the preview):
 *
 *   1. the video, `object-fit: cover`, mirrored with CSS when asked
 *   2. a canvas with the hand skeletons and the strings
 *   3. an SVG with the miniature puppets
 *
 * Landmarks arrive normalized to the video and already mirrored, and are
 * mapped through the same cover rectangle the browser uses for the video, so
 * the overlay stays on the hand through any resize, crop or mirroring.
 */
export function CameraView({ engine, camera, mirror, simulated, trackingStatus, held, lost, slowCamera, pixelRatio, onStart, children }: CameraViewProps) {
  const [boxRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const puppetsRef = useRef<MiniaturePuppetsHandle>(null);
  const video = camera.video;

  useEffect(() => {
    const rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
    const hands: Record<Side, OverlayHand> = {
      left: { points: new Float32Array(LANDMARK_COUNT * 2), activity: engine.puppets.left.fingerActivity, pinched: false, alpha: 1 },
      right: { points: new Float32Array(LANDMARK_COUNT * 2), activity: engine.puppets.right.fingerActivity, pinched: false, alpha: 1 },
    };
    let dirty = true;

    const view = {
      render(frame: CameraFrame) {
        const canvas = canvasRef.current;
        if (!canvas || size.width < 2 || size.height < 2) return;
        const element = video();
        const mediaWidth = frame.simulated ? SIM_ASPECT * 900 : (element?.videoWidth ?? 0);
        const mediaHeight = frame.simulated ? 900 : (element?.videoHeight ?? 0);
        coverRect(size.width, size.height, mediaWidth, mediaHeight, rect);
        engine.preview.width = rect.width;
        engine.preview.height = rect.height;

        const anyHand = frame.hands.left !== null || frame.hands.right !== null;
        // With nothing to draw and nothing drawn, leave the canvas alone.
        if (!anyHand && !dirty && !frame.simulated) return;
        const ratio = fitCanvas(canvas, size.width, size.height, pixelRatio);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        if (frame.simulated) drawSimulatedBackdrop(ctx, size.width, size.height);
        else ctx.clearRect(0, 0, size.width, size.height);
        dirty = anyHand;

        const unit = clamp(Math.min(size.width, size.height) / 430, 0.8, 1.6);
        for (const side of SIDES) {
          const detection = frame.hands[side];
          if (!detection) {
            puppetsRef.current?.hide(side);
            continue;
          }
          const hand = hands[side];
          const { points } = hand;
          for (let i = 0; i < LANDMARK_COUNT; i++) {
            points[i * 2] = rect.x + detection.landmarks[i].x * rect.width;
            points[i * 2 + 1] = rect.y + detection.landmarks[i].y * rect.height;
          }
          hand.pinched = frame.pinched[side];
          const palmLength = Math.hypot(
            points[LANDMARK.MIDDLE_MCP * 2] - points[LANDMARK.WRIST * 2],
            points[LANDMARK.MIDDLE_MCP * 2 + 1] - points[LANDMARK.WRIST * 2 + 1],
          );
          if (frame.simulated) drawSimulatedHand(ctx, points, palmLength);

          if (frame.showMiniPuppets) {
            let px = 0;
            let py = 0;
            for (const id of [LANDMARK.WRIST, LANDMARK.INDEX_MCP, LANDMARK.MIDDLE_MCP, LANDMARK.RING_MCP, LANDMARK.PINKY_MCP]) {
              px += points[id * 2] / 5;
              py += points[id * 2 + 1] / 5;
            }
            const presence = frame.handPresence[side];
            const joints = puppetsRef.current?.place(side, frame.rigs[side], px, py, palmLength, presence);
            if (joints) {
              hand.alpha = presence;
              drawStrings(ctx, hand, joints, frame.fingerMap, unit);
            }
          } else puppetsRef.current?.hide(side);

          if (frame.showSkeleton) {
            hand.alpha = 1;
            drawSkeleton(ctx, hand, unit);
          }
        }
      },
    };
    engine.cameraView = view;
    return () => {
      if (engine.cameraView === view) engine.cameraView = null;
    };
  }, [engine, video, size.width, size.height, pixelRatio]);

  const message = simulated ? null : notice(camera.status, trackingStatus);
  const live = camera.status === 'active' || simulated;
  const lostSides = SIDES.filter((side) => lost[side]);
  const nobody = live && !message && !held.left && !held.right && lostSides.length === 0;

  return (
    <section className="camera" ref={boxRef} aria-label="Live camera with hand tracking">
      <video
        ref={camera.videoRef}
        className={`camera__layer camera__video${mirror ? ' camera__video--mirror' : ''}${camera.status === 'active' ? ' is-live' : ''}`}
        playsInline
        muted
        autoPlay
        disablePictureInPicture
        aria-label="Camera preview"
      />
      <canvas className="camera__layer camera__overlay" ref={canvasRef} aria-hidden="true" />
      <MiniaturePuppets width={size.width} height={size.height} ref={puppetsRef} />

      {children}

      {message && (
        <div className="camera__notice" role="status">
          <h2>{message.title}</h2>
          <p>{message.body}</p>
          {message.busy && <span className="camera__spinner" aria-hidden="true" />}
          {message.action && (
            <button type="button" className="button button--primary" onClick={onStart}>
              {message.action}
            </button>
          )}
        </div>
      )}
      {lostSides.length > 0 && (
        <p className="camera__chip camera__chip--warn" role="status">
          TRACKING LOST · {lostSides.map((side) => side.toUpperCase()).join(' + ')} · pose held, easing to rest
        </p>
      )}
      {nobody && <p className="camera__chip">Raise one or both hands into view</p>}
      {slowCamera !== null && !message && (
        <p className="camera__chip camera__chip--top camera__chip--warn" role="status">
          CAMERA DELIVERS {slowCamera} FPS · webcams slow down in dim light · add light for faster tracking
        </p>
      )}
    </section>
  );
}
