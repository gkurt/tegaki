import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { mergeSegmentFaces } from './face-merge.ts';
import { signedArea } from './primitives.ts';
import type { Face } from './types.ts';

/** Build a segment Face, reorienting to region-on-left and remapping edge tags. */
function buildFace(id: number, points: Point[], edgeCutIds: number[]): Face {
  let polygon = points;
  let tags = edgeCutIds;
  if (signedArea(points) < 0) {
    const n = points.length;
    polygon = [...points].reverse();
    tags = polygon.map((_, j) => edgeCutIds[(n - 2 - j + n) % n]!);
  }
  const c = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return {
    id,
    polygon,
    edgeCutIds: tags,
    holes: [],
    cutIds: [...new Set(tags.filter((t) => t >= 0))],
    area: Math.abs(signedArea(points)),
    centroid: { x: c.x / polygon.length, y: c.y / polygon.length },
    kind: 'segment',
  };
}

describe('mergeSegmentFaces', () => {
  // Two 200×40 rectangles sharing cut 5 at x=200; external cuts 1 (left) and 2 (right).
  const left = () =>
    buildFace(
      0,
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 40 },
        { x: 0, y: 40 },
      ],
      [-1, 5, -1, 1],
    );
  const right = () =>
    buildFace(
      1,
      [
        { x: 200, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 40 },
        { x: 200, y: 40 },
      ],
      [-1, 2, -1, 5],
    );

  test('two rectangles sharing one cut merge into one ring; the internal cut disappears', () => {
    const merged = mergeSegmentFaces([left(), right()]);
    expect(merged).not.toBeNull();
    expect(merged!.cutIds.sort()).toEqual([1, 2]);
    expect(merged!.edgeCutIds).not.toContain(5);
    expect(merged!.area).toBeCloseTo(2 * 200 * 40, 0);
    expect(merged!.holes.length).toBe(0);
    // Region-on-left orientation preserved.
    expect(signedArea(merged!.polygon)).toBeGreaterThan(0);
  });

  test('a loop chain (two faces sharing TWO cuts) closes into an annulus with the counter as a hole', () => {
    // Two U-halves of a square ring (outer 0..300, hole 100..200), joined by
    // cuts 7 and 8 across the legs at y=150. Their union is an annulus: one
    // outer ring plus the counter as a hole (all-wall), area conserved —
    // the loop walk in the straight-skeleton path draws it as one closed
    // stroke (0's stem+bowl).
    const bottom = buildFace(
      0,
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 150 },
        { x: 200, y: 150 },
        { x: 200, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 150 },
        { x: 0, y: 150 },
      ],
      [-1, -1, 7, -1, -1, -1, 8, -1],
    );
    const top = buildFace(
      1,
      [
        { x: 0, y: 150 },
        { x: 100, y: 150 },
        { x: 100, y: 200 },
        { x: 200, y: 200 },
        { x: 200, y: 150 },
        { x: 300, y: 150 },
        { x: 300, y: 300 },
        { x: 0, y: 300 },
      ],
      [8, -1, -1, -1, 7, -1, -1, -1],
    );
    const merged = mergeSegmentFaces([bottom, top]);
    expect(merged).not.toBeNull();
    expect(merged!.holes.length).toBe(1);
    expect(merged!.cutIds).toEqual([]); // both cuts internal — cancelled
    expect(signedArea(merged!.polygon)).toBeGreaterThan(0);
    // Area conserved: outer (300×300) minus counter (100×100) = the two U-halves.
    expect(merged!.area).toBeCloseTo(300 * 300 - 100 * 100, 4);
    // The hole is the counter (cut endpoints may remain as collinear vertices).
    const hole = merged!.holes[0]!;
    expect(Math.min(...hole.map((p) => p.x))).toBe(100);
    expect(Math.max(...hole.map((p) => p.x))).toBe(200);
    expect(Math.min(...hole.map((p) => p.y))).toBe(100);
    expect(Math.max(...hole.map((p) => p.y))).toBe(200);
  });

  test('disconnected faces (nothing shared) are declined', () => {
    const a = left();
    const b = buildFace(
      1,
      [
        { x: 1000, y: 0 },
        { x: 1200, y: 0 },
        { x: 1200, y: 40 },
        { x: 1000, y: 40 },
      ],
      [-1, -1, -1, -1],
    );
    expect(mergeSegmentFaces([a, b])).toBeNull();
  });

  test('three-face chain merges end to end', () => {
    const mid = () =>
      buildFace(
        2,
        [
          { x: 400, y: 0 },
          { x: 600, y: 0 },
          { x: 600, y: 40 },
          { x: 400, y: 40 },
        ],
        [-1, 3, -1, 2],
      );
    const merged = mergeSegmentFaces([left(), right(), mid()]);
    expect(merged).not.toBeNull();
    expect(merged!.cutIds.sort()).toEqual([1, 3]);
    expect(merged!.area).toBeCloseTo(3 * 200 * 40, 0);
  });

  test('subdivision mismatch on the shared edge fails area conservation and is declined', () => {
    // right() sees the shared edge as one 40-long edge, but this left face
    // subdivides it at y=20 — cancellation misses, stitching cannot close.
    const subdividedLeft = buildFace(
      0,
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 20 },
        { x: 200, y: 40 },
        { x: 0, y: 40 },
      ],
      [-1, 5, 5, -1, 1],
    );
    expect(mergeSegmentFaces([subdividedLeft, right()])).toBeNull();
  });
});
