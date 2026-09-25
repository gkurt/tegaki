// Dataset-guided stroke re-grouping.
//
// When the heuristic assembly's strokes disagree with a stroke-order
// reference (stroke counts differ, or the match cost is out of range), the
// reference can still guide a better GROUPING of the same ink. Two moves,
// both operating on the assembled stroke polylines:
//
// - SPLIT: an extracted stroke whose edges change allegiance between
//   reference strokes is cut at the allegiance seams. A box (口) is extracted
//   as one closed annulus loop — its corner turns merge through bare cuts, so
//   there is no junction anywhere to re-pair — but its edges label
//   left / top+right / bottom cleanly, and splitting at the seams yields
//   exactly the three prescribed strokes.
// - MERGE: extracted strokes lying along the SAME reference stroke are
//   chained end-to-end in reference arc-length order when their endpoints
//   meet. A cursive kana like れ legitimately bends far beyond the
//   continuation gate's 75°, so the heuristic splits what the dataset knows
//   is one stroke; strokes drawn as separate overlapping contours land in
//   different pipeline regions and could never merge before. When the join
//   point sits on a piece's INTERIOR rather than an endpoint, the chain
//   RETRACES that piece's own polyline (see the retrace note in the merge
//   phase) — the pen legitimately travels a fused corridor twice.
// - ABSORB (pre-pass): a short stub whose endpoint touches the INTERIOR of a
//   longer piece splices into that piece as an out-and-back excursion. Where
//   a long stroke overlaps itself (そ's second bar under its descending
//   curve, ん's descent under its loop), the skeleton branches: the main
//   path runs through the fused corridor and the stroke's real tip survives
//   only as a spur. The pen visits that tip MID-path — out and back — which
//   no tail-append join can produce. Absorption yields an ALTERNATIVE piece
//   set; both sets feed the portfolio, so a wrong absorption never displaces
//   a working proposal.
// - DEDUP (pre-pass): drop ink that re-travels a corridor the group already
//   covers. A heuristic stroke that wanders a fat or looped region (ね's
//   knot, ゅ's loop wrapping its own stem) carries the same corridor two or
//   three times as parallel spans — no chain order avoids re-drawing them,
//   so the duplicated ink itself goes (see dedupOverlap for the topological
//   redundancy test). Also an alternative piece set in the portfolio.
//
// Edge labels use nearest-reference distance plus a DIRECTION penalty: where
// a stroke crosses another, its points pass within half a width of the other
// reference, but the local travel direction is nowhere near the other
// reference's tangent — the penalty keeps the crossing from flickering the
// label. Residual flicker shorter than `minRunLength` merges into its
// neighbouring runs.
//
// Everything here is a PROPOSAL built from the font's own geometry — the
// caller re-matches the result against the reference and adopts it only when
// it verifies clean, so re-grouping is never worse than the heuristic
// baseline. Reference geometry itself never enters the output strokes
// (consultation-only license boundary, see stroke-order/types.ts).

import type { Point } from 'tegaki';
import { matchStrokes, resamplePolyline } from '../stroke-order/match.ts';
import { dist } from './primitives.ts';
import type { AxisPoint, GeoStroke } from './types.ts';

// Env-gated diagnostics (CLI only — this module also runs in the browser,
// where `process` does not exist).
const DEBUG = typeof process !== 'undefined' && !!process.env?.TEGAKI_REGROUP_DEBUG;

/**
 * How strongly pruned ink counts against a candidate, as mean-cost units per
 * fraction of total ink pruned. Deliberately mild: coverage SAFETY is the
 * veto's job (legitimate prunes run to 60%+ of path length on heavily
 * wandering extractions like ね, so a strong penalty would re-break them);
 * this only makes the portfolio prefer keeping ink when candidates are
 * otherwise close. Shared with the pipeline's adoption gate.
 */
export const PRUNE_COST_WEIGHT = 0.02;

/**
 * Flat rank-and-gate surcharge for proposals that lift extra strokes outside
 * the canonical match. Deviating from the prescribed stroke count must buy a
 * MATERIAL match improvement — without this, shedding an awkward piece into
 * the extras always slims the chains a little and partial proposals would
 * shadow perfectly good full matches (月's bars drawn out of order).
 */
export const LIFT_RANK_PENALTY = 0.03;

/**
 * How strongly EXCESS travel counts against a candidate in RANKING, as
 * mean-cost units per fraction of total ink. Excess is what the proposal
 * draws beyond both the ink itself and the reference's own arc length — so
 * prescribed doubled travel (れ's fused corridor, where the reference walks
 * the corridor twice) is free, while re-traveling a feature the reference
 * never visits twice is the "a retrace that could be a stroke should BE a
 * stroke" smell and loses to a lift proposal that draws it once. Ordering
 * only — never part of the adoption gate.
 */
const RETRACE_COST_WEIGHT = 0.3;

export interface RegroupOptions {
  /** Densification spacing for edge labeling (≈ the pipeline's resample spacing). */
  spacing: number;
  /** Label runs shorter than this arc length are noise and merge into a neighbour. */
  minRunLength: number;
  /** Glyph bbox diagonal — scales the merge gap tolerance. */
  glyphDiag: number;
  /**
   * The caller's adoption gate (max mean match cost). Candidate selection
   * prefers proposals that would actually pass it, so a gate-passing chain
   * from one strategy is never shadowed by a lower-cost chain that fails.
   */
  maxMeanCost: number;
  /**
   * Proposals that end with more strokes than were extracted AND retrace
   * (a split cut along the font's own trajectory — see the pipeline):
   * - 'allow' (default): adoptable like any other;
   * - 'reject': the caller throws them away; the pick is unchanged, so a
   *   rejected winner leaves the extracted strokes as they were;
   * - 'avoid': the caller throws them away, but the pick falls to the best
   *   proposal it would take instead.
   */
  retracedSplits?: 'allow' | 'reject' | 'avoid';
}

export interface RegroupResult {
  strokes: GeoStroke[];
  /** Extracted strokes that were split at label seams. */
  splits: number;
  /** Links applied between same-reference pieces (including absorbed stubs). */
  merges: number;
  /** Of merges: links that re-travel a piece's own polyline (fused corridors, stub excursions). */
  retraces: number;
  /** Arc length of duplicated (re-traveled corridor) ink dropped by the overlap dedup. */
  pruned: number;
  /**
   * Misfit strokes the reference has no stroke for (a crossed 7's crossbar),
   * lifted out of the chains and appended at the END of `strokes`. The
   * leading strokes match the reference; these draw after them.
   */
  extras: number;
}

interface RefIndex {
  pts: Point[];
  /** Cumulative arc length at each vertex. */
  cum: number[];
  total: number;
}

function indexRef(pts: Point[]): RefIndex | null {
  if (pts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  const total = cum[cum.length - 1]!;
  return total > 0 ? { pts, cum, total } : null;
}

interface Projection {
  /** Distance to the nearest point of the reference polyline. */
  d: number;
  /** Normalized arc-length position (0..1) of that nearest point. */
  t: number;
  /** Unit tangent of the reference at the nearest point. */
  tangent: Point;
}

function projectToRef(p: Point, ref: RefIndex): Projection {
  let best: Projection = { d: Infinity, t: 0, tangent: { x: 0, y: 0 } };
  for (let i = 1; i < ref.pts.length; i++) {
    const a = ref.pts[i - 1]!;
    const b = ref.pts[i]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const s = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0;
    const qx = a.x + abx * s;
    const qy = a.y + aby * s;
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d < best.d) {
      const len = Math.sqrt(len2);
      best = {
        d,
        t: (ref.cum[i - 1]! + len * s) / ref.total,
        tangent: len > 0 ? { x: abx / len, y: aby / len } : { x: 0, y: 0 },
      };
    }
  }
  return best;
}

interface PolylineHit {
  /** Distance from the query point to the polyline. */
  d: number;
  /** Segment index i (hit lies on pts[i] → pts[i+1]). */
  seg: number;
  /** The hit point, width interpolated. */
  q: AxisPoint;
}

/** Nearest point of a piece polyline to `p` (for retrace entry points). */
function projectOntoPolyline(pts: AxisPoint[], p: Point): PolylineHit | null {
  if (pts.length < 2) return null;
  let best: PolylineHit | null = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const s = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0;
    const q = { x: a.x + abx * s, y: a.y + aby * s, width: a.width + (b.width - a.width) * s };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { d, seg: i - 1, q };
  }
  return best;
}

/** Walk along `pts` between two hit points, in whichever direction connects them. */
function walkBetween(pts: AxisPoint[], segA: number, qa: AxisPoint, segB: number, qb: AxisPoint): AxisPoint[] {
  if (segA <= segB) return [qa, ...pts.slice(segA + 1, segB + 1), qb];
  return [qa, ...pts.slice(segB + 1, segA + 1).reverse(), qb];
}

/** Arc length along `pts` from the hit point (on segment `seg`) to the last point. */
function lengthFromHitToTail(pts: AxisPoint[], seg: number, q: Point): number {
  let len = dist(q, pts[seg + 1]!);
  for (let i = seg + 2; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!);
  return len;
}

/** Arc length along `pts` from the first point to the hit point (on segment `seg`). */
function lengthFromHeadToHit(pts: AxisPoint[], seg: number, q: Point): number {
  let len = 0;
  for (let i = 1; i <= seg; i++) len += dist(pts[i - 1]!, pts[i]!);
  return len + dist(pts[seg]!, q);
}

