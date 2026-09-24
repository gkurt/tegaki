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
// SERIFS. A serif is a short, thin crossbar capping a stroke end: the
// stem's end cluster meets only short dead ends (the serif's arms) lying
// across it. Paired or retraced, the arms become strokes of their own (a
// serifed H would draw seven). Instead they are ABSORBED: dropped from the
// pairing, so the stem runs on to the cluster center. A two-armed serif on
// a lone stem is then SWEPT by the stem's end (out along one arm, back
// across to the other's tip); any other absorbed arm is stamped with a nib
// lying along it.
//
// FORKED ENDS. A flared or notched stroke end (a heavy slab serif's tip)
// forks its centerline into its corners: a node where every branch but one
// is a short dead end pointing on ahead. That node is the stroke's END, not
// a junction — its spurs become the end's flick, swept out to each corner
// and back, before any clustering sees them.
//
// ASSEMBLY. Branches are chained through paired ends into strokes: walks
// start at free ends (tips, unpaired ends); whatever remains is closed
// rings. Every alive branch is walked exactly once, so no ink the graph
// represents can be dropped.

import type { Point } from 'tegaki';
import { dist, dot, normalize, pointInRegion, polylineLength, sub } from '../primitives.ts';
import type { AxisPoint, Contour, GeoStroke } from '../types.ts';
import { type InkBranch, type InkGraph, withFlicks } from './graph.ts';
import { fitSlabStamp, type InkSample, inNib, paintedBy, triangleSample } from './nib.ts';

