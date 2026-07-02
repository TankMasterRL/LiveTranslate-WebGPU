import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The remote environment ships a prebuilt Chromium at /opt/pw-browsers; use it
// when present so we never download a browser there. Elsewhere (e.g. CI) fall
// back to Playwright's own installed Chromium.
const prebuilt = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const chromiumPath = existsSync(prebuilt) ? prebuilt : undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(chromiumPath ? { executablePath: chromiumPath } : {}),
          // Fake mic so getUserMedia flows can run headless without prompts.
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
        }
      }
    }
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