interface PairHit {
  d: number;
  /** Meeting point on polyline A and the segment index it lies on. */
  qa: AxisPoint;
  segA: number;
  /** Meeting point on polyline B and the segment index it lies on. */
  qb: AxisPoint;
  segB: number;
}

/**
 * Nearest pair of points between two polylines, sampled vertex-to-segment
 * both ways (a real meeting always involves at least one vertex nearby —
 * densified split pieces make this exact in practice).
 */
function nearestPolylinePair(a: AxisPoint[], b: AxisPoint[]): PairHit | null {
  if (a.length < 2 || b.length < 2) return null;
  let best: PairHit | null = null;
  for (let i = 0; i < a.length; i++) {
    const hit = projectOntoPolyline(b, a[i]!);
    if (hit && (!best || hit.d < best.d)) {
      best = { d: hit.d, qa: a[i]!, segA: Math.min(i, a.length - 2), qb: hit.q, segB: hit.seg };
    }
  }
  for (let j = 0; j < b.length; j++) {
    const hit = projectOntoPolyline(a, b[j]!);
    if (hit && (!best || hit.d < best.d)) {
      best = { d: hit.d, qa: hit.q, segA: hit.seg, qb: b[j]!, segB: Math.min(j, b.length - 2) };
    }
  }
  return best;
}

// A join gap spans at most the junction ink between the two pieces (~ a
// stroke width where they cross another stroke); anything larger means the
// reference genuinely lifts the pen or the assignment is off.
function joinTolerance(a: AxisPoint, b: AxisPoint, glyphDiag: number): number {
  return Math.max(2 * Math.max(a.width, b.width), glyphDiag * 0.05);
}

function appendDedup(dst: AxisPoint[], src: AxisPoint[]): void {
  for (const p of src) {
    const last = dst[dst.length - 1];
    if (last && dist(last, p) < 1e-6) continue;
    dst.push({ ...p });
  }
}

function polylineLength(pts: AxisPoint[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!);
  return len;
}

/**
 * Absorb excursion stubs: a piece much shorter than a neighbour, one endpoint
 * touching that neighbour's INTERIOR (clear of both ends — endpoint-adjacent
 * contacts are the chaining phase's job), splices in as an out-and-back
 * excursion at the touch point. This is the skeleton-branch signature of a
 * stroke overlapping itself: the surviving spur is the stroke's real tip and
 * the pen visits it mid-path. Returns null when nothing absorbs.
 */
function absorbStubs(pieces: GeoStroke[], options: RegroupOptions): { pieces: GeoStroke[]; absorbed: number } | null {
  const work = pieces.map((p) => ({ points: p.points.map((q) => ({ ...q })), isLoop: p.isLoop, segmentIndices: [...p.segmentIndices] }));
  let absorbed = 0;
  for (;;) {
    let bestStub = -1;
    let bestHost = -1;
    let bestHit: PolylineHit | null = null;
    let bestFromHead = true;
    for (let s = 0; s < work.length; s++) {
      const stub = work[s]!;
      if (stub.isLoop || stub.points.length < 2) continue;
      const stubLen = polylineLength(stub.points);
      for (let h = 0; h < work.length; h++) {
        if (h === s) continue;
        const host = work[h]!;
        if (host.points.length < 2 || polylineLength(host.points) <= stubLen * 2) continue;
        for (const fromHead of [true, false]) {
          const end = fromHead ? stub.points[0]! : stub.points[stub.points.length - 1]!;
          const hit = projectOntoPolyline(host.points, end);
          if (!hit) continue;
          const tol = joinTolerance(end, hit.q, options.glyphDiag);
          if (hit.d > tol) continue;
          // Interior only: near the host's ends, plain/retrace chaining
          // already models the connection.
          if (lengthFromHeadToHit(host.points, hit.seg, hit.q) <= tol) continue;
          if (lengthFromHitToTail(host.points, hit.seg, hit.q) <= tol) continue;
          if (!bestHit || hit.d < bestHit.d) {
            bestStub = s;
            bestHost = h;
            bestHit = hit;
            bestFromHead = fromHead;
          }
        }
      }
    }
    if (!bestHit) break;
    const stub = work[bestStub]!;
    const host = work[bestHost]!;
    const outbound = bestFromHead ? stub.points : [...stub.points].reverse();
    const spliced: AxisPoint[] = host.points.slice(0, bestHit.seg + 1).map((p) => ({ ...p }));
    appendDedup(spliced, [bestHit.q, ...outbound]);
    appendDedup(spliced, [...outbound].reverse().slice(1));
    appendDedup(spliced, [bestHit.q, ...host.points.slice(bestHit.seg + 1)]);
    host.points = spliced;
    host.segmentIndices = [...host.segmentIndices, ...stub.segmentIndices];
    work.splice(bestStub, 1);
    absorbed++;
  }
  return absorbed > 0 ? { pieces: work, absorbed } : null;
}

/** Insert interpolated points so no edge exceeds `spacing` (labels need granularity). */
function densify(pts: AxisPoint[], spacing: number): AxisPoint[] {
  const out: AxisPoint[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = dist(a, b);
    const n = Math.ceil(len / spacing);
    for (let k = 1; k < n; k++) {
      const s = k / n;
      out.push({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, width: a.width + (b.width - a.width) * s });
    }
    out.push(b);
  }
  return out;
}

/** Contiguous run of equally-labeled edges. */
interface Run {
  label: number;
  /** First and last edge index (inclusive). */
  e0: number;
  e1: number;
  len: number;
}

function buildRuns(labels: number[], edgeLens: number[]): Run[] {
  const runs: Run[] = [];
  for (let e = 0; e < labels.length; e++) {
    const last = runs[runs.length - 1];
    if (last && last.label === labels[e]!) {
      last.e1 = e;
      last.len += edgeLens[e]!;
    } else {
      runs.push({ label: labels[e]!, e0: e, e1: e, len: edgeLens[e]! });
    }
  }
  return runs;
}

/**
 * Merge label runs shorter than `minRun` into their longer neighbour until
 * every remaining run is substantial. `circular` joins first/last as
 * neighbours (closed loops). Operates by relabeling + rebuilding, so merges
 * of newly-adjacent equal labels are picked up each round.
 */
function smoothRuns(labels: number[], edgeLens: number[], minRun: number, circular: boolean): Run[] {
  for (;;) {
    let runs = buildRuns(labels, edgeLens);
    if (circular && runs.length >= 2 && runs[0]!.label === runs[runs.length - 1]!.label) {
      // Wrapping run: fold the tail into the head for length accounting.
      runs[0]!.len += runs[runs.length - 1]!.len;
      runs[0]!.e0 = runs[runs.length - 1]!.e0; // marks the wrap; only len matters below
      runs = runs.slice(0, -1);
    }
    if (runs.length <= 1) return runs;
    let shortest = 0;
    for (let i = 1; i < runs.length; i++) if (runs[i]!.len < runs[shortest]!.len) shortest = i;
    if (runs[shortest]!.len >= minRun) return runs;
    const prev = shortest > 0 ? runs[shortest - 1] : circular ? runs[runs.length - 1] : undefined;
    const next = shortest < runs.length - 1 ? runs[shortest + 1] : circular ? runs[0] : undefined;
    const into = prev && next ? (prev.len >= next.len ? prev : next) : (prev ?? next);
    if (!into) return runs;
    const run = runs[shortest]!;
    // Relabel the short run's edges (e0..e1 may wrap when it is the folded head).
    for (let e = run.e0; ; e = (e + 1) % labels.length) {
      labels[e] = into.label;
      if (e === run.e1) break;
    }
  }
}

/**
 * Split one stroke at reference-label seams. Returns [stroke] (the original
 * object) when the whole stroke belongs to a single reference.
 */
function splitStroke(stroke: GeoStroke, refs: (RefIndex | null)[], options: RegroupOptions): GeoStroke[] {
  if (stroke.points.length < 2) return [stroke];
  const pts = densify(stroke.points, options.spacing);
  // Closed loops label circularly so a seam can fall anywhere on the ring.
  let closed = stroke.isLoop && dist(pts[0]!, pts[pts.length - 1]!) < options.spacing * 2;
  if (closed && dist(pts[0]!, pts[pts.length - 1]!) < 1e-6) pts.pop();
  if (pts.length < 3) closed = false;
  const n = pts.length;
  const edgeCount = closed ? n : n - 1;

  const labels: number[] = [];
  const edgeLens: number[] = [];
  for (let e = 0; e < edgeCount; e++) {
    const a = pts[e]!;
    const b = pts[(e + 1) % n]!;
    const len = dist(a, b);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dir = len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 0, y: 0 };
    const w = (a.width + b.width) / 2;
    let bestLabel = -1;
    let bestCost = Infinity;
    for (let r = 0; r < refs.length; r++) {
      const ref = refs[r];
      if (!ref) continue;
      const proj = projectToRef(mid, ref);
      // Direction penalty: crossing another reference brings the distance
      // near zero, but the travel direction stays ~perpendicular to it.
      const cost = proj.d + (1 - Math.abs(dir.x * proj.tangent.x + dir.y * proj.tangent.y)) * w;
      if (cost < bestCost) {
        bestCost = cost;
        bestLabel = r;
      }
    }
    labels.push(bestLabel);
    edgeLens.push(len);
  }
  if (labels.length === 0 || labels.every((l) => l === labels[0])) return [stroke];

  const runs = smoothRuns(labels, edgeLens, options.minRunLength, closed);
  if (runs.length <= 1) return [stroke];

  // Rebuild runs from the smoothed labels with a stable start: for closed
  // loops rotate so edge 0 begins a run, then cut linearly.
  let start = 0;
  if (closed) {
    for (let e = 0; e < edgeCount; e++) {
      if (labels[e] !== labels[(e - 1 + edgeCount) % edgeCount]) {
        start = e;
        break;
      }
    }
  }
  const parts: GeoStroke[] = [];
  let partPts: AxisPoint[] = [];
  let partLabel = -2;
  for (let k = 0; k < edgeCount; k++) {
    const e = (start + k) % edgeCount;
    const a = pts[e]!;
    const b = pts[(e + 1) % n]!;
    if (labels[e] !== partLabel) {
      if (partPts.length >= 2) parts.push({ points: partPts, isLoop: false, segmentIndices: [...stroke.segmentIndices] });
      partPts = [{ ...a }];
      partLabel = labels[e]!;
    }
    partPts.push({ ...b });
  }
  if (partPts.length >= 2) parts.push({ points: partPts, isLoop: false, segmentIndices: [...stroke.segmentIndices] });
  return parts.length > 1 ? parts : [stroke];
}

