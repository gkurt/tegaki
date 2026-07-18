import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { clampWidthsToBoundary, computeSegmentAxis } from './medial.ts';
import { dist, signedArea } from './primitives.ts';
import { type AxisPoint, DEFAULT_GEOMETRY_OPTIONS, type Face, resolveGeometryOptions } from './types.ts';

const OPTIONS = resolveGeometryOptions(DEFAULT_GEOMETRY_OPTIONS, 1000);

/** Build a cut-free Face from a polygon, oriented region-on-left. */
function blobFace(points: Point[]): Face {
  const polygon = signedArea(points) >= 0 ? points : [...points].reverse();
  return {
    id: 0,
    polygon,
    edgeCutIds: polygon.map(() => -1),
    holes: [],
    cutIds: [],
    area: Math.abs(signedArea(points)),
    centroid: { x: 0, y: 0 },
    kind: 'segment',
  };
}

/**
 * A tall LOBE face: a stalk rising from y=800 up to y=200, whose two cuts both
 * sit at its base, converging at a shared concave corner C poking into it —
 * the shape of a cursive w's fused middle peak. Polygon is oriented for
 * positive signed area (region on the algebraic left, y-down screen coords).
 */
function lobeFace(): Face {
  const A = { x: 450, y: 800 };
  const T1 = { x: 450, y: 200 };
  const T2 = { x: 550, y: 200 };
  const B = { x: 550, y: 800 };
  const C = { x: 500, y: 780 };
  return {
    id: 0,
    polygon: [A, T1, T2, B, C],
    // Edges: A→T1, T1→T2, T2→B are walls; B→C is cut 1; C→A is cut 0.
    edgeCutIds: [-1, -1, -1, 1, 0],
    holes: [],
    cutIds: [0, 1],
    area: 59000,
    centroid: { x: 500, y: 500 },
    kind: 'segment',
  };
}

describe('computeSegmentAxis — 2-cut fold shapes', () => {
  test('lobe: retraced hairpin axis climbs the lobe and returns, one end per cut', () => {
    const info = computeSegmentAxis(lobeFace(), OPTIONS);
    expect(info).not.toBeNull();
    expect(info!.isLoop).toBe(false);

    // Ends terminate on the two distinct cuts (so junction chaining can route
    // a stroke in one side and out the other).
    const endCuts = info!.ends.map((e) => e.cutId).sort();
    expect(endCuts).toEqual([0, 1]);

    // The axis must climb into the lobe (near y=200), not shortcut across the
    // base — and come back down: both endpoints stay at the base.
    const ys = info!.axis.map((p) => p.y);
    expect(Math.min(...ys)).toBeLessThan(260);
    expect(info!.axis[0]!.y).toBeGreaterThan(700);
    expect(info!.axis[info!.axis.length - 1]!.y).toBeGreaterThan(700);
  });

  test('stubby fold face stays a turn (no retrace past the corner region)', () => {
    // Same construction but the stalk barely rises: extent stays within the
    // lobe threshold, so the axis is a rounded turn between the two cuts.
    const face = lobeFace();
    face.polygon[1] = { x: 450, y: 745 }; // T1
    face.polygon[2] = { x: 550, y: 745 }; // T2
    face.area = 4000;
    const info = computeSegmentAxis(face, OPTIONS);
    expect(info).not.toBeNull();
    const endCuts = info!.ends.map((e) => e.cutId).sort();
    expect(endCuts).toEqual([0, 1]);
    // A turn axis stays between the wall and the corner — strictly inside the
    // face, above the wall's top edge midpoint-to-corner band.
    const ys = info!.axis.map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThan(745);
  });
});

describe('computeSegmentAxis — cut-free ribbon (no concave corners: L, U, C, S)', () => {
  /**
   * Quarter-arc ribbon: centerline radius 270 around (400,400) from the top
   * (400,130) to the left (130,400), half-width 30, flat end caps. A smooth
   * bent stroke whose whole outline is one cut-free face — the shape class
   * the farthest-pair fold used to bloat (arc-fraction pairing skews on the
   * inner/outer wall length mismatch of a bend).
   */
  function arcRibbonFace(): Face {
    const C = { x: 400, y: 400 };
    const K = 24;
    const arc = (radius: number, from: number, to: number): Point[] =>
      Array.from({ length: K + 1 }, (_, i) => {
        const a = from + ((to - from) * i) / K;
        return { x: C.x + radius * Math.cos(a), y: C.y + radius * Math.sin(a) };
      });
    const outer = arc(300, -Math.PI / 2, -Math.PI); // (400,100) → (100,400)
    const inner = arc(240, -Math.PI, -Math.PI / 2); // (160,400) → (400,160)
    return blobFace([...outer, ...inner]);
  }

  test('caps become the axis tips and the axis follows the bend', () => {
    const info = computeSegmentAxis(arcRibbonFace(), OPTIONS);
    expect(info).not.toBeNull();
    expect(info!.ends).toHaveLength(2);
    // Axis endpoints sit at the cap centers (either orientation).
    const tips = [info!.axis[0]!, info!.axis[info!.axis.length - 1]!];
    const capCenters = [
      { x: 400, y: 130 },
      { x: 130, y: 400 },
    ];
    for (const cap of capCenters) {
      expect(Math.min(...tips.map((t) => dist(t, cap)))).toBeLessThan(30);
    }
    // The axis passes through the middle of the bend, not across the chord.
    const bendMid = { x: 400 - 270 * Math.SQRT1_2, y: 400 - 270 * Math.SQRT1_2 };
    expect(Math.min(...info!.axis.map((p) => dist(p, bendMid)))).toBeLessThan(30);
    // Widths stay near the true ribbon width (60) — no arc-fraction bloat.
    expect(Math.max(...info!.axis.map((p) => p.width))).toBeLessThanOrEqual(75);
  });

  test('a dot (no cap concentration) still folds at the farthest pair', () => {
    const dot = blobFace(
      Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return { x: 500 + 50 * Math.cos(a), y: 500 + 50 * Math.sin(a) };
      }),
    );
    const info = computeSegmentAxis(dot, OPTIONS);
    expect(info).not.toBeNull();
    expect(info!.axis.length).toBeGreaterThanOrEqual(2);
    for (const p of info!.axis) expect(dist(p, { x: 500, y: 500 })).toBeLessThan(55);
  });
});

describe('clampWidthsToBoundary', () => {
  test('caps over-measured widths at twice the wall distance, excluding cut edges', () => {
    // Vertical bar x 100–200, y 100–700, bottom edge tagged as a cut.
    const polygon: Point[] = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 700 },
      { x: 100, y: 700 },
    ];
    const oriented = signedArea(polygon) >= 0 ? polygon : [...polygon].reverse();
    const cutEdge = oriented.findIndex((p, i) => p.y === 700 && oriented[(i + 1) % 4]!.y === 700);
    const face: Face = {
      id: 0,
      polygon: oriented,
      edgeCutIds: oriented.map((_, i) => (i === cutEdge ? 0 : -1)),
      holes: [],
      cutIds: [0],
      area: 60000,
      centroid: { x: 150, y: 400 },
      kind: 'segment',
    };
    const axis: AxisPoint[] = [
      { x: 150, y: 400, width: 500 }, // grossly over-measured mid-bar
      { x: 150, y: 690, width: 100 }, // on the cut: must NOT clamp to ~0
    ];
    clampWidthsToBoundary(axis, face);
    expect(axis[0]!.width).toBeCloseTo(100, 5);
    expect(axis[1]!.width).toBeCloseTo(100, 5);
  });
});
