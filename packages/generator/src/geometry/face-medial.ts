// Stage G5b — true medial axis for hole-free segment faces.
//
// Chain pairing (strip/turn/lobe folds) approximates the centerline well in
// the middle of a stroke but systematically stops short wherever the stroke
// THINS: tapered tips, curled flourishes, and side limbs all live beyond the
// reach of any two-wall pairing. The medial axis — the locus of maximal
// inscribed disk centers — reaches every thin part by construction.
//
// Approximation: Voronoi diagram of densely sampled WALL points (cut edges
// are artificial cross-sections — sampling them makes the medial fork toward
// cut corners instead of running straight through the open mouth). Interior
// triangle circumcenters are medial nodes (width = 2×circumradius — the
// exact inscribed-disk diameter there); Voronoi edges between adjacent
// interior triangles form the medial graph. Regions thinner than the sample
// step keep no interior circumcenter, so the build ADAPTIVELY REFINES: when
// the graph splits or a free tip stops far short of the boundary, it retries
// at half the step (twice), then bridges any remaining split and extends
// each free tip to `boundary hit − width/2` (pen-nib model, mirroring
// junction end extension). Paths are extracted by port count:
//
// - 2 cut ports: shortest port→port path, with leftover lobes RETRACED into
//   it (the pen enters and leaves through the cuts, so a fused lobe like the
//   w's middle peak is drawn out-and-back within the same stroke).
// - 1 cut port:  port → farthest leaf; other leaves become branch segments.
// - 0 ports:     the tree diameter; other leaves become branch segments.

import { Delaunay } from 'd3-delaunay';
import type { Point } from 'tegaki';
import { buildEnds, extractRuns } from './medial.ts';
import { cross, dist, distToSegment, midpoint, normalize, pointInPolygon, polylineLength, sub } from './primitives.ts';
import type { AxisPoint, Face, ResolvedGeometryOptions, SegmentInfo } from './types.ts';

export interface MedialNode extends Point {
  width: number;
  adj: number[];
  alive: boolean;
}

/**
 * Evenly subdivide wall edges; keep mouth corners (wall vertices adjacent to
 * cuts). Cut edges are normally SKIPPED — they are artificial cross-sections,
 * and sampling them makes the medial fork toward cut corners (and wiggle the
 * port-end tangents) instead of running straight through the open mouth.
 * `includeCuts` samples the full boundary instead — the last-resort mode for
 * faces whose cuts ARE their shape (see medialFaceAxes).
 */