interface PieceInfo {
  piece: GeoStroke;
  label: number;
  tMean: number;
  /** Projected t of the first/last point (after any orientation flip). */
  tStart: number;
  tEnd: number;
  /** Mean sample distance to the assigned reference — how well the piece hugs it. */
  meanD: number;
}

/** Assign a whole piece to its nearest reference and orient it along increasing reference t. */
function labelPiece(piece: GeoStroke, refs: (RefIndex | null)[]): PieceInfo | null {
  if (piece.isLoop || piece.points.length < 2) return null;
  const samples = resamplePolyline(piece.points, 12);
  let best = -1;
  let bestD = Infinity;
  let bestT = 0;
  for (let r = 0; r < refs.length; r++) {
    const ref = refs[r];
    if (!ref) continue;
    let sum = 0;
    let tSum = 0;
    for (const s of samples) {
      const proj = projectToRef(s, ref);
      sum += proj.d;
      tSum += proj.t;
    }
    if (sum < bestD) {
      bestD = sum;
      best = r;
      bestT = tSum / samples.length;
    }
  }
  if (best < 0) return null;
  const ref = refs[best]!;
  let tStart = projectToRef(piece.points[0]!, ref).t;
  let tEnd = projectToRef(piece.points[piece.points.length - 1]!, ref).t;
  if (tStart > tEnd) {
    piece.points = [...piece.points].reverse();
    [tStart, tEnd] = [tEnd, tStart];
  }
  return { piece, label: best, tMean: bestT, tStart, tEnd, meanD: bestD / samples.length };
}

/** An edge kept by the overlap dedup, with enough context for coverage tests. */
interface KeptEdge {
  mid: Point;
  dir: Point;
  width: number;
  pieceIdx: number;
  edgeIdx: number;
}

/**
 * Drop ink that re-travels a corridor the group already covers. A heuristic
 * stroke that wanders a fat or looped region (ね's knot, ゅ's loop wrapping
 * its own stem) carries the same corridor two or three times as PARALLEL
 * polyline spans — no chain order can avoid re-drawing them, the duplicated
 * ink itself has to go. Within each reference group, pieces are processed
 * best-hugging-first (dataset-guided: the span that stays closest to the
 * reference is the one that survives). Redundancy is TOPOLOGICAL, not local:
 * a continuation edge just past a split seam looks exactly like a duplicate
 * (same corridor, a width away), but it advances to a NEW interval of the
 * reference's arc length — so an edge is dropped only when its reference
 * arc interval is already covered by kept ink AND a kept edge runs alongside
 * it (within the local ink width, roughly parallel or antiparallel). Pieces
 * are cut at the drop boundaries and the chaining phase reconnects what
 * remains. A final COVERAGE VETO then reinstates any dropped span whose ink
 * is not genuinely re-drawn by kept ink alongside it — pruning may remove
 * duplicated travel, never coverage. Legitimate prescribed doubling (れ's
 * corridor) is protected by the portfolio: dedup only ADDS a piece-set
 * variant, and the re-match arbitrates. Returns null when nothing drops.
 */
function dedupOverlap(
  pieces: GeoStroke[],
  refs: (RefIndex | null)[],
  options: RegroupOptions,
): { pieces: GeoStroke[]; dropped: number } | null {
  const infos: (PieceInfo | null)[] = pieces.map((p) =>
    labelPiece({ points: [...p.points], isLoop: p.isLoop, segmentIndices: [...p.segmentIndices] }, refs),
  );
  const byGroup = new Map<number, number[]>();
  infos.forEach((info, i) => {
    if (!info) return;
    const list = byGroup.get(info.label);
    if (list) list.push(i);
    else byGroup.set(info.label, [i]);
  });

  const out: GeoStroke[] = [];
  for (let i = 0; i < pieces.length; i++) if (!infos[i]) out.push(pieces[i]!); // loops and degenerates pass through

  interface Decision {
    idx: number;
    piece: GeoStroke;
    pts: AxisPoint[];
    keepEdge: boolean[];
  }
  const decisions: Decision[] = [];

  for (const [label, indices] of byGroup) {
    const ref = refs[label];
    if (!ref) {
      for (const idx of indices) out.push(pieces[idx]!);
      continue;
    }
    // Arc-length coverage of the reference, in spacing-sized buckets.
    const bucketCount = Math.max(1, Math.ceil(ref.total / options.spacing));
    const coveredBuckets = new Array<boolean>(bucketCount).fill(false);
    const bucketRange = (tMid: number, len: number): [number, number] => {
      const arc = tMid * ref.total;
      const b0 = Math.max(0, Math.min(bucketCount - 1, Math.floor((arc - len / 2) / options.spacing)));
      const b1 = Math.max(0, Math.min(bucketCount - 1, Math.floor((arc + len / 2) / options.spacing)));
      return [b0, b1];
    };
    // Best-hugging piece first: its spans become the kept baseline.
    indices.sort((a, b) => infos[a]!.meanD - infos[b]!.meanD);
    const kept: KeptEdge[] = [];
    for (const idx of indices) {
      const piece = infos[idx]!.piece;
      const pts = densify(piece.points, options.spacing);
      const keepEdge: boolean[] = [];
      for (let e = 0; e < pts.length - 1; e++) {
        const a = pts[e]!;
        const b = pts[e + 1]!;
        const len = dist(a, b);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const dir = len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 0, y: 0 };
        const w = (a.width + b.width) / 2;
        const [b0, b1] = bucketRange(projectToRef(mid, ref).t, len);
        let covered = true;
        for (let bi = b0; bi <= b1; bi++) if (!coveredBuckets[bi]) covered = false;
        if (covered) {
          // The reference arc here is covered — but only alongside kept ink
          // is this edge a re-travel (far-away same-t ink stays).
          covered = false;
          for (const k of kept) {
            // A hairpin's own turn is not duplication — skip immediate neighbours.
            if (k.pieceIdx === idx && Math.abs(k.edgeIdx - e) <= 2) continue;
            if (Math.abs(dir.x * k.dir.x + dir.y * k.dir.y) < 0.7) continue;
            if (dist(mid, k.mid) <= Math.max(w, k.width)) {
              covered = true;
              break;
            }
          }
        }
        keepEdge.push(!covered);
        if (!covered) {
          for (let bi = b0; bi <= b1; bi++) coveredBuckets[bi] = true;
          kept.push({ mid, dir, width: w, pieceIdx: idx, edgeIdx: e });
        }
      }
      decisions.push({ idx, piece, pts, keepEdge });
    }
  }

  // COVERAGE VETO — pruning must never lose ink. The per-edge test above is
  // a heuristic (reference-arc buckets + midpoint proximity) and misfires
  // when the ink has a feature the reference lacks (a crossbar 7 against a
  // crossbar-less reference: everything projects onto already-covered arcs)
  // or when strokes are wide (a fat straight run sits within an ink width
  // of its own kept edges beyond the hairpin window). So every dropped span
  // must prove, against the kept geometry itself, that its ink is genuinely
  // re-drawn by kept ink running alongside; spans that can't are reinstated.
  const keptSpans: AxisPoint[][] = out.filter((p) => p.points.length >= 2).map((p) => p.points);
  for (const d of decisions) {
    let run: AxisPoint[] = [];
    for (let e = 0; e < d.pts.length - 1; e++) {
      if (d.keepEdge[e]) {
        if (run.length === 0) run.push(d.pts[e]!);
        run.push(d.pts[e + 1]!);
      } else {
        if (run.length >= 2) keptSpans.push(run);
        run = [];
      }
    }
    if (run.length >= 2) keptSpans.push(run);
  }
  for (const d of decisions) {
    let from = -1;
    for (let e = 0; e <= d.keepEdge.length; e++) {
      const dropping = e < d.keepEdge.length && !d.keepEdge[e];
      if (dropping && from < 0) from = e;
      if (!dropping && from >= 0) {
        // A span long enough to read as a stroke of its own must prove it is
        // a pure corridor duplicate; short jitter gets the lenient test.
        const slice = d.pts.slice(from, e + 1);
        const gap = spanCoverageGap(slice, keptSpans, polylineLength(slice) >= options.minRunLength);
        if (gap) {
          if (DEBUG) {
            console.log(
              `[dedup] veto (${gap}): reinstated (${d.pts[from]!.x.toFixed(0)},${d.pts[from]!.y.toFixed(0)})..(${d.pts[e]!.x.toFixed(0)},${d.pts[e]!.y.toFixed(0)}) of piece ${d.idx}`,
            );
          }
          for (let k = from; k < e; k++) d.keepEdge[k] = true;
        }
        from = -1;
      }
    }
  }

  let dropped = 0;
  for (const d of decisions) {
    const { idx, piece, pts, keepEdge } = d;
    for (let e = 0; e < keepEdge.length; e++) if (!keepEdge[e]) dropped += dist(pts[e]!, pts[e + 1]!);
    if (DEBUG) {
      const spans: string[] = [];
      let from = -1;
      for (let e = 0; e <= keepEdge.length; e++) {
        const drop = e < keepEdge.length && !keepEdge[e];
        if (drop && from < 0) from = e;
        if (!drop && from >= 0) {
          spans.push(`(${pts[from]!.x.toFixed(0)},${pts[from]!.y.toFixed(0)})..(${pts[e]!.x.toFixed(0)},${pts[e]!.y.toFixed(0)})`);
          from = -1;
        }
      }
      if (spans.length > 0) {
        console.log(
          `[dedup] piece ${idx} label ${infos[idx]!.label} meanD ${infos[idx]!.meanD.toFixed(0)} len ${polylineLength(piece.points).toFixed(0)}: dropped ${spans.join(' ')}`,
        );
      }
    }
    // Cut into sub-pieces at drop boundaries; slivers dissolve.
    let run: AxisPoint[] = [];
    const flush = () => {
      if (run.length >= 2 && polylineLength(run) >= options.spacing) {
        out.push({ points: run, isLoop: false, segmentIndices: [...piece.segmentIndices] });
      }
      run = [];
    };
    for (let e = 0; e < pts.length - 1; e++) {
      if (keepEdge[e]) {
        if (run.length === 0) run.push({ ...pts[e]! });
        run.push({ ...pts[e + 1]! });
      } else {
        flush();
      }
    }
    flush();
  }
  if (DEBUG && dropped > 0) {
    const keptLen = out.reduce((s, p) => s + polylineLength(p.points), 0);
    const inLen = pieces.reduce((s, p) => s + polylineLength(p.points), 0);
    console.log(`[dedup] total: in ${inLen.toFixed(0)}, kept ${keptLen.toFixed(0)}, dropped ${dropped.toFixed(0)}`);
  }
  return dropped > 0 ? { pieces: out, dropped } : null;
}

