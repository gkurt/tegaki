import { expect, test } from '@playwright/test';
import { EXAMPLES } from './playwright.config.ts';

// Console/page messages that are noise rather than real failures (e.g. a
// missing favicon on a bare example). Real bugs surface as `pageerror`
// (uncaught exceptions, hydration mismatches) which are always fatal.
const BENIGN = [/favicon/i, /Failed to load resource.*404/i];

/** Does any `<canvas>` on the page have at least one non-transparent pixel? */
function pageHasInk(): boolean {
  const canvases = Array.from(document.querySelectorAll('canvas'));
  for (const c of canvases) {
    const ctx = c.getContext('2d');
    if (!ctx || !c.width || !c.height) continue;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return true;
    }
  }
  return false;
}

for (const { name, port } of EXAMPLES) {
  test(`${name} example renders handwriting`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !BENIGN.some((re) => re.test(m.text()))) errors.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

    // The renderer mounts its canvas in an effect, then draws over rAF frames.
    await page.locator('[data-tegaki="canvas"]').first().waitFor({ state: 'attached', timeout: 30_000 });
    await expect.poll(() => page.evaluate(pageHasInk), { timeout: 30_000, message: 'no canvas ever drew any ink' }).toBe(true);

    expect(errors, `runtime errors:\n${errors.join('\n')}`).toEqual([]);
  });
}
