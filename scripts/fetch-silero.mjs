// Download the Silero VAD v5 ONNX model into the gitignored .model-cache/ so
// the real-model tests can run without any model files stored in the repo:
// the node integration test (silero-session.integration.test.ts) reads it from
// disk, and the offline Playwright test serves it to the built app in place of
// the Hugging Face hub. A cached file that fails the integrity check is
// re-downloaded; a download that fails it is rejected outright.
//
// The URL and sha256 pin must stay in sync with sileroModelUrl and
// sileroModelSha256 in src/lib/audio/silero-model.ts (what the app fetches
// and enforces at runtime) — the integration test asserts the match.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const host =
  (process.env.VITE_MODEL_HOST ?? '').trim().replace(/\/+$/, '') || 'https://huggingface.co';
const url = `${host}/onnx-community/silero-vad/resolve/main/onnx/model.onnx`;
const sha256 = 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808';
const dest = process.env.SILERO_MODEL_PATH ?? '.model-cache/silero_vad_v5.onnx';

const hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (existsSync(dest)) {
  const cached = hex(readFileSync(dest));
  if (cached === sha256) {
    console.log(`silero model already cached at ${dest} (sha256 verified)`);
    process.exit(0);
  }
  console.warn(`cached ${dest} fails integrity check (sha256 ${cached}); re-downloading`);
}

console.log(`fetching ${url} -> ${dest}`);
const response = await fetch(url);
if (!response.ok) {
  console.error(`Failed to fetch ${url}: HTTP ${response.status}`);
  process.exit(1);
}
const bytes = new Uint8Array(await response.arrayBuffer());
const actual = hex(bytes);
if (actual !== sha256) {
  console.error(
    `Integrity check failed for ${url} (${bytes.length} bytes):\n  expected sha256 ${sha256}\n  got      sha256 ${actual}\n` +
      `Refusing to write ${dest}. If the model was upgraded upstream on purpose, verify the new\n` +
      `file out-of-band, then update the pin here and in src/lib/audio/silero-model.ts together.`
  );
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, bytes);
console.log(`fetched ${dest} (sha256 verified)`);
