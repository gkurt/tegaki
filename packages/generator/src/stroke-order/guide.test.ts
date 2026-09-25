import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { guideOrderByReference } from './guide.ts';
import type { ReferenceStroke } from './types.ts';

const line = (x1: number, y1: number, x2: number, y2: number, n = 5): Point[] =>
  Array.from({ length: n }, (_, i) => ({ x: x1 + ((x2 - x1) * i) / (n - 1), y: y1 + ((y2 - y1) * i) / (n - 1) }));

const ring = (cx: number, cy: number, r: number, ccw: boolean): Point[] =>
  Array.from({ length: 13 }, (_, i) => {
    const a = -Math.PI / 2 + (ccw ? -1 : 1) * (i / 12) * 2 * Math.PI;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

const ref = (points: Point[], group?: number): ReferenceStroke => (group === undefined ? { points } : { points, group });

describe('guideOrderByReference', () => {
  test('strokes draw in the order of the reference strokes they follow', () => {
    const reference = [ref(line(0, 0, 100, 0)), ref(line(0, 50, 100, 50)), ref(line(0, 100, 100, 100))];
    const extracted = [line(0, 100, 100, 100), line(0, 0, 100, 0), line(0, 50, 100, 50)];
    const guided = guideOrderByReference(extracted, reference, 100)!;
    expect(guided.sequence).toEqual([1, 2, 0]);
    expect(guided.reverse).toEqual([false, false, false]);
    expect(guided.meanDistance).toBeCloseTo(0);
  });

  test('a stroke drawn against its reference is reversed', () => {
    const reference = [ref(line(0, 0, 100, 0)), ref(line(50, 0, 50, 100))];
    const extracted = [line(100, 0, 0, 0), line(50, 100, 50, 0)];
    expect(guideOrderByReference(extracted, reference, 100)!.reverse).toEqual([true, true]);
  });

  test('a closed stroke takes the reference winding', () => {
    const reference = [ref(ring(50, 50, 40, true))];
    expect(guideOrderByReference([ring(50, 50, 40, false)], reference, 100)!.reverse).toEqual([true]);
    expect(guideOrderByReference([ring(50, 50, 40, true)], reference, 100)!.reverse).toEqual([false]);
  });

  test('ink merged across reference strokes draws where most of it belongs (a ㅎ tick run into its ring, after the bar)', () => {
    // Reference: tick, bar, ring. Extracted: tick+ring as one stroke, then the bar.
    const tick = line(50, 0, 50, 15);
    const bar = line(20, 20, 80, 20);
    const circle = ring(50, 60, 30, true);
    const reference = [ref(tick), ref(bar), ref(circle)];
    const merged = [...line(50, 0, 50, 30, 3), ...circle.slice(1)];
    const guided = guideOrderByReference([merged, bar], reference, 100)!;
    expect(guided.sequence).toEqual([1, 0]);
    expect(guided.reverse).toEqual([false, false]);
  });

  test('a short stroke leaving a long one is still ordered by the ink it follows', () => {
    // ㅏ: the stem, then the tick leaving it rightward.
    const reference = [ref(line(40, 0, 40, 100)), ref(line(40, 50, 80, 50))];
    const extracted = [line(40, 50, 80, 50), line(40, 0, 40, 100)];
    const guided = guideOrderByReference(extracted, reference, 100)!;
    expect(guided.sequence).toEqual([1, 0]);
    expect(guided.reverse).toEqual([false, false]);
  });

  test('a letter set off from its template is moved onto its own ink', () => {
    // Two letters side by side; the font draws the second far lower than the
    // template, so its bar sits nearer the first letter's foot until refit.
    const reference = [ref(line(0, 0, 0, 100), 0), ref(line(0, 100, 40, 100), 0), ref(line(60, 0, 100, 0), 1), ref(line(80, 0, 80, 60), 1)];
    const extracted = [line(0, 0, 0, 100), line(0, 100, 40, 100), line(60, 70, 100, 70), line(80, 70, 80, 130)];
    const guided = guideOrderByReference(extracted, reference, 150)!;
    expect(guided.sequence).toEqual([0, 1, 2, 3]);
    expect(guided.reverse).toEqual([false, false, false, false]);
  });

  test('nothing to order is null', () => {
    expect(guideOrderByReference([], [ref(line(0, 0, 1, 0))], 1)).toBeNull();
    expect(guideOrderByReference([line(0, 0, 1, 0)], [], 1)).toBeNull();
    expect(guideOrderByReference([line(0, 0, 1, 0)], [ref(line(0, 0, 1, 0))], 0)).toBeNull();
  });
});