export interface CoverOptions {
  /** Junction zone radius as a multiple of the junction's inscribed radius. */
  junctionReach: number;
  /** cos(max bend) for a pass-through pairing. */
  continuationMinCos: number;
  /** Sampling step for passage curves and extensions (font units). */
  step: number;
  /** Absorb serifs into the stroke ends they cap (see file header). */
  absorbSerifs: boolean;
  /** True where there is ink (outline-tolerant) — bounds serif nibs. */
  inkAt: (p: Point) => boolean;
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
  /** Serif arms absorbed into this cluster's stroke end (removed from `slots`). */
  serifArms: ClusterSlot[];
  /** The serif is drawn as a sweep at the stem's end (else stamped with nibs). */
  serifSwept: boolean;
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

/**
 * A serif arm reaches at most this far from the cluster center, in widths
 * of the stem it caps — or of the region's stroke weight, when the stem is
 * a hairline (the thin diagonal of a V or X carries a full-size serif).
 */
const SERIF_MAX_LENGTH = 2.4;
/** A serif arm is at most this wide (median), as a fraction of the region's stroke weight. */
const SERIF_MAX_WIDTH = 0.6;
/**
 * The region's stroke weight: the width 80% of its stroke centerline stays
 * under. Not the widest branch — a teardrop knot would make a Devanagari headline
 * look thin enough to be a serif.
 */
const SERIF_WIDTH_PERCENTILE = 0.8;
/** Stroke weight is taken over junction-to-junction branches when they are at least this share of the centerline. */
const SERIF_WEIGHT_MIN_SHARE = 0.3;
/** |cos| between an arm and a stroke body it caps: roughly across it. */
const SERIF_MAX_ALIGN = 0.7;
/** Two bodies with outward directions dotting below this pass straight through (a crossing, not a corner). */
const SERIF_PASS_DOT = -0.5;
/** Two bodies opening less than 60° (dot above this) form an apex, whose single arm is not absorbed. */
const SERIF_APEX_DOT = Math.cos((60 * Math.PI) / 180);
/**
 * Two arms pointing apart within 45° of opposite form a SLAB (dot of their
 * outward directions below this); a bracketed foot on a slanted stem
 * splays its arms by up to ~40°.
 */
const SLAB_MAX_DOT = -Math.cos((45 * Math.PI) / 180);
/** A stem meets its slab at least 25° off the slab's line (|cos| below this), or it is the slab's continuation. */
const SLAB_STEM_MAX_ALIGN = Math.cos((25 * Math.PI) / 180);

/** A cluster slot as serif detection sees it. */
export interface SerifSlotShape {
  /** Dead-end (far end free), so the slot could be an arm. */
  dead: boolean;
  /** Width where the slot meets the cluster. */
  width: number;
  /** Median width along the slot's branch. */
  medianWidth: number;
  /** The branch's far end. */
  tip: Point;
  /** Unit direction leaving the cluster along the branch. */
  out: Point;
}

/**
 * Indices of the slots that are serif arms: short, thin dead ends capping
 * a stroke END. Either a SLAB — two arms pointing apart along one line that
 * the stem meets at an angle (a foot serif, on an upright or a slanted
 * stem alike) — or single arms lying across their body. The body is one
 * stem or two bodies meeting at a corner (the serif hanging off an E's
 * corner) — never two bodies passing straight through, where the "arms"
 * are a crossbar (t, f). At most two arms.
 */
export function findSerifArms(slots: SerifSlotShape[], center: Point, strokeWeight: number): number[] {
  const n = slots.length;
  if (n < 2) return [];
  const all = slots.map((_, i) => i);
  let bodies = all.filter((i) => !slots[i]!.dead);
  // All dead ends (an i, an l): the longest is the stem.
  if (bodies.length === 0) {
    let longest = 0;
    for (let i = 1; i < n; i++) if (dist(slots[i]!.tip, center) > dist(slots[longest]!.tip, center)) longest = i;
    bodies = [longest];
  }
  const lengthUnit = Math.max(strokeWeight, ...bodies.map((i) => slots[i]!.width));
  const candidates = all.filter((i) => {
    const s = slots[i]!;
    return (
      s.dead &&
      !bodies.includes(i) &&
      dist(s.tip, center) <= SERIF_MAX_LENGTH * lengthUnit &&
      s.medianWidth <= SERIF_MAX_WIDTH * strokeWeight
    );
  });
  const out = (i: number) => slots[i]!.out;
  const capsAStrokeEnd = (arms: number[]) => {
    const rest = all.filter((i) => !arms.includes(i));
    return rest.length === 1 || (rest.length === 2 && dot(out(rest[0]!), out(rest[1]!)) > SERIF_PASS_DOT);
  };

  // A slab: the most nearly opposite pair of candidates, met at an angle by
  // everything else.
  let slab: [number, number] | null = null;
  let slabDot = SLAB_MAX_DOT;
  for (const a of candidates) {
    for (const b of candidates) {
      if (b <= a) continue;
      const d = dot(out(a), out(b));
      if (d < slabDot) {
        slabDot = d;
        slab = [a, b];
      }
    }
  }
  if (slab) {
    const [a, b] = slab;
    const axis = normalize(sub(out(a), out(b)));
    const rest = all.filter((i) => i !== a && i !== b);
    if (rest.every((i) => Math.abs(dot(out(i), axis)) <= SLAB_STEM_MAX_ALIGN) && capsAStrokeEnd(slab)) return slab;
  }

  // Single arms, each lying across a body. Not at an acute apex (the top
  // of an M or N): the arm is that V's point, which the pairing's cusp and
  // retrace already draw.
  bodies = all.filter((i) => !candidates.includes(i));
  const arms = candidates.filter((a) => bodies.some((b) => Math.abs(dot(out(a), out(b))) <= SERIF_MAX_ALIGN));
  if (arms.length === 0 || arms.length > 2) return [];
  const rest = all.filter((i) => !arms.includes(i));
  if (rest.length === 2 && dot(out(rest[0]!), out(rest[1]!)) > SERIF_APEX_DOT) return [];
  // Nor an arm that runs straight on from a body (the foot of an E's
  // corner continues its bar): the pairing passes through it.
  if (arms.some((a) => rest.some((b) => dot(out(a), out(b)) < SLAB_MAX_DOT))) return [];
  return capsAStrokeEnd(arms) ? arms : [];
}

/**
 * The width a share `q` of the drawn centerline stays under (arc-length
 * weighted): the region's typical stroke weight, robust to a blob or two.
 */
function strokeWidthPercentile(branches: InkBranch[], q: number): number {
  const spans: [number, number][] = [];
  let total = 0;
  for (const b of branches) {
    for (let i = 1; i < b.axis.length; i++) {
      const len = dist(b.axis[i - 1]!, b.axis[i]!);
      spans.push([(b.axis[i - 1]!.width + b.axis[i]!.width) / 2, len]);
      total += len;
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  let acc = 0;
  for (const [w, len] of spans) {
    acc += len;
    if (acc >= q * total) return w;
  }
  return spans[spans.length - 1]?.[0] ?? 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * A forked end's spurs reach at most this far, in widths of the stroke they
 * end: a square end's corner spurs run ~0.7 widths, a flared one's a little
 * more; a branch of its own (a y's arm) runs several.
 */
const FORK_MAX_SPUR = 1.5;
/**
 * ... and point on ahead into the end's corners, within 60° of the stroke's
 * direction (a square end's run at 45°). Arms sticking out sideways are a
 * slab serif's, left to serif absorption.
 */
const FORK_MIN_ALIGN = Math.cos((60 * Math.PI) / 180);

/** A branch's centerline oriented away from `node`, flicks expanded, out to the tip beyond its far end. */
function outwardFrom(b: InkBranch, node: number): AxisPoint[] {
  const reversed = b.from !== node;
  return [...withFlicks(b.axis, b.flicks, reversed), ...(b.endFlicks[reversed ? 0 : 1] ?? [])];
}

/**
 * Collapse forked stroke ends (see file header): at a node whose branches
 * are all dead ends but one, each no longer than FORK_MAX_SPUR widths of that
 * one and pointing on past its end (FORK_MIN_ALIGN), the spurs are dropped
 * and folded into the remaining branch's end
 * flick — out along each spur to its tip and back, the longest last and only
 * out. Returns the surviving branches and the collapsed nodes.
 */
function collapseForks(g: InkGraph, rawBranches: InkBranch[]): { branches: InkBranch[]; forkEnds: Set<number> } {
  const isNode = (t: number) => t >= 0 && g.alive[t] === 1 && g.deg[t]! >= 3;
  const incident = new Map<number, number[]>();
  rawBranches.forEach((b, bi) => {
    if (b.isCycle || b.from === b.to) return;
    for (const t of [b.from, b.to]) if (isNode(t)) incident.set(t, [...(incident.get(t) ?? []), bi]);
  });
  const dropped = new Set<number>();
  const replaced = new Map<number, InkBranch>();
  const forkEnds = new Set<number>();
  for (const [node, bis] of incident) {
    if (bis.length !== g.deg[node]) continue; // a branch loops back through this node
    const isSpur = (bi: number) => {
      const b = rawBranches[bi]!;
      const far = b.from === node ? b.to : b.from;
      return !isNode(far) && g.deg[far]! <= 1 && !replaced.has(bi) && !dropped.has(bi);
    };
    // The stroke body: the longest branch; everything else must be a short spur.
    const body = bis.reduce((a, b) => (polylineLength(rawBranches[b]!.axis) > polylineLength(rawBranches[a]!.axis) ? b : a));
    const spurs = bis.filter((bi) => bi !== body);
    if (!spurs.every(isSpur)) continue;
    // A short body forked at both ends carries both sweeps.
    const bodyBranch = replaced.get(body) ?? rawBranches[body]!;
    const width = median(bodyBranch.axis.map((p) => p.width));
    const paths = spurs.map((bi) => outwardFrom(rawBranches[bi]!, node));
    if (paths.some((path) => polylineLength(path) > FORK_MAX_SPUR * width)) continue;
    const c = g.center[node]!;
    const bodyAxis = outwardFrom(bodyBranch, node);
    const ahead = normalize(sub(c, pointAlong(bodyAxis, Math.min(width, polylineLength(bodyAxis) / 2))));
    if (paths.some((path) => dot(normalize(sub(path[path.length - 1]!, c)), ahead) < FORK_MIN_ALIGN)) continue;
    paths.sort((a, b) => polylineLength(a) - polylineLength(b));
    const sweep: AxisPoint[] = [];
    paths.forEach((path, i) => {
      sweep.push(...path);
      if (i < paths.length - 1) sweep.push(...[...path].reverse());
    });
    const end = bodyBranch.from === node ? 0 : 1;
    const endFlicks: InkBranch['endFlicks'] = [...bodyBranch.endFlicks];
    endFlicks[end] = sweep;
    replaced.set(body, {
      ...bodyBranch,
      tris: [...bodyBranch.tris, ...spurs.flatMap((bi) => rawBranches[bi]!.tris)],
      endFlicks,
    });
    for (const bi of spurs) dropped.add(bi);
    forkEnds.add(node);
  }
  const branches = rawBranches.flatMap((b, bi) => (dropped.has(bi) ? [] : [replaced.get(bi) ?? b]));
  return { branches, forkEnds };
}

/**
 * Append `src` to a stroke's points (copies), dropping a repeat point unless
 * it changes the width in place — but never its nib: a node center can land
 * exactly on the chord midpoint before it (a dot's two-triangle axis), and
 * dropping it lost the stamp covering that end of the dot. A nib moves onto
 * the repeat's stamp-free twin; two stamps at one point stay two points.
 */
export function appendAxisPoints(dst: AxisPoint[], src: AxisPoint[]): void {
  for (const p of src) {
    const last = dst[dst.length - 1];
    if (last && dist(last, p) < 1e-6 && Math.abs(last.width - p.width) < 1e-6) {
      if (!p.nib) continue;
      if (!last.nib) {
        last.nib = { ...p.nib };
        continue;
      }
    }
    dst.push({ ...p });
  }
}

export function coverInkGraph(g: InkGraph, graphBranches: InkBranch[], contours: Contour[], options: CoverOptions): CoverResult {
  const { junctionReach, continuationMinCos, step, inkAt } = options;
  const { branches: rawBranches, forkEnds } = collapseForks(g, graphBranches);
  const isJunction = (t: number) => t >= 0 && g.alive[t] === 1 && g.deg[t]! >= 3 && !forkEnds.has(t);
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
        serifArms: [],
        serifSwept: false,
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
      const deadEnd = far !== node && !isJunction(far) && (g.deg[far]! <= 1 || forkEnds.has(far)) ? polylineLength(b.axis) : null;
      slotOf.set(bi * 2 + end, { cluster: ci, slot: cl.slots.length });
      cl.slots.push({ key: bi * 2 + end, point, direction, deadEnd });
      // Triangles trimmed off this end belong to the cluster zone.
      cl.zoneTris.push(...trimmedAt[bi]![end]!);
    }
  });

  // ── Serifs: absorb short arms capping a stroke end ────────────────────
  const absorbedArm = new Set<number>();
  if (options.absorbSerifs) {
    // Weigh the strokes, not their serifs: a lowercase x's eight arms are a
    // good share of its centerline. Dead ends count only when little else
    // is left (a bar, a lone stroke).
    const through = branches.filter((b) => b.isCycle || (isJunction(b.from) && isJunction(b.to)));
    const length = (bs: InkBranch[]) => bs.reduce((acc, b) => acc + polylineLength(b.axis), 0);
    const weighed = length(through) >= SERIF_WEIGHT_MIN_SHARE * length(branches) ? through : branches;
    const strokeWeight = strokeWidthPercentile(weighed, SERIF_WIDTH_PERCENTILE);
    clusters.forEach((cl, ci) => {
      const shapes = cl.slots.map((slot): SerifSlotShape => {
        const b = branches[Math.floor(slot.key / 2)]!;
        return {
          dead: slot.deadEnd !== null,
          width: slot.point.width,
          medianWidth: median(b.axis.map((p) => p.width)),
          tip: slot.key % 2 === 0 ? b.axis[b.axis.length - 1]! : b.axis[0]!,
          out: { x: -slot.direction.x, y: -slot.direction.y },
        };
      });
      const arms = new Set(findSerifArms(shapes, cl.center, strokeWeight));
      if (arms.size === 0) return;
      cl.serifArms = cl.slots.filter((_, i) => arms.has(i));
      cl.slots = cl.slots.filter((_, i) => !arms.has(i));
      for (const arm of cl.serifArms) {
        const bi = Math.floor(arm.key / 2);
        absorbedArm.add(bi);
        slotOf.delete(arm.key);
        for (const t of branches[bi]!.tris) cl.zoneTris.push(t, ...g.absorbed[t]!);
      }
      cl.slots.forEach((slot, si) => {
        slotOf.set(slot.key, { cluster: ci, slot: si });
      });
    });
  }

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
    // A two-armed serif capping a lone stem: the stem's end sweeps it.
    if (cl.serifArms.length === 2 && cl.slots.length === 1) {
      // Straight down the stem to the slab (the junction's own centerline
      // bends off toward whichever arm its triangles lean to).
      const stemEnd = extension(cl.slots[0]!, cl, g, contours, step) ?? [cl.slots[0]!.point];
      const sweep = serifSweep(cl.serifArms, branches, trimmedAxis, g);
      // Narrow to the arm's width BEFORE moving sideways: the junction-wide
      // disk swept toward the arm would bulge out over the slab.
      const last = stemEnd[stemEnd.length - 1]!;
      cl.extensions[0] = [...stemEnd, { x: last.x, y: last.y, width: Math.min(last.width, sweep[0]!.width) }, ...sweep];
      cl.serifSwept = true;
    }
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

  const visited = new Uint8Array(branches.length);
  // Retraced dead ends are drawn inside their passage.
  for (const cl of clusters) for (const mid of cl.retraced) if (mid >= 0) visited[Math.floor(cl.slots[mid]!.key / 2)] = 1;
  // Absorbed serif arms are stamped, not walked.
  for (const bi of absorbedArm) visited[bi] = 1;
  const strokes: GeoStroke[] = [];
  const walkFrom = (startBranch: number, startEnd: 0 | 1): GeoStroke => {
    const points: AxisPoint[] = [];
    const segs: number[] = [];
    const startExt = extensionOf(startBranch * 2 + startEnd);
    if (startExt) appendAxisPoints(points, [...startExt].reverse());
    else appendAxisPoints(points, [...(branches[startBranch]!.endFlicks[startEnd] ?? [])].reverse());
    let bi = startBranch;
    let end: 0 | 1 = startEnd;
    let isLoop = false;
    for (let guard = branches.length + 1; guard > 0; guard--) {
      visited[bi] = 1;
      segs.push(bi);
      appendAxisPoints(points, withFlicks(branches[bi]!.axis, branches[bi]!.flicks, end === 1));
      const outKey = bi * 2 + (1 - end);
      const next = partner.get(outKey);
      if (!next) {
        appendAxisPoints(points, extensionOf(outKey) ?? branches[bi]!.endFlicks[1 - end] ?? []);
        break;
      }
      appendAxisPoints(points, next.passage);
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

  for (const cl of clusters) if (cl.serifArms.length > 0 && !cl.serifSwept) stampSerif(cl, g, branches, trimmedAxis, strokes, inkAt, step);

  return { strokes, branches, clusters };
}

/** An arm's centerline (with its flicks) oriented away from its cluster. */
function armAxis(arm: ClusterSlot, branches: InkBranch[]): AxisPoint[] {
  const b = branches[Math.floor(arm.key / 2)]!;
  const reversed = arm.key % 2 === 1;
  return [...withFlicks(b.axis, b.flicks, reversed), ...(b.endFlicks[reversed ? 0 : 1] ?? [])];
}

/**
 * The pen's path across a two-armed serif from the stem's end: out along
 * the left arm to its tip, back, and across to the right arm's tip. Each
 * arm is run from the junction itself — along the centerline its branch
 * was trimmed of, whose disks fill the brackets between stem and slab — so
 * the round pen paints the slab where one inscribed ellipse would leave its
 * corners bare.
 */
function serifSweep(arms: ClusterSlot[], branches: InkBranch[], trimmedAxis: [AxisPoint[], AxisPoint[]][], g: InkGraph): AxisPoint[] {
  const [a, b] = arms.map((arm) => {
    const lost = trimmedAxis[Math.floor(arm.key / 2)]?.[arm.key % 2] ?? [];
    // A junction node's width is its triangle's, not its clearance: clamp
    // each disk to the ink around it.
    return [...[...lost].reverse(), ...armAxis(arm, branches)].map((p) => ({ ...p, width: Math.min(p.width, 2 * g.boundary.nearest(p)) }));
  }) as [AxisPoint[], AxisPoint[]];
  const [first, second] = a[a.length - 1]!.x <= b[b.length - 1]!.x ? [a, b] : [b, a];
  return [...first, ...[...first].reverse(), ...second];
}

/** A stamp must paint at least this share of its arm's unpainted ink, else the pen runs the arm instead. */
const STAMP_MIN_SHARE = 0.5;

/**
 * Cover an absorbed serif arm that is not swept: a nib lying along the arm,
 * left at the stroke point nearest the cluster center, scored on the serif
 * ink (arms and cluster zone) the strokes' round pens leave unpainted. An
 * arm no ellipse fills (a tapered wedge off an M's apex) is RUN instead:
 * from that point out to its tip — and back, unless the point ends its
 * stroke.
 */
function stampSerif(
  cl: JunctionCluster,
  g: InkGraph,
  branches: InkBranch[],
  trimmedAxis: [AxisPoint[], AxisPoint[]][],
  strokes: GeoStroke[],
  inkAt: (p: Point) => boolean,
  step: number,
) {
  let samples: (InkSample & { t: number })[] = [...new Set(cl.zoneTris)]
    .map((t) => ({ t, ...triangleSample(g, t) }))
    .filter(
      (q) =>
        !paintedBy(
          q.p,
          strokes.map((s) => s.points),
          0,
        ),
    );
  for (const arm of cl.serifArms) {
    let at: { stroke: number; index: number } | null = null;
    let atDist = Infinity;
    strokes.forEach((s, si) => {
      s.points.forEach((p, pi) => {
        const d = dist(p, cl.center);
        if (!p.nib && d < atDist) {
          atDist = d;
          at = { stroke: si, index: pi };
        }
      });
    });
    if (!at) return;
    const { stroke, index } = at as { stroke: number; index: number };
    const pen = strokes[stroke]!.points[index]!;
    const bi = Math.floor(arm.key / 2);
    const b = branches[bi]!;
    const tip = arm.key % 2 === 0 ? b.axis[b.axis.length - 1]! : b.axis[0]!;
    // The arm's slab runs from where its axis crosses the stem (its root,
    // projected back toward the cluster center) out to its tip.
    const u = normalize(sub(tip, arm.point));
    const back = Math.max(0, dot(sub(arm.point, cl.center), u));
    const from = { x: arm.point.x - u.x * back, y: arm.point.y - u.y * back };
    const halfWidth = Math.max(...b.axis.map((p) => p.width)) / 2;
    const best = fitSlabStamp({ at: pen, from, to: tip, halfWidth, samples, inkAt });
    const armTris = new Set(b.tris.flatMap((t) => [t, ...g.absorbed[t]!]));
    const own = samples.filter((q) => armTris.has(q.t));
    const ownArea = own.reduce((acc, q) => acc + q.area, 0);
    const ownGain = best ? own.reduce((acc, q) => acc + (inNib(q.p, pen, best.nib) ? q.area : 0), 0) : 0;
    if (best && best.gain >= step * step && ownGain >= STAMP_MIN_SHARE * ownArea) {
      pen.nib = best.nib;
      samples = samples.filter((q) => !inNib(q.p, pen, best.nib));
      continue;
    }
    // Run the arm: from the junction (along the centerline its branch was
    // trimmed of) out to the tip, each disk clamped to the ink around it.
    const lost = trimmedAxis[bi]?.[arm.key % 2] ?? [];
    const run = [...[...lost].reverse(), ...armAxis(arm, branches)].map((p) => ({
      ...p,
      width: Math.min(p.width, 2 * g.boundary.nearest(p)),
    }));
    const pts = strokes[stroke]!.points;
    const returnPath = [...run].reverse();
    if (index === pts.length - 1) pts.push(...run);
    else if (index === 0) pts.unshift(...returnPath);
    else pts.splice(index + 1, 0, ...run, ...returnPath, { ...pen });
    const ran = run.slice(1).map((q, i) => [run[i]!, q]);
    samples = samples.filter((q) => !paintedBy(q.p, ran, 0));
  }
}
