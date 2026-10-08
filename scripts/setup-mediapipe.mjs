// Copies the MediaPipe Tasks Vision WASM runtime into /public so it is served
// from our own origin, and makes sure the hand landmarker model is present.
// Runs automatically before `dev` and `build`.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSource = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmTarget = join(root, 'public', 'mediapipe', 'wasm');
const modelPath = join(root, 'public', 'models', 'hand_landmarker.task');
const modelUrl =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

function copyWasm() {
  if (!existsSync(wasmSource)) {
    console.warn('[mediapipe] @mediapipe/tasks-vision is not installed; run yarn install first.');
    return;
  }
  mkdirSync(wasmTarget, { recursive: true });
  let copied = 0;
  // All three builds are needed: the tracking worker is an ES module and loads
  // the module build; the main-thread fallback loads the classic one (SIMD or not).
  for (const file of readdirSync(wasmSource)) {
    const from = join(wasmSource, file);
    const to = join(wasmTarget, file);
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
    copyFileSync(from, to);
    copied++;
  }
  if (copied > 0) console.log(`[mediapipe] copied ${copied} wasm file(s) to public/mediapipe/wasm`);
}

async function ensureModel() {
  if (existsSync(modelPath) && statSync(modelPath).size > 1_000_000) return;
  mkdirSync(dirname(modelPath), { recursive: true });
  console.log('[mediapipe] downloading hand_landmarker.task …');
  try {
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    writeFileSync(modelPath, Buffer.from(await response.arrayBuffer()));
    console.log('[mediapipe] model saved to public/models/hand_landmarker.task');
  } catch (error) {
    console.warn(
      `[mediapipe] could not download the model (${error.message}). ` +
        'The app will fall back to loading it from the MediaPipe CDN at runtime.',
    );
  }
}

copyWasm();
await ensureModel();
