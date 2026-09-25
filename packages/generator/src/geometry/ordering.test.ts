import { describe, expect, test } from 'bun:test';
import {
  componentSlots,
  findHeadlines,
  HEADLINE_PRIORITY,
  isHeadlineScriptChar,
  ligatureComponentEdges,
  orderAndTimeStrokes,
  type StrokeGroup,
} from './ordering.ts';
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

describe('ligature order', () => {
  // Dancing Script's w_r in font units: the w's two strokes, then the r
  // rising above them on the right.
  const wLeft = stroke([30, -270], [150, 0], [260, -270]);
  const wRight = stroke([260, -260], [370, 0], [487, -260]);
  const r = stroke([491, -100], [600, -390], [990, -300]);
  /** One heuristic group per ligature slot, as the pipeline builds them for letters without references. */
  const slotGroups = (strokes: GeoStroke[], edges: number[]): StrokeGroup[] => {
    const slots = componentSlots(
      strokes.map((s) => s.points),
      edges,
    );
    return Array.from({ length: edges.length + 1 }, (_, k) => ({ strokes: slots.flatMap((slot, i) => (slot === k ? [i] : [])) }));
  };
  const drawn = (strokes: GeoStroke[], groups?: StrokeGroup[]) =>
    orderAndTimeStrokes(strokes, { ...PARAMS, ...(groups ? { groups } : {}) });
  const firstXs = (strokes: GeoStroke[], groups?: StrokeGroup[]) =>
    drawn(strokes, groups).map((s) => Math.min(...s.points.map((p) => p.x)));

  test('top-to-bottom alone draws the taller r before the w', () => {
    expect(firstXs([wLeft, wRight, r])).toEqual([491, 30, 260]);
  });

  test('letter groups draw a ligature letter by letter: the w, then the r', () => {
    const strokes = [wLeft, wRight, r];
    expect(firstXs(strokes, slotGroups(strokes, ligatureComponentEdges([617, 348], 966)))).toEqual([30, 260, 491]);
  });

  test("a stroke belongs to the letter holding its ink's midpoint, not its leftmost point", () => {
    // Reaches back over the w's slot, but most of its ink lies in the r's.
    const hooked = stroke([560, -100], [600, -390], [990, -300]);
    const reach = stroke([400, -400], [560, -100]);
    expect(componentSlots([hooked.points, reach.points], [617])).toEqual([1, 0]);
    const strokes = [hooked, wLeft, reach];
    expect(firstXs(strokes, slotGroups(strokes, [617]))).toEqual([400, 30, 560]);
  });

  test("a letter's plan orders and orients its strokes; the other letters keep their turn", () => {
    // The w's reference draws its right half first, from its right end.
    const groups: StrokeGroup[] = [{ strokes: [0, 1], plan: { sequence: [1, 0], reverse: [false, true] } }, { strokes: [2] }];
    const order = drawn([wLeft, wRight, r], groups);
    expect(order.map((s) => Math.min(...s.points.map((p) => p.x)))).toEqual([260, 30, 491]);
    expect(order[0]!.points[0]!.x).toBe(487);
  });

  test("a dot draws where its letter's plan puts it, and last in a letter without one", () => {
    const dot = stroke([200, -470], [204, -474]);
    const stem = stroke([130, -300], [150, 0]);
    const planned: StrokeGroup[] = [{ strokes: [0, 1], plan: { sequence: [1, 0], reverse: [false, false] } }];
    expect(drawn([stem, dot], planned).map((s) => s.priority ?? 0)).toEqual([0, 0]);
    expect(drawn([stem, dot], planned)[0]!.points[0]!.y).toBe(-470);
    expect(drawn([stem, dot], [{ strokes: [0, 1] }]).at(-1)!.priority).toBe(-1);
  });
});

describe('ligatureComponentEdges', () => {
  test("the components' advances, laid end to end and scaled to the ligature's advance", () => {
    expect(ligatureComponentEdges([600, 400], 900)).toEqual([540]);
    expect(ligatureComponentEdges([100, 100, 200], 400)).toEqual([100, 200]);
  });

  test('no edges for one component, or components without advance (combining marks)', () => {
    expect(ligatureComponentEdges([500], 500)).toEqual([]);
    expect(ligatureComponentEdges([0, 0], 0)).toEqual([]);
  });

  test("no edges when the components don't fill the ligature: a fraction's digits are drawn small (Dancing Script ¼)", () => {
    expect(ligatureComponentEdges([365, 330, 478], 642)).toEqual([]);
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

describe('right-to-left order', () => {
  const RTL = { ...PARAMS, rtl: true };
  /** Index of each drawn stroke among the inputs, matched by its point set. */
  const order = (strokes: GeoStroke[], params = RTL) =>
    orderAndTimeStrokes(strokes, params).map((s) =>
      strokes.findIndex((g) => g.points.some((p) => p.x === s.points[0]!.x && p.y === s.points[0]!.y)),
    );

  test('a stroke planted on another draws after it (ط: the bowl, then the stem standing on it)', () => {
    const tStem = stroke([300, -700], [300, -120]);
    const tBowl = stroke([600, -100], [450, -250], [200, -100], [0, 0]);
    expect(order([tStem, tBowl])).toEqual([1, 0]);
  });

  test('strokes meeting end to end keep top-to-bottom (ح: the bar, then the bowl it runs into)', () => {
    const bar = stroke([500, -500], [100, -500]);
    const hBowl = stroke([100, -500], [0, -250], [300, 0], [600, -50]);
    expect(order([hBowl, bar])).toEqual([1, 0]);
  });

  test('a detached stroke is not planted, even rising from beside another', () => {
    const hBowl = stroke([600, -100], [300, -150], [0, -100]);
    const apart = stroke([300, -700], [300, -300]);
    expect(order([hBowl, apart])).toEqual([1, 0]);
  });

  test('without topEntry an RTL stroke enters at its right end, even from the foot of a leg', () => {
    const he = stroke([0, -600], [500, -600], [500, 0]);
    expect(orderAndTimeStrokes([he], RTL)[0]!.points[0]).toMatchObject({ x: 500, y: 0 });
  });

  test('topEntry enters at the top end (Hebrew ה: its top-left corner, across, then down the right leg)', () => {
    const he = stroke([500, 0], [500, -600], [0, -600]);
    expect(orderAndTimeStrokes([he], { ...RTL, topEntry: true })[0]!.points[0]).toMatchObject({ x: 0, y: -600 });
  });
});
