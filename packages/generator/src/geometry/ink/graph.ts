// Ink graph — the stroke topology read off the ink mesh.
//
// Triangles are the vertices of a graph whose edges are shared chords. For a
// simply connected region that graph is a tree; each hole adds one cycle.
// Tips have degree 1, sleeves degree 2, junctions degree 3. Maximal runs of
// sleeves between non-sleeve triangles are the BRANCHES — pieces of stroke
// body with a clean centerline (their chord midpoints).
//
// Outline noise creates spurious branches: a sharp convex corner, a fillet
// or a small bump gets its own tip ear, which turns the neighbouring sleeve
// into a junction with a spur. Spurs are pruned by the one criterion that
// matters for a pen: INK. A subtree hanging off a node is removed only when
// every triangle it spans lies (up to a tolerance) inside the node's
// inscribed disk — i.e. a pen passing through the node center already
// paints it. The node then becomes a pass-through ("hub") or an end whose
// center stays on the centerline, so the absorbed ink remains covered by
// construction. Nothing is removed for any other reason.

import type { Point } from 'tegaki';
import { dist } from '../primitives.ts';
import type { AxisPoint } from '../types.ts';
import { type InkMesh, sharedEdgeMidpoint, triangleKind, trianglePoints } from './mesh.ts';
import type { SegmentIndex } from './spatial.ts';

export interface InkGraph {
  mesh: InkMesh;
  boundary: SegmentIndex;
  /** Triangle still carries graph structure (not absorbed into a junction). */
  alive: Uint8Array;
  /** Number of alive chord neighbours. */
  deg: Int32Array;
  /**
   * Characteristic point per triangle: inscribed center for junctions and
   * isolated triangles, the cap apex for tips, the centroid for sleeves.
   */
  center: Point[];
  /** Inscribed radius at `center` (0 at a tip apex, which sits on the outline). */
  radius: Float64Array;
  /** Original classification, before pruning changed any degree. */
  kind: ReturnType<typeof triangleKind>[];
  /** Alive triangle → triangles it absorbed while pruning spurs. */
  absorbed: number[][];
  /**
   * Alive triangle → per absorbed subtree, the centerline from the node out
   * to that subtree's deepest ink (its farthest outline vertex), and how far
   * that vertex pokes beyond the node's disk. Pruning decides STRUCTURE; the
   * flick keeps the ear's ink reachable (a tapered tip, the point of a V).
   */
  flicks: Flick[][];
}

export interface Flick {
  /** From the node outward: chord midpoints, ending ON the deepest outline vertex (width 0). */
  path: AxisPoint[];
  /** How far the deepest vertex lies beyond the node's disk. */
  poke: number;
}

/** A run of triangles between two graph nodes, with its centerline. */
export interface InkBranch {
  /** Node triangle at axis[0] (-1 for a node-less cycle). */
  from: number;
  /** Node triangle at the axis end (-1 for a node-less cycle). */
  to: number;
  /** Every triangle along the branch, `from` and `to` included. */
  tris: number[];
  axis: AxisPoint[];
  /** For each axis point, the triangle it was read from. */
  axisTri: number[];
  /** A closed ring with no nodes (an O's annulus). */
  isCycle: boolean;
  /**
   * Flicks drawn out-and-back mid-branch: each hangs off the hub center at
   * `axis[index]`. Kept OUT of the axis so tangents, lengths and trimming
   * read clean stroke body; strokes expand them on assembly (withFlicks).
   */
  flicks: { index: number; path: AxisPoint[] }[];
  /** Per end (axis start / axis end): the flick out past that end node's center to its tip, or null. */
  endFlicks: [AxisPoint[] | null, AxisPoint[] | null];
}

/**
 * A branch axis with its mid-branch flicks expanded in place (each out to its
 * tip and back to the hub), optionally reversed.
 */
export function withFlicks(axis: AxisPoint[], flicks: InkBranch['flicks'], reversed: boolean): AxisPoint[] {
  const at = new Map<number, AxisPoint[][]>();
  for (const f of flicks) at.set(f.index, [...(at.get(f.index) ?? []), f.path]);
  const out: AxisPoint[] = [];
  const n = axis.length;
  for (let k = 0; k < n; k++) {
    const i = reversed ? n - 1 - k : k;
    out.push(axis[i]!);
    for (const path of at.get(i) ?? []) {
      out.push(...path, ...path.slice(0, -1).reverse(), axis[i]!);
    }
  }
  return out;
}

