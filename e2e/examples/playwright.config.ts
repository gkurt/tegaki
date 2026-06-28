/// <reference types="bun-types" />
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

// Each web example is built ahead of time (see `bun run build:examples`) and
// served here from its production output on a dedicated port. The smoke tests
// then load each one in a real browser and assert the renderer actually drew.
export const EXAMPLES = [
  { name: 'vite', port: 4310 },
  { name: 'next', port: 4311 },
  { name: 'nuxt', port: 4312 },
] as const;

export default defineConfig({
  testDir: '.',
  // `.e2e.ts` (not `.spec.ts`) so the unit runner (`bun test`) skips these.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: 1,
  reporter: CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: { trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'bun run preview --port 4310 --host 127.0.0.1',
      cwd: '../../examples/vite',
      url: 'http://127.0.0.1:4310/',
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'bun run start --port 4311 --hostname 127.0.0.1',
      cwd: '../../examples/next',
      url: 'http://127.0.0.1:4311/',
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'bun run preview',
      cwd: '../../examples/nuxt',
      env: { PORT: '4312', HOST: '127.0.0.1', NITRO_PORT: '4312', NITRO_HOST: '127.0.0.1' },
      url: 'http://127.0.0.1:4312/',
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
