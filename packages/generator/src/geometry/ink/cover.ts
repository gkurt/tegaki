// Stroke cover — turning the ink graph into pen strokes.
//
// JUNCTION ZONES. Near a junction the chordal axis is distorted: chords fan
// out of the concave corners, so the centerline bends toward the junction
// center no matter how the pen really moved. Each junction therefore claims a
// zone of `reach × inscribed radius` around its center; branch axes are
// trimmed where they enter it, so every branch END carries a tangent measured
// on clean stroke body. Junctions whose zones swallow the branch between them
// (the two junction triangles of an X, the stem-arm-leg knot of a K) merge
// into one junction CLUSTER.
//
// PAIRING. Inside a cluster the pen either passes through (two branch ends
// paired — the bar of a T, both diagonals of an X) or stops (an unpaired end
// — the T's stem). Each cluster is solved EXACTLY by enumerating every
// matching of its ends: a pairing costs its bend (gated at the continuation
// limit, concave so straight continuations dominate) plus width mismatch, an
// unpaired end costs half a pen lift. The
// total cost is a sum over clusters, so per-cluster optima are the global
// optimum — no greedy order dependence.
//
// GEOMETRY. A paired passage is a cubic Hermite curve between the two
// trimmed ends, leaving and arriving along their measured tangents — what a
// pen does through a crossing. An unpaired end runs on to its junction's
// center along the centerline it was trimmed of (a T's stem reaches the
// bar's centerline) — that path is the ink's own axis, so the junction's ink
// stays painted.
//
// ASSEMBLY. Branches are chained through paired ends into strokes: walks
// start at free ends (tips, unpaired ends); whatever remains is closed
// rings. Every alive branch is walked exactly once, so no ink the graph
// represents can be dropped.

import type { Point } from 'tegaki';
import { dist, dot, normalize, pointInRegion, polylineLength, sub } from '../primitives.ts';
import type { AxisPoint, Contour, GeoStroke } from '../types.ts';
import { type InkBranch, type InkGraph, withFlicks } from './graph.ts';

export interface CoverOptions {
  /** Junction zone radius as a multiple of the junction's inscribed radius. */
  junctionReach: number;
  /** cos(max bend) for a pass-through pairing. */
  continuationMinCos: number;
  /** Sampling step for passage curves and extensions (font units). */
  step: number;
}

/** One branch end opening into a junction cluster. */
export interface ClusterSlot {
  /** branchIndex * 2 + (0 = axis start, 1 = axis end). */
  key: number;
  point: AxisPoint;
  /** Unit travel direction when ENTERING the cluster from this branch. */
  direction: Point;
  /**
   * Arc length of this slot's branch when its far end is FREE (a tip — the
   * branch is a dead end the pen can dip into and come back out of), else
   * null.
   */
  deadEnd: number | null;
}

export interface JunctionCluster {
  /** Junction triangles merged into this cluster. */
  members: number[];
  center: Point;
  slots: ClusterSlot[];
  /** Accepted pass-through pairings (indices into `slots`). */
  pairs: [number, number][];
  /**
   * Per pairing, the dead-end slot retraced between its two ends (-1 for a
   * plain pass-through): the pen enters on the first slot, runs out to the
   * dead end's tip and back, and leaves on the second — the point of a V.
   */
  retraced: number[];
  /** Per pairing: a CUSP — the pen runs into the V between the two ends and reverses. */
  cusp: boolean[];
  /** Passage polyline per pairing, oriented from pairs[i][0] to pairs[i][1]. */
  passages: AxisPoint[][];
  /** Straight extension per slot (null when paired or none), ordered from the slot inward. */
  extensions: (AxisPoint[] | null)[];
  /** Triangles whose centerline was replaced by the cluster's passages. */
  zoneTris: number[];
}

export interface CoverResult {
  strokes: GeoStroke[];
  /** Branches after junction-zone trimming (internal branches removed). */
  branches: InkBranch[];
  clusters: JunctionCluster[];
}

class DSU {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b);
  }
}

/** Point `target` arc-length units from the start of `pts` (clamped). */
function pointAlong(pts: Point[], target: number): Point {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1]!, pts[i]!);
    if (acc + d >= target && d > 0) {
      const f = (target - acc) / d;
      return { x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * f, y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * f };
    }
    acc += d;
  }
  return pts[pts.length - 1]!;
}

