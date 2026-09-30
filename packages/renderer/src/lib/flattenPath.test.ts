import { describe, expect, test } from 'bun:test';
import { flattenPath } from './flattenPath.ts';

describe('flattenPath', () => {
  test('a closed square is one contour without its repeated closing vertex', () => {
    expect(flattenPath('M0 0L10 0L10 10L0 10Z', Infinity)).toEqual([[0, 0, 10, 0, 10, 10, 0, 10]]);
  });

  test('segments are split so no two vertices are further apart than the step', () => {
    const [contour] = flattenPath('M0,0L100,0L100,10Z', 25);
    expect(contour!.slice(0, 10)).toEqual([0, 0, 25, 0, 50, 0, 75, 0, 100, 0]);
  });

  test('relative commands, H / V and implicit linetos after a moveto', () => {
    expect(flattenPath('m5 5 10 0v10h-10z', Infinity)).toEqual([[5, 5, 15, 5, 15, 15, 5, 15]]);
  });

  test('curves end on their endpoint, and each subpath is its own contour', () => {
    const contours = flattenPath('M0 0Q50 100 100 0Z M200 0C200 50 300 50 300 0Z', Infinity);
    expect(contours).toHaveLength(2);
    expect(contours[0]!.slice(-2)).toEqual([100, 0]);
    expect(contours[1]!.slice(-2)).toEqual([300, 0]);
  });
});
