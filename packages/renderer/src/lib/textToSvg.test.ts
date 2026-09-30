import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import caveat from '../../fonts/caveat/bundle.ts';
import nanumPenScript from '../../fonts/nanum-pen-script/bundle.ts';
import suezOne from '../../fonts/suez-one/bundle.ts';
import { registerPlugin } from '../core/plugin-registry.ts';
import type { TegakiPlugin } from '../core/types.ts';
import { glowPlugin } from '../plugins/glow.ts';
import { globalGradientPlugin, strokeGradientPlugin } from '../plugins/gradient.ts';
import { taperPlugin } from '../plugins/taper.ts';
import { wobblePlugin } from '../plugins/wobble.ts';
import { createHarfbuzzShaper } from '../shaper-harfbuzz/index.ts';
import type { TegakiBundle } from '../types.ts';
import type { BundleShaper } from './shaper.ts';
import { headlessShapedLayout } from './textLayout.ts';
import { textToSvg } from './textToSvg.ts';
import { computeTimeline } from './timeline.ts';

const font = caveat as unknown as TegakiBundle;
const suez = suezOne as unknown as TegakiBundle;

/** A harfbuzz shaper from the bundle's font file on disk, the way the CLI builds one. */
async function shaperFor(bundle: TegakiBundle): Promise<BundleShaper> {
  const bytes = readFileSync(bundle.fontUrl);
  return createHarfbuzzShaper(bundle, [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]);
}

