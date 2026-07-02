// Regenerates docs/screenshot.png, the screenshot embedded in README.md.
// Run via `bun run screenshot` (which builds first) after any visual UI
// change, and commit the updated PNG.
//
// Serves the static build with Vite's preview server and drives it with
// Playwright: the YouTube IFrame API is stubbed (same stub as the e2e suite)
// so the shot is deterministic and needs no network, then the demo cues are
// previewed so the subtitle overlay is visible over the player.
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { YT_STUB } from '../tests/e2e/yt-stub.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'docs', 'screenshot.png');

// Same prebuilt-Chromium handling as playwright.config.ts.
const prebuilt = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const chromiumPath = existsSync(prebuilt) ? prebuilt : undefined;

if (!existsSync(path.join(root, 'build', 'index.html'))) {
  console.error('No build output found — run `bun run build` first (or use `bun run screenshot`).');
  process.exit(1);
}

const server = await preview({ root, preview: { port: 4175 } });
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite preview server reported no local URL');

const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  // Software (SwiftShader) WebGPU adapter, so the "WebGPU ready" badge shows
  // the state a user with a WebGPU-capable browser actually sees.
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader']
});
try {
  // 2x scale so the PNG stays crisp at GitHub's rendered README width. The
  // height is adjusted after load to end just below the transcription panel.
  const page = await browser.newPage({
    viewport: { width: 1180, height: 860 },
    deviceScaleFactor: 2
  });
  await page.route('**/iframe_api', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: YT_STUB })
  );

  await page.goto(url);
  await page.getByRole('button', { name: /load video/i }).click();
  await page.getByRole('button', { name: /preview subtitle overlay/i }).click();
  await page.getByTestId('subtitle-line').waitFor();

  // Frame the shot from the page top down to just below the Live
  // transcription panel (header + controls + video/overlay + panel with the
  // WebGPU badge) — measured, so it adapts when the layout changes.
  const panelBottom = await page
    .getByRole('heading', { name: /live transcription/i })
    .evaluate((el) => el.closest('section').getBoundingClientRect().bottom + window.scrollY);
  // +16px keeps a margin below the panel without reaching the next one
  // (the page stacks panels 20px apart).
  await page.setViewportSize({ width: 1180, height: Math.ceil(panelBottom + 16) });

  // Settle rendering: fonts loaded, no focus ring, back at the top of the
  // page (clicking scrolls the buttons into view).
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.blur()
  );
  await page.evaluate(() => window.scrollTo(0, 0));

  await mkdir(path.dirname(outFile), { recursive: true });
  await page.screenshot({ path: outFile });
  console.log(`Wrote ${path.relative(root, outFile)}`);
} finally {
  await browser.close();
  await server.close();
}
