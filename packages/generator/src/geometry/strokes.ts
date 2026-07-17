// Stage G6 — junction continuation matching + stroke assembly.
//
// Each segment axis has up to two ends, each terminating on a cut. A cut is
// shared by two faces; the junction on the far side of the cut is where a
// segment may continue into another segment. For every junction we collect the
// incident segment ends and decide which pairs are "the same stroke passing
// through" using a heuristic on:
//
//   - direction:  the two ends should be roughly antiparallel (the stroke goes
//                 straight through, not making a sharp turn) — cos(bend) test.
//   - width:      matched ends should have similar stroke width.
//   - offset:     the two cut midpoints should be close (the stroke doesn't
//                 jump sideways crossing the junction).
//
// A junction may host several independent strokes (X → 2, asterisk → 3): we
// greedily accept the best-scoring compatible pairs, each end used once. Any
// end left unpaired terminates its stroke at the junction. Accepted pairs are
// then chained across junctions into whole strokes, bridged through each
// junction centroid so the drawn line passes through the crossing.

import type { Point } from 'tegaki';
import { dist, dot, normalize, sub } from './primitives.ts';
import type { AxisEnd, GeoStroke, JunctionInfo, ResolvedGeometryOptions, SegmentInfo } from './types.ts';

/** endKey packs (segmentIndex, endIndex) for use in maps/sets. */
const endKey = (seg: number, end: number) => seg * 2 + end;

interface Incidence {
  segmentIndex: number;
  endIndex: number;
  end: AxisEnd;
}

/**
 * A junction "node" the pipeline pre-computes: either a connected component of
 * junction-classified faces, or a bare cut directly separating two segment
 * faces. Both merge segments the same way, so they share this shape.
 */
export interface JunctionNode {
  faceIds: number[];
  /** Cuts bordering this node — a segment end on any of these opens into it. */
  cutIds: number[];
  /** Geometric center used to bridge assembled strokes through the crossing. */
  center: Point;
}

/**
 * Attach segment ends to the junction node they open into. A segment end sits
 * on a cut; that cut borders exactly two faces, so it belongs to at most one
 * node (its own segment face is never a node). Ends are matched to nodes purely
 * by cut membership — no per-face far-side search needed.
 */
export function buildJunctions(segments: SegmentInfo[], nodes: JunctionNode[]): JunctionInfo[] {
  const cutToNode = new Map<number, number>();
  nodes.forEach((node, ni) => {
    for (const c of node.cutIds) cutToNode.set(c, ni);
  });

  const nodeIncidence = new Map<number, Incidence[]>();
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si]!;
    for (let ei = 0; ei < seg.ends.length; ei++) {
      const end = seg.ends[ei]!;
      if (end.cutId < 0) continue;
      const ni = cutToNode.get(end.cutId);
      if (ni == null) continue;
      const list = nodeIncidence.get(ni) ?? [];
      list.push({ segmentIndex: si, endIndex: ei, end });
      nodeIncidence.set(ni, list);
    }
  }

  const junctions: JunctionInfo[] = [];
  for (const [ni, incidences] of nodeIncidence) {
    const node = nodes[ni]!;
    // Prefer the node's own geometric center; fall back to the average of
    // incident cut midpoints (bare cuts carry no face center).
    let center = node.center;
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      let cx = 0;
      let cy = 0;
      for (const inc of incidences) {
        cx += inc.end.point.x;
        cy += inc.end.point.y;
      }
      center = { x: cx / incidences.length, y: cy / incidences.length };
    }
    junctions.push({
      faceIds: node.faceIds,
      centroid: center,
      incident: incidences.map((i) => ({ segmentIndex: i.segmentIndex, endIndex: i.endIndex })),
      pairings: [],
    });
  }

  return junctions;
}

interface PairScore {
  i: number;
  j: number;
  score: number;
}

/** Score a candidate continuation between two incident ends (higher = better; -1 = incompatible). */
function scorePair(a: AxisEnd, b: AxisEnd, options: ResolvedGeometryOptions): number {
  // Directions point OUT of each segment into the junction, so a straight
  // through-stroke has antiparallel directions (dot ≈ -1). "Bend" is the
  // deviation from straight; accept when cos(bend) ≥ continuationMinCos.
  const alignment = -dot(a.direction, b.direction); // 1 = perfectly straight
  if (alignment < options.continuationMinCos) return -1;

  // Width compatibility: penalize large relative differences.
  const wMax = Math.max(a.width, b.width, 1e-6);
  const wMin = Math.min(a.width, b.width);
  const widthScore = wMin / wMax;

  // Offset: how far apart the two cut midpoints are, relative to width.
  const offset = dist(a.point, b.point);
  const offsetScore = 1 / (1 + offset / wMax);

  // Direction dominates; width and offset break ties and reject bad matches.
  return alignment * 0.6 + widthScore * 0.25 + offsetScore * 0.15;
}