/**
 * Is `span`'s ink genuinely re-drawn by kept ink running ALONGSIDE it? Each
 * sample (an edge midpoint — never a vertex shared with a kept run) must
 * find a kept span within an ink width, roughly parallel (or antiparallel)
 * to its edge. Two refusals separate real duplicates from gaps cut out of a
 * stroke's middle: a hit landing on a kept span's terminal vertex counts
 * only when the sample sits BESIDE that end, not in its forward cone (a
 * collinear gap continues past the fragment's end; a loop-closure duplicate
 * lies laterally next to it), and an interior hit must run parallel so a
 * perpendicular crossing stroke (a crossbar over its stem) can't vouch for
 * ink it doesn't re-draw — unless the sample sits inside the kept pen's own
 * radius, where the kept stroke paints it whatever its direction (hairpin
 * turn TIPS point sideways mid-duplicate). A qualifying kept pen must also
 * PAINT the dropped disk, short of `DEDUP_PAINT_SLACK` of its width: an axis
 * a width away is alongside, but in a fat junction (Playfair Display 9's
 * bowl meeting its tail) that leaves the far half of a 100-unit pen's ink
 * bare. Covered when most samples qualify — returns null (the drop may
 * stand), else which condition failed.
 *
 * `strict` drops both leniencies (no clamped qualification, no pen-disk
 * direction bypass): only interior parallel hits count. Anything long
 * enough to read as a stroke of its own must pass this bar — a fat crossing
 * feature sits inside the crossing stroke's pen radius without being a
 * duplicate of anything, and only pure corridor re-travel survives strict.
 */
/** Share of a dropped point's width a kept pen may leave unpainted and still re-draw it (see spanCoverageGap). */
const DEDUP_PAINT_SLACK = 0.25;

function spanCoverageGap(span: AxisPoint[], keptSpans: AxisPoint[][], strict = false): 'far' | 'static' | null {
  if (span.length < 2 || polylineLength(span) <= 0) return null;
  let far = false;
  let qualified = 0;
  const samples = span.length - 1;
  for (let s = 0; s < span.length - 1; s++) {
    const a = span[s]!;
    const b = span[s + 1]!;
    const edgeLen = dist(a, b);
    if (edgeLen <= 0) {
      qualified++;
      continue;
    }
    const p: AxisPoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, width: (a.width + b.width) / 2 };
    const dir = { x: (b.x - a.x) / edgeLen, y: (b.y - a.y) / edgeLen };
    let near = false;
    let alongside = false;
    for (const ks of keptSpans) {
      const hit = projectOntoPolyline(ks, p);
      if (!hit || hit.d > Math.max(p.width, hit.q.width)) continue;
      near = true;
      if (hit.d + p.width / 2 > hit.q.width / 2 + DEDUP_PAINT_SLACK * p.width) continue;
      const ha = ks[hit.seg]!;
      const hb = ks[hit.seg + 1]!;
      const segLen = dist(ha, hb);
      if (segLen <= 0) continue;
      const tangent = { x: (hb.x - ha.x) / segLen, y: (hb.y - ha.y) / segLen };
      const clamped = dist(hit.q, ks[0]!) < 1e-6 || dist(hit.q, ks[ks.length - 1]!) < 1e-6;
      if (clamped) {
        if (strict) continue;
        if (hit.d <= 0) continue; // the sample IS the terminal vertex — touching, not alongside
        const away = { x: (p.x - hit.q.x) / hit.d, y: (p.y - hit.q.y) / hit.d };
        if (Math.abs(away.x * tangent.x + away.y * tangent.y) >= 0.7) continue; // forward cone: a continuation gap
      } else if ((strict || hit.d > hit.q.width / 2) && Math.abs(dir.x * tangent.x + dir.y * tangent.y) < 0.7) {
        continue;
      }
      alongside = true;
      break;
    }
    if (!near) far = true;
    if (alongside) qualified++;
  }
  if (qualified >= samples * 0.6) return null;
  return far ? 'far' : 'static';
}

/**
 * Lift MISFIT pieces out as standalone EXTRA strokes. A piece is a misfit
 * when it is long enough to read as a pen stroke of its own, everything it
 * contributes to its reference stroke's arc is already covered by
 * better-hugging pieces of the same group (removing it from the chain loses
 * no reference coverage), and its ink is NOT a strict corridor duplicate of
 * that better ink — it is a real feature the reference simply doesn't have:
 * a crossed 7's crossbar, a Z̶'s middle dash, serif flourishes, the personal
 * marks of casual handwriting. Corridor duplicates stay for dedup to prune;
 * misfits become their own strokes so the chains can match the reference
 * cleanly, with the extras appended after the prescribed order.
 */
function liftMisfits(
  pieces: GeoStroke[],
  refs: (RefIndex | null)[],
  options: RegroupOptions,
): { pieces: GeoStroke[]; extras: GeoStroke[] } | null {
  const infos: (PieceInfo | null)[] = pieces.map((p) =>
    labelPiece({ points: [...p.points], isLoop: p.isLoop, segmentIndices: [...p.segmentIndices] }, refs),
  );
  const byGroup = new Map<number, number[]>();
  infos.forEach((info, i) => {
    if (!info) return;
    const list = byGroup.get(info.label);
    if (list) list.push(i);
    else byGroup.set(info.label, [i]);
  });

  const lifted = new Set<number>();
  for (const [label, indices] of byGroup) {
    const ref = refs[label];
    if (!ref || indices.length < 2) continue;
    const bucketCount = Math.max(1, Math.ceil(ref.total / options.spacing));
    const covered = new Array<boolean>(bucketCount).fill(false);
    const bucketRange = (tMid: number, len: number): [number, number] => {
      const arc = tMid * ref.total;
      const b0 = Math.max(0, Math.min(bucketCount - 1, Math.floor((arc - len / 2) / options.spacing)));
      const b1 = Math.max(0, Math.min(bucketCount - 1, Math.floor((arc + len / 2) / options.spacing)));
      return [b0, b1];
    };
    // Best-hugging first: each piece is judged against the arc coverage of
    // the pieces that fit the reference better than it does.
    indices.sort((a, b) => infos[a]!.meanD - infos[b]!.meanD);
    const betterInk: AxisPoint[][] = [];
    for (const idx of indices) {
      const piece = infos[idx]!.piece;
      const pts = densify(piece.points, options.spacing);
      let total = 0;
      let redundant = 0;
      const ranges: [number, number][] = [];
      for (let e = 0; e < pts.length - 1; e++) {
        const a = pts[e]!;
        const b = pts[e + 1]!;
        const len = dist(a, b);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const [b0, b1] = bucketRange(projectToRef(mid, ref).t, len);
        ranges.push([b0, b1]);
        total += len;
        let dup = true;
        for (let bi = b0; bi <= b1; bi++) if (!covered[bi]) dup = false;
        if (dup) redundant += len;
      }
      const misfit =
        betterInk.length > 0 && total >= options.minRunLength && redundant >= total * 0.7 && spanCoverageGap(pts, betterInk, true) !== null;
      if (misfit) {
        lifted.add(idx);
        if (DEBUG) {
          const f = piece.points[0]!;
          const l = piece.points[piece.points.length - 1]!;
          console.log(
            `[lift] piece ${idx} label ${label} len ${total.toFixed(0)} (${f.x.toFixed(0)},${f.y.toFixed(0)})->(${l.x.toFixed(0)},${l.y.toFixed(0)}): misfit stroke, lifted as extra`,
          );
        }
        continue; // its buckets don't count — the chain must cover them without it
      }
      for (const [b0, b1] of ranges) for (let bi = b0; bi <= b1; bi++) covered[bi] = true;
      betterInk.push(piece.points);
    }
  }
  if (lifted.size === 0) return null;
  return {
    pieces: pieces.filter((_, i) => !lifted.has(i)),
    extras: pieces.filter((_, i) => lifted.has(i)),
  };
}

