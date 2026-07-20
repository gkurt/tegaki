import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { matchContinuations, simplifyStroke, type TrialJoinScorer } from './strokes.ts';
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
  // (0,1); a trial that measures the MERGED shape as flowing through (0,2)
  // must override that.
  const threeEnds = (): SegmentInfo[] => [
    segToward({ x: -10, y: 0 }, { x: 1, y: 0 }),
    segToward({ x: 10, y: 0 }, { x: -1, y: 0 }),
    segToward({ x: 10, y: 5 }, { x: -Math.cos(Math.PI / 9), y: Math.sin(Math.PI / 9) }),
  ];

  test('conflicting candidates re-rank on the trial alignment (merged shape overrides end tangents)', () => {
    const segments = threeEnds();
    const junction = junctionOf(3);
    const trial: TrialJoinScorer = (a, b) => (a.segmentIndex === 0 && b.segmentIndex === 2 ? 1.0 : 0.1);
    matchContinuations(junction, segments, OPTIONS, trial);
    expect(junction.pairings).toEqual([[0, 2]]);
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