function inscribedCenter(a: Point, b: Point, c: Point): Point {
  // Circumcenter when it lies inside the triangle (acute: it IS the local
  // maximal inscribed disk center w.r.t. the samples); otherwise the midpoint
  // of the longest edge, the closest the triangle gets to that center.
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) > 1e-12) {
    const a2 = a.x * a.x + a.y * a.y;
    const b2 = b.x * b.x + b.y * b.y;
    const c2 = c.x * c.x + c.y * c.y;
    const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
    const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    const s1 = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    const s2 = (c.x - b.x) * (y - b.y) - (c.y - b.y) * (x - b.x);
    const s3 = (a.x - c.x) * (y - c.y) - (a.y - c.y) * (x - c.x);
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return { x, y };
  }
  const edges: [Point, Point][] = [
    [a, b],
    [b, c],
    [c, a],
  ];
  edges.sort((e, f) => dist(f[0], f[1]) - dist(e[0], e[1]));
  const [p, q] = edges[0]!;
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

export function aliveNeighbours(g: InkGraph, t: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    const n = g.mesh.nbr[3 * t + k]!;
    if (n >= 0 && g.alive[n]) out.push(n);
  }
  return out;
}

/** Walk from node `t0` into `first` through degree-2 triangles until the next node (or back to `t0`). */
function walk(g: InkGraph, t0: number, first: number): { tris: number[]; end: number } {
  const tris: number[] = [];
  let prev = t0;
  let cur = first;
  for (let guard = g.mesh.triCount + 1; guard > 0; guard--) {
    tris.push(cur);
    if (cur === t0 || g.deg[cur] !== 2) return { tris, end: cur };
    const nb = aliveNeighbours(g, cur);
    const nxt = nb[0] === prev ? nb[1]! : nb[0]!;
    prev = cur;
    cur = nxt;
  }
  return { tris, end: cur };
}

export function buildInkGraph(mesh: InkMesh, boundary: SegmentIndex): InkGraph {
  const n = mesh.triCount;
  const alive = new Uint8Array(n).fill(1);
  const deg = new Int32Array(n);
  const center: Point[] = [];
  const radius = new Float64Array(n);
  const kind: ReturnType<typeof triangleKind>[] = [];
  for (let t = 0; t < n; t++) {
    const k = triangleKind(mesh, t);
    kind.push(k);
    let d = 0;
    for (let e = 0; e < 3; e++) if (mesh.nbr[3 * t + e]! >= 0) d++;
    deg[t] = d;
    const [a, b, c] = trianglePoints(mesh, t);
    if (k === 'tip') {
      // The apex is the vertex off the triangle's only chord.
      let apex = a;
      for (let e = 0; e < 3; e++) {
        if (mesh.nbr[3 * t + e]! >= 0) apex = mesh.points[mesh.tris[3 * t + ((e + 2) % 3)]!]!;
      }
      center.push(apex);
      radius[t] = 0;
    } else if (k === 'sleeve') {
      center.push({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 });
      radius[t] = 0;
    } else {
      const p = inscribedCenter(a, b, c);
      center.push(p);
      radius[t] = boundary.nearest(p);
    }
  }
  return {
    mesh,
    boundary,
    alive,
    deg,
    center,
    radius,
    kind,
    absorbed: Array.from({ length: n }, () => []),
    flicks: Array.from({ length: n }, () => []),
  };
}

/**
 * Subtree hanging off `t` through its neighbour `first`, or null when it
 * loops back to `t` (a cycle is structure, never a spur) or pokes further
 * than `limit` outside the disk (center `c`, radius `r`) — exploration stops
 * at the first such triangle, so big subtrees are rejected early.
 */
