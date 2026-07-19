// Merging chains of segment faces back into one polygon.
//
// The partition splits the region at every cut, but a cut between two SEGMENT
// faces (a bare cut — no junction involved) is purely artificial: the two
// faces always end up in the same stroke (degree-2 junctions merge
// unconditionally). For the exact straight-skeleton method those internal
// mouths are the remaining noise source — off-center wall-cut bisector
// vertices, port-tangent wiggle, per-face axis stitching — so the pipeline
// merges each bare-cut-connected chain and skeletonizes the stroke's REAL
// shape instead. External (junction) cuts stay on the merged boundary as the
// ports where the stroke genuinely stops.
//
// The merge is edge cancellation: all faces walk their boundary with the
// region on the left, so an edge shared by two faces of the group appears
// once in each direction — both drop, and stitching the surviving directed
// edges yields the union's boundary. Anything unexpected (a pinch vertex, a
// loop chain closing into an annulus, subdivision mismatch on a shared cut)
// makes the caller fall back to per-face axes: the merge must never guess.

import type { Point } from 'tegaki';
import { polygonCentroid, signedArea } from './primitives.ts';
import type { Face } from './types.ts';

const keyOf = (p: Point): string => `${Math.round(p.x * 1024)}:${Math.round(p.y * 1024)}`;

/**
 * Merge a group of segment faces connected along shared (bare) cut edges into
 * a single Face. Returns null — callers fall back to per-face processing —
 * when the union is not a single simple ring: a loop chain (0's stem+bowl
 * close into an annulus), a pinch vertex, pre-holed members, or any edge
 * bookkeeping mismatch (verified by area conservation).
 */
export function mergeSegmentFaces(group: Face[]): Face | null {
  if (group.length < 2) return null;
  interface DirEdge {
    a: Point;
    b: Point;
    tag: number;
  }
  const edges = new Map<string, DirEdge>();
  let memberArea = 0;
  for (const face of group) {
    if (face.holes.length > 0) return null;
    memberArea += Math.abs(signedArea(face.polygon));
    const n = face.polygon.length;
    for (let i = 0; i < n; i++) {
      const a = face.polygon[i]!;
      const b = face.polygon[(i + 1) % n]!;
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (ka === kb) continue; // zero-length edge
      const rev = `${kb}|${ka}`;
      if (edges.delete(rev)) continue; // shared internal edge — both sides drop
      const key = `${ka}|${kb}`;
      if (edges.has(key)) return null; // duplicate directed edge — degenerate contact
      edges.set(key, { a, b, tag: face.edgeCutIds[i]! });
    }
  }

  // Stitch the surviving directed edges into one ring.
  const byStart = new Map<string, DirEdge[]>();
  for (const e of edges.values()) {
    const k = keyOf(e.a);
    const list = byStart.get(k) ?? [];
    list.push(e);
    byStart.set(k, list);
  }
  const first = edges.values().next().value as DirEdge | undefined;
  if (!first) return null;
  const polygon: Point[] = [];
  const edgeCutIds: number[] = [];
  let cur = first;
  let used = 0;
  for (;;) {
    polygon.push(cur.a);
    edgeCutIds.push(cur.tag);
    used++;
    if (used > edges.size) return null; // walk revisited an edge — not a simple ring
    const nextKey = keyOf(cur.b);
    if (nextKey === keyOf(first.a)) break;
    const candidates = byStart.get(nextKey);
    if (candidates?.length !== 1) return null; // dead end or pinch vertex
    cur = candidates[0]!;
  }
  // A loop chain (or any leftover edges) means the union has a hole — the
  // straight-skeleton spine of an annulus is a cycle the graph machinery
  // cannot walk, so leave those groups to per-face processing.
  if (used !== edges.size) return null;

  // Area conservation is the integrity check: cancellation or stitching gone
  // wrong (subdivision mismatch on a shared cut) shows up as lost area.
  const mergedArea = Math.abs(signedArea(polygon));
  if (Math.abs(mergedArea - memberArea) > Math.max(1, 1e-4 * memberArea)) return null;

  return {
    id: group[0]!.id,
    polygon,
    edgeCutIds,
    holes: [],
    cutIds: [...new Set(edgeCutIds.filter((t) => t >= 0))],
    area: mergedArea,
    centroid: polygonCentroid(polygon),
    kind: 'segment',
  };
}
