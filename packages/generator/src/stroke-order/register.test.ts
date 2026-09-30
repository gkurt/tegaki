import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki/internal';
import { referenceBBox, registerReference } from './register.ts';
import type { ReferenceGlyph } from './types.ts';

function refGlyph(...strokes: Point[][]): ReferenceGlyph {
  return {
    char: 'x',
    strokes: strokes.map((points) => ({ points })),
    viewBox: { width: 109, height: 109 },
    source: 'test',
    license: 'test',
  };
}

describe('registerReference', () => {
  test('full-bodied glyph: reference bbox maps exactly onto the ink bbox', () => {
    // Reference spans 10..100 on both axes; ink spans 50..950 x, -800..-50 y
    // (font units, y-down: glyph tops are negative).
    const ref = refGlyph([
      { x: 10, y: 10 },
      { x: 100, y: 100 },
    ]);
    const reg = registerReference(ref, { x1: 50, y1: -800, x2: 950, y2: -50 });
    const pts = reg.strokes[0]!.points;
    expect(pts[0]!.x).toBeCloseTo(50);
    expect(pts[0]!.y).toBeCloseTo(-800);
    expect(pts[1]!.x).toBeCloseTo(950);
    expect(pts[1]!.y).toBeCloseTo(-50);
  });

  test('x and y scale independently for full-bodied glyphs', () => {
    const ref = refGlyph([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    const reg = registerReference(ref, { x1: 0, y1: 0, x2: 200, y2: 400 });
    expect(reg.transform.scaleX).toBeCloseTo(2);
    expect(reg.transform.scaleY).toBeCloseTo(8);
  });

  test("thin horizontal (一-like): y borrows x's scale instead of stretching wiggle onto ink thickness", () => {
    // Centerline wiggles only 4 units of the 109 frame vertically.
    const ref = refGlyph([
      { x: 10, y: 52 },
      { x: 100, y: 56 },
    ]);
    const ink = { x1: 0, y1: -530, x2: 900, y2: -470 };
    const reg = registerReference(ref, ink);
    expect(reg.transform.scaleY).toBeCloseTo(reg.transform.scaleX);
    expect(reg.transform.scaleX).toBeCloseTo(10);
    // Centers align on the thin axis: reference y-center 54 lands at ink y-center -500.
    const pts = reg.strokes[0]!.points;
    expect((pts[0]!.y + pts[1]!.y) / 2).toBeCloseTo(-500);
  });

  test('thin vertical (丨-like): x borrows y scale', () => {
    const ref = refGlyph([
      { x: 53, y: 10 },
      { x: 55, y: 100 },
    ]);
    const reg = registerReference(ref, { x1: 420, y1: -900, x2: 480, y2: 0 });
    expect(reg.transform.scaleX).toBeCloseTo(reg.transform.scaleY);
    expect(reg.transform.scaleY).toBeCloseTo(10);
  });

  test('dot (both axes thin): frame-proportional scale, centers aligned', () => {
    const ref = refGlyph([
      { x: 53, y: 53 },
      { x: 56, y: 56 },
    ]);
    const ink = { x1: 400, y1: -520, x2: 460, y2: -460 };
    const reg = registerReference(ref, ink);
    expect(reg.transform.scaleX).toBe(reg.transform.scaleY);
    const p = reg.strokes[0]!.points[0]!;
    // The mark stays near the ink center rather than exploding to fill it.
    expect(p.x).toBeGreaterThan(ink.x1);
    expect(p.x).toBeLessThan(ink.x2);
    expect(p.y).toBeGreaterThan(ink.y1);
    expect(p.y).toBeLessThan(ink.y2);
  });

  test('stroke metadata (order, type) survives registration', () => {
    const ref = refGlyph(
      [
        { x: 10, y: 10 },
        { x: 100, y: 30 },
      ],
      [
        { x: 20, y: 50 },
        { x: 90, y: 100 },
      ],
    );
    ref.strokes[0]!.type = '㇐';
    const reg = registerReference(ref, { x1: 0, y1: 0, x2: 100, y2: 100 });
    expect(reg.strokes.length).toBe(2);
    expect(reg.strokes[0]!.type).toBe('㇐');
    expect(reg.strokes[1]!.type).toBeUndefined();
    expect(reg.source).toBe('test');
  });
});

describe('referenceBBox', () => {
  test('spans all strokes', () => {
    const ref = refGlyph(
      [
        { x: 10, y: 40 },
        { x: 50, y: 45 },
      ],
      [
        { x: 30, y: 5 },
        { x: 35, y: 95 },
      ],
    );
    expect(referenceBBox(ref)).toEqual({ x1: 10, y1: 5, x2: 50, y2: 95 });
  });
});
