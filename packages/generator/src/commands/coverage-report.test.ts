import { describe, expect, test } from 'bun:test';
import { type GlyphCoverageReport, type InkBitmap, summarizeCoverageReports, unpaintedShare } from './coverage-report.ts';

/** A solid 20×20 font-unit square of ink, rasterized at `scale` px per unit. */
const square = (scale: number): InkBitmap => {
  const size = 20 * scale;
  return {
    bitmap: new Uint8Array(size * size).fill(1),
    width: size,
    height: size,
    transform: { scaleX: scale, scaleY: scale, offsetX: 0, offsetY: 0 },
  };
};

// A pen 10 units wide along the square's middle row paints half of it.
const band = [
  {
    points: [
      { x: 0, y: 10, width: 10 },
      { x: 20, y: 10, width: 10 },
    ],
  },
];

describe('unpaintedShare', () => {
  test('a pen across the middle half of the ink leaves the other half', () => {
    expect(unpaintedShare(square(1), band, { tolerance: 0, stride: 1 })).toBeCloseTo(0.5, 6);
  });

  test('the tolerance is in font units, not bitmap pixels', () => {
    // 2.5 units either side widens the band to 15 of the 20 rows, at any scale.
    expect(unpaintedShare(square(2), band, { tolerance: 2.5, stride: 1 })).toBeCloseTo(0.25, 6);
    expect(unpaintedShare(square(4), band, { tolerance: 2.5, stride: 1 })).toBeCloseTo(0.25, 6);
  });

  test('a nib stamp paints the ink it covers', () => {
    const stamped = [
      {
        points: [
          { x: 10, y: 10, width: 2, nib: { dx: 0, dy: 0, major: 40, minor: 40, angle: 0 } },
          { x: 10, y: 10, width: 2 },
        ],
      },
    ];
    expect(unpaintedShare(square(1), stamped, { tolerance: 0, stride: 1 })).toBe(0);
  });

  test('a single-point stroke paints its disk', () => {
    const dot = [{ points: [{ x: 10, y: 10, width: 40 }] }];
    expect(unpaintedShare(square(1), dot, { tolerance: 0, stride: 1 })).toBe(0);
  });

  test('no ink is fully painted', () => {
    expect(unpaintedShare({ ...square(1), bitmap: new Uint8Array(400) }, [], {})).toBe(0);
  });
});

const glyph = (over: Partial<GlyphCoverageReport>): GlyphCoverageReport => ({
  char: 'x',
  geometry: 0.01,
  raster: 0.01,
  warnings: [],
  ...over,
});

describe('summarizeCoverageReports', () => {
  test('aggregates both pipelines and ranks the worst geometry glyphs', () => {
    const s = summarizeCoverageReports(
      [
        glyph({ char: 'a', geometry: 0.001, raster: 0.03 }),
        glyph({ char: '.', geometry: 0.06, raster: 0.01 }),
        glyph({ char: 'b', geometry: 0.025, raster: 0.02 }),
        glyph({ char: 'c', geometry: null, raster: 0.04 }),
      ],
      2,
    );
    expect(s.totalGlyphs).toBe(4);
    expect(s.missingGlyph).toBe(2);
    expect(s.geometryFailed).toBe(1);
    expect(s.geometry.mean).toBeCloseTo((0.001 + 0.06 + 0.025) / 3);
    expect(s.raster.mean).toBeCloseTo((0.03 + 0.01 + 0.02 + 0.04) / 4);
    expect([s.geometry.over2, s.geometry.over5]).toEqual([2, 1]);
    expect([s.raster.over2, s.raster.over5]).toEqual([2, 0]);
    expect([s.geometryBetter, s.geometryWorse]).toEqual([1, 1]);
    expect(s.worstGeometry.map((g) => g.char)).toEqual(['.', 'b', 'a']);
  });
});
