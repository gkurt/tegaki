// Stage G5b — true medial axis for hole-free segment faces.
//
// Chain pairing (strip/turn/lobe folds) approximates the centerline well in
// the middle of a stroke but systematically stops short wherever the stroke
// THINS: tapered tips, curled flourishes, and side limbs all live beyond the
// reach of any two-wall pairing. The medial axis — the locus of maximal
// inscribed disk centers — reaches every thin part by construction.
//
// Approximation (same technique as the raster pipeline's `voronoi` skeleton
// method): Voronoi diagram of densely sampled boundary points. Interior
// triangle circumcenters are medial nodes (width = 2×circumradius — the
// exact inscribed-disk diameter there); Voronoi edges between adjacent
// interior triangles form the medial graph. After pruning cut-side artifacts
// and cap forks, paths are extracted by port count:
//
// - 2 cut ports: shortest port→port path, with leftover lobes RETRACED into
//   it (the pen enters and leaves through the cuts, so a fused lobe like the
//   w's middle peak is drawn out-and-back within the same stroke).
// - 1 cut port:  port → farthest leaf; other leaves become branch segments.
// - 0 ports:     the tree diameter; other leaves become branch segments.

import { Delaunay } from 'd3-delaunay';
import type { Point } from 'tegaki';
import { buildEnds, extractRuns } from './medial.ts';
import { dist, midpoint, pointInPolygon, polylineLength } from './primitives.ts';
import type { AxisPoint, Face, ResolvedGeometryOptions, SegmentInfo } from './types.ts';

interface BoundarySample extends Point {
  /** Cut id of the source edge, or -1 for wall edges. */
  cut: number;
}

interface MedialNode extends Point {
  width: number;
  /** True when any of the defining boundary samples lies on a cut edge. */
  touchesCut: boolean;
  adj: number[];
  alive: boolean;
}

/** Evenly subdivide every face edge, tagging samples with the edge's cut id. */
function sampleBoundary(face: Face, step: number): BoundarySample[] {
  const out: BoundarySample[] = [];
  const n = face.polygon.length;
  for (let i = 0; i < n; i++) {
    const a = face.polygon[i]!;
    const b = face.polygon[(i + 1) % n]!;
    const cut = face.edgeCutIds[i]!;
    const pieces = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < pieces; k++) {
      const t = k / pieces;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, cut });
    }
  }
  return out;
}

function circumcircle(a: Point, b: Point, c: Point): { x: number; y: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

const aliveDegree = (nodes: MedialNode[], id: number) => nodes[id]!.adj.filter((o) => nodes[o]!.alive).length;

/** Dijkstra over alive nodes (O(V²) — medial graphs are small). */
function dijkstra(nodes: MedialNode[], sources: number[]): { distTo: Float64Array; prev: Int32Array } {
  const n = nodes.length;
  const distTo = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  for (const s of sources) distTo[s] = 0;
  for (;;) {
    let cur = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && nodes[i]!.alive && distTo[i]! < best) {
        best = distTo[i]!;
        cur = i;
      }
    }
    if (cur < 0) break;
    done[cur] = 1;
    for (const o of nodes[cur]!.adj) {
      if (!nodes[o]!.alive || done[o]) continue;
      const nd = distTo[cur]! + dist(nodes[cur]!, nodes[o]!);
      if (nd < distTo[o]!) {
        distTo[o] = nd;
        prev[o] = cur;
      }
    }
  }
  return { distTo, prev };
}

function walkPath(prev: Int32Array, to: number): number[] {
  const path: number[] = [];
  for (let i = to; i >= 0; i = prev[i]!) path.push(i);
  return path.reverse();
}

const toAxis = (nodes: MedialNode[], ids: number[]): AxisPoint[] =>
  ids.map((i) => ({ x: nodes[i]!.x, y: nodes[i]!.y, width: nodes[i]!.width }));

/**
 * Medial-axis based axes for a hole-free segment face: the primary axis plus
 * branch axes for every limb the medial tree reaches. Returns null when the
 * face is too small or degenerate for a usable graph (callers fall back to
 * chain pairing).
 */
