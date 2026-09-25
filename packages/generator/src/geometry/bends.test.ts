import { describe, expect, test } from 'bun:test';
import { splitBentStrokes } from './bends.ts';
import type { GeoStroke } from './types.ts';

// Font units, y down, a 40-unit pen.
const stroke = (...pts: [number, number][]): GeoStroke => ({
  points: pts.map(([x, y]) => ({ x, y, width: 40 })),
  isLoop: false,
  segmentIndices: [],
});
const loop = (...pts: [number, number][]): GeoStroke => ({ ...stroke(...pts, pts[0]!), isLoop: true });

/** Each stroke as its sorted end points, for comparing without caring about direction. */
const ends = (strokes: GeoStroke[]) =>
  strokes
    .map((s) => {
      const a = s.points[0]!;
      const b = s.points[s.points.length - 1]!;
      return [
        [a.x, a.y],
        [b.x, b.y],
      ].sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]!);
    })
    .sort((p, q) => p[0]![0]! - q[0]![0]! || p[0]![1]! - q[0]![1]! || p[1]![0]! - q[1]![0]! || p[1]![1]! - q[1]![1]!);

describe('splitBentStrokes', () => {
  test('口 as one loop is the left side, the 横折 top and right, and the closing bottom bar', () => {
    const split = splitBentStrokes([loop([0, 0], [400, 0], [400, 400], [0, 400])]);
    expect(split.length).toBe(3);
    expect(split.every((s) => !s.isLoop)).toBe(true);
    expect(ends(split)).toEqual([
      [
        [0, 0],
        [0, 400],
      ],
      [
        [0, 0],
        [400, 400],
      ],
      [
        [0, 400],
        [400, 400],
      ],
    ]);
  });

  test('己 in one run is 横折, the middle bar, and the 竖弯钩 with its hook', () => {
    const run = stroke([0, 0], [300, 0], [300, 200], [0, 200], [0, 450], [400, 450], [400, 350]);
    const split = splitBentStrokes([run]);
    expect(split.map((s) => s.points.length)).toEqual([3, 2, 4]);
  });

  test("山's 竖折 stays whole: its foot ends at a plain vertical, not a 横折's leg", () => {
    const bend = stroke([0, 100], [0, 400], [400, 400]);
    const middle = stroke([200, 0], [200, 400]);
    const right = stroke([400, 100], [400, 400]);
    expect(splitBentStrokes([middle, bend, right]).length).toBe(3);
  });

  test('a 竖钩 keeps its hook', () => {
    expect(splitBentStrokes([stroke([200, 0], [200, 400], [120, 340])]).length).toBe(1);
  });

  test('a corner the pen takes the other way round is cut (up, then right)', () => {
    expect(splitBentStrokes([stroke([0, 400], [0, 0], [400, 0])]).length).toBe(2);
  });

  test('a serif flick retraced on the way into a 横折 is not a corner', () => {
    const run = stroke([0, 0], [300, 0], [330, -40], [300, 0], [300, 400]);
    expect(splitBentStrokes([run]).length).toBe(1);
  });

  test('strokes without corners pass through untouched', () => {
    const bar = stroke([0, 0], [400, 0]);
    const ring = loop(
      ...Array.from({ length: 24 }, (_, i): [number, number] => [200 * Math.cos((i * Math.PI) / 12), 200 * Math.sin((i * Math.PI) / 12)]),
    );
    expect(splitBentStrokes([bar])).toEqual([bar]);
    expect(splitBentStrokes([stroke([0, 0], [200, 30], [400, 0])]).length).toBe(1);
    expect(splitBentStrokes([ring])).toEqual([ring]);
  });
});