/**
 * Most of an extra's centerline, in pen widths, the chains may leave unpainted
 * for it to be dropped as a duplicate. A length, not a share: a short link
 * whose two ends sit inside other strokes (Caveat P's stem-to-bowl join) is
 * mostly "covered" but still bridges a visible gap.
 */
const FOLD_UNCOVERED_MAX_WIDTHS = 0.25;
/** Max angle between a chain's outward direction and an extra leaving from its end (a continuation, not a branch). */
const FOLD_CONTINUE_MAX_DEG = 50;
/**
 * Max angle between a chain end's heading over one pen width and its course
 * over FOLD_COURSE_WIDTHS: a chain that ends in a junction hook (a 横 whose
 * chain finishes on the 撇's pass up through their crossing) isn't heading
 * anywhere an extra could continue it.
 */
const FOLD_END_HOOK_MAX_DEG = 60;
const FOLD_COURSE_WIDTHS = 3;

/** Unit direction pointing OUT of a polyline at one end, measured over `reach` of arc. */
function outwardDirection(pts: AxisPoint[], atHead: boolean, reach: number): Point {
  const seq = atHead ? pts : [...pts].reverse();
  const end = seq[0]!;
  let inner = seq[seq.length - 1]!;
  let walked = 0;
  for (let i = 1; i < seq.length; i++) {
    walked += dist(seq[i - 1]!, seq[i]!);
    if (walked >= reach) {
      inner = seq[i]!;
      break;
    }
  }
  const len = dist(end, inner) || 1;
  return { x: (end.x - inner.x) / len, y: (end.y - inner.y) / len };
}

const angleDeg = (a: Point, b: Point) => (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y))) * 180) / Math.PI;

/**
 * Fold LIFTED extras back into the chains when they belong to a chained
 * stroke after all. Lifting judges a piece against its reference ARC, and ink
 * that runs past the end of the reference stroke projects onto an end that
 * better pieces already cover — so it reads as a misfit. In kaishu that ink
 * is ordinary: a 撇 starting above the 横 it crosses, a 横 running on past
 * the 撇, the curl where 口's 横折 begins (LXGW WenKai against Make Me a
 * Hanzi's medians). Drawn after the prescribed order, each is a late blip
 * away from its stroke. Three cases, retried until none applies:
 * - covered: the chains already paint the extra's ink — drop it;
 * - continuation: an extra end within join reach of a chain end, the extra
 *   leaving in the chain's own direction there — extend the chain;
 * - splice: the extra's ends on the two ends of a short chain section (the
 *   straight jump chaining bridged a junction with) — the extra replaces it.
 * A separate feature (a crossed 7's bar crosses its stem mid-way, free at
 * both ends) matches none of them and stays an extra.
 */
export function foldExtras(
  chains: GeoStroke[],
  extras: GeoStroke[],
  references: Point[][],
  options: RegroupOptions,
): { chains: GeoStroke[]; extras: GeoStroke[]; folded: number; dropped: number } {
  return foldIndexed(chains, extras, references.map(indexRef), options);
}

function foldIndexed(
  chains: GeoStroke[],
  extras: GeoStroke[],
  refs: (RefIndex | null)[],
  options: RegroupOptions,
): { chains: GeoStroke[]; extras: GeoStroke[]; folded: number; dropped: number } {
  const work = chains.map((c) => ({ ...c, points: c.points.map((p) => ({ ...p })) }));
  let left = extras.map((e) => ({ ...e, points: e.points.map((p) => ({ ...p })) }));
  let folded = 0;
  let dropped = 0;

  // Whether the chains already paint an extra's ink, bar under half a pen width of it.
  const isCovered = (pts: AxisPoint[]) => {
    const samples = densify(pts, options.spacing);
    const step = polylineLength(pts) / Math.max(samples.length - 1, 1);
    let uncovered = 0;
    let width = 0;
    for (const p of samples) {
      width += p.width;
      if (
        !work.some((c) => {
          const hit = projectOntoPolyline(c.points, p);
          return hit !== null && hit.d <= hit.q.width / 2;
        })
      )
        uncovered += step;
    }
    return uncovered <= FOLD_UNCOVERED_MAX_WIDTHS * (width / samples.length);
  };

  // Mean distance of a polyline's samples to each reference stroke.
  const refDistances = (pts: AxisPoint[]) => {
    const samples = resamplePolyline(pts, 12);
    return refs.map((ref) => (ref ? samples.reduce((sum, q) => sum + projectToRef(q, ref).d, 0) / samples.length : Infinity));
  };

  const tryContinuation = (extra: GeoStroke): boolean => {
    const extraD = refDistances(extra.points);
    const nearestD = Math.min(...extraD);
    const extraLen = polylineLength(extra.points);
    let best: { chain: number; chainHead: boolean; extraHead: boolean; kept: AxisPoint[]; trimmed: number; score: number } | null = null;
    for (let c = 0; c < work.length; c++) {
      const chain = work[c]!;
      if (chain.isLoop || chain.points.length < 2) continue;
      const chainLabel = labelPiece(chain, refs)?.label;
      const offReference = chainLabel === undefined ? 0 : extraD[chainLabel]! - nearestD;
      const chainLen = polylineLength(chain.points);
      for (const chainHead of [true, false]) {
        const ce = chainHead ? chain.points[0]! : chain.points[chain.points.length - 1]!;
        // Tie-break only: registration of a reference onto a font whose
        // proportions differ mislabels junction pieces, so it never vetoes.
        const offWidths = offReference / Math.max(ce.width, 1);
        for (const extraHead of [true, false]) {
          const ee = extraHead ? extra.points[0]! : extra.points[extra.points.length - 1]!;
          const reach = joinTolerance(ce, ee, options.glyphDiag);
          // Two joints: the chain end itself, or — when the extra lands ON
          // the chain within a junction's reach of that end — the landing
          // point, trimming the jog between (chaining often starts a stroke
          // with a sideways step through the junction it leaves).
          const joints: { kept: AxisPoint[]; trimmed: number; gap: number }[] = [{ kept: chain.points, trimmed: 0, gap: dist(ce, ee) }];
          const hit = projectOntoPolyline(chain.points, ee);
          if (hit && hit.d <= hit.q.width / 2) {
            const trimmed = chainHead
              ? lengthFromHeadToHit(chain.points, hit.seg, hit.q)
              : lengthFromHitToTail(chain.points, hit.seg, hit.q);
            if (trimmed > 0 && trimmed <= reach && chainLen - trimmed >= 2 * trimmed) {
              const kept = chainHead ? [hit.q, ...chain.points.slice(hit.seg + 1)] : [...chain.points.slice(0, hit.seg + 1), hit.q];
              joints.push({ kept, trimmed, gap: hit.d });
            }
          }
          for (const { kept, trimmed, gap } of joints) {
            if (gap > reach) continue;
            const joint = chainHead ? kept[0]! : kept[kept.length - 1]!;
            const out = outwardDirection(kept, chainHead, joint.width);
            const course = outwardDirection(kept, chainHead, FOLD_COURSE_WIDTHS * joint.width);
            if (angleDeg(out, course) > FOLD_END_HOOK_MAX_DEG) continue;
            // The extra must leave the joint the way the chain was heading
            // (its chord from the joint to its far end, which points out at the far end)…
            const away = outwardDirection(extra.points, !extraHead, extraLen);
            const bend = angleDeg(out, away);
            if (bend > FOLD_CONTINUE_MAX_DEG) continue;
            // …and a gap wider than the pen must lie ahead of the chain end, not beside it.
            if (gap > joint.width / 2 && angleDeg(out, { x: (ee.x - joint.x) / gap, y: (ee.y - joint.y) / gap }) > 60) continue;
            const score = bend + ((gap + trimmed) / reach) * 30 + 10 * offWidths;
            if (!best || score < best.score) best = { chain: c, chainHead, extraHead, kept, trimmed, score };
          }
        }
      }
    }
    if (!best) return false;
    const chain = work[best.chain]!;
    if (DEBUG) {
      const e0 = extra.points[0]!;
      console.log(
        `[fold] continuation: extra (${e0.x.toFixed(0)},${e0.y.toFixed(0)}) len ${extraLen.toFixed(0)} onto chain ${best.chain} ${best.chainHead ? 'head' : 'tail'}${best.trimmed > 0 ? ` (trimmed ${best.trimmed.toFixed(0)})` : ''}, score ${best.score.toFixed(1)}`,
      );
    }
    // Orient the extra to run away from the joint, then attach it on that side.
    const leaving = best.extraHead ? extra.points : [...extra.points].reverse();
    const points: AxisPoint[] = [];
    if (best.chainHead) {
      appendDedup(points, [...leaving].reverse());
      appendDedup(points, best.kept);
    } else {
      appendDedup(points, best.kept);
      appendDedup(points, leaving);
    }
    dropped += best.trimmed;
    work[best.chain] = { ...chain, points, segmentIndices: [...chain.segmentIndices, ...extra.segmentIndices] };
    return true;
  };

  const trySplice = (extra: GeoStroke): boolean => {
    const a = extra.points[0]!;
    const b = extra.points[extra.points.length - 1]!;
    const extraLen = polylineLength(extra.points);
    for (let c = 0; c < work.length; c++) {
      const chain = work[c]!;
      if (chain.isLoop) continue;
      const ha = projectOntoPolyline(chain.points, a);
      const hb = projectOntoPolyline(chain.points, b);
      if (!ha || !hb || ha.d > ha.q.width / 2 || hb.d > hb.q.width / 2) continue;
      const section = polylineLength(walkBetween(chain.points, ha.seg, ha.q, hb.seg, hb.q));
      // Only a junction-sized section is replaced — never the chain's own ink run.
      if (section > joinTolerance(ha.q, hb.q, options.glyphDiag) || section >= extraLen) continue;
      const [first, second, run] =
        ha.seg < hb.seg || (ha.seg === hb.seg && dist(chain.points[ha.seg]!, ha.q) <= dist(chain.points[hb.seg]!, hb.q))
          ? [ha, hb, extra.points]
          : [hb, ha, [...extra.points].reverse()];
      if (DEBUG)
        console.log(
          `[fold] splice: extra (${a.x.toFixed(0)},${a.y.toFixed(0)})-(${b.x.toFixed(0)},${b.y.toFixed(0)}) into chain ${c}, section ${section.toFixed(0)}`,
        );
      const points: AxisPoint[] = [];
      appendDedup(points, chain.points.slice(0, first.seg + 1));
      appendDedup(points, run);
      appendDedup(points, chain.points.slice(second.seg + 1));
      work[c] = { ...chain, points, segmentIndices: [...chain.segmentIndices, ...extra.segmentIndices] };
      return true;
    }
    return false;
  };

  for (let progress = true; progress && left.length > 0; ) {
    progress = false;
    const next: GeoStroke[] = [];
    for (const extra of left) {
      if (extra.isLoop || extra.points.length < 2) {
        next.push(extra);
      } else if (isCovered(extra.points)) {
        dropped += polylineLength(extra.points);
        progress = true;
      } else if (tryContinuation(extra) || trySplice(extra)) {
        folded++;
        progress = true;
      } else {
        next.push(extra);
      }
    }
    left = next;
  }
  return { chains: work, extras: left, folded, dropped };
}