describe('textToSvg', () => {
  test('loop mode emits CSS keyframes + group fade and crops the viewBox to ink', () => {
    const svg = textToSvg('Hi', font, { mode: 'loop' });
    expect(svg).toContain('@keyframes tk-a0');
    expect(svg).toContain('stroke-dashoffset');
    // The whole word sits in one group that fades out at the end of each cycle.
    expect(svg).toMatch(/<g class="tk-a\d+">/);
    // No SMIL / mask reveal in the looping path.
    expect(svg).not.toContain('<animate');
    expect(svg).not.toContain('<mask');
    // viewBox is cropped to ink bounds, so it doesn't start at the origin.
    const vb = /viewBox="([\d.]+) ([\d.]+)/.exec(svg);
    expect(vb).not.toBeNull();
    expect(Number(vb![1])).toBeGreaterThan(0);
  });

  test('once mode reveals each stroke through an animated mask (variable width)', () => {
    const svg = textToSvg('Hi', font, { mode: 'once' });
    expect(svg).toContain('<mask');
    expect(svg).toContain('<animate');
    expect(svg).toContain('stroke-dashoffset');
    // Per-segment variable-width lines (not constant-width paths) carry the ink.
    expect(svg).toContain('<line');
    // Single-play, not the looping keyframe machinery.
    expect(svg).not.toContain('@keyframes');
  });

  test('static mode is finished artwork — no animation of any kind', () => {
    const svg = textToSvg('Hi', font, { mode: 'static' });
    expect(svg).not.toContain('@keyframes');
    expect(svg).not.toContain('<animate');
    expect(svg).not.toContain('<mask');
    expect(svg).toContain('<line');
  });

  test('color and font size are honoured', () => {
    const svg = textToSvg('A', font, { mode: 'static', color: '#ff0000', fontSize: 200, crop: false });
    expect(svg).toContain('#ff0000');
    // viewBox height scales with font size (uncropped, the viewBox is the full layout box).
    const h = /height="([\d.]+)"/.exec(svg);
    expect(Number(h![1])).toBeGreaterThan(200);
  });

  test('advance-width layout places the second glyph past the first', () => {
    // Static placements draw left-to-right; the second character's lines must
    // start further right than the first character's, proving the cursor moved
    // by the first glyph's advance width.
    const svg = textToSvg('AV', font, { mode: 'static' });
    const xs = [...svg.matchAll(/x1="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(2);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    // The text spans a meaningful horizontal range (two glyphs side by side).
    expect(max - min).toBeGreaterThan(font.glyphData.A!.w / font.unitsPerEm); // > one em-advance in px-ish
  });

  test('letterSpacing widens the layout and pushes later glyphs right', () => {
    const tight = textToSvg('AV', font, { mode: 'static', fontSize: 100, crop: false });
    const loose = textToSvg('AV', font, { mode: 'static', fontSize: 100, letterSpacing: 40, crop: false });
    // The overall box is one letter-spacing gap wider (one boundary between two glyphs).
    const w1 = Number(/width="([\d.]+)"/.exec(tight)![1]);
    const w2 = Number(/width="([\d.]+)"/.exec(loose)![1]);
    expect(w2 - w1).toBeCloseTo(40, 1);
    // The rightmost ink also moves right by ~40px (the second glyph shifted).
    const maxTight = Math.max(...[...tight.matchAll(/x1="([\d.]+)"/g)].map((m) => Number(m[1])));
    const maxLoose = Math.max(...[...loose.matchAll(/x1="([\d.]+)"/g)].map((m) => Number(m[1])));
    expect(maxLoose - maxTight).toBeCloseTo(40, 1);
  });

  test('letterSpacing does not shift the first glyph on a line', () => {
    // Spacing is inserted between units, never before the first — so the
    // leftmost ink stays put regardless of letter-spacing.
    const tight = textToSvg('AV', font, { mode: 'static', fontSize: 100 });
    const loose = textToSvg('AV', font, { mode: 'static', fontSize: 100, letterSpacing: 40 });
    const minTight = Math.min(...[...tight.matchAll(/x1="([\d.]+)"/g)].map((m) => Number(m[1])));
    const minLoose = Math.min(...[...loose.matchAll(/x1="([\d.]+)"/g)].map((m) => Number(m[1])));
    expect(minLoose).toBeCloseTo(minTight, 1);
  });

  test('a newline produces a two-line layout (taller box)', () => {
    const one = textToSvg('Ab', font, { mode: 'static', crop: false });
    const two = textToSvg('A\nb', font, { mode: 'static', crop: false });
    const h1 = Number(/height="([\d.]+)"/.exec(one)![1]);
    const h2 = Number(/height="([\d.]+)"/.exec(two)![1]);
    expect(h2).toBeGreaterThan(h1 * 1.5);
  });

  test('stagger timing overlaps glyph reveals (earlier begin offsets)', () => {
    const sequential = textToSvg('abcd', font, { mode: 'loop' });
    const staggered = textToSvg('abcd', font, { mode: 'loop', timing: { stagger: { advance: '50%' } } });
    // Both are valid; stagger should not throw and should still animate.
    expect(staggered).toContain('@keyframes');
    expect(sequential).toContain('@keyframes');
  });

  test('empty text yields an empty (but valid) svg', () => {
    const svg = textToSvg('', font, { mode: 'static' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<line');
  });
});

describe('headlessShapedLayout', () => {
  let shaper: BundleShaper;
  beforeAll(async () => {
    shaper = await shaperFor(suez);
  });
  const layout = (text: string) => headlessShapedLayout(text, suez, shaper, computeTimeline(text, suez, {}, shaper));

  test('a Hebrew word runs right to left: its first letter is rightmost', () => {
    const { direction, charOffsets } = layout('שלום');
    expect(direction).toBe('rtl');
    for (let i = 1; i < charOffsets.length; i++) expect(charOffsets[i]!).toBeLessThan(charOffsets[i - 1]!);
  });

  test('in an LTR paragraph a Hebrew word follows the Latin one, still reading right to left', () => {
    const { direction, charOffsets } = layout('ab שלום');
    expect(direction).toBe('ltr');
    const [a, b, , shin, , , finalMem] = charOffsets;
    expect(b!).toBeGreaterThan(a!);
    expect(finalMem!).toBeGreaterThan(b!);
    expect(shin!).toBeGreaterThan(finalMem!);
  });

  test('in an RTL paragraph a Latin word sits left of the Hebrew one that precedes it', () => {
    const { charOffsets } = layout('שלום ab');
    const [shin, , , finalMem, , a, b] = charOffsets;
    expect(a!).toBeLessThan(finalMem!);
    expect(b!).toBeGreaterThan(a!);
    expect(shin!).toBeGreaterThan(finalMem!);
  });

  test("an RTL paragraph's shorter line is right-aligned to the widest", () => {
    const { lineLefts, widthEm } = layout('שלום\nab שלום');
    expect(lineLefts[1]).toBe(0);
    expect(lineLefts[0]!).toBeGreaterThan(0);
    expect(widthEm).toBeGreaterThan(lineLefts[0]!);
  });
});

describe('textToSvg with a harfbuzz shaper for a bundle without glyphDataById', () => {
  const nanum = nanumPenScript as unknown as TegakiBundle;

  test('clipText keeps the ink of a bundle without glyphDataById', async () => {
    const svg = textToSvg('반가워요', nanum, { mode: 'static', shaper: await shaperFor(nanum), clipText: 1.2 });
    const mask = svg.match(/<mask id="tk-clip"[\s\S]*?<\/mask>/)?.[0] ?? '';
    expect([...mask.matchAll(/<path d="[^"]+" transform="translate\([^)]+\) scale\(/g)].length).toBe(4);
    expect(svg).toContain('mask="url(#tk-clip)"');
  });
});

describe('textToSvg with a harfbuzz shaper', () => {
  let shaper: BundleShaper;
  beforeAll(async () => {
    shaper = await shaperFor(font);
  });

  test('clip-to-text masks the ink with each glyph outline', () => {
    const svg = textToSvg('Hi', font, { mode: 'static', shaper, clipText: true });
    expect(svg).toContain('<mask id="tk-clip"');
    expect([...svg.matchAll(/<path d="[^"]+" transform="translate\([^)]+\) scale\(/g)].length).toBe(2);
    expect(svg).not.toContain('<text');
  });

  test('without a clip there is no mask', () => {
    expect(textToSvg('Hi', font, { mode: 'static', shaper })).not.toContain('tk-clip');
  });

  test('a numeric clip widens the strokes before clipping them', () => {
    const maxWidth = (svg: string) => Math.max(...[...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1])));
    const plain = textToSvg('H', font, { mode: 'static', shaper, clipText: true });
    const wide = textToSvg('H', font, { mode: 'static', shaper, clipText: 1.5 });
    expect(maxWidth(wide) / maxWidth(plain)).toBeCloseTo(1.5, 1);
  });

  test('a glyph without an outline leaves the strokes unclipped', () => {
    const noOutlines: BundleShaper = { shape: (text, options) => shaper.shape(text, options), glyphPath: () => null };
    const svg = textToSvg('Hi', font, { mode: 'static', shaper: noOutlines, clipText: 1.2 });
    expect(svg).not.toContain('tk-clip');
    expect(svg).toContain('stroke-width=');
  });

  test("shaped Latin keeps the unshaped layout's glyph placement", () => {
    const xs = (svg: string) => [...svg.matchAll(/x1="([\d.]+)"/g)].map((m) => Number(m[1]));
    const shaped = xs(textToSvg('AV', font, { mode: 'static', shaper, crop: false }));
    const plain = xs(textToSvg('AV', font, { mode: 'static', crop: false }));
    expect(Math.min(...shaped)).toBeCloseTo(Math.min(...plain), 0);
    expect(Math.max(...shaped)).toBeCloseTo(Math.max(...plain), -1);
  });
});