const angleBetween = (a: Point, b: Point) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

/** Bend of the pen passing from slot a into slot b (radians), measured three ways, worst wins. */
function passageBend(a: ClusterSlot, b: ClusterSlot): number {
  // Straight through: a enters along d_a, leaves along −d_b.
  const turn = angleBetween(a.direction, { x: -b.direction.x, y: -b.direction.y });
  const gap = dist(a.point, b.point);
  if (gap < 1e-6) return turn;
  // The chord between the ends must agree with both tangents — two parallel
  // ends side by side (a U's arms) are aligned but would need a sideways jog.
  const chord = normalize(sub(b.point, a.point));
  const devA = angleBetween(a.direction, chord);
  const devB = angleBetween({ x: -b.direction.x, y: -b.direction.y }, chord);
  return Math.max(turn, devA, devB);
}

const UNPAIRED_COST = 0.75;
const WIDTH_WEIGHT = 0.5;
/** Retrace cost per stroke width of dead-end length traveled out and back. */
const RETRACE_WEIGHT = 0.2;
/** Longest dead end the pen retraces, in widths — longer ones are strokes of their own. */
const RETRACE_MAX_WIDTHS = 1.5;
/** Widest V (angle between the two entering directions) the pen turns around in. */
const CUSP_MAX_ANGLE = (100 * Math.PI) / 180;
const CUSP_BASE_COST = 0.45;
const CUSP_ANGLE_COST = 0.4;
const MAX_EXACT_SLOTS = 8;

export interface PairingSolution {
  pairs: [number, number][];
  /** Aligned with `pairs`: the retraced middle slot, or -1. */
  retraced: number[];
  /** Aligned with `pairs`: the pen reverses in a V between the two ends. */
  cusp: boolean[];
}

/**
 * Exact minimum-cost cover of a cluster's slots. Each slot is either
 * unpaired (the stroke ends here) or joined to another slot by one of three
 * pen moves:
 *
 * - PASS: straight(ish) through — bend gated at the continuation limit.
 * - CUSP: two ends entering side by side, pointing into a V (the valley of a
 *   cursive m, the point of a W): the pen runs in and reverses. Costs more
 *   than a gentle pass, less than two lifts.
 * - RETRACE: either move routed out along a short dead end and back (the V's
 *   pointed tip is its own little branch) — the dead end's ink is drawn
 *   twice instead of becoming a stroke of its own.
 *
 * Enumerated exhaustively (greedy pairs only beyond MAX_EXACT_SLOTS).
 */