/**
 * How a group's pieces are ordered while chaining:
 * - 'reference': strict projected-t order, each piece joins the previous one
 *   or breaks the chain. Right when pieces project cleanly onto the
 *   reference (れ).
 * - 'continuity': greedy cheapest-feasible-continuation. Right when the
 *   reference passes back over itself and projected t's turn ambiguous
 *   (ね's sweep crosses its own descent) — strict t-order there stitches
 *   non-adjacent pieces with glyph-spanning retraces.
 * - 'global': subset-DP (Held-Karp) over the pairwise join-cost matrix —
 *   the cheapest order over the WHOLE group. Greedy locks in a cheap first
 *   join and then strands the dense self-crossing tail pieces of ね/ゅ into
 *   back-and-forth bounces; the DP pays a little more early to avoid a lot
 *   later.
 * None dominates, so the caller builds ALL and keeps whichever re-matches
 * the reference better.
 */
type ChainStrategy = 'reference' | 'continuity' | 'global';

/** How the winning candidate attaches to the chain. */
type Join =
  | { kind: 'plain' }
  | { kind: 'retrace'; pair: PairHit }
  | { kind: 'via'; corridor: AxisPoint[]; entry: PolylineHit; pair: PairHit };

/**
 * Cheapest feasible join attaching `cand` after `current`'s tail. Three join
 * kinds, all font ink only — the re-match decides whether the doubled travel
 * is what the reference actually prescribes:
 * - PLAIN: end-to-end, costs its hop.
 * - RETRACE: the pieces touch at their interiors — connect at the nearest
 *   pair of points by re-traveling their own ink (れ's descent and ascent
 *   share ONE extracted diagonal; わ's crossing spur backs out the way it
 *   came). Pays half the doubled travel, so a short corridor beats a
 *   glyph-spanning back-walk. Every vertex-projection meeting pair is
 *   considered and the full cost minimized, not just the closest pair — a
 *   marginally farther meeting with far shorter walks is the better pen path
 *   (and the endpoint-anchored joins are always in this candidate set).
 * - VIA: the connection runs through a THIRD piece's polyline — わ's second
 *   stroke reaches its descent by riding the crossing blob, ink the matcher
 *   assigned to the STEM. Hop onto the corridor, walk it to where the next
 *   piece touches, then enter as a retrace.
 */
function findJoin(
  current: AxisPoint[],
  cand: AxisPoint[],
  corridors: GeoStroke[],
  glyphDiag: number,
  allowVia: boolean,
): { cost: number; join: Join } | null {
  const tail = current[current.length - 1]!;
  const head = cand[0]!;
  let bestCost = Infinity;
  let bestJoin: Join | null = null;
  const hop = dist(tail, head);
  if (hop <= joinTolerance(tail, head, glyphDiag)) {
    bestCost = hop;
    bestJoin = { kind: 'plain' };
  } else {
    const meetings: PairHit[] = [];
    for (let vi = 0; vi < current.length; vi++) {
      const hit = projectOntoPolyline(cand, current[vi]!);
      if (hit) meetings.push({ d: hit.d, qa: current[vi]!, segA: Math.min(vi, current.length - 2), qb: hit.q, segB: hit.seg });
    }
    for (let vj = 0; vj < cand.length; vj++) {
      const hit = projectOntoPolyline(current, cand[vj]!);
      if (hit) meetings.push({ d: hit.d, qa: hit.q, segA: hit.seg, qb: cand[vj]!, segB: Math.min(vj, cand.length - 2) });
    }
    for (const pair of meetings) {
      if (pair.d > joinTolerance(pair.qa, pair.qb, glyphDiag)) continue;
      const cost = pair.d + 0.5 * (lengthFromHitToTail(current, pair.segA, pair.qa) + lengthFromHeadToHit(cand, pair.segB, pair.qb));
      if (cost < bestCost) {
        bestCost = cost;
        bestJoin = { kind: 'retrace', pair };
      }
    }
    if (allowVia) {
      for (const via of corridors) {
        const corridor = via.points;
        if (corridor.length < 2 || corridor === current || corridor === cand) continue;
        const entry = projectOntoPolyline(corridor, tail);
        if (!entry || entry.d > joinTolerance(tail, entry.q, glyphDiag)) continue;
        const exitPair = nearestPolylinePair(corridor, cand);
        if (!exitPair || exitPair.d > joinTolerance(exitPair.qa, exitPair.qb, glyphDiag)) continue;
        const walk = Math.abs(
          lengthFromHeadToHit(corridor, entry.seg, entry.q) - lengthFromHeadToHit(corridor, exitPair.segA, exitPair.qa),
        );
        const cost = entry.d + exitPair.d + 0.5 * (walk + lengthFromHeadToHit(cand, exitPair.segB, exitPair.qb));
        if (cost < bestCost) {
          bestCost = cost;
          bestJoin = { kind: 'via', corridor, entry, pair: exitPair };
        }
      }
    }
  }
  return bestJoin ? { cost: bestCost, join: bestJoin } : null;
}

/** Groups larger than this skip the DP (2^n states) and keep greedy orders. */
const GLOBAL_DP_MAX = 12;
/** Cost of an infeasible adjacency: forces a chain break only when unavoidable. */
const INFEASIBLE = 1e9;

/**
 * Cheapest chain order over the WHOLE group: Held-Karp subset DP over the
 * pairwise join-cost matrix (directed — pieces are already oriented along
 * the reference), free choice of starting piece. Pairwise costs approximate
 * the real splice (which joins from the accumulated chain's tail), but the
 * approximation is exact precisely for the good orders — the ones whose
 * joins stay local. Returns null when the group is trivial or too large.
 */
function orderGlobally(infos: PieceInfo[], corridors: GeoStroke[], glyphDiag: number, allowVia: boolean): PieceInfo[] | null {
  const n = infos.length;
  if (n < 2 || n > GLOBAL_DP_MAX) return null;
  const cost: number[][] = infos.map(() => new Array(n).fill(INFEASIBLE));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const found = findJoin(infos[i]!.piece.points, infos[j]!.piece.points, corridors, glyphDiag, allowVia);
      if (found) cost[i]![j] = found.cost;
    }
  }
  const size = 1 << n;
  const dp: Float64Array[] = Array.from({ length: size }, () => new Float64Array(n).fill(Infinity));
  const parent: Int8Array[] = Array.from({ length: size }, () => new Int8Array(n).fill(-1));
  for (let i = 0; i < n; i++) dp[1 << i]![i] = 0;
  for (let mask = 1; mask < size; mask++) {
    for (let last = 0; last < n; last++) {
      const base = dp[mask]![last]!;
      if (!Number.isFinite(base) || (mask & (1 << last)) === 0) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const total = base + cost[last]![next]!;
        const to = mask | (1 << next);
        if (total < dp[to]![next]!) {
          dp[to]![next] = total;
          parent[to]![next] = last;
        }
      }
    }
  }
  const full = size - 1;
  let end = 0;
  for (let i = 1; i < n; i++) if (dp[full]![i]! < dp[full]![end]!) end = i;
  if (!Number.isFinite(dp[full]![end]!)) return null;
  const order: number[] = [];
  let mask = full;
  let at = end;
  while (at >= 0) {
    order.push(at);
    const prev = parent[mask]![at]!;
    mask &= ~(1 << at);
    at = prev;
  }
  order.reverse();
  return order.map((i) => infos[i]!);
}

