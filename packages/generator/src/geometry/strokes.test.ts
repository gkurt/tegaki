import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { matchContinuations, rdpSimplify, simplifyStroke, type TrialJoinScorer } from './strokes.ts';
import { type AxisPoint, DEFAULT_GEOMETRY_OPTIONS, type JunctionInfo, resolveGeometryOptions, type SegmentInfo } from './types.ts';

const pt = (x: number, y: number): AxisPoint => ({ x, y, width: 10 });

describe('simplifyStroke', () => {
  test('keeps deviating points, drops collinear ones', () => {
    const out = simplifyStroke([pt(0, 0), pt(50, 1), pt(100, 0), pt(100, 100)], 5);
    expect(out.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
  });

  test('closed chain (start == end) survives — degenerate chord must not collapse the loop', () => {
    // A stroke chain that cycles back to its exact start (a B's stem+bowl
    // cycle). RDP with the zero-length start→end chord used to measure every
    // deviation as 0 and reduce the whole loop to its two coincident ends.
    const square = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(0, 0)];
    const out = simplifyStroke(square, 2);
    expect(out.length).toBe(5);
  });

  test('exact retrace (hairpin whose halves coincide) keeps its tip', () => {
    const hairpin = [pt(0, 0), pt(0, 50), pt(0, 100), pt(0, 50), pt(0, 0)];
    const out = simplifyStroke(hairpin, 2);
    expect(out.some((p) => p.y === 100)).toBe(true);
  });

  const wpt = (x: number, y: number, width: number): AxisPoint => ({ x, y, width });

  test('a straight run keeps its FAT interior point — the renderer interpolates widths (Caveat @ closure)', () => {
    // Positionally collinear, but the middle rides a fused two-stroke
    // corridor at twice the width. Position-only RDP collapsed it and the
    // loop-closure ink vanished.
    const out = simplifyStroke([wpt(0, 0, 40), wpt(100, 0, 100), wpt(200, 0, 40)], 4);
    expect(out.some((p) => p.width === 100)).toBe(true);
  });

  test('a sliver-width excursion is pruned — skeleton waist nodes read as zig-zags (Caveat &)', () => {
    // The merged skeleton threads a hairline pinch channel: a w2 node ~25
    // units off the flow line. Its ink is sub-visible; the pen crosses the
    // pinch at full width.
    const out = simplifyStroke([wpt(0, 0, 50), wpt(25, 20, 2), wpt(10, 0, 48), wpt(120, 0, 50)], 4);
    expect(out.some((p) => p.width === 2)).toBe(false);
  });

  test('a half-width jog whose pen disk the chord sweep covers is pruned (Caveat & crossings)', () => {
    // dist-to-chord 10 + radius 12.5 ≤ chord radius 30 — dropping it changes
    // no ink and straightens the crossing.
    const out = simplifyStroke([wpt(0, 0, 60), wpt(30, 10, 25), wpt(60, 0, 60)], 4);
    expect(out.length).toBe(2);
  });

  test('genuine curvature survives the jog prune — a full-width point always pokes past the chord sweep', () => {
    const out = simplifyStroke([wpt(0, 0, 40), wpt(30, 15, 40), wpt(60, 0, 40)], 4);
    expect(out.length).toBe(3);
  });

  test('hairline strokes are untouched — thin neighbours never trip the sliver ratio', () => {
    const out = simplifyStroke([wpt(0, 0, 4), wpt(50, 8, 4), wpt(100, 0, 4)], 2);
    expect(out.length).toBe(3);
  });
});

