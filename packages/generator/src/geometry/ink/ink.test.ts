import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { buildContours } from '../contours.ts';
import { pointInRegion } from '../primitives.ts';
import type { AxisPoint } from '../types.ts';
import { type ClusterSlot, solvePairing } from './cover.ts';
import { extractInkRegion } from './extract.ts';
import { buildInkGraph, pruneSpurs, withFlicks } from './graph.ts';
import { buildInkMesh, trianglePoints } from './mesh.ts';
import { carryNibs, inNib } from './nib.ts';
import { SegmentIndex } from './spatial.ts';

const STEP = 6;
const MIN_COS = Math.cos((75 * Math.PI) / 180);

const rect = (x1: number, y1: number, x2: number, y2: number): Point[] => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];

/** One polygon tracing a plus sign: arms of width 2h around (0,0), reach L. */
function plus(L: number, h: number): Point[] {
  return [
    { x: -h, y: -L },
    { x: h, y: -L },
    { x: h, y: -h },
    { x: L, y: -h },
    { x: L, y: h },
    { x: h, y: h },
    { x: h, y: L },
    { x: -h, y: L },
    { x: -h, y: h },
    { x: -L, y: h },
    { x: -L, y: -h },
    { x: -h, y: -h },
  ];
}

/** A T: a horizontal bar on top of a vertical stem, as one polygon. */
function tee(): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 60 },
    { x: 230, y: 60 },
    { x: 230, y: 400 },
    { x: 170, y: 400 },
    { x: 170, y: 60 },
    { x: 0, y: 60 },
  ];
}

/** A 400×60 bar with a small round ear (half-ellipse, 32 wide, `h` high) on its top edge. */
function barWithEar(h: number): Point[] {
  const ear = Array.from({ length: 13 }, (_, i) => {
    const a = Math.PI - (i / 12) * Math.PI;
    return { x: 200 + 16 * Math.cos(a), y: -h * Math.sin(a) };
  });
  return [{ x: 0, y: 0 }, ...ear, { x: 400, y: 0 }, { x: 400, y: 60 }, { x: 0, y: 60 }];
}

function extract(...polygons: Point[][]) {
  return extractInkRegion(
    buildContours(polygons),
    { sampleSpacing: STEP, spurTolerance: 0.5, junctionReach: 1.5, continuationMinCos: MIN_COS, simplifyEpsilon: 4 },
    0,
  );
}

function slot(key: number, point: Point, direction: Point, deadEnd: number | null = null): ClusterSlot {
  return { key, point: { ...point, width: 60 }, direction, deadEnd };
}

describe('buildInkMesh', () => {
  test('triangles tile the ink exactly (hole punched out)', () => {
    const mesh = buildInkMesh(buildContours([rect(0, 0, 300, 300), [...rect(100, 100, 200, 200)].reverse()]), STEP);
    let area = 0;
    for (let t = 0; t < mesh.triCount; t++) {
      const [a, b, c] = trianglePoints(mesh, t);
      area += ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    }
    expect(mesh.missingEdges).toBe(0);
    expect(area).toBeCloseTo(300 * 300 - 100 * 100, 0);
  });

  test('a plain bar prunes down to a single branch: two tips, no junction nodes', () => {
    const mesh = buildInkMesh(buildContours([rect(0, 0, 400, 60)]), STEP);
    const outline: [Point, Point][] = [];
    for (let i = 0; i < mesh.points.length; i++) outline.push([mesh.points[i]!, mesh.points[mesh.next[i]!]!]);
    const g = buildInkGraph(mesh, new SegmentIndex(outline, STEP * 4));
    pruneSpurs(g, 0.5, STEP * 2.5);
    const degrees = { tips: 0, junctions: 0 };
    for (let t = 0; t < mesh.triCount; t++) {
      if (!g.alive[t]) continue;
      if (g.deg[t] === 1) degrees.tips++;
      if (g.deg[t]! >= 3) degrees.junctions++;
    }
    expect(degrees).toEqual({ tips: 2, junctions: 0 });
  });
});

describe('solvePairing', () => {
  test('a crossing pairs each arm with its opposite (two straight passes)', () => {
    // Directions ENTER the cluster: the arm from the left travels +x, etc.
    const slots = [
      slot(0, { x: -40, y: 0 }, { x: 1, y: 0 }),
      slot(2, { x: 0, y: -40 }, { x: 0, y: 1 }),
      slot(4, { x: 40, y: 0 }, { x: -1, y: 0 }),
      slot(6, { x: 0, y: 40 }, { x: 0, y: -1 }),
    ];
    const pairs = solvePairing(slots, MIN_COS)
      .pairs.map(([i, j]) => [Math.min(i, j), Math.max(i, j)])
      .sort((a, b) => a[0]! - b[0]!);
    expect(pairs).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });

  test('a T passes straight through the bar and leaves the stem unpaired', () => {
    const slots = [
      slot(0, { x: -40, y: 0 }, { x: 1, y: 0 }),
      slot(2, { x: 40, y: 0 }, { x: -1, y: 0 }),
      slot(4, { x: 0, y: 40 }, { x: 0, y: -1 }),
    ];
    const { pairs } = solvePairing(slots, MIN_COS);
    expect(pairs.length).toBe(1);
    expect([...pairs[0]!].sort()).toEqual([0, 1]);
  });
});

