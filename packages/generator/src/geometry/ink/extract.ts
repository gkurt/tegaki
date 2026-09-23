// Ink-graph stroke extraction — orchestrates mesh → graph → cover per region.
//
// An alternative to the corner/cut/face partition pipeline: no corner
// detection, no cuts, no per-face medial axes. The ink is triangulated once,
// its topology read off the triangles (see mesh.ts / graph.ts), and strokes
// chosen by an exact per-junction pairing over that graph (cover.ts).
//
// COVERAGE is an invariant, not a hope: every triangle is either on a
// branch centerline, absorbed into a junction whose disk paints it (spur
// pruning's own criterion), or inside a junction zone crossed by passages /
// extensions. The one lossy step is the junction zone, so the extraction
// AUDITS it — every triangle not painted by the final strokes is counted
// and reported, never silently dropped.

import type { Point } from 'tegaki';
import { dist, pointInRegion, polygonCentroid } from '../primitives.ts';
import { rdpSimplify } from '../strokes.ts';
import type { AxisPoint, Contour, Face, GeoStroke, SegmentInfo } from '../types.ts';
import { coverInkGraph, type JunctionCluster } from './cover.ts';
import { buildInkGraph, extractBranches, pruneSpurs } from './graph.ts';
import { buildInkMesh, trianglePoints } from './mesh.ts';
import { fitNibs, paintedBy } from './nib.ts';
import { SegmentIndex } from './spatial.ts';

export interface InkExtractionOptions {
  /** Outline resampling step (font units). */
  sampleSpacing: number;
  /** Spur prune tolerance as a fraction of the junction radius. */
  spurTolerance: number;
  /** Junction zone radius as a multiple of the junction's inscribed radius. */
  junctionReach: number;
  /** cos(max bend) for pass-through pairings. */
  continuationMinCos: number;
  /** Final stroke simplification tolerance (font units). */
  simplifyEpsilon: number;
  /** Fold serif arms into the stroke ends they cap (cover.ts). */
  absorbSerifs: boolean;
}

export interface InkRegionResult {
  /** Triangles as faces (kind 'junction' inside junction zones) — for visualization. */
  faces: Face[];
  /** Trimmed branch centerlines — for visualization. */
  segments: SegmentInfo[];
  clusters: JunctionCluster[];
  strokes: GeoStroke[];
  /** Ink area (triangle area) no final stroke paints. */
  uncoveredArea: number;
  totalArea: number;
  warnings: string[];
}

/**
 * Drop stroke-end points that add no ink: a point whose pen disk lies inside
 * a later point's disk. A round cap's chordal axis runs on into the cap with
 * shrinking widths; the pen stops at the cap's center with its full width.
 * A tapered tip keeps its points — each one reaches ink the others don't.
 */
function trimRedundantEnd(points: AxisPoint[], tolerance: number): AxisPoint[] {
  const out = [...points];
  const window = 12;
  while (out.length > 2) {
    const p = out[0]!;
    if (p.nib) break; // a nib reaches ink its round disk test cannot see
    let inside = false;
    for (let j = 1; j < Math.min(out.length, window + 1); j++) {
      const q = out[j]!;
      if (dist(p, q) + p.width / 2 <= q.width / 2 + tolerance) {
        inside = true;
        break;
      }
    }
    if (!inside) break;
    out.shift();
  }
  return out;
}

/** Light positional smoothing (endpoints fixed): the chordal axis zig-zags by a fraction of a sample step. */
function smooth(points: AxisPoint[], passes: number, isLoop: boolean, clearance: (p: Point) => number): AxisPoint[] {
  // A loop carries a duplicated seam point; smooth the open ring cyclically
  // and re-close EXACTLY — ordering rotates closed loops only when the seam
  // matches, and otherwise rotates them as open polylines, dropping a span.
  if (isLoop && points.length > 3 && dist(points[0]!, points[points.length - 1]!) < 1e-6) {
    const ring = smooth(points.slice(0, -1), passes, true, clearance);
    return [...ring, { ...ring[0]! }];
  }
  let cur = points;
  for (let pass = 0; pass < passes; pass++) {
    const nxt = cur.map((p) => ({ ...p }));
    const n = cur.length;
    for (let i = 0; i < n; i++) {
      const edge = i === 0 || i === n - 1;
      if (edge && !isLoop) continue;
      if (cur[i]!.nib) continue; // the nib was fitted at exactly this position
      const a = cur[(i - 1 + n) % n]!;
      const b = cur[(i + 1) % n]!;
      // A point doubled in place is a deliberate width change (the pen
      // narrowing at a stem's end before sweeping its serif): keep both.
      if (dist(a, cur[i]!) < 1e-6 || dist(b, cur[i]!) < 1e-6) continue;
      // Hairpins (a flick's tip, a retrace's turn) stay put — averaging
      // would pull the tip back toward its own return path.
      const inX = cur[i]!.x - a.x;
      const inY = cur[i]!.y - a.y;
      const outX = b.x - cur[i]!.x;
      const outY = b.y - cur[i]!.y;
      if (inX * outX + inY * outY < -0.5 * Math.hypot(inX, inY) * Math.hypot(outX, outY)) continue;
      nxt[i]!.x = (a.x + 2 * cur[i]!.x + b.x) / 4;
      nxt[i]!.y = (a.y + 2 * cur[i]!.y + b.y) / 4;
      // Smoothing must not paint past the outline (a junction-wide point
      // where a serif sweep turns would): a moved disk keeps its width where
      // the ink clears it, and otherwise shrinks — at most by its move, the
      // radius at which the disk stays inside the one it was.
      const w = cur[i]!.width;
      nxt[i]!.width = Math.min(w, Math.max(2 * clearance(nxt[i]!), w - 2 * dist(nxt[i]!, cur[i]!)));
    }
    cur = nxt;
  }
  return cur;
}

