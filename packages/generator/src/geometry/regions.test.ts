import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { buildContours, findContourOverlaps } from './contours.ts';
import { partitionRegions, splitComponents } from './regions.ts';

const rect = (x1: number, y1: number, x2: number, y2: number): Point[] => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];

const circle = (cx: number, cy: number, r: number, n = 24): Point[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

/** buildContours + findContourOverlaps + partitionRegions, as the pipeline runs them. */
function regionsOf(...polygons: Point[][]) {
  const contours = buildContours(polygons.map((p) => [...p, p[0]!]));
  return partitionRegions(contours, findContourOverlaps(contours));
}

describe('partitionRegions — holes ride with crossing outers', () => {
  test('no overlaps: all contours stay one region', () => {
    const regions = regionsOf(circle(500, 500, 300), circle(500, 500, 150));
    expect(regions.length).toBe(1);
    expect(regions[0]!.length).toBe(2);
  });

  test("a counter inside an outline that crosses another stroke stays that outline's hole (Caveat R)", () => {
    // Caveat draws R as bowl+stem (one outline with a counter) crossed by the
    // leg. Restricting nesting to non-crossing contours orphaned the counter
    // at depth 0 and re-emitted it as standalone SOLID ink — the hole grew
    // its own medial axis while the hole-less bowl was drawn as a filled
    // teardrop.
    const bowl = circle(500, 400, 300); // outline that will cross the leg
    const counter = circle(500, 400, 150); // its hole
    const leg = rect(450, 600, 550, 1000); // crosses the bowl's boundary
    const regions = regionsOf(bowl, counter, leg);
    expect(regions.length).toBe(2);
    const bowlRegion = regions.find((r) => r.length === 2)!;
    expect(bowlRegion).toBeDefined();
    expect(bowlRegion[0]!.isHole).toBe(false);
    expect(bowlRegion[1]!.isHole).toBe(true);
    const legRegion = regions.find((r) => r.length === 1)!;
    expect(legRegion[0]!.isHole).toBe(false);
  });

  test('crossing outers stay separate pen strokes (an X of two rectangles)', () => {
    const regions = regionsOf(rect(100, 450, 900, 550), rect(450, 100, 550, 900));
    expect(regions.length).toBe(2);
    for (const region of regions) {
      expect(region.length).toBe(1);
      expect(region[0]!.isHole).toBe(false);
    }
  });

  test('an island inside a hole inside a crossing outline gets its own solid region', () => {
    const outer = circle(500, 400, 300);
    const hole = circle(500, 400, 200);
    const island = circle(500, 400, 80);
    const leg = rect(450, 600, 550, 1000);
    const regions = regionsOf(outer, hole, island, leg);
    expect(regions.length).toBe(3); // outer+hole, island, leg
    const outerRegion = regions.find((r) => r.length === 2)!;
    expect(outerRegion[1]!.isHole).toBe(true);
    const solos = regions.filter((r) => r.length === 1);
    expect(solos.length).toBe(2);
    for (const solo of solos) expect(solo[0]!.isHole).toBe(false);
  });
});

describe('splitComponents', () => {
  test("a colon's two dots are two pieces", () => {
    const [region] = regionsOf(circle(100, 100, 40), circle(100, 400, 40));
    expect(splitComponents(region!).map((part) => part.length)).toEqual([1, 1]);
  });

  test('a hole stays with the outer that owns it', () => {
    // An "o" beside a dot: the counter rides with the o, the dot is alone.
    const [region] = regionsOf(circle(500, 500, 300), circle(500, 500, 150), circle(1000, 500, 40));
    const parts = splitComponents(region!);
    expect(parts.map((part) => part.map((c) => c.isHole))).toEqual([[false, true], [false]]);
  });
});