function coveredSubtree(
  g: InkGraph,
  t: number,
  first: number,
  c: Point,
  r: number,
  limit: number,
): { tris: number[]; poke: number; flick: AxisPoint[] } | null {
  const { mesh } = g;
  const parent = new Map<number, number>([[first, t]]);
  const stack = [first];
  const tris: number[] = [];
  let poke = -Infinity;
  let deepTri = first;
  let deepPoint: Point = c;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    tris.push(cur);
    for (const tri of [cur, ...g.absorbed[cur]!]) {
      for (const p of trianglePoints(mesh, tri)) {
        const d = dist(p, c) - r;
        if (d > limit) return null;
        if (d > poke) {
          poke = d;
          deepTri = cur;
          deepPoint = p;
        }
      }
    }
    for (const nb of aliveNeighbours(g, cur)) {
      if (nb === t) {
        if (cur !== first) return null; // reached t again by another route: a cycle
        continue;
      }
      if (parent.has(nb)) continue;
      parent.set(nb, cur);
      stack.push(nb);
    }
  }
  // Centerline out to the deepest vertex: chord midpoints along the tree path.
  const seq = [deepTri];
  while (seq[seq.length - 1] !== t) seq.push(parent.get(seq[seq.length - 1]!)!);
  seq.reverse();
  const flick: AxisPoint[] = [];
  for (let i = 0; i + 1 < seq.length; i++) {
    const m = sharedEdgeMidpoint(mesh, seq[i]!, seq[i + 1]!);
    flick.push({ ...m, width: 2 * g.boundary.nearest(m) });
  }
  flick.push({ x: deepPoint.x, y: deepPoint.y, width: 0 });
  return { tris, poke, flick };
}

/**
 * Remove spurs whose ink a node's inscribed disk already covers (see file
 * header). A spur is a whole SUBTREE hanging off a junction-like triangle,
 * not just a single tip branch: outline fillets (Rubik's rounded bar ends)
 * sprout little junction fans whose own disks are tiny, and only the big
 * disk of the stroke end they sit in sees that the whole fan is its ink.
 * Nodes are visited largest disk first for the same reason. `tolerance` is
 * the allowed overshoot as a fraction of the node radius — a round pen can
 * never reach a square outer corner (it pokes out by (√2−1)·r ≈ 0.41·r), and
 * such pen-unreachable ears are exactly what must go. `floor` is an absolute
 * overshoot always allowed: outline detail smaller than a couple of sample
 * steps (the fillet of a rounded acute corner, where the axis runs into the
 * corner and every disk is tiny) is below what the mesh resolves. A node may
 * prune down to degree 1 (it becomes the stroke's end: its disk is the cap).
 * Returns the number of subtrees removed.
 */
export function pruneSpurs(g: InkGraph, tolerance: number, floor: number): number {
  const { mesh } = g;
  const order = Array.from({ length: mesh.triCount }, (_, t) => t)
    .filter((t) => g.radius[t]! > 0)
    .sort((a, b) => g.radius[b]! - g.radius[a]!);
  let removed = 0;
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of order) {
      if (!g.alive[t] || g.deg[t]! < 2) continue;
      const c = g.center[t]!;
      const r = g.radius[t]!;
      let best: { tris: number[]; poke: number; flick: AxisPoint[] } | null = null;
      for (const first of aliveNeighbours(g, t)) {
        const sub = coveredSubtree(g, t, first, c, r, Math.max(tolerance * r, floor));
        if (sub && (!best || sub.poke < best.poke)) best = sub;
      }
      if (!best) continue;
      for (const bt of best.tris) {
        g.alive[bt] = 0;
        g.absorbed[t]!.push(bt, ...g.absorbed[bt]!);
        g.absorbed[bt] = [];
      }
      g.flicks[t]!.push({ path: best.flick, poke: best.poke });
      g.deg[t]!--;
      removed++;
      changed = true;
    }
  }
  return removed;
}

/** Alive triangle that keeps an absorbed spur or is a pass-through junction — its center belongs on the centerline. */
function isHub(g: InkGraph, t: number): boolean {
  return g.alive[t] === 1 && g.deg[t] === 2 && (g.kind[t] === 'junction' || g.absorbed[t]!.length > 0);
}

/** Flicks worth drawing: the ear pokes out by more than `minPoke`. */
function visibleFlicks(g: InkGraph, t: number, minPoke: number): Flick[] {
  return g.flicks[t]!.filter((f) => f.poke > minPoke);
}

/**
 * Centerline through a triangle sequence: chord midpoints, plus hub centers.
 * Visible flicks come back beside the axis: a hub's hang off its center
 * (drawn out-and-back), and a pruned-down END node (a junction that lost all
 * but one neighbour) keeps its deepest one as the stroke's way out to the tip.
 */
