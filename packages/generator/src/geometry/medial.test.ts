import { describe, expect, test } from 'bun:test';
import { computeSegmentAxis } from './medial.ts';
import { DEFAULT_GEOMETRY_OPTIONS, type Face, resolveGeometryOptions } from './types.ts';

const OPTIONS = resolveGeometryOptions(DEFAULT_GEOMETRY_OPTIONS, 1000);

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
