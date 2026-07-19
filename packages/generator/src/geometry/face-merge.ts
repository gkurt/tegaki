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
// edges yields the union's boundary: one outer ring, plus hole rings when a
// loop chain closes into an annulus (0's stem+bowl around the counter).
// Anything unexpected (a pinch vertex, several outer rings, a cut surviving
// on a hole boundary, subdivision mismatch on a shared cut) makes the caller
// fall back to per-face axes: the merge must never guess.

import type { Point } from 'tegaki';
import { polygonCentroid, signedArea } from './primitives.ts';
import type { Face } from './types.ts';

const keyOf = (p: Point): string => `${Math.round(p.x * 1024)}:${Math.round(p.y * 1024)}`;

/**
 * Merge a group of segment faces connected along shared (bare) cut edges into
 * a single Face — possibly with holes, when the chain closes into a loop
 * (0's stem+bowl become an annulus). Returns null — callers fall back to
 * per-face processing — on a pinch vertex, multiple outer rings, pre-holed
 * members, a cut surviving on a hole boundary, or any edge bookkeeping
 * mismatch (verified by area conservation).
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

  // Stitch the surviving directed edges into rings. One ring is the plain
  // chain case; a loop chain (0's stem+bowl closing around the counter)
  // leaves TWO rings — the outer boundary plus the hole. All faces walk with
  // the region on the left, so the outer ring comes out with positive area
  // and hole rings with negative area.
  const byStart = new Map<string, DirEdge[]>();
  for (const e of edges.values()) {
    const k = keyOf(e.a);
    const list = byStart.get(k) ?? [];
    list.push(e);
    byStart.set(k, list);
  }
  interface Ring {
    pts: Point[];
    tags: number[];
    area: number;
  }
  const rings: Ring[] = [];
  const remaining = new Set(edges.keys());
  while (remaining.size > 0) {
    const firstKey = remaining.values().next().value as string;
    const first = edges.get(firstKey)!;
    const pts: Point[] = [];
    const tags: number[] = [];
    let cur = first;
    for (;;) {
      const curKey = `${keyOf(cur.a)}|${keyOf(cur.b)}`;
      if (!remaining.delete(curKey)) return null; // walk revisited an edge
      pts.push(cur.a);
      tags.push(cur.tag);
      const nextKey = keyOf(cur.b);
      if (nextKey === keyOf(first.a)) break;
      const candidates = byStart.get(nextKey)?.filter((e) => remaining.has(`${keyOf(e.a)}|${keyOf(e.b)}`));
      if (candidates?.length !== 1) return null; // dead end or pinch vertex
      cur = candidates[0]!;
    }
    rings.push({ pts, tags, area: signedArea(pts) });
  }

  const outers = rings.filter((r) => r.area > 0);
  const holes = rings.filter((r) => r.area <= 0);
  if (outers.length !== 1) return null;
  const outer = outers[0]!;
  // Hole rings must be pure wall: a cut surviving on a hole boundary means a
  // face inside the loop was left out of the group — do not guess.
  for (const hole of holes) {
    if (hole.tags.some((t) => t >= 0)) return null;
  }

  // Area conservation is the integrity check: cancellation or stitching gone
  // wrong (subdivision mismatch on a shared cut) shows up as lost area.
  const mergedArea = outer.area - holes.reduce((s, h) => s + Math.abs(h.area), 0);
  if (Math.abs(mergedArea - memberArea) > Math.max(1, 1e-4 * memberArea)) return null;

  return {
    id: group[0]!.id,
    polygon: outer.pts,
    edgeCutIds: outer.tags,
    holes: holes.map((h) => h.pts),
    cutIds: [...new Set(outer.tags.filter((t) => t >= 0))],
    area: mergedArea,
    centroid: polygonCentroid(outer.pts),
    kind: 'segment',
  };
}
