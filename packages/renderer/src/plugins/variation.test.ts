import { describe, expect, test } from 'bun:test';
import type { TegakiGeometryContext, TegakiOutlineContext } from '../core/types.ts';
import { StrokePath } from '../lib/strokePath.ts';
import type { GlyphPlacement, StrokeGeometryContext } from '../lib/strokeTimeline.ts';
import { type VariationOptions, variationField, variationPlugin, variationWidth } from './variation.ts';

const EM = 1000;
const defaults: VariationOptions = variationPlugin.defaults;
const points = [
  { x: 0, y: 0 },
  { x: 500, y: -700 },
  { x: 250, y: -300 },
  { x: 900, y: 100 },
];

describe('variationField', () => {
  test('the same seed strays the same way every time', () => {
    const a = variationField(7, defaults, EM);
    const b = variationField(7, defaults, EM);
    for (const p of points) expect(a(p)).toEqual(b(p));
  });

  test('another seed strays another way', () => {
    const a = variationField(7, defaults, EM);
    const b = variationField(8, defaults, EM);
    expect(points.some((p) => a(p).x !== b(p).x || a(p).y !== b(p).y)).toBe(true);
  });

  test('with amount 0 the glyph is drawn as the font has it', () => {
    const field = variationField(7, { ...defaults, amount: 0 }, EM);
    for (const p of points) {
      expect(field(p).x).toBeCloseTo(p.x, 9);
      expect(field(p).y).toBeCloseTo(p.y, 9);
    }
  });

  test('the defaults keep a glyph close to its shape: no point moves more than a fifth of an em', () => {
    for (let seed = 0; seed < 50; seed++) {
      const field = variationField(seed, defaults, EM);
      for (const p of points) expect(Math.hypot(field(p).x - p.x, field(p).y - p.y)).toBeLessThan(EM / 5);
    }
  });

  test('neighbouring points stay neighbours: the field bends the glyph, it never tears it', () => {
    const field = variationField(3, { ...defaults, amount: 2 }, EM);
    for (const p of points) {
      const a = field(p);
      const b = field({ x: p.x + 1, y: p.y });
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(1.5);
    }
  });

  test('a larger amount strays further', () => {
    const drift = (amount: number) => {
      let total = 0;
      for (let seed = 0; seed < 30; seed++) {
        const field = variationField(seed, { ...defaults, amount }, EM);
        for (const p of points) total += Math.hypot(field(p).x - p.x, field(p).y - p.y);
      }
      return total;
    };
    expect(drift(1.5)).toBeGreaterThan(drift(0.5));
  });
});

describe('variationWidth', () => {
  test('each stroke of a glyph gets a width of its own, within the setting', () => {
    const a = variationWidth(7, '0', defaults);
    const b = variationWidth(7, '1', defaults);
    expect(a(0.5)).not.toBe(b(0.5));
    for (const t of [0, 0.25, 0.5, 1]) {
      expect(Math.abs(a(t) - 1)).toBeLessThanOrEqual(defaults.width * 1.2 + 1e-9);
    }
  });

  test('with width 0 the ink keeps its width', () => {
    const w = variationWidth(7, '0', { ...defaults, width: 0 });
    expect(w(0.3)).toBe(1);
  });
});

describe('variationPlugin', () => {
  const place: GlyphPlacement = { x: 10, y: 20, scale: 0.1, ascender: 800 };
  const fontSize = place.scale * EM;
  const path = new StrokePath([
    { x: 10, y: 100, width: 5, t: 0 },
    { x: 60, y: 30, width: 5, t: 1 },
  ]);

  test('a stroke and its glyph outline move together, so clip-to-text follows the ink', () => {
    const plugin = variationPlugin();
    const g = { seed: 4, place, fontSize, stroke: { strokeIndex: 0 } } as unknown as TegakiGeometryContext & StrokeGeometryContext;
    const o: TegakiOutlineContext = { seed: 4, place, fontSize };
    const moved = plugin.geometry!(path, g).points.map(({ x, y }) => ({ x, y }));
    const outline = plugin.outline!(
      path.points.map(({ x, y }) => ({ x, y })),
      o,
    );
    for (let i = 0; i < moved.length; i++) {
      expect(outline[i]!.x).toBeCloseTo(moved[i]!.x, 9);
      expect(outline[i]!.y).toBeCloseTo(moved[i]!.y, 9);
    }
  });

  test('amount 0 leaves the stroke where it was', () => {
    const plugin = variationPlugin({ amount: 0 });
    const g = { seed: 4, place, fontSize, stroke: { strokeIndex: 0 } } as unknown as TegakiGeometryContext & StrokeGeometryContext;
    const out = plugin.geometry!(path, g).points;
    for (let i = 0; i < out.length; i++) {
      expect(out[i]!.x).toBeCloseTo(path.points[i]!.x, 9);
      expect(out[i]!.y).toBeCloseTo(path.points[i]!.y, 9);
      expect(out[i]!.width).toBeCloseTo(5, 9);
    }
  });
});
