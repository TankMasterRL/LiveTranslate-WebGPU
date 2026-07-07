import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { sileroModelUrl } from '../../src/lib/audio/silero-model';
import { YT_STUB } from './yt-stub.js';

test.beforeEach(async ({ page }) => {
  await page.route('**/iframe_api', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: YT_STUB })
  );
});

test('overlays demo subtitles on top of the loaded player', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /load video/i }).click();

  // The overlay layer mounts over the player once a video is loaded.
  await expect(page.getByTestId('subtitle-overlay')).toBeVisible();

  await page.getByRole('button', { name: /preview subtitle overlay/i }).click();

  const line = page.getByTestId('subtitle-line');
  await expect(line).toBeVisible();
  await expect(line).toContainText('rendered by SvelteKit');

  // The demo cues also populate the transcript history panel.
  await expect(page.getByTestId('transcript-list')).toBeVisible();

  await page.screenshot({ path: 'test-results/overlay.png', fullPage: true });
});

test('persists appearance settings across reloads', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/theme/i).selectOption('terminal');
  await page.reload();
  await expect(page.getByLabel(/theme/i)).toHaveValue('terminal');
});

test('translation panel exposes local and api modes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /load video/i }).click();

  // By role+name: "Recognition model" in the transcribe panel also matches
  // a bare /mode/i label lookup.
  const mode = page.getByRole('combobox', { name: 'Mode', exact: true });
  await expect(mode).toBeVisible();

  await mode.selectOption('local');
  await expect(page.getByLabel(/target language/i)).toBeVisible();
  await expect(page.getByLabel(/source language/i)).toBeVisible();

  await mode.selectOption('api');
  await expect(page.getByLabel(/endpoint/i)).toBeVisible();
  await expect(page.getByLabel(/api key/i)).toBeVisible();

  await page.screenshot({ path: 'test-results/translate-panel.png', fullPage: true });
});

test('transcription panel offers whisper and nemotron recognition models', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /load video/i }).click();

  const model = page.getByLabel(/recognition model/i);
  await expect(model).toBeVisible();
  await expect(model).toHaveValue('whisper');
  // The spoken-language prompt only applies to Nemotron's conditioning.
  await expect(page.getByLabel(/spoken language/i)).not.toBeVisible();

  await model.selectOption('nemotron');
  await expect(page.getByLabel(/spoken language/i)).toHaveValue('auto');

  // The choice persists like the other capture settings. (The panel only
  // renders once a video is loaded, so load one again after the reload.)
  await page.reload();
  await page.getByRole('button', { name: /load video/i }).click();
  await expect(page.getByLabel(/recognition model/i)).toHaveValue('nemotron');
});

test('silero vad loads in the browser without falling back', async ({ page }) => {
  // All model weights download from the Hugging Face hub, which this test
  // environment can't reach. Serve the real Silero bytes from the local fetch
  // cache (`bun run fetch:models` — CI's Dockerfile.test does this at build
  // time) at the exact URL the app requests, and block everything else so the
  // pipeline fails fast *after* the VAD stage. This proves ort-web + the real
  // model load in the built app; skip when the model hasn't been fetched.
  const modelPath = process.env.SILERO_MODEL_PATH ?? '.model-cache/silero_vad_v5.onnx';
  test.skip(
    !existsSync(modelPath),
    `no silero model at ${modelPath} — run \`bun run fetch:models\``
  );
  const model = readFileSync(modelPath);
  await page.route(/huggingface\.co/, (route) =>
    route.request().url() === sileroModelUrl()
      ? route.fulfill({ contentType: 'application/octet-stream', body: model })
      : route.abort()
  );

  await page.goto('/');
  await page.getByRole('button', { name: /load video/i }).click();
  await page.getByLabel(/audio source/i).selectOption('microphone');
  await page.getByLabel(/voice detection/i).selectOption('silero');
  await page.getByRole('button', { name: /start transcription/i }).click();

  // Wait for a terminal state: listening, or the expected Whisper load error.
  await expect(
    page.getByText(/listening — speak/i).or(page.getByRole('alert').filter({ hasText: /./ }))
  ).toBeVisible({ timeout: 60_000 });

  // The one failure that must NOT happen: the Silero ONNX session.
  await expect(page.getByText(/silero vad failed/i)).not.toBeVisible();
});

test('rejects input with no video id', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox').fill('https://example.com/not-a-video');
  await page.getByRole('button', { name: /load video/i }).click();
  await expect(page.getByRole('alert')).toContainText(/video id/i);
});
