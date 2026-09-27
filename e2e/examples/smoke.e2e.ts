import { expect, test } from '@playwright/test';
import { EXAMPLES } from './playwright.config.ts';

// Console/page messages that are noise rather than real failures (e.g. a
// missing favicon on a bare example). Real bugs surface as `pageerror`
// (uncaught exceptions, hydration mismatches) which are always fatal.
const BENIGN = [/favicon/i, /Failed to load resource.*404/i];

interface InkSample {
  /** Renderer canvases found (`[data-tegaki="canvas"]`, web components' shadow roots included). */
  canvases: number;
  /** Non-transparent pixels across all of them. */
  ink: number;
  /** A canvas `getImageData` refused to read (tainted) — the message, so the failure says why. */
  unreadable: string | null;
}

/**
 * Count the ink the renderers inside `selector`'s element (the whole document
 * when null) drew. Runs in the page. Only the renderer's own canvases count
 * (not an effect's scratch canvas), and a web component's live in its shadow
 * root, so every open shadow root is searched too. A canvas `getImageData`
 * can't read — tainted, which WebKit and Firefox enforce more strictly than
 * Chromium — is reported rather than thrown, so the poll's failure names it.
 */
function sampleInk(selector: string | null): InkSample {
  const canvases: HTMLCanvasElement[] = [];
  const visit = (root: Document | Element | ShadowRoot) => {
    canvases.push(...root.querySelectorAll<HTMLCanvasElement>('canvas[data-tegaki="canvas"]'));
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
  };
  const root = selector ? document.querySelector(selector) : document;
  if (root instanceof Element && root.shadowRoot) visit(root.shadowRoot);
  if (root) visit(root);
  let ink = 0;
  let unreadable: string | null = null;
  for (const c of canvases) {
    if (!c.width || !c.height) continue;
    const ctx = c.getContext('2d');
    if (!ctx) continue;
    try {
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) ink++;
    } catch (e) {
      unreadable = (e as Error).message;
    }
  }
  return { canvases: canvases.length, ink, unreadable };
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
        .poll(
          async () => {
            const s = await page.evaluate(sampleInk, selector);
            return s.unreadable ? `unreadable canvas: ${s.unreadable}` : s.ink > 0 ? 'ink' : `no ink in ${s.canvases} canvases`;
          },
          {
            timeout: 30_000,
            message: selector ? `the renderer in ${selector} never drew any ink` : 'no renderer canvas ever drew any ink',
          },
        )
        .toBe('ink');
    }

    // Every example has a looping renderer, so the ink must keep changing: the
    // engine's rAF loop is really animating, not a canvas painted once (or the
    // plain-text fallback a renderer that failed would leave behind).
    let last = (await page.evaluate(sampleInk, null)).ink;
    await expect
      .poll(
        async () => {
          const { ink } = await page.evaluate(sampleInk, null);
          const moved = ink !== last;
          last = ink;
          return moved;
        },
        { timeout: 15_000, intervals: [250], message: 'the ink never changed — the animation is not running' },
      )
      .toBe(true);

    expect(errors, `runtime errors:\n${errors.join('\n')}`).toEqual([]);
  });
}

test("svelte example follows a style change after mount, keeping the engine's root styles", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${EXAMPLES.find((e) => e.name === 'svelte')!.port}/`, { waitUntil: 'load' });
  const root = page.locator('#scrubbable [data-tegaki="root"]');
  const state = () =>
    root.evaluate((el: HTMLElement) => ({
      fontSize: getComputedStyle(el).fontSize,
      fontFamily: el.style.fontFamily,
      duration: el.style.getPropertyValue('--tegaki-duration'),
    }));
  const inkWidth = () =>
    root.evaluate((el) => {
      const c = el.querySelector<HTMLCanvasElement>('canvas[data-tegaki="canvas"]')!;
      const { data, width } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      let min = width;
      let max = -1;
      for (let i = 3; i < data.length; i += 4) {
        if (!data[i]) continue;
        const x = ((i - 3) / 4) % width;
        min = Math.min(min, x);
        max = Math.max(max, x);
      }
      return max - min;
    });

  await expect.poll(inkWidth, { timeout: 30_000, message: 'the scrubbable renderer never drew' }).toBeGreaterThan(0);
  const before = await state();
  const widthBefore = await inkWidth();
  expect(before.fontSize).toBe('48px');
  expect(before.fontFamily).not.toBe('');
  expect(before.duration).not.toBe('');

  await page.locator('#resize').click();
  await expect.poll(async () => (await state()).fontSize).toBe('72px');
  // Svelte rewriting the whole style attribute would have wiped these.
  expect(await state()).toMatchObject({ fontFamily: before.fontFamily, duration: before.duration });
  await expect.poll(inkWidth, { message: 'the handwriting was not redrawn at the new size' }).toBeGreaterThan(widthBefore * 1.3);

  await page.locator('#resize').click();
  await expect.poll(async () => (await state()).fontSize).toBe('48px');
});