export function solvePairing(slots: ClusterSlot[], minCos: number): PairingSolution {
  const maxBend = Math.acos(minCos);
  const n = slots.length;
  const pass: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(Infinity));
  const cusp: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = slots[i]!;
      const b = slots[j]!;
      const ratio = Math.min(a.point.width, b.point.width) / Math.max(a.point.width, b.point.width, 1e-9);
      const widthCost = WIDTH_WEIGHT * (1 - ratio);
      const bend = passageBend(a, b);
      // CONCAVE in the bend: one straight passage plus two lifts must beat
      // two moderately bent passages (k: the stem runs straight; arm and leg
      // do not each bend into half of it). Good continuation, not least
      // total squared turning.
      if (bend <= maxBend) pass[i]![j] = Math.sqrt(bend / maxBend) + widthCost;
      const opening = angleBetween(a.direction, b.direction);
      if (opening <= CUSP_MAX_ANGLE) cusp[i]![j] = CUSP_BASE_COST + CUSP_ANGLE_COST * (opening / CUSP_MAX_ANGLE) + widthCost;
    }
  }
  // A cusp needs evidence of the V's point: normally its own little dead-end
  // branch (the retrace triple below). Without one, the direction the V
  // points in is taken by another branch (e's tail beyond the bar/loop
  // meeting), and the pen passes into it instead. Only a two-slot cluster —
  // nothing else to continue into — may cusp bare.
  const bareCusp = (i: number, j: number) => (n === 2 ? cusp[i]![j]! : Infinity);
  const pairCost = (i: number, j: number) => Math.min(pass[i]![j]!, bareCusp(i, j));
  const retraceCost = (s: number): number => {
    const slot = slots[s]!;
    if (slot.deadEnd === null) return Infinity;
    const widths = slot.deadEnd / Math.max(slot.point.width, 1e-9);
    return widths > RETRACE_MAX_WIDTHS ? Infinity : RETRACE_WEIGHT * widths;
  };
  // a → dead end s → b: pass into the dead end and back out, or a cusp whose
  // V the dead end is the pointed tip of.
  const tripleCost = (a: number, s: number, b: number) => Math.min(pass[a]![s]! + pass[s]![b]!, cusp[a]![b]!) + retraceCost(s);

  if (n > MAX_EXACT_SLOTS) {
    const cands: [number, number, number][] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (pass[i]![j]! < 2 * UNPAIRED_COST) cands.push([i, j, pass[i]![j]!]);
    cands.sort((a, b) => a[2] - b[2]);
    const used = new Set<number>();
    const pairs: [number, number][] = [];
    for (const [i, j] of cands) {
      if (used.has(i) || used.has(j)) continue;
      used.add(i);
      used.add(j);
      pairs.push([i, j]);
    }
    return { pairs, retraced: pairs.map(() => -1), cusp: pairs.map(() => false) };
  }

  let best: PairingSolution = { pairs: [], retraced: [], cusp: [] };
  let bestCost = Infinity;
  const used = new Uint8Array(n);
  const cur: PairingSolution = { pairs: [], retraced: [], cusp: [] };
  const recurse = (acc: number) => {
    if (acc >= bestCost) return;
    let i = 0;
    while (i < n && used[i]) i++;
    if (i === n) {
      bestCost = acc;
      best = { pairs: cur.pairs.map((p) => [p[0], p[1]]), retraced: [...cur.retraced], cusp: [...cur.cusp] };
      return;
    }
    const take = (a: number, mid: number, b: number, c: number, isCusp: boolean) => {
      if (!Number.isFinite(c)) return;
      used[a] = used[b] = 1;
      if (mid >= 0) used[mid] = 1;
      cur.pairs.push([a, b]);
      cur.retraced.push(mid);
      cur.cusp.push(isCusp);
      recurse(acc + c);
      cur.pairs.pop();
      cur.retraced.pop();
      cur.cusp.pop();
      used[a] = used[b] = 0;
      if (mid >= 0) used[mid] = 0;
    };
    used[i] = 1;
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      take(i, -1, j, pairCost(i, j), bareCusp(i, j) < pass[i]![j]!);
      for (let k = i + 1; k < n; k++) {
        if (used[k] || k === j) continue;
        take(i, k, j, tripleCost(i, k, j), false); // i → dead end k → j
        if (j < k) take(j, i, k, tripleCost(j, i, k), false); // i is the dead end between j and k
      }
    }
    used[i] = 1;
    recurse(acc + UNPAIRED_COST);
    used[i] = 0;
  };
  recurse(0);
  return best;
}

/** Cubic Hermite passage from slot a to slot b along their tangents. */
function passageCurve(a: ClusterSlot, b: ClusterSlot, g: InkGraph, step: number): AxisPoint[] {
  const p0 = a.point;
  const p3 = b.point;
  const span = dist(p0, p3);
  const h = span / 3;
  const p1 = { x: p0.x + a.direction.x * h, y: p0.y + a.direction.y * h };
  const p2 = { x: p3.x + b.direction.x * h, y: p3.y + b.direction.y * h };
  const count = Math.max(2, Math.ceil(span / step) + 1);
  const out: AxisPoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const u = 1 - t;
    const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
    const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
    const lerped = p0.width + (p3.width - p0.width) * t;
    // Never paint outside the outline, whatever the interpolation says.
    const inscribed = 2 * g.boundary.nearest({ x, y });
    out.push({ x, y, width: Math.min(lerped, inscribed) });
  }
  return out;
}

function segmentHit(p: Point, d: Point, a: Point, b: Point): number | null {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denom = d.x * sy - d.y * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const qx = a.x - p.x;
  const qy = a.y - p.y;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * d.y - qy * d.x) / denom;
  return t > 1e-6 && u >= 0 && u <= 1 ? t : null;
}