/** Simplifying may widen the pen past a point's own width by a quarter of the positional tolerance. */
const WIDTH_OVERSHOOT_WEIGHT = 4;
/**
 * ... and paint past the outline by half of it. Stricter halves the spill
 * again but keeps ~20% more points (Rubik, EB Garamond).
 */
const SPILL_WEIGHT = 2;

/** Width-aware RDP that keeps every nib point (each nib was fitted relative to its exact position). */
function simplifyKeepingNibs(points: AxisPoint[], epsilon: number, clearance: (p: Point) => number): AxisPoint[] {
  const out: AxisPoint[] = [];
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (i < points.length - 1 && !points[i]!.nib) continue;
    const piece = rdpSimplify(points.slice(start, i + 1), epsilon, {
      overshootWeight: WIDTH_OVERSHOOT_WEIGHT,
      clearance,
      spillWeight: SPILL_WEIGHT,
    });
    out.push(...(out.length > 0 ? piece.slice(1) : piece));
    start = i;
  }
  return out.length > 0 ? out : points;
}

export function extractInkRegion(contours: Contour[], options: InkExtractionOptions, faceIdOffset: number): InkRegionResult {
  const warnings: string[] = [];
  const step = options.sampleSpacing;
  const mesh = buildInkMesh(contours, step);
  if (mesh.missingEdges > 0) warnings.push(`ink mesh: ${mesh.missingEdges} outline edge(s) not conforming after refinement`);

  const outline: [Point, Point][] = [];
  for (let i = 0; i < mesh.points.length; i++) {
    const j = mesh.next[i]!;
    if (j >= 0 && j !== i) outline.push([mesh.points[i]!, mesh.points[j]!]);
  }
  const boundary = new SegmentIndex(outline, step * 4);

  const graph = buildInkGraph(mesh, boundary);
  pruneSpurs(graph, options.spurTolerance, step * 2.5);
  // Flicks poking out less than a sample step are sampling noise, not ink.
  const minPoke = step;
  const inkAt = (p: Point) => pointInRegion(p, contours) || boundary.nearest(p) < step * 0.25;
  fitNibs(graph, inkAt, step, minPoke);
  const rawBranches = extractBranches(graph, minPoke);
  const cover = coverInkGraph(graph, rawBranches, contours, {
    junctionReach: options.junctionReach,
    continuationMinCos: options.continuationMinCos,
    step,
    absorbSerifs: options.absorbSerifs,
    inkAt,
  });

  const clearance = (p: Point) => boundary.nearest(p);
  const strokes = cover.strokes.map((s) => {
    let pts = s.points;
    if (!s.isLoop && pts.length > 2) {
      pts = trimRedundantEnd(pts, step * 0.25);
      pts = trimRedundantEnd([...pts].reverse(), step * 0.25).reverse();
    }
    pts = smooth(pts, 2, s.isLoop, clearance);
    // Width-aware RDP only: simplifyStroke's pinch prune targets partition
    // skeleton waists and would drop flick tips (width 0 by construction).
    if (pts.length > 2) pts = simplifyKeepingNibs(pts, options.simplifyEpsilon, clearance);
    return { ...s, points: pts };
  });

  // ── Coverage audit: which triangles does the final pen leave unpainted? ─
  const zone = new Set<number>();
  for (const cl of cover.clusters) for (const t of cl.zoneTris) zone.add(t);
  const strokePts = strokes.map((s) => s.points);
  const tolerance = step * 0.5;
  let uncoveredArea = 0;
  let totalArea = 0;
  const faces: Face[] = [];
  for (let t = 0; t < mesh.triCount; t++) {
    const tri = trianglePoints(mesh, t);
    const [a, b, c] = tri;
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    totalArea += area;
    const centroid = polygonCentroid(tri);
    if (!paintedBy(centroid, strokePts, tolerance)) uncoveredArea += area;
    faces.push({
      id: faceIdOffset + t,
      polygon: tri,
      edgeCutIds: [-1, -1, -1],
      holes: [],
      cutIds: [],
      area,
      centroid,
      kind: zone.has(t) ? 'junction' : 'segment',
    });
  }
  if (totalArea > 0 && uncoveredArea / totalArea > 0.005) {
    warnings.push(`ink graph: ${((100 * uncoveredArea) / totalArea).toFixed(1)}% of the ink is not painted by any stroke`);
  }

  const segments: SegmentInfo[] = cover.branches.map((b) => ({
    faceId: faceIdOffset + (b.tris[0] ?? 0),
    axis: b.axis,
    isLoop: b.isCycle,
    ends: [],
  }));
  for (const cl of cover.clusters) {
    for (const slot of cl.slots) {
      const seg = segments[Math.floor(slot.key / 2)];
      seg?.ends.push({ cutId: -1, point: slot.point, direction: slot.direction, width: slot.point.width });
    }
  }

  return { faces, segments, clusters: cover.clusters, strokes, uncoveredArea, totalArea, warnings };
}
