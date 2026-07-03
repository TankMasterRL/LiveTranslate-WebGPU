// Download the Silero VAD v5 ONNX model into the gitignored .model-cache/ so
// the real-model tests can run without any model files stored in the repo:
// the node integration test (silero-session.integration.test.ts) reads it from
// disk, and the offline Playwright test serves it to the built app in place of
// the Hugging Face hub. Skips the download when the file is already present.
//
// The URL must stay in sync with sileroModelUrl in src/lib/audio/silero-model.ts
// (the URL the app itself fetches at runtime) — the e2e test asserts the match.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const host =
  (process.env.VITE_MODEL_HOST ?? '').trim().replace(/\/+$/, '') || 'https://huggingface.co';
const url = `${host}/onnx-community/silero-vad/resolve/main/onnx/model.onnx`;
const dest = process.env.SILERO_MODEL_PATH ?? '.model-cache/silero_vad_v5.onnx';

if (existsSync(dest)) {
  console.log(`silero model already cached at ${dest}`);
} else {
  console.log(`fetching ${url} -> ${dest}`);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Failed to fetch ${url}: HTTP ${response.status}`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, new Uint8Array(await response.arrayBuffer()));
  console.log(`fetched ${dest}`);
}
