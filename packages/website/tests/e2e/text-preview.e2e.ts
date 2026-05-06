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
  {
    // Within-word `calt` must still fire — Caveat substitutes the second `s`
    // of "ss" with a contextual variant. Canary against an over-aggressive
    // word-split that would suppress all contextual lookups.
    name: 'calt-within-word',
    params: { t: 'ss', tm: 'controlled', ct: 1000, fs: 128, w: 300, h: 220 },
  },
  {
    // Regression: harfbuzz used to see "s s" as one buffer, so Caveat's calt
    // fired across the space and the canvas drew a variant glyph for the
    // second `s` that the DOM-rendered overlay never produced. The shaper
    // now tokenises at whitespace, mirroring how the browser shapes each
    // word independently — both `s`s should be the nominal glyph.
    name: 'calt-not-across-space',
    params: { t: 's s', tm: 'controlled', ct: 1000, fs: 128, w: 400, h: 220 },
  },
  {
    // Three consecutive `s`s exercise multiple within-word calt
    // substitutions in a single segment. Pairs with `calt-not-across-space`
    // to lock in "split at whitespace, but only at whitespace".
    name: 'calt-triple-s',
    params: { t: 'sss', tm: 'controlled', ct: 1000, fs: 128, w: 400, h: 220 },
  },
  {
    // Overlay-only frame (ct=0, ol=1): the DOM-rendered text must show the
    // same calt-driven glyph shapes the canvas would draw, otherwise the
    // overlay diverges from the animated text below it. Chrome silently
    // skips OpenType layout for text with alpha < 1 — the renderer sets
    // `text-rendering: geometricPrecision` on the overlay to opt back in.
    name: 'overlay-shaping-with-calt',
    params: { t: 'Handwriting is awesome', tm: 'controlled', ct: 0, fs: 72, w: 900, h: 200, ol: 1 },
  },
  {
    // The user-reported scenario: paused mid-animation with the overlay
    // visible. Canvas-drawn portion (left) and overlay portion (right) must
    // share the same glyph forms across the seam, otherwise the typography
    // shifts mid-letter as the animation advances.
    name: 'overlay-canvas-seam',
    params: { t: 'Handwriting is awesome', tm: 'controlled', ct: 8.6411, fs: 72, w: 900, h: 200, ol: 1 },
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