function sampleWalls(face: Face, step: number, includeCuts: boolean): Point[] {
  const out: Point[] = [];
  const n = face.polygon.length;
  for (let i = 0; i < n; i++) {
    if (!includeCuts && face.edgeCutIds[i]! >= 0) continue;
    const a = face.polygon[i]!;
    const b = face.polygon[(i + 1) % n]!;
    const pieces = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < pieces; k++) {
      const t = k / pieces;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    if (!includeCuts && face.edgeCutIds[(i + 1) % n]! >= 0) out.push({ ...b });
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

const dedupe = (axis: AxisPoint[]): AxisPoint[] => axis.filter((p, i) => i === 0 || dist(p, axis[i - 1]!) > 1e-9);

/** Distance along the unit-dir ray from origin to the first boundary crossing. */
function rayToBoundary(origin: Point, dir: Point, polygon: Point[]): number {
  let best = Infinity;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!;
    const e = sub(polygon[(i + 1) % n]!, a);
    const denom = cross(dir, e);
    if (Math.abs(denom) < 1e-12) continue;
    const oa = sub(a, origin);
    const s = cross(oa, e) / denom;
    const u = cross(oa, dir) / denom;
    if (s > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, s);
  }
  return best;
}

/**
 * A true-medial free end stops at the cap's last inscribed-disk center — for
 * a round cap that IS the stroke tip, but a tapered tip's final stretch is
 * thinner than the sample step and keeps no medial nodes. Extend along the
 * exit direction to `boundary hit − width/2` (the pen's disk then touches
 * the apex exactly); the downstream boundary clamp tapers the widths.
 * Returns the extension length applied, so callers can request refinement
 * when a straight extension would have to bridge a long (possibly curved)
 * tail.
 */
function extendFreeTip(axis: AxisPoint[], atStart: boolean, polygon: Point[], lookback: number): number {
  if (axis.length < 2) return 0;
  const endIdx = atStart ? 0 : axis.length - 1;
  const inward = atStart ? 1 : -1;
  const end = axis[endIdx]!;
  let i = endIdx;
  let travelled = 0;
  while (i + inward >= 0 && i + inward < axis.length && travelled < lookback) {
    i += inward;
    travelled += dist(axis[i]!, axis[i - inward]!);
  }
  const dir = normalize(sub(end, axis[i]!));
  if (dir.x === 0 && dir.y === 0) return 0;
  const hit = rayToBoundary(end, dir, polygon);
  if (!Number.isFinite(hit)) return 0;
  const ext = hit - end.width / 2;
  if (ext <= 1e-6) return 0;
  const tip: AxisPoint = { x: end.x + dir.x * ext, y: end.y + dir.y * ext, width: end.width };
  if (atStart) axis.unshift(tip);
  else axis.push(tip);
  return ext;
}

/**
 * True when a leaf chain sweeps real ink beyond the reference disks: some
 * node's PEN DISK pokes visibly past every reference disk. The poke is
 * `dist + width/2 − ref.radius` — the node's own radius counts, because a
 * fat node whose CENTER sits inside the attach disk still inks far beyond
 * it (G's cap curls tightly, so every curl node's center lies within the
 * body disk while their disks reach the nose; center-clearance judged the
 * whole curl worthless and the cascade pruned the cap). "No area dropped"
 * wins over stroke-count purity: the threshold stays at half a spacing so
 * only sub-visible wisps — noise spurs and thin flat-cap corner slivers no
 * round pen could ink — are rejected.
 */
export function chainEscapes(
  nodes: MedialNode[],
  chain: number[],
  refs: { x: number; y: number; radius: number }[],
  spacing: number,
): boolean {
  for (const id of chain) {
    const node = nodes[id]!;
    let poke = Infinity;
    for (const ref of refs) poke = Math.min(poke, dist(node, ref) + node.width / 2 - ref.radius);
    if (poke > 0.5 * spacing) return true;
  }
  return false;
}

/** True when the pen sweeping every axis inks `p` to within `allowance`. */
function coveredByAxes(p: Point, axes: AxisPoint[][], allowance: number): boolean {
  for (const axis of axes) {
    for (let i = 1; i < axis.length; i++) {
      const a = axis[i - 1]!;
      const b = axis[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      const w = a.width + (b.width - a.width) * t;
      if (Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) - w / 2 <= allowance) return true;
    }
  }
  return false;
}

type Attempt = { kind: 'ok'; infos: SegmentInfo[] } | { kind: 'refine' } | { kind: 'fail' };

const REFINE: Attempt = { kind: 'refine' };
const FAIL: Attempt = { kind: 'fail' };

function attemptMedialAxes(face: Face, options: ResolvedGeometryOptions, step: number, final: boolean, includeCuts: boolean): Attempt {
  const retry = final ? FAIL : REFINE;
  const samples = sampleWalls(face, step, includeCuts);
  if (samples.length < 8) return retry;

  // ── Medial graph from the Voronoi dual ─────────────────────────────────
  // Co-circular sample quads yield two triangles with the SAME circumcenter
  // (one Voronoi vertex) — merge them into one node, or paths stutter with
  // duplicate points and degree-based pruning miscounts.
  const delaunay = new Delaunay(Float64Array.from(samples.flatMap((p) => [p.x, p.y])));
  const { triangles, halfedges } = delaunay;
  const triCount = Math.floor(triangles.length / 3);
  const nodeOfTri = new Int32Array(triCount).fill(-1);
  const nodes: MedialNode[] = [];
  const byCoord = new Map<string, number>();
  for (let t = 0; t < triCount; t++) {
    const s0 = samples[triangles[3 * t]!]!;
    const s1 = samples[triangles[3 * t + 1]!]!;
    const s2 = samples[triangles[3 * t + 2]!]!;
    const cc = circumcircle(s0, s1, s2);
    if (!cc || !pointInPolygon(cc, face.polygon)) continue;
    const key = `${Math.round(cc.x * 256)}:${Math.round(cc.y * 256)}`;
    let id = byCoord.get(key);
    if (id === undefined) {
      id = nodes.length;
      byCoord.set(key, id);
      nodes.push({ x: cc.x, y: cc.y, width: 2 * cc.r, adj: [], alive: true });
    }
    nodeOfTri[t] = id;
  }
  for (let e = 0; e < halfedges.length; e++) {
    const twin = halfedges[e]!;
    if (twin < e) continue; // covers -1 (hull edges) and double-visits
    const a = nodeOfTri[Math.floor(e / 3)]!;
    const b = nodeOfTri[Math.floor(twin / 3)]!;
    if (a < 0 || b < 0 || a === b) continue;
    if (!nodes[a]!.adj.includes(b)) {
      nodes[a]!.adj.push(b);
      nodes[b]!.adj.push(a);
    }
  }
  return processMedialGraph(face, options, nodes, samples, step, final, includeCuts);
}

/**
 * Shared graph→axes machinery: connectivity, port attachment, ink-coverage
 * pruning, primary/limb extraction, and the quality gates. Works on any
 * medial-like node graph — Voronoi circumcenters (attemptMedialAxes) or an
 * exact straight-skeleton spine (segmentAxesFromMedialGraph). `samples` are
 * wall points for the coverage gate; pass [] when `final` (the gate is
 * refine-only). `exactWidths` marks graphs whose node widths are trustworthy
 * inscribed diameters at every node (no sampling noise) — the retrace width
 * cap is skipped for them.
 */
function processMedialGraph(
  face: Face,
  options: ResolvedGeometryOptions,
  nodes: MedialNode[],
  samples: Point[],
  step: number,
  final: boolean,
  includeCuts: boolean,
  exactWidths = false,
): Attempt {
  const spacing = options.resampleSpacing;
  const retry = final ? FAIL : REFINE;
  // Fewer than 4 Voronoi circumcenters means the sampling was too coarse for
  // the face — but an EXACT graph that small is simply a complete skeleton of
  // a simple shape (a rectangle's spine is exactly 2 vertices).
  if (nodes.length < (exactWidths ? 2 : 4)) return retry;

  // Circumcircles are empty of SAMPLES, not of the continuous boundary —
  // near the open cut mouth a disk spills through the sample-free gap and
  // measures far past the true inscribed size, and its bogus radius then
  // poisons every disk-based decision below (pruning, limb coverage, retrace
  // caps). Clamp each node to the inscribed bound now: 2× the distance to
  // the nearest WALL edge (cuts are not boundary).
  {
    const n = face.polygon.length;
    for (const node of nodes) {
      let wall = Infinity;
      for (let i = 0; i < n; i++) {
        if (face.edgeCutIds[i]! >= 0) continue;
        wall = Math.min(wall, distToSegment(node, face.polygon[i]!, face.polygon[(i + 1) % n]!));
      }
      if (Number.isFinite(wall)) node.width = Math.min(node.width, 2 * wall);
    }
  }

  // ── Connectivity ────────────────────────────────────────────────────────
  // Regions thinner than the sample step keep no interior circumcenter, so
  // hairline necks split the graph. Prefer refining (denser samples restore
  // the true medial through the neck); on the final attempt bridge nearest
  // pairs — the face is simply connected, so separate components always sit
  // across such a neck and no blob may be dropped.
  {
    const comp = new Int32Array(nodes.length).fill(-1);
    let count = 0;
    for (let i = 0; i < nodes.length; i++) {
      if (comp[i]! >= 0) continue;
      const stack = [i];
      comp[i] = count;
      while (stack.length) {
        const cur = stack.pop()!;
        for (const o of nodes[cur]!.adj) {
          if (comp[o]! < 0) {
            comp[o] = count;
            stack.push(o);
          }
        }
      }
      count++;
    }
    if (count > 1 && !final) return REFINE;
    while (count > 1) {
      let ba = -1;
      let bb = -1;
      let bd = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          if (comp[i]! === comp[j]!) continue;
          const d = dist(nodes[i]!, nodes[j]!);
          if (d < bd) {
            bd = d;
            ba = i;
            bb = j;
          }
        }
      }
      nodes[ba]!.adj.push(bb);
      nodes[bb]!.adj.push(ba);
      const absorbed = comp[bb]!;
      for (let i = 0; i < nodes.length; i++) if (comp[i]! === absorbed) comp[i] = comp[ba]!;
      count--;
    }
  }

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
    // The sanity bound on port attachment must NOT scale with the sample
    // step: refinement would then make acceptance stricter, and a face that
    // legitimately keeps its nodes far from a slanted cut's midpoint (て's
    // crossing face — the wedge along the cut is sample-free) bails on the
    // final attempt only. Scale by spacing (face geometry), matching the
    // base-step behavior.
    if (best < 0 || bestD > span + 2 * spacing) return retry;
    ports.push({ node: best, cutId: run.cutId, mid, span });
  }
  const portIds = new Set(ports.map((p) => p.node));

  // ── Pruning: cap forks and wall-noise spurs ─────────────────────────────
  // A leaf chain is an artifact when it is below the sampling noise floor or
  // never sweeps real ink beyond its attachment's inscribed disk. Judged by
  // pen coverage (chainEscapes), NOT arc length vs attach width: a genuinely
  // inked short limb off a thick crotch (r's bottom leg) has a small arc yet
  // carries pen-sized disks well outside the disk.
  //
  // Exact graphs prune in ONE deferred pass: every leaf chain there is real
  // geometry, and the iterative cascade erodes a tapering tip one
  // sub-threshold bite at a time (r's stem tip lost 16 units to three
  // consecutive prunes, each individually under the noise floor, and the
  // straight tip ray from the fat surviving leaf could not follow the curve
  // back down). A single pass bounds the total loss to one threshold.
  // Sampled graphs keep the cascade — removing an outer spur exposes more
  // spur noise, not more shape.
  for (let changed = true; changed; ) {
    changed = false;
    const deferredKills: number[][] = [];
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
      const attach = { x: nodes[cur]!.x, y: nodes[cur]!.y, radius: nodes[cur]!.width / 2 };
      if (len <= 2 * step || !chainEscapes(nodes, chain, [attach], spacing)) {
        if (exactWidths) {
          deferredKills.push(chain);
        } else {
          for (const id of chain) nodes[id]!.alive = false;
          changed = true;
        }
      }
    }
    if (exactWidths) {
      for (const chain of deferredKills) for (const id of chain) nodes[id]!.alive = false;
      break;
    }
  }
  const alive = nodes.filter((n) => n.alive).length;
  if (alive < 2 || ports.some((p) => !nodes[p.node]!.alive)) return retry;

  // ── Primary path by port count ──────────────────────────────────────────
  let primaryIds: number[];
  if (ports.length === 2) {
    const { distTo, prev } = dijkstra(nodes, [ports[0]!.node]);
    if (!Number.isFinite(distTo[ports[1]!.node]!)) return retry;
    // Cuts sharing a corner can map both ports onto ONE node — a 1-node
    // primary is fine here, the exact cut midpoints below give it extent.
    primaryIds = walkPath(prev, ports[1]!.node);
  } else if (ports.length === 1) {
    const { distTo, prev } = dijkstra(nodes, [ports[0]!.node]);
    let far = ports[0]!.node;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i]!.alive && Number.isFinite(distTo[i]!) && distTo[i]! > distTo[far]!) far = i;
    }
    if (far === ports[0]!.node) return retry;
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
    if (a === b) return retry;
    primaryIds = walkPath(second.prev, b);
  }
  if (primaryIds.length < 2 && ports.length !== 2) return retry;

  // ── Leftover leaves: retrace into a 2-port primary, else branch ─────────
  const onPrimary = new Set(primaryIds);
  const { distTo: dPrim, prev: pPrim } = dijkstra(nodes, primaryIds);
  interface Limb {
    attach: number;
    ids: number[]; // attach → leaf
    len: number;
  }
  // A limb that never sweeps ink beyond the pen's pass over the primary
  // (cap forks, mouth-corner spurs) adds nothing — only unreached limbs
  // become retraces or branches. Port disks count as covered — the stroke
  // crosses the cut inking mouth corners — but at the honest inscribed
  // width, NOT the raw cut span: a bogus over-long cut (r's slanted leg
  // cut spans 215 units) would otherwise claim coverage the pen never
  // delivers and swallow real limbs.
  const coverRefs = [
    ...primaryIds.map((id) => ({ x: nodes[id]!.x, y: nodes[id]!.y, radius: nodes[id]!.width / 2 })),
    ...ports.map((p) => ({ x: p.mid.x, y: p.mid.y, radius: Math.min(p.span, nodes[p.node]!.width) / 2 })),
  ];
  const limbs: Limb[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i]!.alive || onPrimary.has(i) || aliveDegree(nodes, i) !== 1) continue;
    if (!Number.isFinite(dPrim[i]!)) continue;
    const ids = walkPath(pPrim, i); // starts at a primary node
    if (ids.length < 2) continue;
    const len = dPrim[i]!;
    if (len < Math.max(2 * step, spacing)) continue;
    if (!chainEscapes(nodes, ids.slice(1), coverRefs, spacing)) continue;
    limbs.push({ attach: ids[0]!, ids, len });
  }

  // Track how far straight tip extensions have to reach: a long shortfall
  // means the sampling missed a (possibly curved) thin tail — refine instead.
  let maxShortfall = 0;

  // Limb disposition: 2-port faces retrace EVERY limb (the stroke enters and
  // leaves through the cuts, so even a long lobe is drawn out-and-back), and
  // short limbs retrace regardless of ports — a Mincho uroko or a pressure
  // tip is the parent stroke's finishing flick, not a stroke of its own.
  // Only limbs longer than their attachment is wide become branch strokes.
  // Full-boundary mode also retraces everything: sampled cut corners create
  // artificial medial forks near the mouths, and promoting one to a branch
  // invents a phantom stroke (9's tail tip grew a free-free sliver).
  const retraced = limbs.map((limb) => includeCuts || ports.length === 2 || limb.len <= 1.25 * nodes[limb.attach]!.width);

  const primaryAxis: AxisPoint[] = [];
  for (const id of primaryIds) {
    primaryAxis.push({ x: nodes[id]!.x, y: nodes[id]!.y, width: nodes[id]!.width });
    // Retrace limbs at their attachment, capped at the attachment width so
    // the out-and-back pass draws at the local stroke width. Exact graphs
    // skip the cap: their widths are honest everywhere, and the attach node
    // of a straight-skeleton fork can sit OFF-CENTER near a cut mouth (a
    // wall-cut bisector vertex) — れ's w46 stem drew at w27 when the cap
    // propagated that one thin node down the whole limb.
    for (let k = 0; k < limbs.length; k++) {
      const limb = limbs[k]!;
      if (!retraced[k] || limb.attach !== id) continue;
      const capW = exactWidths ? Infinity : nodes[id]!.width;
      const out = toAxis(nodes, limb.ids).map((p) => ({ ...p, width: Math.min(p.width, capW) }));
      maxShortfall = Math.max(maxShortfall, extendFreeTip(out, false, face.polygon, spacing));
      primaryAxis.push(...out.slice(1));
      primaryAxis.push(...out.slice(0, -1).reverse());
    }
  }

  // Free (portless) primary ends reach for the tip they point at.
  if (ports.length <= 1) maxShortfall = Math.max(maxShortfall, extendFreeTip(primaryAxis, false, face.polygon, spacing));
  if (ports.length === 0) maxShortfall = Math.max(maxShortfall, extendFreeTip(primaryAxis, true, face.polygon, spacing));

  // Exact cut endpoints (the medial stops at the last node before the mouth;
  // the stroke must reach the cross-section it continues through). Width is
  // capped near the honest local size — a lengthwise fold cut spans far more
  // than the stroke is wide, and the raw span would survive the boundary
  // clamp (cuts are not walls) as a fat blob in the rendered stroke. The 2×
  // headroom keeps transverse mouths (where the port node sits half a width
  // inside and under-measures) at their true span.
  const portWidth = (p: (typeof ports)[number]) => Math.min(p.span, 2 * nodes[p.node]!.width);
  if (ports.length >= 1) primaryAxis.unshift({ ...ports[0]!.mid, width: portWidth(ports[0]!) });
  if (ports.length === 2) primaryAxis.push({ ...ports[1]!.mid, width: portWidth(ports[1]!) });

  const branchAxes: AxisPoint[][] = [];
  for (let k = 0; k < limbs.length; k++) {
    if (retraced[k]) continue;
    // Branch convention: tip first (leaf → attachment).
    const axis = toAxis(nodes, [...limbs[k]!.ids].reverse());
    maxShortfall = Math.max(maxShortfall, extendFreeTip(axis, true, face.polygon, spacing));
    branchAxes.push(axis);
  }
  if (!final && maxShortfall > 4 * step) return REFINE;

  const primary = dedupe(primaryAxis);
  if (primary.length < 2) return retry;
  const startCut = ports.length >= 1 ? ports[0]!.cutId : -1;
  const endCut = ports.length === 2 ? ports[1]!.cutId : -1;
  const infos: SegmentInfo[] = [{ faceId: face.id, axis: primary, isLoop: false, ends: buildEnds(primary, startCut, endCut, spacing) }];
  for (const raw of branchAxes) {
    const axis = dedupe(raw);
    if (axis.length < 2) continue;
    infos.push({ faceId: face.id, axis, isLoop: false, ends: buildEnds(axis, -1, -1, spacing) });
  }

  // ── Quality gates (refine-only): the graph exists, but is it honest? ────
  // ── Quality gates: the graph exists, but is it honest? ──────────────────
  // Sparse-sample jitter: a ported path is a corridor centerline and locally
  // smooth — dense sampling gives per-step turns of a few degrees, and even
  // a genuine corner face bends sharply once or twice. REPEATED sharp
  // reversals are Voronoi zigzag from wall samples that don't oppose the
  // path: S's small half-cut corridor face wobbled ±25 units with ~7
  // reversals, and 字's wing lens (one long cut under a single wall arc)
  // zigzagged 171 units inside a 94×38 face — its garbage port tangent
  // luckily merged with the cover stroke, and any change to it split the
  // glyph. Tortuosity is the wrong measure (S's own spine face runs 1.56×
  // its chord legitimately); 0-port primaries are exempt — a blob's tree
  // diameter turns sharply at skeleton junctions by construction. Retraces
  // live outside primaryIds, so out-and-back lobes don't count. On the
  // final wall-only attempt this FAILS to the chain fallback (whose
  // strip/turn/lobe/end-cap axes handle exactly these small mostly-cut
  // faces); full-boundary rescue keeps its result — its caller has already
  // proven the chain fallback drops ink.
  if (!includeCuts && ports.length >= 1) {
    let sharpTurns = 0;
    for (let i = 1; i + 1 < primaryIds.length; i++) {
      const a = nodes[primaryIds[i - 1]!]!;
      const b = nodes[primaryIds[i]!]!;
      const c = nodes[primaryIds[i + 1]!]!;
      const ab = normalize(sub(b, a));
      const bc = normalize(sub(c, b));
      if (ab.x * bc.x + ab.y * bc.y < Math.SQRT1_2) sharpTurns++;
    }
    if (sharpTurns >= 3) return retry;
  }
  if (!final) {
    // Pen coverage: a wall sample the produced axes cannot ink marks a thin
    // (usually CURVED) tail the graph missed — a straight tip extension
    // cannot follow a curling cap (G's top hook bends away from the exit
    // ray, which dies on the inner wall long before the apex). Only denser
    // sampling puts medial nodes inside the tail. The final attempt accepts
    // best effort, so a mouth corner a bogus over-long cut leaves genuinely
    // unreachable costs extra attempts, never a failure.
    const axes = infos.map((s) => s.axis);
    for (const s of samples) {
      if (!coveredByAxes(s, axes, 0.5 * spacing)) return REFINE;
    }
  }
  return { kind: 'ok', infos };
}

