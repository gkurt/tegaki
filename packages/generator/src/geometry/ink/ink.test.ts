import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { buildContours } from '../contours.ts';
import { pointInRegion } from '../primitives.ts';
import type { AxisPoint } from '../types.ts';
import { appendAxisPoints, type ClusterSlot, findSerifArms, type SerifSlotShape, solvePairing } from './cover.ts';
import { extractInkRegion, type InkExtractionOptions, regionScale } from './extract.ts';
import { buildInkGraph, pruneSpurs, withFlicks } from './graph.ts';
import { buildInkMesh, trianglePoints } from './mesh.ts';
import { carryNibs, inNib, paintedBy, stampHoles, triangleSample, unpaintedSamples } from './nib.ts';
import { RegionIndex, SegmentIndex } from './spatial.ts';

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

function extractWith(overrides: Partial<InkExtractionOptions>, ...polygons: Point[][]) {
  return extractInkRegion(
    buildContours(polygons),
    {
      sampleSpacing: STEP,
      spurTolerance: 0.5,
      junctionReach: 0.6,
      continuationMinCos: MIN_COS,
      simplifyEpsilon: 4,
      absorbSerifs: true,
      ...overrides,
    },
    0,
  );
}

const extract = (...polygons: Point[][]) => extractWith({}, ...polygons);

/** A serifed I: a 100-wide stem capped top and bottom by 360×45 slabs. */
function serifedI(): Point[] {
  return [
    { x: -30, y: 0 },
    { x: 330, y: 0 },
    { x: 330, y: 45 },
    { x: 200, y: 45 },
    { x: 200, y: 555 },
    { x: 330, y: 555 },
    { x: 330, y: 600 },
    { x: -30, y: 600 },
    { x: -30, y: 555 },
    { x: 100, y: 555 },
    { x: 100, y: 45 },
    { x: -30, y: 45 },
  ];
}

function slot(key: number, point: Point, direction: Point, deadEnd: number | null = null): ClusterSlot {
  return { key, point: { ...point, width: 60 }, direction, deadEnd };
}

describe('RegionIndex', () => {
  test('agrees with pointInRegion everywhere, holes included', () => {
    const contours = buildContours([plus(200, 40), rect(-20, -20, 20, 20).reverse(), serifedI()]);
    const index = new RegionIndex(contours, STEP);
    for (let i = 0; i < 4000; i++) {
      // Deterministic scatter over (and just past) the shapes, including exact vertex rows.
      const p = { x: ((i * 7919) % 700) - 250, y: ((i * 104729) % 820) - 230 + (i % 5 === 0 ? 0 : 0.37) };
      expect(index.contains(p)).toBe(pointInRegion(p, contours));
    }
  });
});

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

describe('findSerifArms', () => {
  // A foot at (0,0) in y-down units: the stem rises from it (out = up).
  const stem: SerifSlotShape = { dead: false, width: 100, medianWidth: 100, tip: { x: 0, y: -500 }, out: { x: 0, y: -1 } };
  const arm = (side: -1 | 1, overrides: Partial<SerifSlotShape> = {}): SerifSlotShape => ({
    dead: true,
    width: 45,
    medianWidth: 45,
    tip: { x: side * 160, y: 10 },
    out: { x: side, y: 0 },
    ...overrides,
  });
  const center = { x: 0, y: 0 };

  test('a foot serif: short, thin dead ends across a lone stem are its arms', () => {
    expect(findSerifArms([stem, arm(-1), arm(1)], center, 100)).toEqual([1, 2]);
  });

  test('a crossbar is not a serif: the stem runs on past it (t, f)', () => {
    const above: SerifSlotShape = { dead: true, width: 60, medianWidth: 57, tip: { x: 0, y: 140 }, out: { x: 0, y: 1 } };
    expect(findSerifArms([stem, above, arm(-1), arm(1)], center, 100)).toEqual([]);
  });

  test("arms as heavy as the stroke weight are a bar, not a serif (a sans T's top)", () => {
    expect(findSerifArms([stem, arm(-1, { medianWidth: 90 }), arm(1, { medianWidth: 90 })], center, 100)).toEqual([]);
  });

  test('arms reaching past 2.4 stem widths are a bar, not a serif', () => {
    expect(findSerifArms([stem, arm(-1, { tip: { x: -300, y: 10 } }), arm(1, { tip: { x: 300, y: 10 } })], center, 100)).toEqual([]);
  });

  test('a one-sided serif on a lone stem is absorbed', () => {
    expect(findSerifArms([stem, arm(-1)], center, 100)).toEqual([1]);
  });

  test('a slanted stem meeting its slab at an angle still carries a serif (V, X, K)', () => {
    const slanted: SerifSlotShape = { ...stem, tip: { x: 250, y: -433 }, out: { x: 0.5, y: -Math.sqrt(3) / 2 } };
    expect(findSerifArms([slanted, arm(-1), arm(1)], center, 100)).toEqual([1, 2]);
  });

  test("a splayed slab (arms 140° apart, a lowercase x's foot) is still a slab", () => {
    const a = (Math.PI * 20) / 180;
    const splayed = [arm(-1, { out: { x: -Math.cos(a), y: Math.sin(a) } }), arm(1, { out: { x: Math.cos(a), y: Math.sin(a) } })];
    expect(findSerifArms([stem, ...splayed], center, 100)).toEqual([1, 2]);
  });

  test("a hairline stem's serif is measured against the stroke weight, not the hairline", () => {
    const hairline: SerifSlotShape = { ...stem, width: 40, medianWidth: 40 };
    const long = (side: -1 | 1) => arm(side, { width: 35, medianWidth: 35, tip: { x: side * 200, y: 10 } });
    expect(findSerifArms([hairline, long(-1), long(1)], center, 100)).toEqual([1, 2]);
  });

  test('an arm running straight on from a bar is left to the pairing (the foot of an E)', () => {
    const bar: SerifSlotShape = { dead: false, width: 60, medianWidth: 60, tip: { x: 400, y: 0 }, out: { x: 1, y: 0 } };
    expect(findSerifArms([stem, bar, arm(-1)], center, 100)).toEqual([]);
  });

  test("an arm at an acute apex is that V's point, not a serif (the top of an M)", () => {
    const a = (28 * Math.PI) / 180;
    const diagonal: SerifSlotShape = { ...stem, tip: { x: 230, y: -440 }, out: { x: Math.sin(a), y: -Math.cos(a) } };
    expect(findSerifArms([stem, diagonal, arm(-1)], center, 100)).toEqual([]);
  });
});

