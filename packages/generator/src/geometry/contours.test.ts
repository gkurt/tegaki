import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { buildContours, dropSpikes } from './contours.ts';

const pts = (...xy: [number, number][]): Point[] => xy.map(([x, y]) => ({ x, y }));

describe('dropSpikes', () => {
  test("a hairline running out and back along one line folds away (Caveat F's top-bar tip)", () => {
    // The bar's right end: …186 → 187, out along slope ½ to 189 and back past 187 to 191, then on.
    const bar = pts(
      [0, 0],
      [629.375, -618.875],
      [629, -618],
      [627.5625, -618.71875],
      [627.25, -618.875],
      [628.0625, -618.46875],
      [630, -617.5],
      [0, -600],
    );
    expect(dropSpikes(bar)).toEqual(pts([0, 0], [629.375, -618.875], [629, -618], [630, -617.5], [0, -600]));
  });

  test('a spike that returns to its base drops its repeated base point too', () => {
    const square = pts([0, 0], [10, 0], [20, 0], [10, 0], [10, 10], [0, 10]);
    expect(dropSpikes(square)).toEqual(pts([0, 0], [10, 0], [10, 10], [0, 10]));
  });

  test('sharp but real corners stay', () => {
    const sliver = pts([0, 0], [100, 1], [0, 2]);
    expect(dropSpikes(sliver)).toEqual(sliver);
  });

  test('straight runs keep their vertices', () => {
    const rect = pts([0, 0], [5, 0], [10, 0], [10, 10], [0, 10]);
    expect(dropSpikes(rect)).toEqual(rect);
  });
});

describe('buildContours', () => {
  test('an outline that is all spike leaves no contour', () => {
    expect(buildContours([pts([0, 0], [10, 0], [20, 0], [10, 0], [0, 0])])).toEqual([]);
  });
});