/**
 * Medial-axis based axes for a hole-free segment face: the primary axis plus
 * branch axes for every limb the medial tree reaches. Adaptively refines the
 * boundary sampling for shapes with sub-step thin parts. Returns null when
 * the face is too small or degenerate for a usable graph (callers fall back
 * to chain pairing).
 */
export function medialFaceAxes(face: Face, options: ResolvedGeometryOptions): SegmentInfo[] | null {
  let step = Math.max(3, options.resampleSpacing / 2);
  for (let attempt = 0; ; attempt++) {
    const final = attempt >= 2 || step <= 1.5;
    const result = attemptMedialAxes(face, options, step, final, false);
    if (result.kind === 'ok') return result.infos;
    if (final) return null;
    step = Math.max(1.5, step / 2);
  }
}

/**
 * Full-boundary medial rescue: like medialFaceAxes but samples CUT edges too,
 * in one final-mode attempt. For faces whose cuts ARE their shape — a hairpin
 * fold's cuts run LENGTHWISE along the stroke (え/る's tip wedge is two long
 * fold cuts plus a small nose cap), so wall-only sampling leaves the graph a
 * tiny cluster at the cap and the build bails, and the chain fallback then
 * truncates the tip. Cut samples wiggle port-end tangents (retraces land next
 * to ports and continuation pairing can misread the bend — Caveat 0's
 * crossing kernel splits), so callers must invoke this ONLY when the chain
 * fallback measurably fails to cover the face's ink.
 */
