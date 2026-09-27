import { expect, test } from '@playwright/test';
import { EXAMPLES } from './playwright.config.ts';

// Console/page messages that are noise rather than real failures (e.g. a
// missing favicon on a bare example). Real bugs surface as `pageerror`
// (uncaught exceptions, hydration mismatches) which are always fatal.
const BENIGN = [/favicon/i, /Failed to load resource.*404/i];

/**
 * Does a `<canvas>` inside `selector`'s element (the whole document when
 * omitted) have at least one non-transparent pixel? Walks open shadow roots,
 * so a `<tegaki-renderer>`'s shadow-root canvas counts too.
 */
function hasInk(selector: string | null): boolean {
  const root = selector ? document.querySelector(selector) : document;
  if (!root) return false;
  const canvases: HTMLCanvasElement[] = [];
  const walk = (node: ParentNode) => {
    for (const el of node.querySelectorAll('*')) {
      if (el instanceof HTMLCanvasElement) canvases.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  if (root instanceof Element && root.shadowRoot) walk(root.shadowRoot);
  walk(root);
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

for (const { name, port, renderers, knownErrors = [] } of EXAMPLES) {
  test(`${name} example renders handwriting`, async ({ page }) => {
    const errors: string[] = [];
    const tolerated = [...BENIGN, ...knownErrors];
    page.on('console', (m) => {
      if (m.type() === 'error' && !tolerated.some((re) => re.test(m.text()))) errors.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

    // The renderer mounts its canvas in an effect, then draws over rAF frames.
    // (CSS locators pierce open shadow roots, so this finds the web component's too.)
    await page.locator('[data-tegaki="canvas"]').first().waitFor({ state: 'attached', timeout: 30_000 });
    for (const selector of renderers ?? [null]) {
      await expect
        .poll(() => page.evaluate(hasInk, selector), {
          timeout: 30_000,
          message: selector ? `the renderer in ${selector} never drew any ink` : 'no canvas ever drew any ink',
        })
        .toBe(true);
    }

    expect(errors, `runtime errors:\n${errors.join('\n')}`).toEqual([]);
  });
}
