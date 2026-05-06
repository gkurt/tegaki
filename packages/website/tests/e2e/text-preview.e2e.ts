import { expect, type Page, test } from '@playwright/test';

const PAGE = '/tegaki/preview/';

/**
 * Build a URL with the standalone preview params. Values are URL-encoded via
 * URLSearchParams so callers don't have to escape them.
 */
function previewUrl(params: Record<string, string | number>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) p.set(k, String(v));
  return `${PAGE}?${p.toString()}`;
}

/** Wait for the standalone preview to signal that the bundle is loaded and rendered. */
async function waitForReady(page: Page) {
  await page.waitForSelector('body[data-tegaki-ready="true"]', { timeout: 30_000 });
  // Guarantee the font has been applied and the SVG element is actually painted.
  await page.evaluate(() => document.fonts.ready);
  // One extra frame for any final layout pass (stroke widths depend on measured font-size).
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
}

interface PreviewCase {
  /** Snapshot filename (without extension) and step label. */
  name: string;
  /** URL params fed to the standalone text preview. */
  params: Record<string, string | number>;
  /** Extra per-case assertions, evaluated against the container element. */
  extraAssert?: (page: Page) => Promise<void>;
}

const CASES: PreviewCase[] = [
  {
    // ct past the end of the timeline -> clamped to totalDuration, so we snapshot
    // the fully-drawn final frame rather than a mid-animation intermediate.
    name: 'default-hello',
    params: { t: 'Hello', tm: 'controlled', ct: 1000, fs: 96, w: 600, h: 200 },
  },
  {
    // At 320px the phrase must wrap onto multiple lines.
    name: 'wrap-narrow',
    params: { t: 'The quick brown fox jumps over the lazy dog', tm: 'controlled', ct: 1000, fs: 64, w: 320, h: 400 },
    extraAssert: async (page) => {
      const box = await page.locator('[data-tegaki-container]').boundingBox();
      expect(box?.width).toBeCloseTo(320, 0);
    },
  },
  {
    // Same text, wider container -> fewer wrapped lines.
    name: 'wrap-wide',
    params: { t: 'The quick brown fox jumps over the lazy dog', tm: 'controlled', ct: 1000, fs: 64, w: 900, h: 300 },
  },
  {
    name: 'explicit-newlines',
    params: { t: 'Line one\nLine two\nLine three', tm: 'controlled', ct: 1000, fs: 72, w: 600, h: 500 },
  },
  {
    // Mid-animation frame: deterministic because ct is fixed and time mode is 'controlled'.
    name: 'mid-animation',
    params: { t: 'Hello', tm: 'controlled', ct: 0.5, fs: 96, w: 600, h: 200 },
  },
];

test('Standalone text preview — snapshots across URL params', async ({ page }) => {
  for (const c of CASES) {
    await test.step(c.name, async () => {
      await page.goto(previewUrl(c.params));
      await waitForReady(page);
      await c.extraAssert?.(page);
      await expect(page.locator('[data-tegaki-container]')).toHaveScreenshot(`${c.name}.png`);
    });
  }
});
