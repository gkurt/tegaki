import { describe, expect, test } from 'bun:test';
import type { TegakiGeometryContext, TegakiOutlineContext } from '../core/types.ts';
import { StrokePath } from '../lib/strokePath.ts';
import { curveAt, type TextPathOptions, textPathMove, textPathPlugin } from './textPath.ts';

const defaults: TextPathOptions = textPathPlugin.defaults;
const box = { minX: 0, minY: 0, maxX: 400, maxY: 100 };
const place = { x: 300, y: 0, scale: 0.1, ascender: 800 };

describe('curveAt', () => {
  test('a straight line is no curve at all', () => {
    expect(curveAt({ ...defaults, angle: 0 }, 400, 100)).toBeNull();
    expect(curveAt({ ...defaults, shape: 'wave', amplitude: 0 }, 400, 100)).toBeNull();
  });

  test('a positive arc is a rainbow: its ends fall away below its middle', () => {
    const curve = curveAt({ ...defaults, angle: 90 }, 400, 100)!;
    expect(curve(0)).toMatchObject({ x: 0, y: 0 });
    expect(curve(200).y).toBeGreaterThan(20);
    expect(curve(-200).y).toBeCloseTo(curve(200).y, 9);
    // It turns the arc's angle across the text: 45° either way at its ends.
    expect(Math.atan2(curve(200).ty, curve(200).tx)).toBeCloseTo(Math.PI / 4, 6);
  });

  test('a negative arc smiles', () => {
    expect(curveAt({ ...defaults, angle: -90 }, 400, 100)!(200).y).toBeLessThan(-20);
  });

  test('a full turn closes the circle: the two ends of the text meet', () => {
    const curve = curveAt({ ...defaults, angle: 360 }, 400, 100)!;
    expect(curve(200).x).toBeCloseTo(curve(-200).x, 6);
    expect(curve(200).y).toBeCloseTo(curve(-200).y, 6);
  });

  test('a wave rises and falls its height, a wavelength apart, and a shift moves it along', () => {
    const o = { ...defaults, shape: 'wave' as const, amplitude: 0.3, wavelength: 4, phase: 90 };
    const curve = curveAt(o, 400, 100)!;
    expect(curve(0).y).toBeCloseTo(-30, 6);
    expect(curve(400).y).toBeCloseTo(-30, 6);
    expect(curve(200).y).toBeCloseTo(30, 6);
    expect(curveAt(o, 400, 100, 0.5)!(0).y).toBeCloseTo(30, 6);
  });
});

describe('textPathMove', () => {
  const curve = curveAt({ ...defaults, angle: 90 }, 400, 100)!;

  test('a glyph moved whole keeps its shape', () => {
    const move = textPathMove(curve, box, 'rotate', place, 100);
    const a = move({ x: 310, y: 20 });
    const b = move({ x: 350, y: 70 });
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(Math.hypot(40, 50), 6);
  });

  test('upright glyphs are only moved, not turned', () => {
    const move = textPathMove(curve, box, 'upright', place, 100);
    const a = move({ x: 310, y: 20 });
    const b = move({ x: 350, y: 70 });
    expect(b.x - a.x).toBeCloseTo(40, 9);
    expect(b.y - a.y).toBeCloseTo(50, 9);
  });

  test('the middle of the text stays where it was', () => {
    const move = textPathMove(curve, box, 'bend', place, 100);
    expect(move({ x: 200, y: 50 })).toMatchObject({ x: 200, y: 50 });
  });
});

describe('textPathPlugin', () => {
  test("a stroke and its glyph's outline move together, so clip-to-text follows the ink", () => {
    const plugin = textPathPlugin({ angle: 120 });
    const path = new StrokePath([
      { x: 310, y: 20, width: 5, t: 0 },
      { x: 350, y: 70, width: 5, t: 1 },
    ]);
    const g = { place, fontSize: 100, textBox: box, step: 0 } as unknown as TegakiGeometryContext;
    const o: TegakiOutlineContext = { place, fontSize: 100, textBox: box, step: 0, seed: 0 };
    const moved = plugin.geometry!(path, g).points;
    const outline = plugin.outline!(
      path.points.map(({ x, y }) => ({ x, y })),
      o,
    );
    for (let i = 0; i < moved.length; i++) {
      expect(outline[i]!.x).toBeCloseTo(moved[i]!.x, 9);
      expect(outline[i]!.y).toBeCloseTo(moved[i]!.y, 9);
    }
  });

  test('only a flowing wave redraws over time', () => {
    expect(textPathPlugin().steps).toBeUndefined();
    expect(textPathPlugin({ shape: 'wave', flow: 0.5 }).steps).toMatchObject({ count: 24, idle: true });
  });
});
