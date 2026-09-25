import { describe, expect, test } from 'bun:test';
import { findHeadlines, HEADLINE_PRIORITY, isHeadlineScriptChar, orderAndTimeStrokes } from './ordering.ts';
import type { GeoStroke } from './types.ts';

const stroke = (...pts: [number, number][]): GeoStroke => ({
  points: pts.map(([x, y]) => ({ x, y, width: 40 })),
  isLoop: false,
  segmentIndices: [],
});

// A क-like letter in font units (y down): the headline across the top, a
// stem hanging from it on the right, and a bowl left of the stem.
const headline = stroke([0, -600], [700, -600]);
const stem = stroke([400, -590], [400, 0]);
const bowl = stroke([350, -400], [100, -300], [350, -150]);
const PARAMS = { drawingSpeed: 1000, strokePause: 0.1, rtl: false, yTolerance: 20 };

/** The draw order as the input strokes' indices. */
const drawOrder = (strokes: GeoStroke[], headlineLast: boolean) =>
  orderAndTimeStrokes(strokes, { ...PARAMS, headlineLast }).map((s) => strokes.findIndex((g) => g.points[0]!.y === s.points[0]!.y));

describe('headline last', () => {
  test('top-to-bottom draws the headline first; headlineLast draws it after the letter it caps', () => {
    const strokes = [headline, stem, bowl];
    expect(drawOrder(strokes, false)[0]).toBe(0);
    expect(drawOrder(strokes, true)).toEqual([1, 2, 0]);
  });

  test('a mark above the headline does not disqualify it, even one nearly a letter tall', () => {
    const hook = stroke([100, -620], [80, -1100], [300, -1150]);
    expect(findHeadlines([headline.points, stem.points, hook.points], [0, 0, 0])).toEqual([true, false, false]);
  });

  test('the headline is tagged for word-level deferral; a dot still draws after it', () => {
    const dot = stroke([900, -900], [905, -905]);
    const order = orderAndTimeStrokes([headline, stem, bowl, dot], { ...PARAMS, headlineLast: true });
    expect(order.map((s) => s.priority ?? 0)).toEqual([0, 0, HEADLINE_PRIORITY, -1]);
    expect(order.at(-2)!.points[0]!.y).toBe(-600);
  });

  test('a glyph that is only its bar keeps its order: nothing hangs from it', () => {
    expect(findHeadlines([headline.points], [0])).toEqual([false]);
  });

  test('a headline over a gap is still a headline: the body need not touch it', () => {
    const lowStem = stroke([400, -500], [400, 0]);
    expect(findHeadlines([headline.points, lowStem.points], [0, 0])).toEqual([true, false]);
  });

  test('a short or deep bar is not a headline', () => {
    // The stem's cap, not a headline: 150 of the glyph's 350 units.
    const shortBar = stroke([300, -600], [450, -600]);
    const midBar = stroke([0, -300], [700, -300]);
    expect(findHeadlines([shortBar.points, stem.points, bowl.points], [0, 0, 0])).toEqual([false, false, false]);
    expect(findHeadlines([midBar.points, stem.points, headline.points], [0, 0, 0])).toEqual([false, false, true]);
  });
});

describe('isHeadlineScriptChar', () => {
  test('Devanagari, Bengali and Gurmukhi letters hang from a headline', () => {
    expect(['क', 'ক', 'ਕ', 'ꣲ'].map(isHeadlineScriptChar)).toEqual([true, true, true, true]);
  });

  test('Latin, Hebrew and Arabic do not', () => {
    expect(['T', 'ה', 'ب', ''].map(isHeadlineScriptChar)).toEqual([false, false, false, false]);
  });
});
