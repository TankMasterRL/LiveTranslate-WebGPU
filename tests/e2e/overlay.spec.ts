import { expect, test } from '@playwright/test';

// A stub of the YouTube IFrame Player API so the e2e is deterministic and needs
// no network / real embed. getCurrentTime returns 0.1s so the first demo cue
// (0–3800ms) is active.
const YT_STUB = `
  window.YT = {
    Player: function (el, opts) {
      this.getCurrentTime = function () { return 0.1; };
      this.getDuration = function () { return 100; };
      this.getPlayerState = function () { return 1; };
      this.playVideo = function () {};
      this.pauseVideo = function () {};
      this.loadVideoById = function () {};
      this.destroy = function () {};
      var self = this;
      setTimeout(function () { opts.events && opts.events.onReady && opts.events.onReady({ target: self, data: 1 }); }, 0);
    },
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }
  };
  if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();
`;

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

  const mode = page.getByLabel(/mode/i);
  await expect(mode).toBeVisible();

  await mode.selectOption('local');
  await expect(page.getByLabel(/target language/i)).toBeVisible();
  await expect(page.getByLabel(/source language/i)).toBeVisible();

  await mode.selectOption('api');
  await expect(page.getByLabel(/endpoint/i)).toBeVisible();
  await expect(page.getByLabel(/api key/i)).toBeVisible();

  await page.screenshot({ path: 'test-results/translate-panel.png', fullPage: true });
});

test('silero vad loads in the browser without falling back', async ({ page }) => {
  // Whisper weights are fetched from the Hugging Face hub, which this test
  // environment can't reach — block them so the pipeline fails fast *after*
  // the VAD stage. Silero is vendored locally, so it must load fine.
  await page.route(/huggingface\.co/, (route) => route.abort());

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
