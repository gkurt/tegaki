import { expect, type Page, test } from '@playwright/test';
import { type PreviewParams, previewUrl, waitForReady } from './preview.ts';

// The render check for every engine — Chromium, WebKit and Firefox (see the
// projects in playwright.config.ts). Pixel snapshots differ per engine, and
// the committed ones are Chromium's, so this spec asserts structure instead:
// the ink is there, where the DOM text is, grows as time moves forward, runs
// the way the script writes, and carries the effects' colors.

/** Rect in client CSS px. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the renderer's canvas holds, measured in the page by {@link measureInk}. */
interface InkReport {
  /** Why nothing could be measured (no container / canvas / overlay, or the canvas is unreadable). */
  problem: string | null;
  /** The DOM text layer's text. */
  overlayText: string;
  /** Pixels with any ink (alpha > 0), in CSS px² so pixel ratios compare. */
  area: number;
  /** Box of the solid ink (alpha ≥ 64: antialiasing and faint glow halos left out). Null when there is none. */
  box: Box | null;
  /** Horizontal center of mass of the ink, in client px. */
  centroidX: number;
  /** The DOM overlay's text box (a Range over its contents) and the preview container. */
  text: Box;
  container: Box;
  /** Solid, saturated ink pixels per 30° hue bucket (0 = red, 10 = magenta). */
  hues: number[];
}

/** Runs in the page: read the preview's canvas and DOM text layer. */
function measureInk(): InkReport {
  const empty = { left: 0, top: 0, right: 0, bottom: 0 };
  const report: InkReport = { problem: null, overlayText: '', area: 0, box: null, centroidX: 0, text: empty, container: empty, hues: [] };
  const rect = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const container = document.querySelector('[data-tegaki-container]');
  if (!container) {
    const error = document.querySelector('[data-tegaki-error]');
    return { ...report, problem: error ? `preview error: ${error.textContent}` : 'no [data-tegaki-container]' };
  }
  const canvas = container.querySelector<HTMLCanvasElement>('canvas[data-tegaki="canvas"]');
  const overlay = container.querySelector<HTMLElement>('[data-tegaki="overlay"]');
  if (!canvas) return { ...report, problem: 'no [data-tegaki="canvas"]' };
  if (!overlay) return { ...report, problem: 'no [data-tegaki="overlay"]' };
  report.overlayText = overlay.textContent ?? '';
  report.container = rect(container.getBoundingClientRect());
  const range = document.createRange();
  range.selectNodeContents(overlay);
  report.text = rect(range.getBoundingClientRect());

  const c = rect(canvas.getBoundingClientRect());
  if (!canvas.width || !canvas.height || c.right <= c.left || c.bottom <= c.top) return { ...report, problem: 'the canvas has no size' };
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ...report, problem: 'the canvas has no 2d context' };
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch (e) {
    return { ...report, problem: `unreadable canvas: ${(e as Error).message}` };
  }
  const sx = canvas.width / (c.right - c.left);
  const sy = canvas.height / (c.bottom - c.top);
  const hues = new Array(12).fill(0);
  let count = 0;
  let sumX = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const a = data[i + 3]!;
      if (a === 0) continue;
      count++;
      sumX += x;
      if (a < 64) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // getImageData un-premultiplies, so the channels are the ink's own color.
      const r = data[i]! / 255;
      const g = data[i + 1]! / 255;
      const b = data[i + 2]! / 255;
      const max = Math.max(r, g, b);
      const chroma = max - Math.min(r, g, b);
      if (a < 128 || max === 0 || chroma / max < 0.4) continue;
      const h = max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
      hues[Math.floor(h * 2) % 12]++;
    }
  }
  report.area = count / (sx * sy);
  report.hues = hues;
  if (count > 0) report.centroidX = c.left + sumX / count / sx;
  if (maxX >= 0)
    report.box = { left: c.left + minX / sx, top: c.top + minY / sy, right: c.left + (maxX + 1) / sx, bottom: c.top + (maxY + 1) / sy };
  return report;
}

async function ink(page: Page): Promise<InkReport> {
  const report = await page.evaluate(measureInk);
  expect(report.problem, 'the preview could not be measured').toBeNull();
  return report;
}

/** Let the renderer draw what it was just told to (two frames: the update, then the paint). */
async function nextFrames(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
}

