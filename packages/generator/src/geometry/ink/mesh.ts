// Ink mesh — a conforming Delaunay triangulation of one ink region.
//
// The outline (outer contours + holes) is resampled at a fixed spacing and
// triangulated. Triangles inside the region tile the ink exactly, and each
// one is classified by how many of its edges are OUTLINE edges (consecutive
// samples along a contour) versus CHORDS (edges crossing the ink):
//
//   2 outline edges → tip       (a stroke end: the ear at a cap)
//   1 outline edge  → sleeve    (the body of a stroke: two chords, in and out)
//   0 outline edges → junction  (three chords: where branches meet)
//   3 outline edges → isolated  (a region that is a single triangle)
//
// Chords connect opposite walls, so walking sleeve triangles chord-to-chord
// traces a stroke's body and the chord midpoints are its centerline (the
// chordal axis transform). This one structure replaces corner detection,
// cuts and the face partition: junctions are found where the ink actually
// branches, whether or not the outline has a sharp corner there.
//
// Conformity: an outline edge must itself be a Delaunay edge, or the
// triangles do not tile the ink. Dense sampling almost always guarantees it;
// the few edges still missing (thin necks, sharp notches) are split at their
// midpoints and the triangulation rebuilt.

import { Delaunay } from 'd3-delaunay';
import type { Point } from 'tegaki';
import { dist, pointInRegion } from '../primitives.ts';
import type { Contour } from '../types.ts';

export type TriangleKind = 'tip' | 'sleeve' | 'junction' | 'isolated';

export interface InkMesh {
  /** Outline samples. */
  points: Point[];
  /** Successor of each sample along its contour. */
  next: Int32Array;
  /** Inside triangles: three sample ids each, counter-clockwise (positive area). */
  tris: Int32Array;
  /**
   * Per triangle edge k (tris[3t+k] → tris[3t+(k+1)%3]): the inside triangle
   * across that edge when it is a chord, or -1 when it is an outline edge (or
   * an unresolved conformity gap).
   */
  nbr: Int32Array;
  triCount: number;
  /** Outline edges still absent from the triangulation after refinement. */
  missingEdges: number;
}

const MAX_REFINE_PASSES = 6;

