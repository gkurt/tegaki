// Stage G4 — planar partition of the glyph region by the cut segments.
//
// Builds the planar arrangement of ALL input segments — every contour edge and
// every cut — splitting each segment at every intersection with another, then
// extracts the arrangement's minimal faces via a rotation system. Working from
// the full arrangement (rather than inserting cuts into pre-oriented contours)
// makes the partition robust to fonts whose glyphs are drawn as *overlapping*
// stroke contours relying on nonzero-winding union (common in script fonts):
// the crossings become real vertices instead of silently ignored.
//
// Each undirected sub-edge yields two half-edges. Walking "most-clockwise turn
// at each arrival" enumerates every minimal cycle; positive-area cycles are
// face candidates and negative-area cycles are hole/exterior boundaries. A face
// is kept when a point just inside its boundary lies in the filled region
// (nonzero winding of the original contours), which drops counters and exterior
// pockets while keeping annuli (O) as single faces with hole boundaries.

import type { Point } from 'tegaki';
import { add, dist, midpoint, pointInPolygon, pointInRegion, polygonCentroid, scale, signedArea, sub } from './primitives.ts';
import type { Contour, Cut, Face } from './types.ts';

interface HalfEdge {
  from: number;
  to: number;
  cutId: number; // -1 for outline edges
}

interface Cycle {
  vertexIds: number[];
  edgeCutIds: number[];
  area: number;
}

export interface PartitionResult {
  faces: Face[];
  warnings: string[];
}

interface InputSegment {
  a: Point;
  b: Point;
  cutId: number;
}