export function medialFaceAxesFullBoundary(face: Face, options: ResolvedGeometryOptions): SegmentInfo[] | null {
  const result = attemptMedialAxes(face, options, Math.max(3, options.resampleSpacing / 2), true, true);
  return result.kind === 'ok' ? result.infos : null;
}

/**
 * Axes from an externally built EXACT medial-like graph (the straight-skeleton
 * spine): one attempt, final semantics — the graph is not sampled, so denser
 * sampling cannot improve it; split components are bridged and best effort is
 * accepted. The jitter gate still fails dishonest ported primaries to the
 * chain fallback. Returns null when the graph is too small or rejected
 * (callers fall back to chain pairing).
 */
export function segmentAxesFromMedialGraph(face: Face, options: ResolvedGeometryOptions, nodes: MedialNode[]): SegmentInfo[] | null {
  const result = processMedialGraph(face, options, nodes, [], Math.max(3, options.resampleSpacing / 2), true, false, true);
  return result.kind === 'ok' ? result.infos : null;
}

/** A pen disk another stroke already sweeps (for limb suppression). */
export interface InkDisk {
  x: number;
  y: number;
  radius: number;
}

/**
 * Anchored axis extraction for a FINAL stroke recomputed on its fully merged
 * region (segment chains + the junction faces the stroke traverses). The
 * primary path runs between the graph nodes nearest the stroke's existing
 * endpoints — the stroke's identity (count, grouping, endpoints) is already
 * decided by assembly and must not change — and surviving limbs are retraced
 * in place. A limb whose ink `otherInk` (the OTHER strokes' pen disks)
 * already covers is suppressed: junction kernels are shared territory, and
 * the crossing stroke's corridor must not be double-drawn. Exact-graph
 * semantics throughout (deferred one-pass prune, uncapped retrace widths).
 */
