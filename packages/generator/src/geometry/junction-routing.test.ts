import { describe, expect, test } from 'bun:test';
import { routeThroughNode } from './junction-routing.ts';
import { DEFAULT_GEOMETRY_OPTIONS, type Face, resolveGeometryOptions } from './types.ts';

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
