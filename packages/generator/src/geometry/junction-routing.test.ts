import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { extendUnpairedEnds, routeJunctionPaths, routeThroughNode } from './junction-routing.ts';
import { signedArea } from './primitives.ts';
import { buildJunctions, type JunctionNode, matchContinuations } from './strokes.ts';
import { DEFAULT_GEOMETRY_OPTIONS, type Face, resolveGeometryOptions, type SegmentInfo } from './types.ts';

const OPTIONS = resolveGeometryOptions(DEFAULT_GEOMETRY_OPTIONS, 1000);

/**
 * An L-shaped (quarter-arc) junction face: horizontal arm y 100–300 (x
 * 100–500), vertical arm x 100–300 (y 100–500), with cut 0 at the right end
 * and cut 1 at the bottom end. Its centroid sits near the inner corner — and
 * the straight chord between the two cut midpoints passes OUTSIDE the face
 * (through the empty notch x>300, y>300), which is exactly the script-R bowl
 * failure this routing exists to fix.
 */
function elbowFace(): Face {
  const P = [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 300 }, // → right cut end
    { x: 300, y: 300 },
    { x: 300, y: 500 }, // → bottom cut end
    { x: 100, y: 500 },
  ];
  return {
    id: 7,
    polygon: P,
    // Edges: top wall, right cut (0), inner walls, bottom cut (1), left wall.
    edgeCutIds: [-1, 0, -1, -1, 1, -1],
    holes: [],
    cutIds: [0, 1],
    area: 120000,
    centroid: { x: 233, y: 233 },
    kind: 'junction',
  };
}

describe('routeThroughNode', () => {
  test('arc-shaped junction routes along the elbow, never across the empty notch', () => {
    const route = routeThroughNode([elbowFace()], 0, 1, OPTIONS);
    expect(route).not.toBeNull();
    // Starts at the entry cut midpoint, ends at the exit cut midpoint.
    expect(route![0]!.x).toBeCloseTo(500, 0);
    expect(route![0]!.y).toBeCloseTo(200, 0);
    expect(route![route!.length - 1]!.x).toBeCloseTo(200, 0);
    expect(route![route!.length - 1]!.y).toBeCloseTo(500, 0);
    // No point may leave the face through the notch (the centroid-bridge /
    // straight-chord failure passes through ~(350, 350)).
    for (const p of route!) {
      expect(p.x > 310 && p.y > 310).toBe(false);
    }
  });

  test('orientation follows the requested cut order', () => {
    const forward = routeThroughNode([elbowFace()], 0, 1, OPTIONS)!;
    const backward = routeThroughNode([elbowFace()], 1, 0, OPTIONS)!;
    expect(backward[0]!.y).toBeCloseTo(forward[forward.length - 1]!.y, 0);
    expect(backward[backward.length - 1]!.x).toBeCloseTo(forward[0]!.x, 0);
  });

  test('returns null when the cuts are not on any face', () => {
    expect(routeThroughNode([elbowFace()], 5, 1, OPTIONS)).toBeNull();
  });
});

// ── Unpaired-end extensions ─────────────────────────────────────────────────
//
// The regression at stake (Klee One 家): a junction NODE can absorb a long
// curved corridor face (misclassified as junction — its mouth was split
// across two cuts, so it carries 3 cut ids). When no pairing routes through
// that face, the only thing sweeping it is the unpaired end's extension —
// and a straight nib ray dies on the first wall of a bend. Uncovered faces
// must instead be crossed by a ROUTED extension along the faces' own axes.

/** Build a Face from a polygon + per-edge cut tags, normalizing to region-on-left. */
function makeFace(id: number, points: Point[], edgeCutIds: number[]): Face {
  const n = points.length;
  let polygon = points;
  let tags = edgeCutIds;
  if (signedArea(points) < 0) {
    polygon = [...points].reverse();
    tags = polygon.map((_, j) => edgeCutIds[(n - 2 - j + n) % n]!);
  }
  let cx = 0;
  let cy = 0;
  for (const p of polygon) {
    cx += p.x;
    cy += p.y;
  }
  return {
    id,
    polygon,
    edgeCutIds: tags,
    holes: [],
    cutIds: [...new Set(tags.filter((c) => c >= 0))],
    area: Math.abs(signedArea(points)),
    centroid: { x: cx / n, y: cy / n },
    kind: 'junction',
  };
}

/** A stub segment whose ends[1] terminates on a cut (ends[0] is free). */
function segmentInto(faceId: number, axis: Point[], cutId: number, direction: Point, width: number): SegmentInfo {
  const first = axis[0]!;
  const last = axis[axis.length - 1]!;
  return {
    faceId,
    axis: axis.map((p) => ({ ...p, width })),
    isLoop: false,
    ends: [
      { cutId: -1, point: { ...first }, direction: { x: -direction.x, y: -direction.y }, width },
      { cutId, point: { ...last }, direction, width },
    ],
  };
}

