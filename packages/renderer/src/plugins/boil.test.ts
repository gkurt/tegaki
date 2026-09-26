import { describe, expect, test } from 'bun:test';
import type { TegakiGeometryContext, TegakiOutlineContext } from '../core/types.ts';
import { StrokePath } from '../lib/strokePath.ts';
import type { GlyphPlacement, StrokeGeometryContext } from '../lib/strokeTimeline.ts';
import { type BoilOptions, boilField, boilPlugin, boilWidth } from './boil.ts';

const EM = 1000;
const defaults: BoilOptions = boilPlugin.defaults;
const points = [
  { x: 0, y: 0 },
  { x: 500, y: -700 },
  { x: 250, y: -300 },
  { x: 900, y: 100 },
];
const moved = (f: (p: { x: number; y: number }) => { x: number; y: number }) => points.map(f);

describe('boilField', () => {
  test('a drawing is the same every time it comes round', () => {
    expect(moved(boilField(3, 1, defaults, EM))).toEqual(moved(boilField(3, 1, defaults, EM)));
  });

  test('each drawing of a glyph differs, and so does each glyph', () => {
    const a = moved(boilField(3, 0, defaults, EM));
    expect(moved(boilField(3, 1, defaults, EM))).not.toEqual(a);
    expect(moved(boilField(4, 0, defaults, EM))).not.toEqual(a);
  });

  test('no point wanders further than the amount', () => {
    for (let step = 0; step < 8; step++) {
      const field = boilField(7, step, defaults, EM);
      for (const p of points) {
        const q = field(p);
        expect(Math.abs(q.x - p.x)).toBeLessThanOrEqual(defaults.amount * EM + 1e-9);
        expect(Math.abs(q.y - p.y)).toBeLessThanOrEqual(defaults.amount * EM + 1e-9);
      }
    }
  });

  test('with amount 0 the line holds still', () => {
    const field = boilField(7, 2, { ...defaults, amount: 0 }, EM);
    for (const p of points) expect(field(p)).toEqual(p);
  });

  test('more detail makes the line change faster along its length', () => {
    // How much the displacement changes over a short stretch, summed.
    const roughness = (detail: number) => {
      let total = 0;
      for (let seed = 0; seed < 20; seed++) {
        const field = boilField(seed, 0, { amount: 0.01, detail }, EM);
        for (let x = 0; x < EM; x += 20) {
          const a = field({ x, y: -300 });
          const b = field({ x: x + 20, y: -300 });
          total += Math.abs(b.y - a.y);
        }
      }
      return total;
    };
    expect(roughness(1)).toBeGreaterThan(roughness(0) * 2);
  });
});

describe('boilWidth', () => {
  test('stays within the setting, and holds with width 0', () => {
    const w = boilWidth(1, '0', 2, 0.1);
    for (const t of [0, 0.3, 0.7, 1]) expect(Math.abs(w(t) - 1)).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(boilWidth(1, '0', 2, 0)(0.5)).toBe(1);
  });
});

describe('boilPlugin', () => {
  const place: GlyphPlacement = { x: 10, y: 20, scale: 0.1, ascender: 800 };
  const fontSize = place.scale * EM;
  const path = new StrokePath([
    { x: 10, y: 100, width: 5, t: 0 },
    { x: 60, y: 30, width: 5, t: 1 },
  ]);
  const ctx = (step: number) =>
    ({ seed: 4, place, fontSize, step, stroke: { strokeIndex: 0 } }) as unknown as TegakiGeometryContext & StrokeGeometryContext;

  test('asks the engine for its drawings as steps', () => {
    expect(boilPlugin().steps).toEqual({ count: 3, fps: 12, idle: false });
    expect(boilPlugin({ drawings: 5, fps: 8, idle: true }).steps).toEqual({ count: 5, fps: 8, idle: true });
  });

  test('keeping on after the text is written is off unless asked for', () => {
    expect(boilPlugin.defaults.idle).toBe(false);
  });

  test('each step is its own drawing', () => {
    const plugin = boilPlugin();
    const a = plugin.geometry!(path, ctx(0)).points;
    const b = plugin.geometry!(path, ctx(1)).points;
    expect(a.map((p) => p.x)).not.toEqual(b.map((p) => p.x));
  });

  test('a stroke and its outline boil together, so clip-to-text follows the ink', () => {
    const plugin = boilPlugin();
    const strokes = plugin.geometry!(path, ctx(2)).points;
    const o: TegakiOutlineContext = { seed: 4, place, fontSize, step: 2 };
    const outline = plugin.outline!(
      path.points.map(({ x, y }) => ({ x, y })),
      o,
    );
    for (let i = 0; i < strokes.length; i++) {
      expect(outline[i]!.x).toBeCloseTo(strokes[i]!.x, 9);
      expect(outline[i]!.y).toBeCloseTo(strokes[i]!.y, 9);
    }
  });
});
