import { describe, expect, test } from 'bun:test';
import { resolveEffects } from './effects.ts';
import { flattenPath, strokeEffects, wobbledOutline } from './strokeEffects.ts';

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

describe('wobbledOutline', () => {
  const square = 'M0 0L100 0L100 100L0 100Z';

  test('without a wobble the outline keeps its shape', () => {
    const fx = strokeEffects([], 0, '#000');
    expect(wobbledOutline(square, fx, Infinity)).toBe('M0 0L100 0L100 100L0 100Z');
  });

  test('each vertex moves by the wobble its glyph seed gives the strokes', () => {
    const effects = resolveEffects({ wobble: { amplitude: 4 } });
    const a = wobbledOutline(square, strokeEffects(effects, 1, '#000'), 50);
    const b = wobbledOutline(square, strokeEffects(effects, 2, '#000'), 50);
    expect(a).not.toBe(b);
    const coords = a.match(/-?[\d.]+/g)!.map(Number);
    const [flat] = flattenPath(square, 50);
    for (let i = 0; i < coords.length; i++) expect(Math.abs(coords[i]! - flat![i]!)).toBeLessThanOrEqual(4);
  });
});