/** Controlled time: move the live engine (`window.__tegakiEngine`, the preview's debugging handle) to `time` seconds. */
async function seek(page: Page, time: number): Promise<InkReport> {
  await page.evaluate(
    (t) => (window as unknown as { __tegakiEngine: { update(o: { time: number }): void } }).__tegakiEngine.update({ time: t }),
    time,
  );
  await nextFrames(page);
  return ink(page);
}

const totalDuration = (page: Page) => page.evaluate(() => window.__tegakiPreviewReady?.totalDuration ?? 0);

const width = (b: Box) => b.right - b.left;
const height = (b: Box) => b.bottom - b.top;

/**
 * The fully written frame is sane in any engine: the ink lies inside the
 * container, over the DOM text (so layout, direction and the canvas mapping
 * agree), spans most of it, and covers a plausible share of it — not a
 * speck, not a filled box.
 */
function expectWritten(report: InkReport, text: string, fontSize: number) {
  expect(report.overlayText, 'the DOM text layer holds the text').toBe(text);
  expect(report.box, 'the canvas holds solid ink').not.toBeNull();
  const box = report.box!;
  const slack = fontSize * 0.25;
  const { text: t, container: c } = report;
  expect(box.left, 'ink starts inside the container').toBeGreaterThanOrEqual(c.left - slack);
  expect(box.right, 'ink ends inside the container').toBeLessThanOrEqual(c.right + slack);
  expect(box.top, 'ink starts inside the container').toBeGreaterThanOrEqual(c.top - slack);
  expect(box.bottom, 'ink ends inside the container').toBeLessThanOrEqual(c.bottom + slack);
  expect(box.left, 'ink starts near the DOM text').toBeGreaterThanOrEqual(t.left - slack);
  expect(box.right, 'ink ends near the DOM text').toBeLessThanOrEqual(t.right + slack);
  expect(box.top, 'ink is not above the DOM text').toBeGreaterThanOrEqual(t.top - slack);
  expect(box.bottom, 'ink is not below the DOM text').toBeLessThanOrEqual(t.bottom + slack);
  expect(width(box), 'ink spans the DOM text').toBeGreaterThan(width(t) * 0.7);
  expect(height(box), 'ink is as tall as writing').toBeGreaterThan(height(t) * 0.25);
  // Plain strokes cover ~15% of their text box, a glow's halo ~55%; a canvas
  // flooded with ink (or a mis-scaled one) goes past the box's own area.
  const coverage = report.area / (width(t) * height(t));
  expect(coverage, 'ink covers a plausible share of the text box').toBeGreaterThan(0.03);
  expect(coverage, 'ink covers a plausible share of the text box').toBeLessThan(0.85);
}

interface CrossBrowserCase {
  name: string;
  /** Preview params; `t` and `fs` are required, the time mode is the case's own. */
  params: PreviewParams & { t: string; fs: number };
  /** Single-line text: the way the writing moves, checked from the ink's center of mass mid-way. */
  direction?: 'ltr' | 'rtl';
  /** Extra assertions on the written frame. */
  extraAssert?: (report: InkReport) => void;
}

// A spread of scripts and features, each through the same checks. `w` / `h`
// fix the container so every engine lays the text out in the same box.
const CASES: CrossBrowserCase[] = [
  { name: 'latin-caveat', params: { t: 'Hello World', fs: 96, w: 700, h: 200 }, direction: 'ltr' },
  { name: 'arabic-amiri-rtl', params: { f: 'Amiri', t: 'مرحبا بالعالم', fs: 96, w: 700, h: 240 }, direction: 'rtl' },
  { name: 'devanagari-tillana', params: { f: 'Tillana', t: 'नमस्ते हिन्दी', fs: 96, w: 800, h: 220 }, direction: 'ltr' },
  { name: 'japanese-klee-one', params: { f: 'Klee One', t: 'ひらがな山川', fs: 96, w: 700, h: 200 }, direction: 'ltr' },
  {
    // Glow is a blurred pass under the stroke; a rainbow gradient colors each stroke.
    name: 'effects-glow-rainbow',
    params: {
      t: 'Glow',
      fs: 128,
      w: 500,
      h: 240,
      fx: JSON.stringify({
        glow: { enabled: true, radius: 10, color: '#00ccff', offsetX: 0, offsetY: 0 },
        strokeGradient: { enabled: true, colors: 'rainbow', saturation: 80, lightness: 55 },
      }),
    },
    extraAssert: (report) => {
      const buckets = report.hues.filter((n) => n > 20).length;
      expect(buckets, `the rainbow gradient paints several hues (${report.hues.join(',')})`).toBeGreaterThanOrEqual(4);
    },
  },
];