describe('serif absorption', () => {
  test('a serifed I is one stroke, its slabs swept by the stem ends', () => {
    const r = extract(serifedI());
    expect(r.strokes.length).toBe(1);
    const xs = r.strokes[0]!.points.map((p) => p.x);
    // The sweep reaches both slab ends.
    expect(Math.min(...xs)).toBeLessThan(20);
    expect(Math.max(...xs)).toBeGreaterThan(280);
    expect(1 - r.uncoveredArea / r.totalArea).toBeGreaterThan(0.97);
  });

  test('a slanted serifed stroke (a V or X leg) is one stroke too', () => {
    const r = extract([
      { x: 130, y: 0 },
      { x: 430, y: 0 },
      { x: 430, y: 45 },
      { x: 300, y: 45 },
      { x: 100, y: 555 },
      { x: 230, y: 555 },
      { x: 230, y: 600 },
      { x: -130, y: 600 },
      { x: -130, y: 555 },
      { x: 0, y: 555 },
      { x: 200, y: 45 },
      { x: 130, y: 45 },
    ]);
    expect(r.strokes.length).toBe(1);
    expect(1 - r.uncoveredArea / r.totalArea).toBeGreaterThan(0.97);
  });

  test('without absorption the slabs are strokes of their own', () => {
    expect(extractWith({ absorbSerifs: false }, serifedI()).strokes.length).toBeGreaterThan(1);
  });
});

/** A 400×60 bar whose right end flares into two horns around a notch (the tip of a heavy slab serif). */
function fishtailBar(): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 340, y: 0 },
    { x: 392, y: -12 },
    { x: 376, y: 30 },
    { x: 392, y: 72 },
    { x: 340, y: 60 },
    { x: 0, y: 60 },
  ];
}

