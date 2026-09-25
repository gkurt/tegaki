import { describe, expect, test } from 'bun:test';
import type { TegakiGlyphData } from '../types.ts';
import { drawGlyph } from './drawGlyph.ts';
import { subdivideStroke } from './strokeCache.ts';
import { placementsToSvg, type SvgExportConfig } from './svgExport.ts';

// A 100-unit horizontal stroke with a nib stamp at its middle point, pointing up.
const stroke: TegakiGlyphData['s'][number] = {
  p: [
    [0, 0, 10],
    [50, 0, 10],
    [100, 0, 10],
  ],
  d: 0,
  a: 1,
  n: [[1, 0, -6, 24, 8, -Math.PI / 2]],
};
const glyph: TegakiGlyphData = { w: 100, t: 1, s: [stroke] };

describe('subdivideStroke', () => {
  test('pointCumLen gives the arc length at each ORIGINAL point, with or without subdivision', () => {
    expect(subdivideStroke(stroke, Infinity).pointCumLen).toEqual([0, 50, 100]);
    const fine = subdivideStroke(stroke, 7);
    expect(fine.pointCumLen.map((l) => Math.round(l))).toEqual([0, 50, 100]);
    expect(fine.vertices.length).toBeGreaterThan(3);
  });
});

/** A 2D context stub that records ellipse() calls; everything else is a no-op. */
function recordingContext() {
  const ellipses: number[][] = [];
  const ctx = new Proxy(
    { ellipses },
    {
      get(target, key) {
        if (key === 'ellipse') return (...args: number[]) => ellipses.push(args);
        if (key in target) return target[key as keyof typeof target];
        return () => {};
      },
      set: () => true,
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ellipses };
}

describe('drawGlyph nib stamps', () => {
  const pos = { x: 0, y: 0, fontSize: 100, unitsPerEm: 100, ascender: 0, descender: 0 };
  const linear = (t: number) => t;

  test('a stamp appears only once the pen reaches its point', () => {
    const before = recordingContext();
    drawGlyph(before.ctx, glyph, pos, 0.4, 'round', '#000', [], 0, undefined, linear);
    expect(before.ellipses.length).toBe(0);

    const after = recordingContext();
    drawGlyph(after.ctx, glyph, pos, 0.6, 'round', '#000', [], 0, undefined, linear);
    expect(after.ellipses.length).toBe(1);
    const [cx, cy, rx, ry, rotation] = after.ellipses[0]!;
    // Point (50,0) + offset (0,−6), at scale 1; radii are half the diameters.
    expect([cx, cy, rx, ry]).toEqual([50, -6, 12, 4]);
    expect(rotation).toBeCloseTo(-Math.PI / 2);
  });

  test('stamps scale with the font size and the stroke scale', () => {
    const { ctx, ellipses } = recordingContext();
    drawGlyph(ctx, glyph, { ...pos, fontSize: 200 }, 1, 'round', '#000', [], 0, undefined, linear, 1.5);
    const [, , rx, ry] = ellipses[0]!;
    expect(rx).toBeCloseTo(12 * 2 * 1.5);
    expect(ry).toBeCloseTo(4 * 2 * 1.5);
  });
});

describe('placementsToSvg nib stamps', () => {
  const cfg: SvgExportConfig = {
    width: 200,
    height: 100,
    lineCap: 'round',
    color: '#123',
    pressure: 1,
    segmentLengthFU: Infinity,
    smoothing: false,
    strokeScale: 1,
    animated: false,
    totalDuration: 1,
  };
  const items = [{ glyph, ox: 0, oy: 50, scale: 1, ascender: 0, offset: 0 }];

  test('static artwork draws the stamp as a rotated ellipse', () => {
    const svg = placementsToSvg(items, cfg);
    expect(svg).toContain('<ellipse cx="50" cy="44" rx="12" ry="4" transform="rotate(-90 50 44)" fill="#123" />');
  });

  test('single-play reveals the stamp when the pen reaches it', () => {
    const svg = placementsToSvg(items, { ...cfg, animated: true });
    // Halfway along the stroke under ease-out-quad: t = 1 − √0.5.
    const begin = Number(/<set attributeName="opacity" to="1" begin="([\d.]+)s"/.exec(svg)?.[1]);
    expect(begin).toBeCloseTo(1 - Math.sqrt(0.5), 3);
  });

  test('loop mode keyframes the stamp in and out with the word', () => {
    const svg = placementsToSvg(items, { ...cfg, loop: true });
    const cls = /<ellipse [^>]*class="(tk-a\d+)" opacity="0" \/>/.exec(svg)?.[1];
    expect(cls).toBeDefined();
    expect(svg).toContain(`@keyframes ${cls} { 0% { opacity:0 }`);
  });
});
