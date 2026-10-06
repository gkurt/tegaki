import { describe, expect, test } from 'bun:test';
import { subdivideStroke } from '../lib/strokeCache.ts';
import type { StrokePath } from '../lib/strokePath.ts';
import { nibAnchor, placeStrokes } from '../lib/strokeTimeline.ts';
import { placementsToSvg, type SvgExportConfig } from '../lib/svgExport.ts';
import type { TegakiGlyphData } from '../types.ts';
import { drawGlyph } from './drawGlyph.ts';

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
    drawGlyph(before.ctx, glyph, pos, 0.4, { strokeEasing: linear });
    expect(before.ellipses.length).toBe(0);

    const after = recordingContext();
    drawGlyph(after.ctx, glyph, pos, 0.6, { strokeEasing: linear });
    expect(after.ellipses.length).toBe(1);
    const [cx, cy, rx, ry, rotation] = after.ellipses[0]!;
    // Point (50,0) + offset (0,−6), at scale 1; radii are half the diameters.
    expect([cx, cy, rx, ry]).toEqual([50, -6, 12, 4]);
    expect(rotation).toBeCloseTo(-Math.PI / 2);
  });

  test('stamps scale with the font size and the stroke scale', () => {
    const { ctx, ellipses } = recordingContext();
    drawGlyph(ctx, glyph, { ...pos, fontSize: 200 }, 1, { strokeEasing: linear, strokeScale: 1.5 });
    const [, , rx, ry] = ellipses[0]!;
    expect(rx).toBeCloseTo(12 * 2 * 1.5);
    expect(ry).toBeCloseTo(4 * 2 * 1.5);
  });
});

describe('nib stamps on a point the stroke thins to nothing', () => {
  // The middle point is all nib: the stroke narrows to nothing there and a 24-unit stamp covers it.
  const thin: TegakiGlyphData['s'][number] = {
    p: [
      [0, 0, 10],
      [30, 0, 30],
      [50, 0, 0.2],
      [60, 0, 10],
      [100, 0, 10],
    ],
    d: 0,
    a: 1,
    n: [[2, 0, -6, 24, 8, 0]],
  };
  const thinGlyph: TegakiGlyphData = { w: 100, t: 1, s: [thin] };
  const entry = { char: 'a', graphemeIndex: 0, offset: 0, duration: 1, hasGlyph: true };
  const place = (reshape?: (path: StrokePath) => StrokePath) =>
    placeStrokes([{ id: '0:0', entryIndex: 0, entry, glyph: thinGlyph, strokeIndex: 0, stroke: thin, start: 0, duration: 1 }], {
      placeEntry: () => ({ x: 0, y: 0, scale: 1, ascender: 0, seed: 0 }),
      reshape,
    })[0]!;
  const painted = (s: ReturnType<typeof place>) => {
    const nib = s.nibs[0]!;
    const at = s.path.pointAt(nib.t);
    return { cx: at.x + nib.dx, cy: at.y + nib.dy, rx: nib.rx * at.width, ry: nib.ry * at.width };
  };

  const CUM = [0, 30, 50, 60, 100];

  test('nibAnchor keeps a nib on its point when the ink there is as wide as the nib', () => {
    expect(nibAnchor(thin.p, CUM, 1, 12)).toBe(1);
  });

  test('nibAnchor moves a nib wider than its point to the nearest point that wide, else the widest', () => {
    expect(nibAnchor(thin.p, CUM, 2, 8)).toBe(3);
    expect(nibAnchor(thin.p, CUM, 2, 12)).toBe(1);
    expect(nibAnchor(thin.p, CUM, 2, 40)).toBe(1);
  });

  test('with the bundle widths, the stamp is drawn where and as large as the bundle says', () => {
    const { cx, cy, rx, ry } = painted(place());
    expect([cx, cy]).toEqual([50, -6]);
    expect(rx).toBeCloseTo(12);
    expect(ry).toBeCloseTo(4);
  });

  test('evening the widths out (pressure 0) keeps the stamp near its size instead of swelling it', () => {
    const s = place();
    const mean = thin.p.reduce((a, p) => a + p[2]!, 0) / thin.p.length;
    const { cx, cy, rx } = painted(place((path) => path.map((p) => ({ ...p, width: mean }))));
    expect([cx, cy]).toEqual([50, -6]);
    expect(rx).toBeLessThanOrEqual(12);
    expect(s.nibs[0]!.t).toBeLessThan(0.5);
  });
});

describe('placementsToSvg nib stamps', () => {
  const cfg: SvgExportConfig = {
    width: 200,
    height: 100,
    lineCap: 'round',
    color: '#123',
    strokeScale: 1,
    animated: false,
    totalDuration: 1,
  };
  const entry = { char: 'a', graphemeIndex: 0, offset: 0, duration: 1, hasGlyph: true };
  const [placed] = placeStrokes([{ id: '0:0', entryIndex: 0, entry, glyph, strokeIndex: 0, stroke, start: 0, duration: 1 }], {
    placeEntry: () => ({ x: 0, y: 50, scale: 1, ascender: 0, seed: 0 }),
  });
  const items = [{ glyph, ox: 0, oy: 50, scale: 1, ascender: 0, offset: 0, inks: [{ path: placed!.path, nibs: placed!.nibs }] }];

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