describe('forked ends', () => {
  test("a stroke end forking into its corners is the stroke's end: one stroke painting both horns", () => {
    const r = extract(fishtailBar());
    expect(r.strokes.length).toBe(1);
    const pts = r.strokes.map((s) => s.points);
    expect(paintedBy({ x: 380, y: -2 }, pts, 0)).toBe(true);
    expect(paintedBy({ x: 380, y: 62 }, pts, 0)).toBe(true);
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

  test('stampHoles stamps the ink a stroke leaves, without moving the pen', () => {
    const polygon = rect(0, 0, 200, 200);
    const contours = buildContours([polygon]);
    const boundary = new SegmentIndex(
      polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]!] as [Point, Point]),
      STEP * 4,
    );
    const g = buildInkGraph(buildInkMesh(contours, STEP), boundary);
    const inkAt = (p: Point) => pointInRegion(p, contours) || boundary.nearest(p) < STEP * 0.25;
    // A 100-wide pen across the middle of a 200-square leaves a band above and below.
    const strokes = [
      {
        points: [
          { x: 50, y: 100, width: 100 },
          { x: 150, y: 100, width: 100 },
        ],
      },
    ];
    const unpainted = () => {
      let area = 0;
      for (let t = 0; t < g.mesh.triCount; t++) {
        const q = triangleSample(g, t);
        if (
          !paintedBy(
            q.p,
            strokes.map((s) => s.points),
            0,
          )
        )
          area += q.area;
      }
      return area;
    };
    const before = unpainted();
    expect(stampHoles(strokes, g, inkAt, STEP)).toBeGreaterThan(0);
    expect(unpainted()).toBeLessThan(0.5 * before);
    for (const p of strokes[0]!.points) expect(p.y).toBeCloseTo(100);
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

describe('appendAxisPoints', () => {
  const nib = { dx: 4, dy: 0, major: 20, minor: 10, angle: 0 };
  test('a repeat point is dropped, but its nib moves onto the stamp-free twin', () => {
    const dst: AxisPoint[] = [{ x: 0, y: 0, width: 10 }];
    appendAxisPoints(dst, [
      { x: 0, y: 0, width: 10, nib },
      { x: 20, y: 0, width: 10 },
    ]);
    expect(dst.map((p) => [p.x, p.nib?.major])).toEqual([
      [0, 20],
      [20, undefined],
    ]);
  });

  test('two stamps at one point stay two points', () => {
    const dst: AxisPoint[] = [{ x: 0, y: 0, width: 10, nib }];
    appendAxisPoints(dst, [{ x: 0, y: 0, width: 10, nib: { ...nib, angle: 1 } }]);
    expect(dst.map((p) => p.nib?.angle)).toEqual([0, 1]);
  });
});

describe('paintedBy', () => {
  test('a negative tolerance past the pen radius paints nothing', () => {
    const pen = [
      [
        { x: 0, y: 0, width: 10 },
        { x: 100, y: 0, width: 10 },
      ],
    ];
    expect(paintedBy({ x: 50, y: 0 }, pen, -4)).toBe(true);
    expect(paintedBy({ x: 50, y: 0 }, pen, -6)).toBe(false);
  });
});

describe('unpaintedSamples', () => {
  const mesh = buildInkMesh(buildContours([rect(0, 0, 60, 60)]), 1000);
  const g = buildInkGraph(mesh, new SegmentIndex([], 1000));
  const areaOf = (t: number) => {
    const [a, b, c] = trianglePoints(mesh, t);
    return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  };

  test('bare ink is sampled about `spacing` apart, area preserved', () => {
    for (let t = 0; t < mesh.triCount; t++) {
      const [a] = trianglePoints(mesh, t);
      const qs = unpaintedSamples(g, t, 6, [], 0);
      expect(qs.length).toBeGreaterThan(100);
      expect(qs.reduce((acc, q) => acc + q.area, 0)).toBeCloseTo(areaOf(t), 6);
      expect(Math.min(...qs.map((q) => Math.hypot(q.p.x - a.x, q.p.y - a.y)))).toBeLessThan(6);
    }
  });

  test('a sliver along the rim of a broad triangle is measured, not hidden by its painted centroid', () => {
    // A pen along y = 28 painting 0 ≤ y ≤ 56 of the square: a 4-high band is left.
    const pen = [
      [
        { x: 0, y: 28, width: 56 },
        { x: 60, y: 28, width: 56 },
      ],
    ];
    let left = 0;
    for (let t = 0; t < mesh.triCount; t++) for (const q of unpaintedSamples(g, t, 3, pen, 0)) left += q.area;
    expect(left / 3600).toBeGreaterThan(0.04);
    expect(left / 3600).toBeLessThan(0.1);
  });
});

describe('regionScale', () => {
  test('letter-sized ink keeps the default step', () => {
    expect(regionScale(buildContours([rect(0, 0, 40, 500)]), STEP)).toBe(1);
  });

  test('a dot is refined to 50 steps across its diagonal', () => {
    // 60 × 80: a 100-unit diagonal, 50 steps of 2 instead of ~17 of 6.
    expect(regionScale(buildContours([rect(0, 0, 60, 80)]), STEP) * STEP).toBeCloseTo(2, 6);
  });
});

describe('round dots', () => {
  // A round blob many sample steps across: its chordal axis is a tree of rim
  // fans, all inside the center disk. Pruning used to stop the center at one
  // neighbour, leaving that last branch's fans to split into stray strokes.
  const disk = (r: number, n = 32): Point[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });

  test('a dot twenty steps across is one stroke: its disk', () => {
    const r = extractWith({ sampleSpacing: 2 }, disk(40));
    expect(r.strokes.length).toBe(1);
    expect(r.strokes[0]!.points.length).toBe(1);
    expect(r.uncoveredArea / r.totalArea).toBeLessThan(0.01);
  });
});
