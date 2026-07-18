import { describe, expect, test } from 'bun:test';
import { simplifyStroke } from './strokes.ts';
import type { AxisPoint } from './types.ts';

const pt = (x: number, y: number): AxisPoint => ({ x, y, width: 10 });

describe('simplifyStroke', () => {
  test('keeps deviating points, drops collinear ones', () => {
    const out = simplifyStroke([pt(0, 0), pt(50, 1), pt(100, 0), pt(100, 100)], 5);
    expect(out.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
  });

  test('closed chain (start == end) survives — degenerate chord must not collapse the loop', () => {
    // A stroke chain that cycles back to its exact start (a B's stem+bowl
    // cycle). RDP with the zero-length start→end chord used to measure every
    // deviation as 0 and reduce the whole loop to its two coincident ends.
    const square = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(0, 0)];
    const out = simplifyStroke(square, 2);
    expect(out.length).toBe(5);
  });

  test('exact retrace (hairpin whose halves coincide) keeps its tip', () => {
    const hairpin = [pt(0, 0), pt(0, 50), pt(0, 100), pt(0, 50), pt(0, 0)];
    const out = simplifyStroke(hairpin, 2);
    expect(out.some((p) => p.y === 100)).toBe(true);
  });
});