/** Concatenate `b` after `a` per the join's prescription (see findJoin). */
function spliceJoin(a: AxisPoint[], b: AxisPoint[], join: Join): AxisPoint[] {
  const joined = a.map((p) => ({ ...p }));
  if (join.kind === 'retrace') {
    appendDedup(joined, [...a.slice(join.pair.segA + 1, a.length - 1).reverse(), join.pair.qa]);
    appendDedup(joined, [join.pair.qb, ...b.slice(0, join.pair.segB + 1).reverse()]);
  } else if (join.kind === 'via') {
    appendDedup(joined, walkBetween(join.corridor, join.entry.seg, join.entry.q, join.pair.segA, join.pair.qa));
    appendDedup(joined, [join.pair.qb, ...b.slice(0, join.pair.segB + 1).reverse()]);
  }
  appendDedup(joined, b);
  return joined;
}

/**
 * Corrective moves for proportion drift between the dataset and the font.
 * Both are consulted only in the caller's SECOND portfolio phase (when the
 * plain portfolio produced nothing adoptable), so passing glyphs never see
 * them:
 * - fillEmpty: KanjiVG draws components wider/narrower than the font, so a
 *   whole reference stroke can land off-ink and win NO pieces — its real ink
 *   labels to whatever it crosses (星's 日-left vertical, 歌's 口-left, 歩's
 *   right dot). Move the nearest spare piece into each empty group.
 * - rescue: the same drift labels a piece into a group it cannot CHAIN in
 *   (む's top-bar-left labels the big loop stroke; 船's hook labels a dot).
 *   A group emitting several chains is a defect — every group is exactly one
 *   reference stroke — so surplus chains re-attach to whichever chain their
 *   ink actually touches, either end, reversal allowed.
 */
interface ChainExtras {
  fillEmpty: boolean;
  rescue: boolean;
}

/** Merge phase for one strategy: label + orient piece clones, chain per group. */
function chainPieces(
  pieces: GeoStroke[],
  refs: (RefIndex | null)[],
  options: RegroupOptions,
  strategy: ChainStrategy,
  allowVia: boolean,
  extras: ChainExtras,
): { strokes: GeoStroke[]; merges: number; retraces: number; filled: number } {
  const out: GeoStroke[] = [];
  const groups = new Map<number, PieceInfo[]>();
  for (const piece of pieces) {
    // Clone: chaining reorients and concatenates polylines, and the same
    // piece set feeds every strategy (and the caller may reject everything —
    // the heuristic originals must survive untouched).
    const info = labelPiece({ points: [...piece.points], isLoop: piece.isLoop, segmentIndices: [...piece.segmentIndices] }, refs);
    if (!info) {
      out.push(piece); // loops and degenerates pass through unmerged
      continue;
    }
    const list = groups.get(info.label);
    if (list) list.push(info);
    else groups.set(info.label, [info]);
  }

  let filled = 0;
  if (extras.fillEmpty) {
    for (let r = 0; r < refs.length; r++) {
      const ref = refs[r];
      if (!ref || groups.has(r)) continue;
      let best: { list: PieceInfo[]; idx: number; d: number; t: number } | null = null;
      for (const list of groups.values()) {
        // Taking a group's only piece would just relocate the hole.
        if (list.length < 2) continue;
        for (let i = 0; i < list.length; i++) {
          const samples = resamplePolyline(list[i]!.piece.points, 12);
          let sum = 0;
          let tSum = 0;
          for (const s of samples) {
            const proj = projectToRef(s, ref);
            sum += proj.d;
            tSum += proj.t;
          }
          const d = sum / samples.length;
          if (!best || d < best.d) best = { list, idx: i, d, t: tSum / samples.length };
        }
      }
      // Never conscript ink beyond a quarter-diagonal — the reference stroke
      // may be genuinely absent from the font.
      if (!best || best.d > options.glyphDiag * 0.25) continue;
      const info = best.list.splice(best.idx, 1)[0]!;
      const piece = info.piece;
      let tStart = projectToRef(piece.points[0]!, ref).t;
      let tEnd = projectToRef(piece.points[piece.points.length - 1]!, ref).t;
      if (tStart > tEnd) {
        piece.points = [...piece.points].reverse();
        [tStart, tEnd] = [tEnd, tStart];
      }
      groups.set(r, [{ piece, label: r, tMean: best.t, tStart, tEnd, meanD: best.d }]);
      filled++;
    }
  }

  let merges = 0;
  let retraces = 0;
  const chains: { stroke: GeoStroke; label: number }[] = [];

  for (const [label, infos] of groups) {
    let pending = [...infos].sort((a, b) => a.tMean - b.tMean);
    if (strategy === 'global') {
      const ordered = orderGlobally(pending, pieces, options.glyphDiag, allowVia);
      if (ordered) pending = ordered;
    }
    let current: GeoStroke | null = null;
    while (pending.length > 0 || current) {
      if (!current) {
        current = pending.shift()!.piece;
        continue;
      }
      if (pending.length === 0) {
        chains.push({ stroke: current, label });
        current = null;
        continue;
      }
      // Cheapest feasible continuation among the scanned candidates —
      // 'continuity' scans everything pending, the fixed-order strategies
      // only the prescribed next piece (see findJoin for the join kinds).
      const scan = strategy === 'continuity' ? pending.length : 1;
      let bestIdx = -1;
      let bestJoin: Join | null = null;
      let bestCost = Infinity;
      for (let i = 0; i < scan; i++) {
        const found = findJoin(current.points, pending[i]!.piece.points, pieces, options.glyphDiag, allowVia);
        if (found && found.cost < bestCost) {
          bestCost = found.cost;
          bestIdx = i;
          bestJoin = found.join;
        }
      }
      if (bestIdx < 0 || !bestJoin) {
        chains.push({ stroke: current, label });
        current = null;
        continue;
      }
      const piece = pending[bestIdx]!.piece;
      pending.splice(bestIdx, 1);
      if (bestJoin.kind !== 'plain') retraces++;
      current.points = spliceJoin(current.points, piece.points, bestJoin);
      current.segmentIndices = [...current.segmentIndices, ...piece.segmentIndices];
      merges++;
    }
  }

  if (extras.rescue) {
    // Every group is exactly one reference stroke, so a group emitting
    // several chains is a defect. Strands (all but the longest chain per
    // group) re-attach to whichever chain their ink touches — any group,
    // either end, reversal allowed.
    const byLabel = new Map<number, typeof chains>();
    for (const c of chains) {
      const list = byLabel.get(c.label);
      if (list) list.push(c);
      else byLabel.set(c.label, [c]);
    }
    const strands: typeof chains = [];
    for (const list of byLabel.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => polylineLength(b.stroke.points) - polylineLength(a.stroke.points));
      strands.push(...sorted.slice(1));
    }
    strands.sort((a, b) => polylineLength(a.stroke.points) - polylineLength(b.stroke.points));
    for (const strand of strands) {
      const at = chains.indexOf(strand);
      if (at < 0) continue; // already consumed by an earlier rescue
      const fwd = strand.stroke.points;
      const rev = [...fwd].reverse();
      let best: { target: (typeof chains)[number]; a: AxisPoint[]; b: AxisPoint[]; join: Join; cost: number } | null = null;
      for (const target of chains) {
        if (target === strand) continue;
        const arrangements: [AxisPoint[], AxisPoint[]][] = [
          [target.stroke.points, fwd],
          [target.stroke.points, rev],
          [fwd, target.stroke.points],
          [rev, target.stroke.points],
        ];
        for (const [a, b] of arrangements) {
          const found = findJoin(a, b, pieces, options.glyphDiag, allowVia);
          if (found && (!best || found.cost < best.cost)) best = { target, a, b, join: found.join, cost: found.cost };
        }
      }
      if (!best) continue;
      if (best.join.kind !== 'plain') retraces++;
      best.target.stroke.points = spliceJoin(best.a, best.b, best.join);
      best.target.stroke.segmentIndices = [...best.target.stroke.segmentIndices, ...strand.stroke.segmentIndices];
      chains.splice(at, 1);
      merges++;
    }
  }

  return { strokes: [...out, ...chains.map((c) => c.stroke)], merges, retraces, filled };
}

/**
 * Re-group assembled strokes to the reference's segmentation: split strokes
 * at reference-label seams, then chain same-reference pieces. Both chain
 * strategies are built and scored against the reference; the better proposal
 * is returned. Returns null when nothing changed (the caller skips
 * re-validation).
 */
