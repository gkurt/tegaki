import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { dissolvePartitionDebris } from './partition.ts';
import { polygonCentroid, signedArea } from './primitives.ts';
import type { Face } from './types.ts';

/** Build a Face from a region-on-left (positive-area) polygon. */
function face(id: number, polygon: Point[], edgeCutIds?: number[]): Face {
  const tags = edgeCutIds ?? polygon.map(() => -1);
  return {
    id,
    polygon,
    edgeCutIds: tags,
    holes: [],
    cutIds: [...new Set(tags.filter((t) => t >= 0))],
    area: signedArea(polygon),
    centroid: polygonCentroid(polygon),
    kind: 'segment',
  };
}

// The debris class this pass exists for: a cut-less micro-face pinched off at
// a corner (Caveat g grew a 29-unit² wedge where its bowl closes onto the
// stem), sharing edges with normal faces. Fixtures are synthetic on purpose —
// they must keep exercising this code after the partition itself stops
// emitting such faces.
describe('dissolvePartitionDebris', () => {
  const FLOOR = 200;

  /** 200×60 ribbon whose right edge is split at (200,25) so a wedge can share the lower piece. */
  const ribbon = () =>
    face(0, [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 25 },
      { x: 200, y: 60 },
      { x: 0, y: 60 },
    ]);
  /** Area-125 cut-less wedge sharing the ribbon's (200,0)→(200,25) edge. */
  const wedge = (id: number) =>
    face(id, [
      { x: 200, y: 0 },
      { x: 210, y: 10 },
      { x: 200, y: 25 },
    ]);

  test('cut-less micro-face dissolves into its edge-sharing neighbour, silently', () => {
    const a = ribbon();
    const areaBefore = a.area;
    const debris = wedge(1);
    const { faces, warnings } = dissolvePartitionDebris([a, debris], FLOOR);
    expect(warnings).toEqual([]);
    expect(faces.length).toBe(1);
    expect(faces[0]!.area).toBeCloseTo(areaBefore + 125, 6);
    // The absorbed wedge is interior now: no vertex of the merged outline
    // coincides with the wedge tip's former neighbours on the shared edge.
    expect(faces[0]!.polygon.some((p) => p.x === 210 && p.y === 10)).toBe(true);
  });

  test('debris with several neighbours is absorbed by the one sharing the longest boundary', () => {
    // Wedge shares 25 units of edge with the ribbon but only 18 with a small
    // side face on its upper-right edge — the ribbon must win.
    const a = ribbon();
    const debris = wedge(1);
    const side = face(2, [
      { x: 210, y: 10 },
      { x: 200, y: 0 },
      { x: 260, y: 0 },
      { x: 260, y: 40 },
    ]);
    const { faces, warnings } = dissolvePartitionDebris([a, debris, side], FLOOR);
    expect(warnings).toEqual([]);
    expect(faces.length).toBe(2);
    const absorbed = faces.find((f) => f.polygon.some((p) => p.y === 60))!;
    expect(absorbed.area).toBeCloseTo(200 * 60 + 125, 6);
  });

  test('island debris (no shared edge) is dropped with a warning — never silently', () => {
    const a = ribbon();
    const island = face(1, [
      { x: 500, y: 500 },
      { x: 510, y: 500 },
      { x: 505, y: 510 },
    ]);
    const { faces, warnings } = dissolvePartitionDebris([a, island], FLOOR);
    expect(faces.length).toBe(1);
    expect(faces[0]!.polygon.length).toBe(5);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('dropped');
  });

  test('a cut-less face ABOVE the floor is real ink (island dot in a counter) and stays', () => {
    const a = ribbon();
    const dot = face(1, [
      { x: 500, y: 500 },
      { x: 540, y: 500 },
      { x: 540, y: 540 },
      { x: 500, y: 540 },
    ]);
    const { faces, warnings } = dissolvePartitionDebris([a, dot], FLOOR);
    expect(faces.length).toBe(2);
    expect(warnings).toEqual([]);
  });

  test('faces with cuts are never debris, however small', () => {
    const a = ribbon();
    const tiny = face(
      1,
      [
        { x: 200, y: 0 },
        { x: 210, y: 10 },
        { x: 200, y: 25 },
      ],
      [7, -1, -1],
    );
    const { faces, warnings } = dissolvePartitionDebris([a, tiny], FLOOR);
    expect(faces.length).toBe(2);
    expect(warnings).toEqual([]);
  });

  test('a lone face is the whole region, never debris', () => {
    const only = wedge(0);
    const { faces, warnings } = dissolvePartitionDebris([only], FLOOR);
    expect(faces.length).toBe(1);
    expect(warnings).toEqual([]);
  });

  test('face ids come back dense — cross-region offsetting relies on id === index', () => {
    const a = ribbon();
    a.id = 0;
    const debris = wedge(1);
    const side = face(2, [
      { x: 210, y: 10 },
      { x: 200, y: 0 },
      { x: 260, y: 0 },
      { x: 260, y: 40 },
    ]);
    const { faces } = dissolvePartitionDebris([a, debris, side], FLOOR);
    expect(faces.map((f) => f.id)).toEqual([0, 1]);
  });
});
