/// <reference types="bun-types" />
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

// The smoke tests normally run against the workspace examples. The post-release
// check (scripts/test-published-examples.ts) points this at copies that have the
// *published* npm package installed instead, by setting TEGAKI_EXAMPLES_DIR.
const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = process.env.TEGAKI_EXAMPLES_DIR ? resolve(process.env.TEGAKI_EXAMPLES_DIR) : resolve(here, '../../examples');

export interface Example {
  name: string;
  port: number;
  /**
   * A selector per renderer on the page that must draw ink: each is checked on
   * its own, its canvas found inside the matched element, open shadow roots
   * included (the web component draws into its shadow root). Without it, any
   * renderer drawing anywhere on the page passes.
   */
  renderers?: readonly string[];
  /**
   * Console errors from a known, tracked bug that the smoke test tolerates for
   * this example only (every other console error still fails it). Remove the
   * entry once the bug is fixed.
   */
  knownErrors?: readonly RegExp[];
}

// Each web example is built ahead of time (see `bun run build:examples`) and
// served here from its production output on a dedicated port. The smoke tests
// then load each one in a real browser and assert the renderer actually drew.
export const EXAMPLES: readonly Example[] = [
  { name: 'vite', port: 4310 },
  { name: 'next', port: 4311 },
  { name: 'nuxt', port: 4312 },
  { name: 'svelte', port: 4313, renderers: ['#looping', '#scrubbable'] },
  { name: 'vue', port: 4314, renderers: ['#looping', '#scrubbable', '#arabic'] },
  { name: 'solid', port: 4315, renderers: ['#looping', '#scrubbable'] },
  {
    name: 'astro',
    port: 4316,
    renderers: ['#looping', '#finished'],
    // Known bug: `tegaki/astro` serializes the bundle as the server evaluated it,
    // and a font bundle's `fontUrl` / `fullFontUrl` are `new URL('./x.ttf',
    // import.meta.url)` — a `file://` path on the build machine once prerendered.
    // The browser refuses to load it, so the page falls back to an unloaded font
    // (the strokes still draw from the glyph data).
    // Each engine words it differently (Chromium: "Not allowed to load local resource"; Firefox: a
    // security error and a failed download), but every message names the file:// font URL.
    knownErrors: [/file:\/\/\S*\.ttf/],
  },
  { name: 'vanilla', port: 4317, renderers: ['#wc', '#core'] },
];

function portOf(name: string): number {
  const example = EXAMPLES.find((e) => e.name === name);
  if (!example) throw new Error(`Unknown example: ${name}`);
  return example.port;
}

/** The Vite-built examples (and Astro, whose preview takes the same flags) serve their `dist/` with `<bundler> preview`. */
function previewServer(name: string, extraFlags = '') {
  const port = portOf(name);
  return {
    command: `bun run preview --port ${port} --host 127.0.0.1${extraFlags}`,
    cwd: resolve(EXAMPLES_DIR, name),
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !CI,
    timeout: 120_000,
    stdout: 'ignore' as const,
    stderr: 'pipe' as const,
  };
}

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
  // Every example in all three engines: WebKit is what every iOS browser runs
  // (Safari and Chrome alike — gkurt/tegaki#29 was the renderer not showing on
  // an iPhone), and `mobile-webkit` adds the phone viewport, touch and a 3×
  // device pixel ratio on top. Run one with `--project=webkit`.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 15'] } },
  ],
  webServer: [
    previewServer('vite'),
    {
      command: 'bun run start --port 4311 --hostname 127.0.0.1',
      cwd: resolve(EXAMPLES_DIR, 'next'),
      url: 'http://127.0.0.1:4311/',
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'bun run preview',
      cwd: resolve(EXAMPLES_DIR, 'nuxt'),
      env: { PORT: '4312', HOST: '127.0.0.1', NITRO_PORT: '4312', NITRO_HOST: '127.0.0.1' },
      url: 'http://127.0.0.1:4312/',
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    previewServer('svelte'),
    previewServer('vue'),
    previewServer('solid'),
    // Under a coding agent `astro preview` detaches into a background server and
    // exits, which Playwright reads as the server dying; `--ignore-lock` keeps
    // it in the foreground (and skips the lock file) wherever it runs.
    previewServer('astro', ' --ignore-lock'),
    previewServer('vanilla'),
  ],
});