export function medialFaceAxes(face: Face, options: ResolvedGeometryOptions): SegmentInfo[] | null {
  const spacing = options.resampleSpacing;
  const step = Math.max(3, spacing / 2);
  const samples = sampleBoundary(face, step);
  if (samples.length < 8) return null;

  // ── Medial graph from the Voronoi dual ─────────────────────────────────
  const delaunay = new Delaunay(Float64Array.from(samples.flatMap((p) => [p.x, p.y])));
  const { triangles, halfedges } = delaunay;
  const triCount = Math.floor(triangles.length / 3);
  const nodeOfTri = new Int32Array(triCount).fill(-1);
  const nodes: MedialNode[] = [];
  for (let t = 0; t < triCount; t++) {
    const s0 = samples[triangles[3 * t]!]!;
    const s1 = samples[triangles[3 * t + 1]!]!;
    const s2 = samples[triangles[3 * t + 2]!]!;
    const cc = circumcircle(s0, s1, s2);
    if (!cc || !pointInPolygon(cc, face.polygon)) continue;
    nodeOfTri[t] = nodes.length;
    nodes.push({ x: cc.x, y: cc.y, width: 2 * cc.r, touchesCut: s0.cut >= 0 || s1.cut >= 0 || s2.cut >= 0, adj: [], alive: true });
  }
  for (let e = 0; e < halfedges.length; e++) {
    const twin = halfedges[e]!;
    if (twin < e) continue; // covers -1 (hull edges) and double-visits
    const a = nodeOfTri[Math.floor(e / 3)]!;
    const b = nodeOfTri[Math.floor(twin / 3)]!;
    if (a < 0 || b < 0 || a === b) continue;
    nodes[a]!.adj.push(b);
    nodes[b]!.adj.push(a);
  }
  if (nodes.length < 4) return null;

  // ── Ports: nearest node to each of the (≤2 longest) cut-run midpoints ──
  const cutRuns = extractRuns(face)
    .filter((r) => r.cutId >= 0)
    .sort((a, b) => polylineLength(b.points) - polylineLength(a.points))
    .slice(0, 2);
  const ports: { node: number; cutId: number; mid: Point; span: number }[] = [];
  for (const run of cutRuns) {
    const mid = midpoint(run.points[0]!, run.points[run.points.length - 1]!);
    const span = dist(run.points[0]!, run.points[run.points.length - 1]!);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = dist(nodes[i]!, mid);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0 || bestD > span + 4 * step) return null;
    ports.push({ node: best, cutId: run.cutId, mid, span });
  }
  const portIds = new Set(ports.map((p) => p.node));

  // ── Pruning ─────────────────────────────────────────────────────────────
  // (a) Cut-side artifacts: the medial of a CLOSED face forks toward every
  // cut corner; those forks are boundary artifacts, not stroke geometry.
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (!node.alive || portIds.has(i) || !node.touchesCut) continue;
      if (aliveDegree(nodes, i) <= 1) {
        node.alive = false;
        changed = true;
      }
    }
  }
  // (b) Cap forks and wall-noise spurs: leaf chains that stay within their
  // attachment's inscribed disk (a flat cap's corner forks sit at ~0.7×w)
  // or are shorter than the sampling noise floor.
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i]!.alive || portIds.has(i) || aliveDegree(nodes, i) !== 1) continue;
      // Walk the chain from this leaf to its first junction/port.
      const chain = [i];
      let len = 0;
      let cur = i;
      let from = -1;
      for (;;) {
        const next = nodes[cur]!.adj.filter((o) => nodes[o]!.alive && o !== from);
        if (next.length !== 1) break;
        from = cur;
        cur = next[0]!;
        len += dist(nodes[from]!, nodes[cur]!);
        if (aliveDegree(nodes, cur) >= 3 || portIds.has(cur)) break;
        chain.push(cur);
      }
      if (len <= Math.max(2 * step, 0.8 * nodes[cur]!.width)) {
        for (const id of chain) nodes[id]!.alive = false;
        changed = true;
      }
    }
  }
  const alive = nodes.filter((n) => n.alive).length;
  if (alive < 2 || ports.some((p) => !nodes[p.node]!.alive)) return null;

  // ── Primary path by port count ──────────────────────────────────────────
  let primaryIds: number[];
  if (ports.length === 2) {
    const { distTo, prev } = dijkstra(nodes, [ports[0]!.node]);
    if (!Number.isFinite(distTo[ports[1]!.node]!)) return null;
    primaryIds = walkPath(prev, ports[1]!.node);
  } else if (ports.length === 1) {
    const { distTo, prev } = dijkstra(nodes, [ports[0]!.node]);
    let far = ports[0]!.node;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i]!.alive && Number.isFinite(distTo[i]!) && distTo[i]! > distTo[far]!) far = i;
    }
    if (far === ports[0]!.node) return null;
    primaryIds = walkPath(prev, far);
  } else {
    const seed = nodes.findIndex((n) => n.alive);
    const first = dijkstra(nodes, [seed]);
    let a = seed;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i]!.alive && Number.isFinite(first.distTo[i]!) && first.distTo[i]! > first.distTo[a]!) a = i;
    }
    const second = dijkstra(nodes, [a]);
    let b = a;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i]!.alive && Number.isFinite(second.distTo[i]!) && second.distTo[i]! > second.distTo[b]!) b = i;
    }
    if (a === b) return null;
    primaryIds = walkPath(second.prev, b);
  }
  if (primaryIds.length < 2) return null;

  // ── Leftover leaves: retrace into a 2-port primary, else branch ─────────
  const onPrimary = new Set(primaryIds);
  const { distTo: dPrim, prev: pPrim } = dijkstra(nodes, primaryIds);
  interface Limb {
    attach: number;
    ids: number[]; // attach → leaf
    len: number;
  }
  const limbs: Limb[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i]!.alive || onPrimary.has(i) || aliveDegree(nodes, i) !== 1) continue;
    if (!Number.isFinite(dPrim[i]!)) continue;
    const ids = walkPath(pPrim, i); // starts at a primary node
    if (ids.length < 2) continue;
    const len = dPrim[i]!;
    if (len < Math.max(2 * step, spacing)) continue;
    limbs.push({ attach: ids[0]!, ids, len });
  }

  const primaryAxis: AxisPoint[] = [];
  for (const id of primaryIds) {
    primaryAxis.push({ x: nodes[id]!.x, y: nodes[id]!.y, width: nodes[id]!.width });
    if (ports.length === 2) {
      // Retrace lobes at their attachment, capped at the attachment width so
      // the out-and-back pass draws at the local stroke width.
      for (const limb of limbs) {
        if (limb.attach !== id) continue;
        const capW = nodes[id]!.width;
        const out = toAxis(nodes, limb.ids).map((p) => ({ ...p, width: Math.min(p.width, capW) }));
        primaryAxis.push(...out.slice(1));
        primaryAxis.push(...out.slice(0, -1).reverse());
      }
    }
  }

  // Exact cut endpoints (the medial fork stops ~half a width short of a cut;
  // the stroke must reach the cross-section it continues through).
  if (ports.length >= 1) primaryAxis.unshift({ ...ports[0]!.mid, width: ports[0]!.span });
  if (ports.length === 2) primaryAxis.push({ ...ports[1]!.mid, width: ports[1]!.span });

  const startCut = ports.length >= 1 ? ports[0]!.cutId : -1;
  const endCut = ports.length === 2 ? ports[1]!.cutId : -1;
  const infos: SegmentInfo[] = [
    { faceId: face.id, axis: primaryAxis, isLoop: false, ends: buildEnds(primaryAxis, startCut, endCut, spacing) },
  ];

  if (ports.length < 2) {
    for (const limb of limbs) {
      // Branch convention: tip first (leaf → attachment).
      const axis = toAxis(nodes, [...limb.ids].reverse());
      infos.push({ faceId: face.id, axis, isLoop: false, ends: buildEnds(axis, -1, -1, spacing) });
    }
  }
  return infos;
}