describe('withFlicks', () => {
  const axis: AxisPoint[] = [0, 1, 2].map((x) => ({ x, y: 0, width: 1 }));
  const flick = [
    { x: 1, y: 1, width: 0.5 },
    { x: 1, y: 2, width: 0 },
  ];

  test('expands a hub flick out to its tip and back to the hub', () => {
    expect(withFlicks(axis, [{ index: 1, path: flick }], false).map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 1],
      [1, 0],
      [2, 0],
    ]);
  });

  test('reversal keeps the excursion attached to the same hub', () => {
    expect(withFlicks(axis, [{ index: 1, path: flick }], true).map((p) => p.x)).toEqual([2, 1, 1, 1, 1, 1, 0]);
  });
});

describe('extractInkRegion', () => {
  const covered = (r: ReturnType<typeof extract>) => 1 - r.uncoveredArea / r.totalArea;

  test('a bar is one stroke along its length, painting its ink', () => {
    const r = extract(rect(0, 0, 400, 60));
    expect(r.strokes.length).toBe(1);
    // Only the square corners escape the round pen (flicks reach into them).
    expect(covered(r)).toBeGreaterThan(0.98);
  });

  test('a plus is two straight strokes through the crossing', () => {
    const r = extract(plus(200, 30));
    expect(r.strokes.length).toBe(2);
    for (const s of r.strokes) {
      const a = s.points[0]!;
      const b = s.points[s.points.length - 1]!;
      // Opposite arms: the stroke spans the full reach along one axis.
      expect(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))).toBeGreaterThan(300);
    }
    expect(covered(r)).toBeGreaterThan(0.99);
  });

  test('a T is a bar plus a stem, the stem reaching into the bar', () => {
    const r = extract(tee());
    expect(r.strokes.length).toBe(2);
    expect(covered(r)).toBeGreaterThan(0.99);
  });

  test('a square ring is one closed loop', () => {
    const r = extract(rect(0, 0, 300, 300), [...rect(60, 60, 240, 240)].reverse());
    expect(r.strokes.length).toBe(1);
    expect(r.strokes[0]!.isLoop).toBe(true);
    // Square outer corners lie beyond a round pen's reach — a known limit.
    expect(covered(r)).toBeGreaterThan(0.97);
  });
});

describe('nibs', () => {
  test('inNib tests the rotated, offset ellipse', () => {
    const at = { x: 10, y: 10 };
    // 40 long along +y (angle 90°), 10 across, centered 5 below the point.
    const nib = { dx: 0, dy: 5, major: 40, minor: 10, angle: Math.PI / 2 };
    expect(inNib({ x: 10, y: 34 }, at, nib)).toBe(true);
    expect(inNib({ x: 10, y: 36 }, at, nib)).toBe(false);
    expect(inNib({ x: 14, y: 15 }, at, nib)).toBe(true);
    expect(inNib({ x: 16, y: 15 }, at, nib)).toBe(false);
  });

  test('a small ear on a stroke gets a nib pointing into it instead of a flick', () => {
    const r = extract(barWithEar(12));
    expect(r.strokes.length).toBe(1);
    const pts = r.strokes[0]!.points;
    const earNib = pts.find((p) => p.nib && Math.abs(p.x - 200) < 10);
    expect(earNib).toBeDefined();
    // Major axis points up into the ear (y-down frame: angle ≈ -90°).
    expect(Math.abs(Math.sin(earNib!.nib!.angle) + 1)).toBeLessThan(0.1);
    // No flick excursion (flick tips carry width 0) is left at the ear.
    expect(pts.some((p) => p.width < 1 && Math.abs(p.x - 200) < 20)).toBe(false);
  });

  test('nibs stay inside the ink', () => {
    const polygon = barWithEar(12);
    const contours = buildContours([polygon]);
    const outline = new SegmentIndex(
      polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]!] as [Point, Point]),
      STEP * 4,
    );
    const nibs = extract(polygon).strokes.flatMap((s) => s.points.filter((p) => p.nib));
    expect(nibs.length).toBeGreaterThan(0);
    for (const p of nibs) {
      const { dx, dy, major, minor, angle } = p.nib!;
      for (let k = 0; k < 32; k++) {
        const phi = (k / 32) * Math.PI * 2;
        const lx = (major / 2) * Math.cos(phi);
        const ly = (minor / 2) * Math.sin(phi);
        const q = { x: p.x + dx + lx * Math.cos(angle) - ly * Math.sin(angle), y: p.y + dy + lx * Math.sin(angle) + ly * Math.cos(angle) };
        // The fit allows its outline a quarter sample step past the ink's.
        expect(pointInRegion(q, contours) || outline.nearest(q) < STEP * 0.3).toBe(true);
      }
    }
  });

  test('carryNibs keeps each stamp at the same place when strokes are re-cut', () => {
    const nib = { dx: 3, dy: -4, major: 20, minor: 8, angle: 0.5 };
    const before: { points: AxisPoint[] }[] = [{ points: [0, 50, 100].map((x) => ({ x, y: 0, width: 10, ...(x === 50 ? { nib } : {}) })) }];
    // Re-grouped: split at x = 40, and the nib's point simplified away.
    const after: { points: AxisPoint[] }[] = [
      {
        points: [
          { x: 0, y: 0, width: 10 },
          { x: 40, y: 0, width: 10 },
        ],
      },
      {
        points: [
          { x: 40, y: 0, width: 10 },
          { x: 100, y: 0, width: 10 },
        ],
      },
    ];
    const carried = carryNibs(before, after);
    const stamped = carried.flatMap((s) => s.points.filter((p) => p.nib));
    expect(stamped.length).toBe(1);
    const p = stamped[0]!;
    expect(p.x + p.nib!.dx).toBeCloseTo(53);
    expect(p.y + p.nib!.dy).toBeCloseTo(-4);
    expect(after[1]!.points.length).toBe(2); // inputs are not mutated
  });
});