export function regroupStrokesByReference(strokes: GeoStroke[], references: Point[][], options: RegroupOptions): RegroupResult | null {
  if (strokes.length === 0 || references.length === 0) return null;
  const refs = references.map(indexRef);
  if (refs.every((r) => r === null)) return null;

  // SPLIT phase (strategy-independent).
  let splits = 0;
  const pieces: GeoStroke[] = [];
  for (const stroke of strokes) {
    const parts = splitStroke(stroke, refs, options);
    if (parts.length > 1) splits++;
    pieces.push(...parts);
  }

  // MERGE phase, once per (piece set × strategy × via) combination; the
  // re-match against the reference picks the winner. Piece sets are the raw
  // split pieces plus (when any stub absorbs) the stub-absorbed variant.
  // ADOPTABLE candidates (counts agree AND under the caller's cost gate)
  // outrank everything, so a passing chain from one combination is never
  // shadowed by a lower-cost chain that fails — then count agreement, then
  // mean cost. The raw no-via reference combination reproduces plain
  // consecutive chaining exactly, so richer joins can only ever add
  // adoptable proposals, never lose one.
  if (DEBUG) {
    pieces.forEach((p, i) => {
      const first = p.points[0]!;
      const last = p.points[p.points.length - 1]!;
      const info = labelPiece({ points: [...p.points], isLoop: p.isLoop, segmentIndices: [] }, refs);
      const dists = refs
        .map((ref, r) => {
          if (!ref) return `${r}:-`;
          const samples = resamplePolyline(p.points, 12);
          const mean = samples.reduce((s, q) => s + projectToRef(q, ref).d, 0) / samples.length;
          return `${r}:${mean.toFixed(0)}`;
        })
        .join(' ');
      console.log(
        `[regroup] piece ${i}: len ${polylineLength(p.points).toFixed(0)} loop=${p.isLoop} (${first.x.toFixed(0)},${first.y.toFixed(0)}) -> (${last.x.toFixed(0)},${last.y.toFixed(0)}) label=${info ? info.label : 'none'} meanD[${dists}]`,
      );
    });
  }
  const pieceSets: { name: string; pieces: GeoStroke[]; absorbed: number; pruned: number; extras: GeoStroke[] }[] = [
    { name: 'raw', pieces, absorbed: 0, pruned: 0, extras: [] },
  ];
  const absorbedSet = absorbStubs(pieces, options);
  if (absorbedSet) pieceSets.push({ name: 'absorb', ...absorbedSet, pruned: 0, extras: [] });
  // Dedup applies to the RAW pieces only: absorption splices out-and-back
  // excursions on purpose, and dedup would immediately unpick them.
  const deduped = dedupOverlap(pieces, refs, options);
  if (deduped) pieceSets.push({ name: 'dedup', pieces: deduped.pieces, absorbed: 0, pruned: deduped.dropped, extras: [] });
  // Misfit features the reference has no stroke for leave the chains and
  // ride along as extra strokes (drawn after the prescribed order).
  const liftedSet = liftMisfits(pieces, refs, options);
  if (liftedSet) pieceSets.push({ name: 'lift', pieces: liftedSet.pieces, absorbed: 0, pruned: 0, extras: liftedSet.extras });
  const combos: [ChainStrategy, boolean][] = [
    ['reference', false],
    ['reference', true],
    ['continuity', false],
    ['continuity', true],
    ['global', false],
    ['global', true],
  ];
  const totalInk = pieces.reduce((sum, p) => sum + polylineLength(p.points), 0);
  const refTravel = refs.reduce((sum, r) => sum + (r ? r.total : 0), 0);
  const runPortfolio = (extras: ChainExtras) =>
    pieceSets.flatMap((set) =>
      combos.map(([strategy, allowVia]) => {
        const chained = chainPieces(set.pieces, refs, options, strategy, allowVia, extras);
        // Lifted extras that turn out to continue a chain fold back into it.
        const fold =
          set.extras.length > 0
            ? foldIndexed(chained.strokes, set.extras, refs, options)
            : { chains: chained.strokes, extras: [], folded: 0, dropped: 0 };
        const chainStrokes = fold.chains;
        const setExtras = fold.extras;
        // An absorption both merges two extracted strokes and doubles travel,
        // so it reports as one merge + one retrace.
        const merges = chained.merges + set.absorbed + fold.folded;
        const retraces = chained.retraces + set.absorbed;
        const pruned = set.pruned + fold.dropped;
        const match = matchStrokes(
          chainStrokes.map((s) => s.points),
          references,
          options.glyphDiag,
        );
        const countsAgree = match.extractedCount === match.referenceCount;
        // Pruning is a last resort: even coverage-safe drops count against a
        // candidate, so deleting awkward ink can never beat keeping it unless
        // the match improves by more than the ink was worth. Lifted extras
        // pay a flat surcharge for deviating from the prescribed count.
        const gateCost =
          match.meanCost + (totalInk > 0 ? PRUNE_COST_WEIGHT * (pruned / totalInk) : 0) + (setExtras.length > 0 ? LIFT_RANK_PENALTY : 0);
        // Excess travel: everything the proposal draws beyond the raw ink
        // AND beyond what the reference itself travels (prescribed doubles
        // are free) — retrace walks, via corridors, absorb excursions.
        const drawn =
          chainStrokes.reduce((sum, s) => sum + polylineLength(s.points), 0) +
          setExtras.reduce((sum, p) => sum + polylineLength(p.points), 0);
        const extraTravel = Math.max(0, drawn - Math.max(totalInk, refTravel));
        const rankCost = gateCost + (totalInk > 0 ? RETRACE_COST_WEIGHT * (extraTravel / totalInk) : 0);
        // The deviation ladder: a faithful full match (nothing pruned, no
        // unprescribed re-travel) beats a lift proposal (all ink kept but
        // extra strokes outside the canon), which beats destroying ink or
        // re-traveling a would-be stroke. Cost only arbitrates within a
        // rung. The 10% allowance is ordinary join glue, not re-travel.
        // Folded extras dropped as already painted are not destroyed ink:
        // the rung reads the set's own pruning.
        const deviation = set.pruned > 0 || extraTravel > totalInk * 0.1 ? 2 : setExtras.length > 0 ? 1 : 0;
        if (DEBUG) {
          const ends = chainStrokes
            .map((s) => {
              const f = s.points[0]!;
              const l = s.points[s.points.length - 1]!;
              return `[len ${polylineLength(s.points).toFixed(0)} (${f.x.toFixed(0)},${f.y.toFixed(0)})->(${l.x.toFixed(0)},${l.y.toFixed(0)})]`;
            })
            .join(' ');
          const tag = `${extras.fillEmpty ? '+fill' : ''}${extras.rescue ? '+rescue' : ''}`;
          console.log(
            `[regroup] ${set.name}/${strategy}${allowVia ? '+via' : ''}${tag}: ${chainStrokes.length} strokes${setExtras.length > 0 ? ` +${setExtras.length} extras` : ''}${fold.folded + fold.dropped > 0 ? ` (${fold.folded} folded, ${fold.dropped.toFixed(0)} dropped)` : ''}, mean ${match.meanCost.toFixed(3)}, rank ${rankCost.toFixed(3)} dev${deviation}${countsAgree && gateCost <= options.maxMeanCost ? ' adoptable' : ''}, pairs ${match.pairs.map((p) => p.cost.toFixed(3)).join('/')} ${ends}`,
          );
        }
        return {
          strokes: [...chainStrokes, ...setExtras],
          merges,
          retraces,
          filled: chained.filled,
          pruned,
          extras: setExtras.length,
          countsAgree,
          adoptable: countsAgree && gateCost <= options.maxMeanCost,
          retracedSplit: retraces > 0 && chainStrokes.length > strokes.length,
          deviation,
          rankCost,
        };
      }),
    );
  // Adoptable AND not a proposal the caller throws away in favour of another.
  const acceptable = (c: { adoptable: boolean; retracedSplit: boolean }) =>
    c.adoptable && !(options.retracedSplits === 'avoid' && c.retracedSplit);
  type Scored = ReturnType<typeof runPortfolio>[number];
  const ranked = (list: Scored[]) =>
    list.sort(
      (a, b) =>
        Number(b.adoptable) - Number(a.adoptable) ||
        Number(b.countsAgree) - Number(a.countsAgree) ||
        (a.adoptable ? a.deviation - b.deviation : 0) ||
        a.rankCost - b.rankCost,
    );
  let scored = ranked(runPortfolio({ fillEmpty: false, rescue: false }));
  // Second phase: corrective labeling variants (see ChainExtras). Consulted
  // only when the plain portfolio has no acceptable proposal, so glyphs that
  // already pass never change.
  if (!scored.some(acceptable)) {
    scored = ranked(
      scored.concat(
        runPortfolio({ fillEmpty: true, rescue: false }),
        runPortfolio({ fillEmpty: false, rescue: true }),
        runPortfolio({ fillEmpty: true, rescue: true }),
      ),
    );
  }
  // A winner to avoid gives way to the best acceptable proposal (a Hangul
  // syllable split along its jamo without retracing); failing one, it stands
  // and the caller keeps the extracted strokes.
  const best = (scored[0]!.adoptable && !acceptable(scored[0]!) && scored.find(acceptable)) || scored[0]!;

  if (splits === 0 && best.merges === 0 && best.pruned === 0 && best.filled === 0 && best.extras === 0) return null;
  return { strokes: best.strokes, splits, merges: best.merges, retraces: best.retraces, pruned: best.pruned, extras: best.extras };
}