/** Straight extension of an unpaired slot toward the cluster center (see file header). */
function extension(slot: ClusterSlot, cluster: JunctionCluster, g: InkGraph, contours: Contour[], step: number): AxisPoint[] | null {
  const d = slot.direction;
  let length = dot(sub(cluster.center, slot.point), d);
  for (const passage of cluster.passages) {
    for (let i = 1; i < passage.length; i++) {
      const t = segmentHit(slot.point, d, passage[i - 1]!, passage[i]!);
      if (t != null && t < length) length = t;
    }
  }
  if (length <= step * 0.5) return null;
  const out: AxisPoint[] = [slot.point];
  const count = Math.ceil(length / step);
  for (let i = 1; i <= count; i++) {
    const s = (length * i) / count;
    const p = { x: slot.point.x + d.x * s, y: slot.point.y + d.y * s };
    if (!pointInRegion(p, contours)) break;
    out.push({ ...p, width: Math.min(slot.point.width, 2 * g.boundary.nearest(p)) });
  }
  return out.length >= 2 ? out : null;
}

export function coverInkGraph(g: InkGraph, rawBranches: InkBranch[], contours: Contour[], options: CoverOptions): CoverResult {
  const { junctionReach, continuationMinCos, step } = options;
  const isJunction = (t: number) => t >= 0 && g.alive[t] === 1 && g.deg[t]! >= 3;
  const junctionTris = [...new Set(rawBranches.flatMap((b) => [b.from, b.to]).filter(isJunction))];
  const junctionIndex = new Map(junctionTris.map((t, i) => [t, i]));
  const reach = (t: number) => junctionReach * g.radius[t]!;
  const dsu = new DSU(junctionTris.length);

  // ── Trim branch ends at junction zones ────────────────────────────────
  const branches: InkBranch[] = [];
  // Triangles each trimmed branch lost at its start / end (junction zone
  // territory), and the centerline it lost there, ordered from the kept end
  // INTO the junction (the route an unpaired end takes to the center).
  const trimmedAt: [number[], number[]][] = [];
  const trimmedAxis: [AxisPoint[], AxisPoint[]][] = [];
  const internal: InkBranch[] = [];
  for (const b of rawBranches) {
    if (b.isCycle) {
      branches.push(b);
      trimmedAt.push([[], []]);
      trimmedAxis.push([[], []]);
      continue;
    }
    const n = b.axis.length;
    let i0 = 0;
    let i1 = n - 1;
    if (isJunction(b.from)) {
      const c = g.center[b.from]!;
      while (i0 < n && dist(b.axis[i0]!, c) < reach(b.from)) i0++;
    }
    if (isJunction(b.to)) {
      const c = g.center[b.to]!;
      while (i1 >= 0 && dist(b.axis[i1]!, c) < reach(b.to)) i1--;
    }
    if (i0 > i1) {
      if (isJunction(b.from) && isJunction(b.to)) {
        dsu.union(junctionIndex.get(b.from)!, junctionIndex.get(b.to)!);
        internal.push(b);
        continue;
      }
      // Junction-to-tip branch shorter than the zone: keep the tip as the end.
      if (isJunction(b.from)) i0 = i1 = n - 1;
      else i0 = i1 = 0;
    }
    branches.push({
      ...b,
      axis: b.axis.slice(i0, i1 + 1),
      axisTri: b.axisTri.slice(i0, i1 + 1),
      flicks: b.flicks.filter((f) => f.index >= i0 && f.index <= i1).map((f) => ({ ...f, index: f.index - i0 })),
    });
    trimmedAt.push([b.axisTri.slice(0, i0), b.axisTri.slice(i1 + 1)]);
    trimmedAxis.push([b.axis.slice(0, i0).reverse(), b.axis.slice(i1 + 1)]);
  }

  // ── Clusters ───────────────────────────────────────────────────────────
  const clusterOfRoot = new Map<number, number>();
  const clusters: JunctionCluster[] = [];
  junctionTris.forEach((t, i) => {
    const root = dsu.find(i);
    let ci = clusterOfRoot.get(root);
    if (ci === undefined) {
      ci = clusters.length;
      clusterOfRoot.set(root, ci);
      clusters.push({
        members: [],
        center: { x: 0, y: 0 },
        slots: [],
        pairs: [],
        retraced: [],
        cusp: [],
        passages: [],
        extensions: [],
        zoneTris: [],
      });
    }
    clusters[ci]!.members.push(t);
  });
  const clusterOf = (t: number) => clusterOfRoot.get(dsu.find(junctionIndex.get(t)!))!;
  for (const cl of clusters) {
    let x = 0;
    let y = 0;
    for (const t of cl.members) {
      x += g.center[t]!.x;
      y += g.center[t]!.y;
      cl.zoneTris.push(t, ...g.absorbed[t]!);
    }
    cl.center = { x: x / cl.members.length, y: y / cl.members.length };
  }
  for (const b of internal) {
    const cl = clusters[clusterOf(b.from)]!;
    for (const t of b.tris) cl.zoneTris.push(t, ...g.absorbed[t]!);
  }

  // ── Slots: each trimmed branch end at a cluster ────────────────────────
  const slotOf = new Map<number, { cluster: number; slot: number }>();
  branches.forEach((b, bi) => {
    if (b.isCycle) return;
    for (const end of [0, 1] as const) {
      const node = end === 0 ? b.from : b.to;
      if (!isJunction(node)) continue;
      const ci = clusterOf(node);
      const cl = clusters[ci]!;
      const axis = end === 0 ? b.axis : [...b.axis].reverse();
      const point = axis[0]!;
      // Tangent from clean body: look back at least a couple of widths.
      const back = pointAlong(axis, Math.max(1.5 * point.width, 3 * step));
      let direction = normalize(sub(point, back));
      if (dist(point, back) < 1e-6) direction = normalize(sub(cl.center, point));
      const far = end === 0 ? b.to : b.from;
      const deadEnd = far !== node && !isJunction(far) && g.deg[far]! <= 1 ? polylineLength(b.axis) : null;
      slotOf.set(bi * 2 + end, { cluster: ci, slot: cl.slots.length });
      cl.slots.push({ key: bi * 2 + end, point, direction, deadEnd });
      // Triangles trimmed off this end belong to the cluster zone.
      cl.zoneTris.push(...trimmedAt[bi]![end]!);
    }
  });

  // ── Solve each cluster; build passages and extensions ─────────────────
  for (const cl of clusters) {
    const solution = solvePairing(cl.slots, continuationMinCos);
    cl.pairs = solution.pairs;
    cl.retraced = solution.retraced;
    cl.cusp = solution.cusp;
    cl.passages = cl.pairs.map(([i, j], pi) => {
      const mid = cl.retraced[pi]!;
      if (mid < 0 && cl.cusp[pi]) {
        // Into the V and back out: arrive at the cluster center along the
        // bisector of the two entering directions, reverse, leave.
        const a = cl.slots[i]!;
        const b = cl.slots[j]!;
        const bisector = normalize({ x: a.direction.x + b.direction.x, y: a.direction.y + b.direction.y });
        const apex: ClusterSlot = {
          key: -1,
          point: { ...cl.center, width: 2 * g.boundary.nearest(cl.center) },
          direction: { x: -bisector.x, y: -bisector.y },
          deadEnd: null,
        };
        return [...passageCurve(a, apex, g, step), ...passageCurve(apex, b, g, step)];
      }
      if (mid < 0) return passageCurve(cl.slots[i]!, cl.slots[j]!, g, step);
      // Out along the dead end to its tip and back: its branch axis oriented
      // away from the cluster, then reversed.
      const key = cl.slots[mid]!.key;
      const spur = branches[Math.floor(key / 2)]!;
      const spurAxis = [...withFlicks(spur.axis, spur.flicks, key % 2 === 1), ...(spur.endFlicks[1 - (key % 2)] ?? [])];
      return [
        ...passageCurve(cl.slots[i]!, cl.slots[mid]!, g, step),
        ...spurAxis,
        ...[...spurAxis].reverse(),
        ...passageCurve(cl.slots[mid]!, cl.slots[j]!, g, step),
      ];
    });
    const paired = new Set([...cl.pairs.flat(), ...cl.retraced.filter((m) => m >= 0)]);
    cl.extensions = cl.slots.map((slot, si) => {
      if (paired.has(si)) return null;
      // An unpaired end runs on to its junction's center along the
      // centerline it was trimmed of: distorted for TANGENTS, but it is the
      // ink's own axis, so it paints the junction the way the chordal axis
      // does. Only a branch that lost nothing (a tip-only stub) falls back
      // to the straight ray.
      const bi = Math.floor(slot.key / 2);
      const lost = trimmedAxis[bi]?.[slot.key % 2] ?? [];
      if (lost.length > 0) return [slot.point, ...lost];
      return extension(slot, cl, g, contours, step);
    });
  }

  // ── Assembly ───────────────────────────────────────────────────────────
  const partner = new Map<number, { key: number; passage: AxisPoint[] }>();
  for (const cl of clusters) {
    cl.pairs.forEach(([i, j], pi) => {
      const passage = cl.passages[pi]!;
      partner.set(cl.slots[i]!.key, { key: cl.slots[j]!.key, passage });
      partner.set(cl.slots[j]!.key, { key: cl.slots[i]!.key, passage: [...passage].reverse() });
    });
  }
  const extensionOf = (key: number): AxisPoint[] | null => {
    const s = slotOf.get(key);
    return s ? (clusters[s.cluster]!.extensions[s.slot] ?? null) : null;
  };
  const append = (dst: AxisPoint[], src: AxisPoint[]) => {
    for (const p of src) {
      const last = dst[dst.length - 1];
      if (last && dist(last, p) < 1e-6) continue;
      dst.push({ ...p });
    }
  };

  const visited = new Uint8Array(branches.length);
  // Retraced dead ends are drawn inside their passage.
  for (const cl of clusters) for (const mid of cl.retraced) if (mid >= 0) visited[Math.floor(cl.slots[mid]!.key / 2)] = 1;
  const strokes: GeoStroke[] = [];
  const walkFrom = (startBranch: number, startEnd: 0 | 1): GeoStroke => {
    const points: AxisPoint[] = [];
    const segs: number[] = [];
    const startExt = extensionOf(startBranch * 2 + startEnd);
    if (startExt) append(points, [...startExt].reverse());
    else append(points, [...(branches[startBranch]!.endFlicks[startEnd] ?? [])].reverse());
    let bi = startBranch;
    let end: 0 | 1 = startEnd;
    let isLoop = false;
    for (let guard = branches.length + 1; guard > 0; guard--) {
      visited[bi] = 1;
      segs.push(bi);
      append(points, withFlicks(branches[bi]!.axis, branches[bi]!.flicks, end === 1));
      const outKey = bi * 2 + (1 - end);
      const next = partner.get(outKey);
      if (!next) {
        append(points, extensionOf(outKey) ?? branches[bi]!.endFlicks[1 - end] ?? []);
        break;
      }
      append(points, next.passage);
      const nb = Math.floor(next.key / 2);
      if (visited[nb]) {
        isLoop = nb === startBranch && next.key === startBranch * 2 + startEnd;
        break;
      }
      bi = nb;
      end = (next.key % 2) as 0 | 1;
    }
    if (isLoop && points.length > 1) points.push({ ...points[0]! });
    return { points, isLoop, segmentIndices: segs };
  };

  // Open walks from free ends: tips, isolated dots, and unpaired cluster slots.
  branches.forEach((b, bi) => {
    if (b.isCycle || visited[bi]) return;
    for (const end of [0, 1] as const) {
      if (visited[bi]) break;
      if (partner.has(bi * 2 + end)) continue;
      strokes.push(walkFrom(bi, end));
    }
  });
  // Whatever remains closes on itself: node-less rings and fully paired chains.
  branches.forEach((b, bi) => {
    if (visited[bi]) return;
    if (b.isCycle) {
      visited[bi] = 1;
      strokes.push({ points: withFlicks(b.axis, b.flicks, false).map((p) => ({ ...p })), isLoop: true, segmentIndices: [bi] });
      return;
    }
    strokes.push(walkFrom(bi, 0));
  });

  return { strokes, branches, clusters };
}