export function anchoredAxisFromMedialGraph(
  face: Face,
  options: ResolvedGeometryOptions,
  nodes: MedialNode[],
  anchors: [AxisPoint, AxisPoint],
  otherInk: InkDisk[],
): AxisPoint[] | null {
  const spacing = options.resampleSpacing;
  const step = Math.max(3, spacing / 2);
  if (nodes.length < 2) return null;

  // Anchor nodes are the stroke's endpoints inside the region — protected
  // from pruning. A far-off anchor means the region does not actually
  // contain this stroke's end (bookkeeping mismatch) — bail.
  const anchorNode = anchors.map((a) => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = dist(nodes[i]!, a);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return bestD <= Math.max(a.width, 4 * spacing) ? best : -1;
  }) as [number, number];
  if (anchorNode[0] < 0 || anchorNode[1] < 0) return null;
  const protectedIds = new Set(anchorNode);

  // Deferred one-pass prune: wisps below the noise floor, plus leaf chains
  // whose ink the other strokes already sweep.
  {
    const kills: number[][] = [];
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i]!.alive || protectedIds.has(i) || aliveDegree(nodes, i) !== 1) continue;
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
        if (aliveDegree(nodes, cur) >= 3 || protectedIds.has(cur)) break;
        chain.push(cur);
      }
      const attach = { x: nodes[cur]!.x, y: nodes[cur]!.y, radius: nodes[cur]!.width / 2 };
      if (len <= 2 * step || !chainEscapes(nodes, chain, [attach, ...otherInk], spacing)) kills.push(chain);
    }
    for (const chain of kills) {
      for (const id of chain) if (!protectedIds.has(id)) nodes[id]!.alive = false;
    }
  }

  const { distTo, prev } = dijkstra(nodes, [anchorNode[0]]);
  if (!Number.isFinite(distTo[anchorNode[1]]!)) return null;
  const primaryIds = walkPath(prev, anchorNode[1]);

  // Leftover limbs retrace at their attachment — the stroke count is fixed
  // at this stage, so nothing may branch. Limbs the primary's own pen or the
  // other strokes already cover add nothing.
  const onPrimary = new Set(primaryIds);
  const { distTo: dPrim, prev: pPrim } = dijkstra(nodes, primaryIds);
  const coverRefs = [...primaryIds.map((id) => ({ x: nodes[id]!.x, y: nodes[id]!.y, radius: nodes[id]!.width / 2 })), ...otherInk];
  interface Limb {
    attach: number;
    ids: number[];
  }
  const limbs: Limb[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i]!.alive || onPrimary.has(i) || aliveDegree(nodes, i) !== 1) continue;
    if (!Number.isFinite(dPrim[i]!)) continue;
    const ids = walkPath(pPrim, i);
    if (ids.length < 2) continue;
    if (dPrim[i]! < Math.max(2 * step, spacing)) continue;
    if (!chainEscapes(nodes, ids.slice(1), coverRefs, spacing)) continue;
    limbs.push({ attach: ids[0]!, ids });
  }

  const axis: AxisPoint[] = [{ x: anchors[0].x, y: anchors[0].y, width: anchors[0].width }];
  for (const id of primaryIds) {
    axis.push({ x: nodes[id]!.x, y: nodes[id]!.y, width: nodes[id]!.width });
    for (const limb of limbs) {
      if (limb.attach !== id) continue;
      const out = toAxis(nodes, limb.ids);
      extendFreeTip(out, false, face.polygon, spacing);
      axis.push(...out.slice(1));
      axis.push(...out.slice(0, -1).reverse());
    }
  }
  axis.push({ x: anchors[1].x, y: anchors[1].y, width: anchors[1].width });
  const deduped = dedupe(axis);
  return deduped.length >= 2 ? deduped : null;
}