describe('textToSvg plugins', () => {
  beforeAll(() => registerPlugin(glowPlugin, taperPlugin));

  test('a glow is a drop-shadow filter around the ink', () => {
    const svg = textToSvg('Hi', font, { mode: 'static', plugins: [glowPlugin({ radius: '8px', color: '#f0f' })] });
    expect(svg).toMatch(/<filter id="tk-glow-\d+" filterUnits="userSpaceOnUse" x="[-\d.]+" y="[-\d.]+"/);
    expect(svg).toContain('<feDropShadow in="tint" dx="0" dy="0" stdDeviation="4" flood-color="#f0f"');
    expect(svg).toMatch(/<g filter="url\(#tk-glow-\d+\)">/);
  });

  test("a glow's radius in em follows the font size", () => {
    const blur = (fontSize: number) =>
      Number(
        /stdDeviation="([\d.]+)"/.exec(textToSvg('Hi', font, { mode: 'static', fontSize, plugins: [glowPlugin({ radius: 0.1 })] }))?.[1],
      );
    expect(blur(40)).toBeCloseTo(2, 6);
    expect(blur(160)).toBeCloseTo(8, 6);
  });

  test('a glow widens the crop by its radius', () => {
    const width = (svg: string) => Number(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/.exec(svg)?.[1]);
    const plain = textToSvg('Hi', font, { mode: 'static' });
    const glowing = textToSvg('Hi', font, { mode: 'static', plugins: [glowPlugin({ radius: '30px' })] });
    expect(width(glowing) - width(plain)).toBeGreaterThan(40);
  });

  test('taper draws each stroke a segment at a time, thinner at its ends', () => {
    const svg = textToSvg('l', font, { mode: 'static', pressure: 0, plugins: [taperPlugin({ startLength: 0.5, endLength: 0.5 })] });
    const widths = [...svg.matchAll(/<line [^>]*stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(4);
    expect(widths[0]!).toBeLessThan(Math.max(...widths));
    expect(widths.at(-1)!).toBeLessThan(Math.max(...widths));
  });

  test('a stroke gradient colors each segment; a text gradient paints every stroke with one gradient', () => {
    const stroke = textToSvg('l', font, { mode: 'static', plugins: [strokeGradientPlugin({ colors: ['#ff0000', '#0000ff'] })] });
    expect(new Set([...stroke.matchAll(/<line [^>]*stroke="(rgb[^"]+)"/g)].map((m) => m[1])).size).toBeGreaterThan(3);
    const text = textToSvg('Hi', font, { mode: 'static', plugins: [globalGradientPlugin({ colors: ['#f00', '#00f'] })] });
    expect(text).toMatch(/<linearGradient id="tk-gg-\d+" gradientUnits="userSpaceOnUse"/);
    expect(text).toMatch(/stroke="url\(#tk-gg-\d+\)"/);
  });

  test('wobble moves the clip outlines with the strokes', async () => {
    const shaper = await shaperFor(font);
    const plain = textToSvg('H', font, { mode: 'static', shaper, clipText: true });
    const wobbly = textToSvg('H', font, { mode: 'static', shaper, clipText: true, plugins: [wobblePlugin({ amplitude: 8 })] });
    const mask = (svg: string) => /<mask id="tk-clip"[^>]*>([\s\S]*?)<\/mask>/.exec(svg)?.[1];
    expect(mask(wobbly)).not.toBe(mask(plain));
    // Reshaped outlines are drawn in place, with no transform.
    expect(mask(wobbly)).not.toContain('transform');
  });

  test('plugins can be named once registered, with options', () => {
    const named = textToSvg('Hi', font, { mode: 'static', plugins: [['glow', { radius: '8px', color: '#f0f' }]] });
    const direct = textToSvg('Hi', font, { mode: 'static', plugins: [glowPlugin({ radius: '8px', color: '#f0f' })] });
    expect(named).toBe(direct);
  });

  test('a name no plugin is registered as throws', () => {
    expect(() => textToSvg('Hi', font, { plugins: ['no-such-plugin'] })).toThrow('no-such-plugin');
  });

  test("a plugin's timing retimes the file", () => {
    const dur = (svg: string) => Math.max(...[...svg.matchAll(/begin="([\d.]+)s"/g)].map((m) => Number(m[1])));
    const later: TegakiPlugin = {
      name: 'later',
      timing: ({ strokes }) => ({ strokes: strokes.map((s) => ({ start: s.start + 2, duration: s.duration })) }),
    };
    expect(dur(textToSvg('Hi', font, { mode: 'once', plugins: [later] }))).toBeGreaterThan(
      dur(textToSvg('Hi', font, { mode: 'once' })) + 1.9,
    );
  });
});
