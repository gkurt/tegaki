import { describe, expect, test } from 'bun:test';
import { seededRandom } from './random.ts';
import { clearance, expandBox, inkEdge, offsetPath, type PathPoint, StrokePath, unionBoxes } from './strokePath.ts';

/** A path through `xy` pairs, `t` spread by arc length, every point `width` wide. */
function path(xy: [number, number][], width = 4): StrokePath {
  const lens = [0];
  for (let i = 1; i < xy.length; i++) lens.push(lens[i - 1]! + Math.hypot(xy[i]![0] - xy[i - 1]![0], xy[i]![1] - xy[i - 1]![1]));
  const total = lens[lens.length - 1]!;
  return new StrokePath(xy.map(([x, y], i) => ({ x, y, width, t: total > 0 ? lens[i]! / total : 0 })));
}

const xy = (p: StrokePath) => p.points.map((q) => [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100]);

describe('StrokePath', () => {
  const line = path([
    [0, 0],
    [100, 0],
    [100, 100],
  ]);

  test('length is the arc length', () => {
    expect(line.length).toBe(200);
  });

  test('pointAt interpolates by draw progress and heads along the segment', () => {
    expect(line.pointAt(0.25)).toEqual({ x: 50, y: 0, angle: 0, width: 4 });
    const down = line.pointAt(0.75);
    expect([down.x, down.y]).toEqual([100, 50]);
    expect(down.angle).toBeCloseTo(Math.PI / 2, 9);
  });

  test('pointAt clamps to the ends', () => {
    expect(line.pointAt(-1)).toMatchObject({ x: 0, y: 0 });
    expect(line.pointAt(2)).toMatchObject({ x: 100, y: 100 });
  });

  test('a slice runs its own 0–1 between the cut points', () => {
    const part = line.slice(0.25, 0.75);
    expect(xy(part)).toEqual([
      [50, 0],
      [100, 0],
      [100, 50],
    ]);
    expect(part.points.map((p) => p.t)).toEqual([0, 0.5, 1]);
  });

  test('bounds pad every point by half its width', () => {
    expect(line.bounds()).toEqual({ minX: -2, minY: -2, maxX: 102, maxY: 102 });
    expect(new StrokePath([]).bounds()).toBeNull();
  });
});

describe('offsetPath', () => {
  const east = path([
    [0, 0],
    [100, 0],
  ]);

  test('positive goes to the pen’s left: up, for a pen moving right (y down)', () => {
    expect(xy(offsetPath(east, 5))).toEqual([
      [0, -5],
      [100, -5],
    ]);
    expect(xy(offsetPath(east, -5))).toEqual([
      [0, 5],
      [100, 5],
    ]);
  });

  test('points keep their source’s draw progress', () => {
    expect(offsetPath(east, 5).points.map((p) => p.t)).toEqual([0, 1]);
  });

  test('a corner is mitered, on either side', () => {
    const corner = path([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
    // A right turn: its left is the outside.
    expect(xy(offsetPath(corner, 5))).toEqual([
      [0, -5],
      [105, -5],
      [105, 100],
    ]);
    expect(xy(offsetPath(corner, -5))).toEqual([
      [0, 5],
      [95, 5],
      [95, 100],
    ]);
  });

  test('a corner too sharp to miter is beveled', () => {
    const hairpin = path([
      [0, 0],
      [100, 0],
      [0, 20],
    ]);
    const out = offsetPath(hairpin, 5).points;
    // Two points where the corner was, one off each segment.
    expect(out).toHaveLength(4);
    expect(out[1]!.t).toBe(out[2]!.t);
  });

  test('an inside offset wider than a curve’s radius has its loop cut out', () => {
    // East, a quarter turn right around (0, 10) with radius 10, then south.
    const arc: [number, number][] = [];
    for (let k = 0; k <= 8; k++) {
      const a = -Math.PI / 2 + (k / 8) * (Math.PI / 2);
      arc.push([10 * Math.cos(a), 10 + 10 * Math.sin(a)]);
    }
    const turn = path([[-50, 0], ...arc, [10, 60]]);
    // 20px to the right (inside the turn) folds back past the centre.
    expect(xy(offsetPath(turn, -20))).toEqual([
      [-50, 20],
      [-10, 20],
      [-10, 60],
    ]);
  });

  test('a real crossing (a cursive loop) is kept', () => {
    const loop = path([
      [0, 50],
      [100, 50],
      [100, 0],
      [50, 0],
      [50, 100],
    ]);
    // The offset of the loop crosses itself where the stroke does, running forwards throughout.
    expect(offsetPath(loop, 3).points).toHaveLength(5);
  });

  test('inkEdge keeps a gap from the ink’s edge, wherever the ink is wide', () => {
    const swelling = new StrokePath([
      { x: 0, y: 0, width: 4, t: 0 },
      { x: 100, y: 0, width: 20, t: 1 },
    ] satisfies PathPoint[]);
    expect(xy(offsetPath(swelling, inkEdge(3)))).toEqual([
      [0, -5],
      [100, -13],
    ]);
    expect(xy(offsetPath(swelling, inkEdge(3, -1)))).toEqual([
      [0, 5],
      [100, 13],
    ]);
  });
});

describe('clearance', () => {
  const east = path(
    [
      [0, 0],
      [100, 0],
    ],
    4,
  );

  test('distance to the nearest ink edge', () => {
    expect(clearance({ x: 50, y: 10 }, [east])).toBe(8);
    expect(clearance({ x: 110, y: 0 }, [east])).toBe(8);
  });

  test('negative inside the ink; Infinity with nothing to clear', () => {
    expect(clearance({ x: 50, y: 1 }, [east])).toBe(-1);
    expect(clearance({ x: 0, y: 0 }, [])).toBe(Infinity);
  });
});

describe('boxes', () => {
  test('unionBoxes skips missing boxes', () => {
    expect(unionBoxes([null, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, { minX: -1, minY: 2, maxX: 0, maxY: 3 }])).toEqual({
      minX: -1,
      minY: 0,
      maxX: 1,
      maxY: 3,
    });
    expect(unionBoxes([])).toBeNull();
  });

  test('expandBox grows every side; no box stays none', () => {
    expect(expandBox({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 2)).toEqual({ minX: -2, minY: -2, maxX: 3, maxY: 3 });
    expect(expandBox(null, 2)).toBeNull();
  });
});

describe('seededRandom', () => {
  test('the same seed and key give the same numbers', () => {
    const a = seededRandom(1.5, 'stroke:1');
    const b = seededRandom(1.5, 'stroke:1');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test('another key gives other numbers, all in [0, 1)', () => {
    const a = seededRandom(1.5, 'stroke:1');
    const b = seededRandom(1.5, 'stroke:2');
    const xs = Array.from({ length: 100 }, () => a());
    expect(xs[0]).not.toBe(b());
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});