export function partitionFaces(contours: Contour[], cuts: Cut[], weldEps: number): PartitionResult {
  const warnings: string[] = [];

  // ── Input segments: contour edges + cuts ─────────────────────────────────
  const segments: InputSegment[] = [];
  for (const c of contours) {
    const pts = c.points;
    for (let i = 0; i < pts.length; i++) segments.push({ a: pts[i]!, b: pts[(i + 1) % pts.length]!, cutId: -1 });
  }
  for (let k = 0; k < cuts.length; k++) segments.push({ a: cuts[k]!.a.point, b: cuts[k]!.b.point, cutId: k });

  // ── Welded vertex pool ────────────────────────────────────────────────────
  const vertices: Point[] = [];
  const weldSq = weldEps * weldEps;
  const vertexId = (p: Point): number => {
    for (let i = 0; i < vertices.length; i++) {
      const d = vertices[i]!;
      const dx = d.x - p.x;
      const dy = d.y - p.y;
      if (dx * dx + dy * dy <= weldSq) return i;
    }
    vertices.push({ x: p.x, y: p.y });
    return vertices.length - 1;
  };

  // ── Split every segment at intersections with every other segment ─────────
  // splitParams[i] = sorted list of t∈(0,1) where segment i is crossed.
  const splitParams: number[][] = segments.map(() => []);
  for (let i = 0; i < segments.length; i++) {
    const si = segments[i]!;
    const rx = si.b.x - si.a.x;
    const ry = si.b.y - si.a.y;
    for (let j = i + 1; j < segments.length; j++) {
      const sj = segments[j]!;
      // bbox reject
      if (
        Math.max(si.a.x, si.b.x) < Math.min(sj.a.x, sj.b.x) ||
        Math.max(sj.a.x, sj.b.x) < Math.min(si.a.x, si.b.x) ||
        Math.max(si.a.y, si.b.y) < Math.min(sj.a.y, sj.b.y) ||
        Math.max(sj.a.y, sj.b.y) < Math.min(si.a.y, si.b.y)
      ) {
        continue;
      }
      const sx = sj.b.x - sj.a.x;
      const sy = sj.b.y - sj.a.y;
      const denom = rx * sy - ry * sx;
      if (Math.abs(denom) < 1e-12) continue; // parallel/collinear
      const qpx = sj.a.x - si.a.x;
      const qpy = sj.a.y - si.a.y;
      const t = (qpx * sy - qpy * sx) / denom;
      const u = (qpx * ry - qpy * rx) / denom;
      if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
      // Only record splits strictly interior to each segment (endpoints weld anyway).
      if (t > 1e-6 && t < 1 - 1e-6) splitParams[i]!.push(t);
      if (u > 1e-6 && u < 1 - 1e-6) splitParams[j]!.push(u);
    }
  }

  // ── Half-edges from split sub-segments (both directions) ──────────────────
  const halfEdges: HalfEdge[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const ts = [...new Set(splitParams[i]!)].sort((a, b) => a - b);
    const chain: number[] = [vertexId(seg.a)];
    for (const t of ts) {
      const p = add(seg.a, scale(sub(seg.b, seg.a), t));
      const id = vertexId(p);
      if (id !== chain[chain.length - 1]) chain.push(id);
    }
    const endId = vertexId(seg.b);
    if (endId !== chain[chain.length - 1]) chain.push(endId);
    for (let c = 0; c + 1 < chain.length; c++) {
      const from = chain[c]!;
      const to = chain[c + 1]!;
      if (from === to) continue;
      halfEdges.push({ from, to, cutId: seg.cutId });
      halfEdges.push({ from: to, to: from, cutId: seg.cutId });
    }
  }

  // ── Rotation system ────────────────────────────────────────────────────────
  const outgoing = new Map<number, number[]>();
  for (let h = 0; h < halfEdges.length; h++) {
    const list = outgoing.get(halfEdges[h]!.from) ?? [];
    list.push(h);
    outgoing.set(halfEdges[h]!.from, list);
  }
  const angleOf = (h: number): number => {
    const e = halfEdges[h]!;
    const a = vertices[e.from]!;
    const b = vertices[e.to]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  for (const list of outgoing.values()) list.sort((a, b) => angleOf(a) - angleOf(b));

  // next(h): arriving at v via h, leave along the edge whose direction is the
  // next one clockwise from the reversed arrival direction. This walks each
  // minimal face with its interior on the algebraic left.
  const twinOf = new Map<number, number>();
  for (let h = 0; h < halfEdges.length; h += 2) {
    twinOf.set(h, h + 1);
    twinOf.set(h + 1, h);
  }
  const nextEdge = (h: number): number | null => {
    const e = halfEdges[h]!;
    const list = outgoing.get(e.to);
    if (!list || list.length === 0) return null;
    const a = vertices[e.from]!;
    const b = vertices[e.to]!;
    const reverseAngle = Math.atan2(a.y - b.y, a.x - b.x);
    // Choose the outgoing edge with the largest angle strictly less than the
    // reversed-arrival angle; wrap to the max angle otherwise (cyclic).
    let best: number | null = null;
    let bestAngle = -Infinity;
    let maxEdge: number | null = null;
    let maxAngle = -Infinity;
    for (const cand of list) {
      const ang = angleOf(cand);
      if (ang > maxAngle) {
        maxAngle = ang;
        maxEdge = cand;
      }
      if (ang < reverseAngle - 1e-12 && ang > bestAngle) {
        bestAngle = ang;
        best = cand;
      }
    }
    return best ?? maxEdge;
  };

  const visited = new Uint8Array(halfEdges.length);
  const cycles: Cycle[] = [];
  for (let h0 = 0; h0 < halfEdges.length; h0++) {
    if (visited[h0]) continue;
    const vertexIds: number[] = [];
    const edgeCutIds: number[] = [];
    let h = h0;
    let guard = halfEdges.length + 2;
    let broken = false;
    while (guard-- > 0) {
      visited[h] = 1;
      vertexIds.push(halfEdges[h]!.from);
      edgeCutIds.push(halfEdges[h]!.cutId);
      const nxt = nextEdge(h);
      if (nxt == null) {
        broken = true;
        break;
      }
      h = nxt;
      if (h === h0) break;
      if (visited[h]) {
        broken = true;
        break;
      }
    }
    if (broken || guard <= 0) {
      warnings.push('face walk aborted (degenerate geometry)');
      continue;
    }
    const points = vertexIds.map((id) => vertices[id]!);
    cycles.push({ vertexIds, edgeCutIds, area: signedArea(points) });
  }

  // ── Faces (positive cycles) + holes (negative cycles) ────────────────────
  const areaEps = weldEps * weldEps;
  const positive = cycles.filter((c) => c.area > areaEps);
  const negative = cycles.filter((c) => c.area < -areaEps);

  const candidates = positive.map((cycle, id) => {
    const polygon = cycle.vertexIds.map((v) => ({ x: vertices[v]!.x, y: vertices[v]!.y }));
    return { id, cycle, polygon, holes: [] as Point[][] };
  });

  // Attach each negative cycle to the smallest positive face that *strictly*
  // contains it. A genuine hole (a counter) is smaller than the face around it;
  // the arrangement's exterior/unbounded cycle is the outer boundary traversed
  // backwards, so its area equals (or exceeds) the outermost face's — it must
  // never be attached as a hole. Requiring the container to be strictly larger
  // than the hole excludes it (its first vertex lies *on* a face boundary, so
  // the point-in-polygon test alone reports a false "inside").
  for (const hole of negative) {
    const holeArea = -hole.area; // positive magnitude
    const probe = vertices[hole.vertexIds[0]!]!;
    let owner: (typeof candidates)[number] | null = null;
    for (const cand of candidates) {
      if (cand.cycle.area <= holeArea + areaEps) continue;
      if (!pointInPolygon(probe, cand.polygon)) continue;
      if (!owner || cand.cycle.area < owner.cycle.area) owner = cand;
    }
    if (owner) owner.holes.push(hole.vertexIds.map((v) => ({ x: vertices[v]!.x, y: vertices[v]!.y })));
  }

  // Keep only faces whose interior lies in the filled region (nonzero winding).
  const faces: Face[] = [];
  for (const cand of candidates) {
    const inside = interiorProbe(cand.polygon);
    if (!inside || !pointInRegion(inside, contours)) continue;
    const cutIds = [...new Set(cand.cycle.edgeCutIds.filter((c) => c >= 0))];
    faces.push({
      id: faces.length,
      polygon: cand.polygon,
      edgeCutIds: cand.cycle.edgeCutIds,
      holes: cand.holes,
      cutIds,
      area: cand.cycle.area,
      centroid: polygonCentroid(cand.polygon),
      kind: 'segment',
    });
  }

  return { faces, warnings };
}

/** A point just inside a positive (region-on-left) polygon, near its longest edge. */
function interiorProbe(polygon: Point[]): Point | null {
  const n = polygon.length;
  if (n < 3) return null;
  // Longest edge gives the most numerically stable inward offset.
  let bestEdge = 0;
  let bestLen = -1;
  for (let i = 0; i < n; i++) {
    const l = dist(polygon[i]!, polygon[(i + 1) % n]!);
    if (l > bestLen) {
      bestLen = l;
      bestEdge = i;
    }
  }
  const a = polygon[bestEdge]!;
  const b = polygon[(bestEdge + 1) % n]!;
  const m = midpoint(a, b);
  const dir = sub(b, a);
  // Left normal (interior side for a positive cycle): rotate +90° algebraically.
  const nrm = { x: -dir.y, y: dir.x };
  const nl = Math.hypot(nrm.x, nrm.y) || 1;
  const eps = Math.min(bestLen * 0.25, Math.max(bestLen * 0.01, 1e-3));
  const probe = add(m, scale({ x: nrm.x / nl, y: nrm.y / nl }, eps));
  // Confirm it's inside the polygon; fall back to the opposite side otherwise.
  if (pointInPolygon(probe, polygon)) return probe;
  const alt = add(m, scale({ x: nrm.x / nl, y: nrm.y / nl }, -eps));
  if (pointInPolygon(alt, polygon)) return alt;
  return polygonCentroid(polygon);
}

/**
 * Classify faces as stroke segments vs cross-section junctions.
 *
 * A junction is where three or more cross-sections meet (the quad where a T's
 * stem meets its bar, the center of an X). Faces with ≤2 cuts are ALWAYS
 * segments — even compact ones (elbows, valley turns, lobes): the medial stage
 * routes their axis through the actual local shape (strip / turn / retraced
 * lobe). Classifying compact 2-cut faces as junctions instead collapsed whole
 * glyph areas into single centroid-bridged nodes — a cursive 'w' lost both
 * valleys and its middle peak to one jagged bridge.
 */
export function classifyFaces(faces: Face[]): void {
  for (const face of faces) {
    face.kind = face.cutIds.length >= 3 ? 'junction' : 'segment';
  }
}
