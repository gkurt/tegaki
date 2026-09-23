import { describe, expect, test } from 'bun:test';
import { toCompactStroke } from './generate.ts';

describe('toCompactStroke', () => {
  const base = { delay: 0.5, animationDuration: 1 };

  test('strokes without nibs stay byte-identical to the previous schema (no `n`)', () => {
    const out = toCompactStroke({ ...base, points: [{ x: 0, y: 0, width: 4 }] });
    expect(out).toEqual({ p: [[0, 0, 4]], d: 0.5, a: 1 });
  });

  test('nib stamps are listed by point index as [i, dx, dy, major, minor, angle]', () => {
    const nib = { dx: 1, dy: -2, major: 9, minor: 3, angle: 0.25 };
    const out = toCompactStroke({
      ...base,
      points: [
        { x: 0, y: 0, width: 4 },
        { x: 5, y: 0, width: 4, nib },
      ],
    });
    expect(out.n).toEqual([[1, 1, -2, 9, 3, 0.25]]);
  });
});
