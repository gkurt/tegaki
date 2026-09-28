/// <reference types="bun" />
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4321);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // `.e2e.ts` (not `.spec.ts`) so `bun test` — which matches `*.spec.ts` — skips them.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  expect: {
    // The renderer emits sub-pixel antialiasing differences across runs and
    // across OSes, so allow a small pixel delta before failing a snapshot.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' },
  },
  // Chromium runs every spec. WebKit (what every iOS browser runs —
  // gkurt/tegaki#29) and Firefox run only the cross-browser render check: the
  // pixel snapshots are committed for Chromium alone, so text-preview.e2e.ts
  // stays out of their runs. Run one engine with `--project=webkit`.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: '**/cross-browser.e2e.ts',
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: '**/cross-browser.e2e.ts',
    },
  ],
  webServer: {
    // --ignore-lock keeps astro in the foreground: run by a coding agent, astro 7
    // moves `astro dev` to the background, and Playwright takes the exit for a crash.
    command: `bun dev --port ${PORT} --host 127.0.0.1 --ignore-lock`,
    url: `${BASE_URL}/preview/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
