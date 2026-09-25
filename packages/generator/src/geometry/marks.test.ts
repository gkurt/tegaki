import { describe, expect, test } from 'bun:test';
import { baseLetter, findMarkStrokes, hasCombiningMarks } from './marks.ts';
import { orderAndTimeStrokes } from './ordering.ts';
import type { GeoStroke } from './types.ts';

// Font units, y down, a 40-unit pen.
const stroke = (...pts: [number, number][]): GeoStroke => ({
  points: pts.map(([x, y]) => ({ x, y, width: 40 })),
  isLoop: false,
  segmentIndices: [],
});

// ô: the bowl, and a circumflex well clear above it.
const bowl = stroke([300, -200], [200, -350], [100, -200], [200, -50], [300, -200]);
const circumflex = stroke([120, -450], [200, -540], [280, -450]);

describe('hasCombiningMarks', () => {
  test('accented Latin, Greek and Cyrillic letters carry marks (é, ô, ό, й)', () => {
    for (const char of ['é', 'ô', 'ό', 'й', 'Ά']) expect(hasCombiningMarks(char)).toBe(true);
  });

  test('plain letters, a precomposed Hangul syllable and kana with dakuten do not', () => {
    for (const char of ['e', 'i', 'ø', '한', 'が']) expect(hasCombiningMarks(char)).toBe(false);
  });
});

describe('baseLetter', () => {
  test('an accented letter decomposes to its letter (é → e, ΐ → ι, Å → A)', () => {
    expect(baseLetter('é')).toBe('e');
    expect(baseLetter('ΐ')).toBe('ι');
    expect(baseLetter('Å')).toBe('A');
  });

  test('a letter without marks has no base', () => {
    expect(baseLetter('e')).toBeNull();
    expect(baseLetter('한')).toBeNull();
  });
});

describe('findMarkStrokes', () => {
  test("ô's circumflex is a mark, its bowl is not", () => {
    expect(findMarkStrokes([circumflex, bowl])).toEqual([true, false]);
  });

  test('a mark with more ink than a short body is still a mark (î: the circumflex over a dotless stem)', () => {
    const stem = stroke([200, -300], [200, -50]);
    const wide = stroke([60, -420], [200, -560], [340, -420]);
    expect(findMarkStrokes([wide, stem])).toEqual([true, false]);
  });

  test('strokes touching the body are body (a cedilla run into its c)', () => {
    const c = stroke([300, -300], [100, -200], [300, -50]);
    const cedilla = stroke([300, -50], [320, 80], [250, 120]);
    expect(findMarkStrokes([c, cedilla])).toEqual([false, false]);
  });

  test('one piece has no marks', () => {
    expect(findMarkStrokes([bowl])).toEqual([false]);
  });
});

describe('mark order', () => {
  const params = { drawingSpeed: 1000, strokePause: 0.1, rtl: false, yTolerance: 20 };

  test('a mark draws after the body and in the dot tier, though it sits higher', () => {
    const drawn = orderAndTimeStrokes([{ ...circumflex, mark: true }, bowl], params);
    expect(drawn.map((s) => s.points[0]!.y > -400)).toEqual([true, false]);
    expect(drawn.map((s) => s.priority)).toEqual([undefined, -1]);
  });

  test('without the tag the top-to-bottom order draws the accent first', () => {
    const drawn = orderAndTimeStrokes([circumflex, bowl], params);
    expect(drawn[0]!.points[0]!.y).toBeLessThan(-400);
  });

  test('a reference plan orders the body; the mark still draws last', () => {
    const drawn = orderAndTimeStrokes([bowl, { ...circumflex, mark: true }], params, { sequence: [0, 1], reverse: [false, false] });
    expect(drawn.map((s) => s.priority)).toEqual([undefined, -1]);
  });
});
