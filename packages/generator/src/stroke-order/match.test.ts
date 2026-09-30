import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki/internal';
import { hungarian, isClosedPolyline, matchStrokes, resamplePolyline, rotateLoop } from './match.ts';

const line = (x1: number, y1: number, x2: number, y2: number): Point[] => [
  { x: x1, y: y1 },
  { x: x2, y: y2 },
];

describe('resamplePolyline', () => {
  test('produces n arc-length-uniform points with exact endpoints', () => {
    const out = resamplePolyline(line(0, 0, 30, 0), 4);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  test('uniform in arc length, not vertex index', () => {
    // Two segments of very different lengths: samples must not bunch at the joint.
    const out = resamplePolyline(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 100, y: 0 },
      ],
      5,
    );
    expect(out.map((p) => p.x)).toEqual([0, 25, 50, 75, 100]);
  });

  test('a single-point stroke (dot) repeats the point', () => {
    const out = resamplePolyline([{ x: 5, y: 7 }], 3);
    expect(out).toEqual([
      { x: 5, y: 7 },
      { x: 5, y: 7 },
      { x: 5, y: 7 },
    ]);
  });
});

describe('hungarian', () => {
  test('picks the globally optimal assignment, not the greedy one', () => {
    // Greedy row-by-row takes (0,0)=1 then forces (1,1)=100 (total 101);
    // optimal is (0,1)=2 + (1,0)=3 (total 5).
    const assignment = hungarian([
      [1, 2],
      [3, 100],
    ]);
    expect(assignment).toEqual([1, 0]);
  });

  test('identity when the diagonal dominates', () => {
    expect(
      hungarian([
        [0, 9, 9],
        [9, 0, 9],
        [9, 9, 0],
      ]),
    ).toEqual([0, 1, 2]);
  });
});

describe('matchStrokes', () => {
  test('recovers the reference order when extracted strokes are shuffled', () => {
    // Extracted: [left bar, right bar]; reference orders right first.
    const extracted = [line(100, 0, 100, 500), line(400, 0, 400, 500)];
    const reference = [line(400, 0, 400, 500), line(100, 0, 100, 500)];
    const m = matchStrokes(extracted, reference, 640);
    expect(m.pairs.length).toBe(2);
    const byExtracted = new Map(m.pairs.map((p) => [p.extracted, p]));
    expect(byExtracted.get(0)!.reference).toBe(1);
    expect(byExtracted.get(1)!.reference).toBe(0);
    expect(m.meanCost).toBeLessThan(0.01);
  });

  test('detects reversed pen direction', () => {
    // Extracted drawn top-to-bottom, reference prescribes bottom-to-top.
    const extracted = [line(100, 0, 100, 500)];
    const reference = [line(100, 500, 100, 0)];
    const m = matchStrokes(extracted, reference, 640);
    expect(m.pairs[0]!.reversed).toBe(true);
  });

  test('forward direction is not flagged', () => {
    const m = matchStrokes([line(0, 0, 500, 0)], [line(0, 0, 500, 0)], 640);
    expect(m.pairs[0]!.reversed).toBe(false);
  });

  test('count mismatch matches min(n,m) and reports both counts', () => {
    const extracted = [line(100, 0, 100, 500)];
    const reference = [line(400, 0, 400, 500), line(100, 0, 100, 500)];
    const m = matchStrokes(extracted, reference, 640);
    expect(m.pairs.length).toBe(1);
    expect(m.pairs[0]!.reference).toBe(1); // the nearer reference stroke
    expect(m.extractedCount).toBe(1);
    expect(m.referenceCount).toBe(2);
  });

  test('a wildly different reference yields a high cost, not a confident match', () => {
    // Vertical extracted vs horizontal reference across the glyph.
    const m = matchStrokes([line(250, 0, 250, 500)], [line(0, 250, 500, 250)], Math.hypot(500, 500));
    expect(m.meanCost).toBeGreaterThan(0.15);
  });

  test('reports the cost of the pen running the other way', () => {
    const m = matchStrokes([line(100, 0, 100, 500)], [line(100, 500, 100, 0)], 640);
    expect(m.pairs[0]!.cost).toBeLessThan(0.01);
    expect(m.pairs[0]!.reverseCost).toBeGreaterThan(0.3);
  });
});

// A square ring, counter-clockwise on screen (y-down), closed on its first vertex.
const ring = (start: number): Point[] => {
  const corners = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
  ];
  const out = [...corners.slice(start), ...corners.slice(0, start)];
  return [...out, { ...out[0]! }];
};

describe('loops', () => {
  test('rotateLoop moves the seam and closes the ring again', () => {
    expect(rotateLoop(ring(0), 2)).toEqual(ring(2));
  });

  test('isClosedPolyline tells a ring from an open stroke', () => {
    expect(isClosedPolyline(ring(0))).toBe(true);
    expect(isClosedPolyline(ring(0).slice(0, -1))).toBe(false);
  });

  test('a loop is entered where the reference enters it', () => {
    // Extracted from the top-left corner; the reference starts at the bottom-right one.
    const m = matchStrokes([ring(0)], [ring(2)], 141, [true]);
    expect(m.pairs[0]!.start).toBe(2);
    expect(m.pairs[0]!.reversed).toBe(false);
    expect(m.pairs[0]!.cost).toBeLessThan(0.01);
  });

  test('a loop wound the other way is entered and reversed', () => {
    const clockwise = [...ring(2)].reverse();
    const m = matchStrokes([ring(0)], [clockwise], 141, [true]);
    expect(m.pairs[0]!.reversed).toBe(true);
    expect(rotateLoop(ring(0), m.pairs[0]!.start!).reverse()).toEqual(clockwise);
  });

  test('a path that only happens to end where it began keeps its start', () => {
    const m = matchStrokes([ring(0)], [ring(2)], 141);
    expect(m.pairs[0]!.start).toBeUndefined();
    expect(m.pairs[0]!.cost).toBeGreaterThan(0.3);
  });
});