test.describe('preview renders in every engine', () => {
  // Each case builds its glyphs in the page (the geometry pipeline) and fetches
  // the font from the CDN: slower than the default 30s allows in WebKit/Firefox.
  test.describe.configure({ timeout: 90_000 });

  // Empty until beforeEach runs, so a browser that never launched fails on its launch error, not here.
  let errors: string[] = [];
  test.beforeEach(({ page }) => {
    errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  });
  test.afterEach(() => {
    expect(errors, `runtime errors:\n${errors.join('\n')}`).toEqual([]);
  });

  for (const c of CASES) {
    test(`${c.name}: controlled time writes the text, in order`, async ({ page }) => {
      await page.goto(previewUrl({ ...c.params, tm: 'controlled', ct: 1000 }));
      await waitForReady(page);
      const written = await ink(page);
      expectWritten(written, c.params.t, c.params.fs);
      c.extraAssert?.(written);

      const duration = await totalDuration(page);
      expect(duration, 'the timeline has a length').toBeGreaterThan(0);
      const start = await seek(page, 0);
      const mid = await seek(page, duration / 2);
      const end = await seek(page, duration);
      expect(start.area, 'nothing is written at time 0').toBeLessThan(written.area * 0.02);
      expect(mid.area, 'half-way, some of the text is written').toBeGreaterThan(written.area * 0.1);
      expect(mid.area, 'half-way, not all of the text is written').toBeLessThan(written.area * 0.95);
      expect(Math.abs(end.area - written.area), 'seeking back to the end draws the same frame').toBeLessThan(written.area * 0.02);
      if (c.direction === 'ltr') expect(mid.centroidX, 'left-to-right text is written from the left').toBeLessThan(written.centroidX);
      if (c.direction === 'rtl') expect(mid.centroidX, 'right-to-left text is written from the right').toBeGreaterThan(written.centroidX);
    });
  }

  test('uncontrolled time plays to the end on its own', async ({ page }) => {
    const params = { t: 'Hello', fs: 96, w: 600, h: 200 };
    await page.goto(previewUrl({ ...params, tm: 'uncontrolled' }));
    await waitForReady(page);
    // The engine's rAF clock moves the ink on its own…
    const areas: number[] = [];
    await expect
      .poll(
        async () => {
          areas.push((await ink(page)).area);
          return new Set(areas.filter((a) => a > 0)).size;
        },
        { timeout: 20_000, intervals: [100], message: 'the ink never grew — the animation is not playing' },
      )
      .toBeGreaterThanOrEqual(3);
    // …and without `loop` it stops once the text is written.
    const complete = () =>
      page.evaluate(() => (window as unknown as { __tegakiEngine: { isComplete: boolean } }).__tegakiEngine.isComplete);
    await expect.poll(complete, { timeout: 30_000, message: 'the animation never completed' }).toBe(true);
    await nextFrames(page);
    expectWritten(await ink(page), params.t, params.fs);
  });

  test('css time follows --tegaki-progress', async ({ page }) => {
    const params = { t: 'Hello', fs: 96, w: 600, h: 200 };
    await page.goto(previewUrl({ ...params, tm: 'css' }));
    await waitForReady(page);
    // The renderer writes --tegaki-progress: 0 on its root inline; an
    // !important rule overrides it the way a stylesheet driving it would.
    const setProgress = async (p: number) => {
      await page.evaluate((v) => {
        let style = document.getElementById('progress') as HTMLStyleElement | null;
        if (!style) {
          style = document.createElement('style');
          style.id = 'progress';
          document.head.append(style);
        }
        style.textContent = `[data-tegaki="root"] { --tegaki-progress: ${v} !important; }`;
      }, p);
      await nextFrames(page);
    };
    const area = async () => (await ink(page)).area;
    expect(await area(), 'progress 0 writes nothing').toBe(0);
    // The engine hears of a new progress through a transition on its sentinel,
    // a registered custom property — the part most likely to differ by engine.
    await setProgress(1);
    await expect.poll(area, { timeout: 10_000, message: 'progress 1 never wrote the text' }).toBeGreaterThan(0);
    await nextFrames(page);
    const written = await ink(page);
    expectWritten(written, params.t, params.fs);
    await setProgress(0.5);
    await expect
      .poll(area, { timeout: 10_000, message: 'progress 0.5 never took part of the text back' })
      .toBeLessThan(written.area * 0.95);
    expect(await area(), 'progress 0.5 still writes some of the text').toBeGreaterThan(written.area * 0.1);
  });
});