// Kernel face: 50×50 square with cuts on the left (c0), right (c1), and
// bottom (c2) edges; the top edge is wall. A crossbar passes left→right.
const kernel = makeFace(
  0,
  [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
    { x: 0, y: 50 },
  ],
  [2, 1, -1, 0],
);

// L-shaped corridor hanging off the kernel's bottom cut (c2): down 250, then
// 250 to the right, ending on cut c3. Ink entering at c3 heading left must
// climb around the elbow up to the c2 mouth.
const corridor = () =>
  makeFace(
    1,
    [
      { x: 0, y: 0 },
      { x: 0, y: -250 },
      { x: 300, y: -250 },
      { x: 300, y: -200 },
      { x: 50, y: -200 },
      { x: 50, y: 0 },
    ],
    [-1, -1, 3, -1, -1, 2],
  );

const crossbarSegments = (): SegmentInfo[] => [
  segmentInto(
    100,
    [
      { x: -100, y: 25 },
      { x: 0, y: 25 },
    ],
    0,
    { x: 1, y: 0 },
    50,
  ),
  segmentInto(
    101,
    [
      { x: 150, y: 25 },
      { x: 50, y: 25 },
    ],
    1,
    { x: -1, y: 0 },
    50,
  ),
];

function runNode(node: JunctionNode, segments: SegmentInfo[], faces: Face[], warnings?: string[]) {
  const faceById = new Map(faces.map((f) => [f.id, f]));
  const junctions = buildJunctions(segments, [node]);
  expect(junctions).toHaveLength(1);
  for (const j of junctions) matchContinuations(j, segments, OPTIONS);
  routeJunctionPaths(junctions, segments, faceById, OPTIONS);
  extendUnpairedEnds(junctions, segments, faceById, OPTIONS, warnings);
  return junctions[0]!;
}

describe('extendUnpairedEnds', () => {
  test('unpaired end routes through an uncovered curved corridor — a straight nib ray dies on the bend', () => {
    const segments = [
      ...crossbarSegments(),
      segmentInto(
        102,
        [
          { x: 400, y: -225 },
          { x: 300, y: -225 },
        ],
        3,
        { x: -1, y: 0 },
        50,
      ),
    ];
    const node: JunctionNode = { faceIds: [0, 1], cutIds: [0, 1, 2, 3], center: { x: 25, y: 25 } };

    const junction = runNode(node, segments, [kernel, corridor()]);

    // The crossbar pairs and routes through the kernel; the corridor end stays unpaired.
    expect(junction.pairings).toEqual([[0, 1]]);
    expect(junction.routes[0]!.length).toBeGreaterThanOrEqual(2);

    // A straight ray from (300,-225) heading left stays on y = -225 and stops
    // at the far wall — it can never turn the corner. The routed extension
    // must climb the vertical arm (points near x=25 midway up) and reach the
    // c2 mouth at (25, 0).
    const ext = junction.extensions[2];
    expect(ext).not.toBeNull();
    expect(ext!.length).toBeGreaterThan(4);
    const last = ext![ext!.length - 1]!;
    expect(Math.hypot(last.x - 25, last.y - 0)).toBeLessThan(20);
    expect(ext!.some((p) => p.y > -150 && p.y < -50 && Math.abs(p.x - 25) < 15)).toBe(true);
  });

  test('unpaired end into a route-covered kernel keeps the straight nib ray (T-stem into the bar)', () => {
    const segments = [
      ...crossbarSegments(),
      segmentInto(
        102,
        [
          { x: 25, y: -100 },
          { x: 25, y: 0 },
        ],
        2,
        { x: 0, y: 1 },
        50,
      ),
    ];
    const node: JunctionNode = { faceIds: [0], cutIds: [0, 1, 2], center: { x: 25, y: 25 } };

    const junction = runNode(node, segments, [kernel]);

    expect(junction.pairings).toEqual([[0, 1]]);
    // Straight ray: hit the top wall at 50, pull back half the width → the
    // stem's ink stops exactly on the crossbar centerline.
    const ext = junction.extensions[2];
    expect(ext).not.toBeNull();
    expect(ext!).toHaveLength(2);
    expect(ext![1]!.x).toBeCloseTo(25, 5);
    expect(ext![1]!.y).toBeCloseTo(25, 5);
  });

  test('a node face swept by no route and no extension raises a warning', () => {
    // Same corridor, but nothing enters it: only the crossbar's two ends
    // exist, they pair through the kernel, and the corridor dangles.
    const node: JunctionNode = { faceIds: [0, 1], cutIds: [0, 1, 2, 3], center: { x: 25, y: 25 } };

    const warnings: string[] = [];
    runNode(node, crossbarSegments(), [kernel, corridor()], warnings);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('junction face 1');
  });
});
