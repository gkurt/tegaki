import type { Page } from '@playwright/test';

// Helpers shared by the /preview/ specs. Not an `.e2e.ts` file, so
// Playwright loads it only through the specs' imports.

const PAGE = '/preview/';

/** URL params fed to the standalone text preview (see url-state.ts for the keys). */
export type PreviewParams = Record<string, string | number>;

/**
 * Build a URL with the standalone preview params. Values are URL-encoded via
 * URLSearchParams so callers don't have to escape them. The default is the
 * geometry pipeline (what the shipped bundles use); a case can still set
 * `pl=raster`.
 */
export function previewUrl(params: PreviewParams): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) p.set(k, String(v));
  return `${PAGE}?${p.toString()}`;
}

/** Wait for the standalone preview to signal that the bundle is loaded and rendered. */
export async function waitForReady(page: Page) {
  // A font that fails to load shows `[data-tegaki-error]` and never gets ready:
  // fail with its message rather than the timeout.
  await page.waitForSelector('body[data-tegaki-ready="true"], [data-tegaki-error]', { timeout: 30_000 });
  const error = page.locator('[data-tegaki-error]');
  if (await error.count()) throw new Error(`the preview failed: ${await error.textContent()}`);
  // Guarantee the font has been applied and the SVG element is actually painted.
  await page.evaluate(() => document.fonts.ready);
  // One extra frame for any final layout pass (stroke widths depend on measured font-size).
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
}