/** Resample a closed polygon at `spacing`, keeping every original vertex. */
function sampleClosed(points: Point[], spacing: number): Point[] {
  const out: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const pieces = Math.max(1, Math.ceil(dist(a, b) / spacing));
    for (let k = 0; k < pieces; k++) {
      const t = k / pieces;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

export function buildInkMesh(contours: Contour[], spacing: number): InkMesh {
  const chains = contours.map((c) => sampleClosed(c.points, spacing));

  for (let pass = 0; ; pass++) {
    // Flatten chains into one sample array; drop coincident samples (touching
    // contours) — their successor link then skips over them.
    const points: Point[] = [];
    const next: number[] = [];
    const chainOf: number[] = [];
    const posOf: number[] = [];
    const seen = new Map<string, number>();
    for (let c = 0; c < chains.length; c++) {
      const chain = chains[c]!;
      const ids: number[] = [];
      for (let k = 0; k < chain.length; k++) {
        const p = chain[k]!;
        const key = `${Math.round(p.x * 1e4)}:${Math.round(p.y * 1e4)}`;
        if (seen.has(key)) continue;
        seen.set(key, points.length);
        ids.push(points.length);
        points.push(p);
        chainOf.push(c);
        posOf.push(k);
        next.push(-1);
      }
      for (let k = 0; k < ids.length; k++) next[ids[k]!] = ids[(k + 1) % ids.length]!;
    }

    const delaunay = new Delaunay(Float64Array.from(points.flatMap((p) => [p.x, p.y])));
    const { triangles, halfedges } = delaunay;
    const n = points.length;
    const edgeSet = new Set<number>();
    for (let e = 0; e < triangles.length; e++) {
      const a = triangles[e]!;
      const b = triangles[e % 3 === 2 ? e - 2 : e + 1]!;
      edgeSet.add(Math.min(a, b) * n + Math.max(a, b));
    }
    const isOutline = (a: number, b: number) => next[a] === b || next[b] === a;

    const missing: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = next[i]!;
      if (j >= 0 && j !== i && !edgeSet.has(Math.min(i, j) * n + Math.max(i, j))) missing.push(i);
    }

    if (missing.length > 0 && pass < MAX_REFINE_PASSES) {
      // Split each missing outline edge at its midpoint (per chain, back to
      // front so positions stay valid) and triangulate again.
      const splits = new Map<number, number[]>();
      for (const i of missing) {
        const list = splits.get(chainOf[i]!) ?? [];
        list.push(posOf[i]!);
        splits.set(chainOf[i]!, list);
      }
      for (const [c, positions] of splits) {
        const chain = chains[c]!;
        positions.sort((a, b) => b - a);
        for (const k of positions) {
          const a = chain[k]!;
          const b = chain[(k + 1) % chain.length]!;
          chain.splice(k + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
      }
      continue;
    }

    // Inside triangles (centroid in the nonzero-winding region), re-indexed.
    const triCountAll = Math.floor(triangles.length / 3);
    const insideIndex = new Int32Array(triCountAll).fill(-1);
    let triCount = 0;
    for (let t = 0; t < triCountAll; t++) {
      const a = points[triangles[3 * t]!]!;
      const b = points[triangles[3 * t + 1]!]!;
      const c = points[triangles[3 * t + 2]!]!;
      const area2 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      // Slivers of (nearly) collinear samples along straight outline edges:
      // their centroid sits ON the outline, so inside/outside is a coin flip
      // and an "inside" one surfaces as an isolated ink dot. They hold no ink.
      const longest = Math.max(dist(a, b), dist(b, c), dist(c, a));
      if (Math.abs(area2) < 1e-6 * longest * longest) continue;
      if (pointInRegion({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }, contours)) insideIndex[t] = triCount++;
    }
    const tris = new Int32Array(triCount * 3);
    const nbr = new Int32Array(triCount * 3).fill(-1);
    for (let t = 0; t < triCountAll; t++) {
      const it = insideIndex[t]!;
      if (it < 0) continue;
      let v = [triangles[3 * t]!, triangles[3 * t + 1]!, triangles[3 * t + 2]!];
      let e = [3 * t, 3 * t + 1, 3 * t + 2];
      const [a, b, c] = v.map((id) => points[id]!) as [Point, Point, Point];
      if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) {
        // Reverse to counter-clockwise; halfedge k then runs v[k+1] → v[k].
        v = [v[0]!, v[2]!, v[1]!];
        e = [3 * t + 2, 3 * t + 1, 3 * t];
      }
      for (let k = 0; k < 3; k++) {
        tris[3 * it + k] = v[k]!;
        const va = v[k]!;
        const vb = v[(k + 1) % 3]!;
        if (isOutline(va, vb)) continue;
        const twin = halfedges[e[k]!]!;
        if (twin < 0) continue;
        const other = insideIndex[Math.floor(twin / 3)]!;
        if (other >= 0) nbr[3 * it + k] = other;
      }
    }
    return { points, next: Int32Array.from(next), tris, nbr, triCount, missingEdges: missing.length };
  }
}

/** Classify a triangle by its count of outline edges (see file header). */
export function triangleKind(mesh: InkMesh, t: number): TriangleKind {
  let chords = 0;
  for (let k = 0; k < 3; k++) if (mesh.nbr[3 * t + k]! >= 0) chords++;
  return chords === 0 ? 'isolated' : chords === 1 ? 'tip' : chords === 2 ? 'sleeve' : 'junction';
}

/** The three corner points of triangle `t`. */
export function trianglePoints(mesh: InkMesh, t: number): [Point, Point, Point] {
  return [mesh.points[mesh.tris[3 * t]!]!, mesh.points[mesh.tris[3 * t + 1]!]!, mesh.points[mesh.tris[3 * t + 2]!]!];
}

/** Midpoint of the edge shared by triangles `a` and `b` (they must be chord neighbours). */
export function sharedEdgeMidpoint(mesh: InkMesh, a: number, b: number): Point {
  for (let k = 0; k < 3; k++) {
    if (mesh.nbr[3 * a + k] === b) {
      const p = mesh.points[mesh.tris[3 * a + k]!]!;
      const q = mesh.points[mesh.tris[3 * a + ((k + 1) % 3)]!]!;
      return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    }
  }
  throw new Error(`triangles ${a} and ${b} are not chord neighbours`);
}
