import { CHANNEL_LABEL } from '../../motion/PuppetMapping';
import { JOINT_CHANNELS, type FingerMap, type FingerName } from '../../types';
import { CloseIcon } from '../Header/icons';

interface GestureGuideProps {
  fingerMap: FingerMap;
  onClose: () => void;
}

const FINGER_LABEL: Record<FingerName, string> = { thumb: 'Thumb', index: 'Index finger', middle: 'Middle finger', ring: 'Ring finger', pinky: 'Little finger' };

const EFFECT: Record<keyof FingerMap, string> = {
  frontShoulder: 'Straight raises the front arm and the paddle; bending lowers it. Where the finger points aims the arm.',
  frontElbow: 'Bending folds the front elbow and brings the paddle up.',
  frontWrist: 'Spreading and bending it turns the wrist: this is how the paddle is angled and flicked.',
  backShoulder: 'Straight lifts the back arm out behind; bending lets it hang.',
  backElbow: 'Bending folds the back elbow and raises the keris.',
};

const HAND: readonly (readonly [string, string])[] = [
  ['Move the hand left / right', 'The puppet walks across its side of the stage.'],
  ['Raise / lower the hand', 'Lifts the puppet off the ground; pressing down folds its knees.'],
  ['Roll the wrist', 'Leans the body forward or back.'],
  ['Bring the hand closer to the camera', 'Draws the puppet toward the lamp: larger, softer.'],
  ['Pinch thumb and index', 'The grip: it closes gradually as the fingertips approach. Near the ball or a fly it catches it; opening lets it go (that is how you serve).'],
];

const STAGE: readonly (readonly [string, string])[] = [
  ['Fly hunt', 'Swing the paddle through a fly to knock it down. A slow paddle only shoos them away.'],
  ['Rally', 'After five swats (or the Rally button) a ball is served over the table. Meet it with the paddle to send it back.'],
  ['One hand', 'The flies pick up the other puppet’s strings and play against you.'],
  ['Two hands', 'Each hand holds one puppet. They never swap, even when your hands cross.'],
];

/** How to play: the live finger → joint mapping, the whole-hand controls and the two stage games. */
export function GestureGuide({ fingerMap, onClose }: GestureGuideProps) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Gesture guide">
      <div className="modal__card">
        <header className="settings__head">
          <h2>Gesture guide</h2>
          <button type="button" className="icon-button" aria-label="Close gesture guide" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="settings__scroll">
          <p className="settings__note">
            Each hand holds one puppet. Nothing needs to be held or timed: every channel is continuous, and a small movement already shows.
          </p>
          <h3>Fingers</h3>
          <dl className="guide">
            {JOINT_CHANNELS.map((channel) => (
              <div key={channel}>
                <dt>
                  {FINGER_LABEL[fingerMap[channel]]} <span>→ {CHANNEL_LABEL[channel]}</span>
                </dt>
                <dd>{EFFECT[channel]}</dd>
              </div>
            ))}
          </dl>
          <h3>Whole hand</h3>
          <dl className="guide">
            {HAND.map(([what, effect]) => (
              <div key={what}>
                <dt>{what}</dt>
                <dd>{effect}</dd>
              </div>
            ))}
          </dl>
          <h3>On stage</h3>
          <dl className="guide">
            {STAGE.map(([what, effect]) => (
              <div key={what}>
                <dt>{what}</dt>
                <dd>{effect}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