describe('matchContinuations — trial-join re-ranking', () => {
  const OPTIONS = resolveGeometryOptions(DEFAULT_GEOMETRY_OPTIONS, 1000);

  /** Segment whose end 1 sits at the junction: `point` on the cut, `direction` into it. */
  const segToward = (point: Point, direction: Point, width = 60): SegmentInfo => {
    const start = { x: point.x - direction.x * 200, y: point.y - direction.y * 200, width };
    return {
      faceId: 0,
      axis: [start, { ...point, width }],
      isLoop: false,
      ends: [
        { cutId: -1, point: { x: start.x, y: start.y }, direction: { x: -direction.x, y: -direction.y }, width },
        { cutId: 0, point, direction, width },
      ],
    };
  };

  const junctionOf = (count: number): JunctionInfo => ({
    faceIds: [],
    centroid: { x: 0, y: 0 },
    incident: Array.from({ length: count }, (_, i) => ({ segmentIndex: i, endIndex: 1 })),
    pairings: [],
    routes: [],
    extensions: Array.from({ length: count }, () => null),
  });

  // Three ends: 0 arrives from the left; 1 and 2 both arrive from the right,
  // 1 dead-straight to 0, 2 rotated 20°. The tangent heuristic must prefer
  // (0,1); a trial that sees (0,1)'s MERGED shape turn back on itself must
  // veto it below (0,2) — the Caveat k stem×arm case (its trial scored −0.83).
  const threeEnds = (): SegmentInfo[] => [
    segToward({ x: -10, y: 0 }, { x: 1, y: 0 }),
    segToward({ x: 10, y: 0 }, { x: -1, y: 0 }),
    segToward({ x: 10, y: 5 }, { x: -Math.cos(Math.PI / 9), y: Math.sin(Math.PI / 9) }),
  ];

  test('the trial vetoes a tangent-favored join whose merged spine reverses', () => {
    const segments = threeEnds();
    const junction = junctionOf(3);
    const trial: TrialJoinScorer = (a, b) => (a.segmentIndex === 0 && b.segmentIndex === 2 ? 1.0 : -0.8);
    matchContinuations(junction, segments, OPTIONS, trial);
    expect(junction.pairings).toEqual([[0, 2]]);
  });

  test('a mildly-low trial is measurement noise, not a veto (Klee One む: 0.39 must not split the knot exit)', () => {
    // On む's knot the true vertical→bottom-sweep join trial-scored 0.39
    // against a 0.71 tangent — min()-style demotion handed the win to a rival
    // pair and split the canonical first stroke in two. Only a REVERSAL
    // (negative trial) may override the tangent ranking.
    const segments = threeEnds();
    const junction = junctionOf(3);
    const trial: TrialJoinScorer = (a, b) => (a.segmentIndex === 0 && b.segmentIndex === 1 ? 0.39 : 1.0);
    matchContinuations(junction, segments, OPTIONS, trial);
    expect(junction.pairings).toEqual([[0, 1]]);
  });

  test('a laundered trial cannot promote a barely-gated pair and strand the others (Klee One ぁ)', () => {
    // A stroke crossing ITSELF: at the ring closure of ぁ, four ends meet —
    // stub (down), tail (out east), circle-top (in from west), circle-right
    // (out southwest). True pen path: stub→circle-right and circle-top→tail.
    // The merged-spine trial launders the stub→tail pen turn into a smooth
    // curve (0.91 on the real glyph, tangent 0.26) — if that REPLACED the
    // tangent term it would outrank both true pairs, strand the circle's
    // ends, and split the ring into a floating stroke. A positive trial must
    // never move a candidate; the barely-gated pair stays last.
    const cos20 = Math.cos(Math.PI / 9);
    const sin20 = Math.sin(Math.PI / 9);
    const segments = [
      segToward({ x: 0, y: -10 }, { x: 0, y: 1 }), // stub
      segToward({ x: 10, y: 0 }, { x: -cos20, y: -sin20 }), // tail
      segToward({ x: -10, y: 0 }, { x: 1, y: 0 }), // circle-top
      segToward({ x: 7, y: -7 }, { x: sin20, y: -cos20 }), // circle-right
    ];
    const junction = junctionOf(4);
    const trial: TrialJoinScorer = (a, b) => (a.segmentIndex === 0 && b.segmentIndex === 1 ? 0.95 : 0.9);
    matchContinuations(junction, segments, OPTIONS, trial);
    const sorted = junction.pairings.map((p) => [...p].sort((x, y) => x - y)).sort((x, y) => x[0]! - y[0]!);
    expect(sorted).toEqual([
      [0, 3],
      [1, 2],
    ]);
  });

  test('trial returning null keeps the tangent-based ranking', () => {
    const segments = threeEnds();
    const junction = junctionOf(3);
    matchContinuations(junction, segments, OPTIONS, () => null);
    expect(junction.pairings).toEqual([[0, 1]]);
  });

  test('the trial is a re-ranker, not a gate: pairs the bend threshold rejects stay rejected', () => {
    // Ends 0 (from left) and 2 (from below) meet at ~90° — the gate rejects
    // the pair before any trial. A trial claiming the join is straight must
    // not resurrect it. End 3 gives the junction degree 3 (degree-2 junctions
    // merge unconditionally and would mask the gate).
    const segments = [
      segToward({ x: -10, y: 0 }, { x: 1, y: 0 }),
      segToward({ x: 10, y: 0 }, { x: -1, y: 0 }),
      segToward({ x: 0, y: 10 }, { x: 0, y: -1 }),
    ];
    const junction = junctionOf(3);
    matchContinuations(junction, segments, OPTIONS, () => 1.0);
    expect(junction.pairings).toEqual([[0, 1]]);
  });

  test('non-conflicting candidates never pay for a trial (skeleton builds cost real time)', () => {
    // Two disjoint straight-through pairs: (0,1) horizontal, (2,3) vertical.
    // Cross pairs meet at 90° and fail the gate, so no end is contested.
    const segments = [
      segToward({ x: -10, y: 0 }, { x: 1, y: 0 }),
      segToward({ x: 10, y: 0 }, { x: -1, y: 0 }),
      segToward({ x: 0, y: -10 }, { x: 0, y: 1 }),
      segToward({ x: 0, y: 10 }, { x: 0, y: -1 }),
    ];
    const junction = junctionOf(4);
    let calls = 0;
    matchContinuations(junction, segments, OPTIONS, () => {
      calls++;
      return 1.0;
    });
    expect(calls).toBe(0);
    expect(junction.pairings.map((p) => [...p].sort())).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});

describe('rdpSimplify coverage', () => {
  // A blob bulging 3 off the chord and 10 wider than it: neither error alone
  // passes epsilon 6, but together the far side of the blob loses 8.
  const blob: AxisPoint[] = [
    { x: 0, y: 0, width: 20 },
    { x: 50, y: 3, width: 30 },
    { x: 100, y: 0, width: 20 },
  ];
  test('plain RDP drops the bulge', () => {
    expect(rdpSimplify(blob, 6).length).toBe(2);
  });
  test('coverage keeps it: offset and radius shortfall add up', () => {
    expect(rdpSimplify(blob, 6, { coverage: true }).length).toBe(3);
  });

  // A 40-unit bar between its two 36-wide cap nodes (Playfair Display |):
  // a 2-unit radius shortfall is under epsilon 4 but 10% of the bar's ink.
  const bar = (width: number): AxisPoint[] => [
    { x: 0, y: 0, width: 0.9 * width },
    { x: 0, y: 500, width },
    { x: 0, y: 1000, width: 0.9 * width },
  ];
  test('a thin pen may fall short by only a share of its own radius', () => {
    expect(rdpSimplify(bar(40), 4, { coverage: true }).length).toBe(3);
  });
  test('a thick pen may fall short by up to epsilon', () => {
    expect(
      rdpSimplify(
        [
          { x: 0, y: 0, width: 197 },
          { x: 0, y: 500, width: 200 },
          { x: 0, y: 1000, width: 197 },
        ],
        4,
        { coverage: true },
      ).length,
    ).toBe(2);
  });
});