function axisThrough(
  g: InkGraph,
  seq: number[],
  withEnds: boolean,
  minPoke: number,
): Pick<InkBranch, 'axis' | 'axisTri' | 'flicks' | 'endFlicks'> {
  const axis: AxisPoint[] = [];
  const axisTri: number[] = [];
  const flicks: InkBranch['flicks'] = [];
  const endFlicks: InkBranch['endFlicks'] = [null, null];
  const push = (p: Point, t: number, width?: number) => {
    const w = width ?? 2 * g.boundary.nearest(p);
    axis.push({ x: p.x, y: p.y, width: w });
    axisTri.push(t);
  };
  const pushCenter = (t: number) => push(g.center[t]!, t, 2 * g.radius[t]!);
  const endFlick = (t: number): AxisPoint[] | null => {
    if (g.deg[t] !== 1 || g.radius[t]! <= 0) return null;
    const visible = visibleFlicks(g, t, minPoke);
    return visible.length > 0 ? visible.reduce((a, b) => (b.poke > a.poke ? b : a)).path : null;
  };
  if (withEnds) {
    pushCenter(seq[0]!);
    endFlicks[0] = endFlick(seq[0]!);
  }
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = seq[i]!;
    const b = seq[i + 1]!;
    push(sharedEdgeMidpoint(g.mesh, a, b), b);
    const isInner = i + 1 < seq.length - 1 || !withEnds;
    if (isInner && isHub(g, b)) {
      pushCenter(b);
      for (const flick of visibleFlicks(g, b, minPoke)) flicks.push({ index: axis.length - 1, path: flick.path });
    }
  }
  if (withEnds && seq.length > 1) {
    const last = seq[seq.length - 1]!;
    pushCenter(last);
    endFlicks[1] = endFlick(last);
  }
  return { axis, axisTri, flicks, endFlicks };
}

/**
 * Split the alive graph into branches: every maximal degree-2 run between
 * two nodes (tips, junctions, isolated triangles), plus node-less rings.
 * A node with no alive neighbours (an isolated triangle — a tiny dot) is a
 * one-point branch.
 */
export function extractBranches(g: InkGraph, minFlickPoke: number): InkBranch[] {
  const { mesh } = g;
  const branches: InkBranch[] = [];
  const visitedDir = new Set<number>();
  const dirKey = (a: number, b: number) => a * mesh.triCount + b;
  const covered = new Uint8Array(mesh.triCount);

  for (let t = 0; t < mesh.triCount; t++) {
    if (!g.alive[t] || g.deg[t] === 2) continue;
    covered[t] = 1;
    if (g.deg[t] === 0) {
      branches.push({
        from: t,
        to: t,
        tris: [t],
        axis: [{ ...g.center[t]!, width: 2 * g.radius[t]! }],
        axisTri: [t],
        isCycle: false,
        flicks: [],
        endFlicks: [null, null],
      });
      continue;
    }
    for (const first of aliveNeighbours(g, t)) {
      if (visitedDir.has(dirKey(t, first))) continue;
      const { tris, end } = walk(g, t, first);
      const seq = [t, ...tris];
      visitedDir.add(dirKey(t, first));
      visitedDir.add(dirKey(end, seq[seq.length - 2]!));
      for (const bt of tris) covered[bt] = 1;
      branches.push({ from: t, to: end, tris: seq, isCycle: false, ...axisThrough(g, seq, true, minFlickPoke) });
    }
  }

  // Rings without any node: all-sleeve cycles around a hole.
  for (let t = 0; t < mesh.triCount; t++) {
    if (!g.alive[t] || covered[t]) continue;
    const seq = [t];
    covered[t] = 1;
    let prev = t;
    let cur = aliveNeighbours(g, t)[0]!;
    while (cur !== t && cur !== undefined) {
      seq.push(cur);
      covered[cur] = 1;
      const nb = aliveNeighbours(g, cur);
      const nxt = nb[0] === prev ? nb[1]! : nb[0]!;
      prev = cur;
      cur = nxt;
    }
    seq.push(t);
    const { axis, axisTri, flicks } = axisThrough(g, seq, false, minFlickPoke);
    if (axis.length >= 2) {
      axis.push({ ...axis[0]! });
      axisTri.push(axisTri[0]!);
      branches.push({ from: -1, to: -1, tris: seq.slice(0, -1), axis, axisTri, isCycle: true, flicks, endFlicks: [null, null] });
    }
  }
  return branches;
}