/** Greedily accept best-scoring continuation pairs at one junction, each end used once. */
export function matchContinuations(junction: JunctionInfo, segments: SegmentInfo[], options: ResolvedGeometryOptions): void {
  const ends = junction.incident.map((inc) => segments[inc.segmentIndex]!.ends[inc.endIndex]!);
  const candidates: PairScore[] = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      // Never pair two ends of the same segment (a segment can't continue into
      // itself across a junction).
      if (junction.incident[i]!.segmentIndex === junction.incident[j]!.segmentIndex) continue;
      const score = scorePair(ends[i]!, ends[j]!, options);
      if (score > 0) candidates.push({ i, j, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const used = new Set<number>();
  for (const cand of candidates) {
    if (used.has(cand.i) || used.has(cand.j)) continue;
    used.add(cand.i);
    used.add(cand.j);
    junction.pairings.push([cand.i, cand.j]);
  }
}

/**
 * Chain segments into strokes by walking accepted pairings across junctions.
 *
 * Builds an adjacency of (segmentIndex, endIndex) → (segmentIndex, endIndex)
 * links from every junction's pairings, plus the junction centroid to bridge
 * through. Then traverses maximal chains: each stroke is a run of segments
 * whose ends are linked, glued end-to-end and threaded through the junction
 * centroids so the polyline visibly passes through each crossing.
 */
export function assembleStrokes(segments: SegmentInfo[], junctions: JunctionInfo[]): GeoStroke[] {
  // link: endKey -> { otherKey, bridge } (the far end it continues to + junction centroid)
  const link = new Map<number, { other: number; bridge: Point }>();
  for (const junction of junctions) {
    for (const [i, j] of junction.pairings) {
      const a = junction.incident[i]!;
      const b = junction.incident[j]!;
      const ka = endKey(a.segmentIndex, a.endIndex);
      const kb = endKey(b.segmentIndex, b.endIndex);
      link.set(ka, { other: kb, bridge: junction.centroid });
      link.set(kb, { other: ka, bridge: junction.centroid });
    }
  }

  const strokes: GeoStroke[] = [];

  // Loops first (annuli have no ends and never chain).
  const consumedSeg = new Set<number>();
  for (let si = 0; si < segments.length; si++) {
    if (segments[si]!.isLoop) {
      strokes.push({ points: segments[si]!.axis.map((p) => ({ ...p })), isLoop: true, segmentIndices: [si] });
      consumedSeg.add(si);
    }
  }

  // Find chain start segments: a segment end with no link, or (for pure cycles)
  // any unconsumed segment. Walk from the free end through links.
  const consumedEnd = new Set<number>();

  const walkFrom = (startSeg: number, startEnd: number): GeoStroke | null => {
    // startEnd is the FREE end (points[0] side). We emit that segment first,
    // then continue out its other end through links.
    const orderedSegs: number[] = [];
    const points: import('./types.ts').AxisPoint[] = [];
    let curSeg = startSeg;
    let entryEnd = startEnd; // the end we're entering the segment from
    const guard = segments.length + 1;
    let steps = 0;
    while (steps++ < guard) {
      if (consumedSeg.has(curSeg)) break;
      consumedSeg.add(curSeg);
      orderedSegs.push(curSeg);
      const seg = segments[curSeg]!;
      // Orient this segment's axis so it starts at entryEnd.
      const axis = entryEnd === 0 ? seg.axis.map((p) => ({ ...p })) : seg.axis.map((p) => ({ ...p })).reverse();
      // Mark both ends consumed.
      consumedEnd.add(endKey(curSeg, 0));
      consumedEnd.add(endKey(curSeg, 1));
      // Append (dedup the seam).
      for (const p of axis) {
        const last = points[points.length - 1];
        if (last && dist(last, p) < 1e-6) continue;
        points.push(p);
      }
      const exitEnd = entryEnd === 0 ? 1 : 0;
      const outKey = endKey(curSeg, exitEnd);
      const next = link.get(outKey);
      if (!next) break;
      // Bridge through the junction centroid.
      const bridge = next.bridge;
      const last = points[points.length - 1];
      if (last && dist(last, bridge) > 1e-6) {
        points.push({ ...bridge, width: last.width });
      }
      const nextSeg = Math.floor(next.other / 2);
      const nextEntry = next.other % 2;
      if (consumedSeg.has(nextSeg)) break;
      curSeg = nextSeg;
      entryEnd = nextEntry;
    }
    if (orderedSegs.length === 0 || points.length < 2) return null;
    return { points, isLoop: false, segmentIndices: orderedSegs };
  };

  // 1) Start from genuinely free ends (no link at that end).
  for (let si = 0; si < segments.length; si++) {
    if (consumedSeg.has(si)) continue;
    for (let ei = 0; ei < 2; ei++) {
      if (link.has(endKey(si, ei))) continue;
      // This end is free — walk starting here.
      const stroke = walkFrom(si, ei);
      if (stroke) strokes.push(stroke);
      break;
    }
  }

  // 2) Any remaining segments form closed chains (rare); start arbitrarily.
  for (let si = 0; si < segments.length; si++) {
    if (consumedSeg.has(si)) continue;
    const stroke = walkFrom(si, 0);
    if (stroke) strokes.push(stroke);
  }

  return strokes;
}

/** Merge collinear runs and drop near-duplicate points to tidy assembled strokes. */
export function simplifyStroke(points: import('./types.ts').AxisPoint[], epsilon: number): import('./types.ts').AxisPoint[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const rdp = (lo: number, hi: number) => {
    if (hi <= lo + 1) return;
    const a = points[lo]!;
    const b = points[hi]!;
    const ab = sub(b, a);
    const abLen = Math.hypot(ab.x, ab.y) || 1e-9;
    const nx = -ab.y / abLen;
    const ny = ab.x / abLen;
    let far = -1;
    let farD = epsilon;
    for (let i = lo + 1; i < hi; i++) {
      const d = Math.abs((points[i]!.x - a.x) * nx + (points[i]!.y - a.y) * ny);
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      rdp(lo, far);
      rdp(far, hi);
    }
  };
  rdp(0, points.length - 1);
  const out: import('./types.ts').AxisPoint[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]!);
  return out;
}

/** Unit tangent at the head of a stroke (used only for debug/inspection). */
export function headTangent(points: Point[]): Point {
  if (points.length < 2) return { x: 0, y: 0 };
  return normalize(sub(points[1]!, points[0]!));
}
