// Stage G5 — medial axis per segment face, via chain pairing.
//
// A segment face is a "strip": its boundary decomposes into cut runs (the
// cross-sections at its ends) and boundary chains (the stroke walls). Instead
// of a full Voronoi medial axis (whose junction branches are the very noise
// this pipeline exists to avoid), the centerline is computed by pairing
// opposite walls sample-by-sample:
//
// - 2 cut runs  → pair the two wall chains (a bar between two junctions)
// - 1 cut run   → fold the single chain at its arc midpoint (a stroke end cap)
// - 0 cut runs  → closed blob: farthest-pair fold (dots) or, with holes, an
//                 annular loop paired against the hole (an O)
// - with holes  → pair the longest wall chain against the hole boundary
//                 (bowls and lobes, e.g. the loops of an 8)
//
// Width at each axis sample is the pairing distance — the true local stroke
// diameter, measured from the outline rather than a rasterized approximation.

import type { Point } from 'tegaki';
import {
  closestPointOnPolyline,
  dist,
  distToSegment,
  midpoint,
  normalize,
  pointAtArcLength,
  polylineLength,
  resamplePolyline,
  sub,
} from './primitives.ts';
import type { AxisEnd, AxisPoint, Face, ResolvedGeometryOptions, SegmentInfo } from './types.ts';

/**
 * A 2-cut face is "fold-shaped" (turn or lobe, rather than a strip) when its
 * shorter wall is this small relative to the longer one — i.e. the two cuts
 * (nearly) meet at a shared concave corner instead of sitting at opposite ends.
 */
const FOLD_WALL_RATIO = 0.25;

export interface WalkRun {
  cutId: number; // -1 for boundary runs
  points: Point[]; // inclusive of both end vertices
}

/** Decompose the face boundary walk into alternating cut / boundary runs. */
export function extractRuns(face: Face): WalkRun[] {
  const n = face.polygon.length;
  if (n === 0) return [];

  // Rotate so the walk starts at a tag change (keeps runs contiguous).
  let start = 0;
  for (let i = 0; i < n; i++) {
    const prevTag = face.edgeCutIds[(i - 1 + n) % n]!;
    if (face.edgeCutIds[i]! !== prevTag) {
      start = i;
      break;
    }
  }

  const runs: WalkRun[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const tag = face.edgeCutIds[i]!;
    const a = face.polygon[i]!;
    const b = face.polygon[(i + 1) % n]!;
    const last = runs[runs.length - 1];
    if (last && last.cutId === tag) {
      last.points.push(b);
    } else {
      runs.push({ cutId: tag, points: [a, b] });
    }
  }
  return runs;
}

const clampSamples = (length: number, spacing: number) => Math.max(2, Math.min(256, Math.round(length / Math.max(spacing, 1e-6)) + 1));

/** Pair two chains sample-by-sample; the second chain must already run in opposite travel direction. */
function pairChains(a: Point[], b: Point[], spacing: number): AxisPoint[] {
  const n = clampSamples(Math.max(polylineLength(a), polylineLength(b)), spacing);
  const sa = resamplePolyline(a, n);
  const sb = resamplePolyline(b, n);
  const axis: AxisPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = sa[i]!;
    const q = sb[i]!;
    axis.push({ ...midpoint(p, q), width: dist(p, q) });
  }
  return axis;
}

/** Pair a chain against the closest points on the face's hole boundaries. */
function pairChainToHoles(chain: Point[], holes: Point[][], spacing: number): AxisPoint[] {
  const closedHoles = holes.map((h) => [...h, h[0]!]);
  const n = clampSamples(polylineLength(chain), spacing);
  const samples = resamplePolyline(chain, n);
  const axis: AxisPoint[] = [];
  for (const p of samples) {
    let best: Point | null = null;
    let bestD = Infinity;
    for (const hole of closedHoles) {
      const q = closestPointOnPolyline(p, hole);
      const d = dist(p, q);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    if (!best) continue;
    axis.push({ ...midpoint(p, best), width: bestD });
  }
  return axis;
}

/** Midpoint / span length of a cut run (the portion of the cut on this face). */
function runEnd(run: WalkRun): { point: Point; width: number } {
  const a = run.points[0]!;
  const b = run.points[run.points.length - 1]!;
  return { point: midpoint(a, b), width: dist(a, b) };
}

/** Direction pointing out of the axis at one of its ends (into the junction). */
function endDirection(axis: AxisPoint[], atStart: boolean, lookback: number): Point {
  if (axis.length < 2) return { x: 0, y: 0 };
  const endIdx = atStart ? 0 : axis.length - 1;
  const step = atStart ? 1 : -1;
  let i = endIdx;
  let travelled = 0;
  while (i + step >= 0 && i + step < axis.length && travelled < lookback) {
    travelled += dist(axis[i]!, axis[i + step]!);
    i += step;
  }
  return normalize(sub(axis[endIdx]!, axis[i]!));
}

function buildEnds(axis: AxisPoint[], startCutId: number, endCutId: number, spacing: number): AxisEnd[] {
  const mk = (atStart: boolean, cutId: number): AxisEnd => {
    const p = atStart ? axis[0]! : axis[axis.length - 1]!;
    const lookback = Math.max(2 * spacing, p.width / 2);
    return { cutId, point: { x: p.x, y: p.y }, direction: endDirection(axis, atStart, lookback), width: p.width };
  };
  return [mk(true, startCutId), mk(false, endCutId)];
}

/** Compute the medial axis and end metadata for one segment face. */
export function computeSegmentAxis(face: Face, options: ResolvedGeometryOptions): SegmentInfo | null {
  const info = computeSegmentAxisCore(face, options);
  if (info) {
    clampWidthsToBoundary(info.axis, face);
    // Keep end metadata consistent with the (possibly lowered) axis widths.
    if (info.ends.length === 2) {
      info.ends[0]!.width = info.axis[0]!.width;
      info.ends[1]!.width = info.axis[info.axis.length - 1]!.width;
    }
  }
  return info;
}

function computeSegmentAxisCore(face: Face, options: ResolvedGeometryOptions): SegmentInfo | null {
  const spacing = options.resampleSpacing;
  const runs = extractRuns(face);
  const cutRuns = runs.filter((r) => r.cutId >= 0);

  // ── Faces with holes: pair the longest wall against the hole boundary ────
  if (face.holes.length > 0) {
    if (cutRuns.length === 0) {
      // Annulus (O): closed loop midway between outer boundary and hole.
      const outer = [...face.polygon, face.polygon[0]!];
      const axis = pairChainToHoles(outer, face.holes, spacing);
      if (axis.length < 2) return null;
      axis.push({ ...axis[0]! });
      return { faceId: face.id, axis, isLoop: true, ends: [] };
    }
    // Lobe / bowl: the longest boundary chain wraps the hole; its adjacent cut
    // runs are the stroke's ends (both may be the same cut — a closed lobe).
    let bestChain: Point[] | null = null;
    let bestLen = -1;
    let bestPrev: WalkRun | null = null;
    let bestNext: WalkRun | null = null;
    for (let i = 0; i < runs.length; i++) {
      if (runs[i]!.cutId >= 0) continue;
      const chainLen = polylineLength(runs[i]!.points);
      if (chainLen > bestLen) {
        bestLen = chainLen;
        bestChain = runs[i]!.points;
        bestPrev = runs[(i - 1 + runs.length) % runs.length]!;
        bestNext = runs[(i + 1) % runs.length]!;
      }
    }
    if (!bestChain || !bestPrev || !bestNext) return null;
    const axis = pairChainToHoles(bestChain, face.holes, spacing);
    if (axis.length < 2) return null;
    const startEnd = runEnd(bestPrev);
    const endEnd = runEnd(bestNext);
    if (bestPrev.cutId >= 0) axis.unshift({ ...startEnd.point, width: startEnd.width });
    if (bestNext.cutId >= 0) axis.push({ ...endEnd.point, width: endEnd.width });
    return {
      faceId: face.id,
      axis,
      isLoop: false,
      ends: buildEnds(axis, bestPrev.cutId, bestNext.cutId, spacing),
    };
  }

  // ── Hole-free faces, by cut-run count ─────────────────────────────────────
  if (cutRuns.length === 0) {
    // A cut-free face: either a compact dot, or — far more often — an entire
    // glyph drawn as one smooth cap-ended ribbon (l, L, U, C, S: no concave
    // corners anywhere, so no cuts exist to decompose it).
    const axis = ribbonAxis(face, options);
    if (!axis || axis.length < 2) return null;
    return { faceId: face.id, axis, isLoop: false, ends: buildEnds(axis, -1, -1, spacing) };
  }

  // Use the two longest cut runs as the axis ends; anything between (including
  // additional small cut runs on misclassified faces) is treated as wall.
  let r1 = -1;
  let r2 = -1;
  for (let i = 0; i < runs.length; i++) {
    if (runs[i]!.cutId < 0) continue;
    const l = polylineLength(runs[i]!.points);
    if (r1 < 0 || l > polylineLength(runs[r1]!.points)) {
      r2 = r1;
      r1 = i;
    } else if (r2 < 0 || l > polylineLength(runs[r2]!.points)) {
      r2 = i;
    }
  }

  if (r2 < 0) {
    // Single cut run: end cap. Fold the wall chain at its arc midpoint.
    const chain: Point[] = [];
    for (let k = 1; k < runs.length; k++) {
      const run = runs[(r1 + k) % runs.length]!;
      appendChain(chain, run.points);
    }
    const end = runEnd(runs[r1]!);
    if (polylineLength(chain) < 1e-9) {
      return null;
    }
    const total = polylineLength(chain);
    const half = splitAtArcLength(chain, total / 2);
    const axis = pairChains(half.before, half.after.reverse(), spacing);
    axis.unshift({ ...end.point, width: end.width });
    if (axis.length < 2) return null;
    return { faceId: face.id, axis, isLoop: false, ends: buildEnds(axis, runs[r1]!.cutId, -1, spacing) };
  }

  // Two (or more) cut runs: axis between the two main runs.
  const [first, second] = r1 < r2 ? [r1, r2] : [r2, r1];
  const axis = axisBetweenRuns(runs, first, second, options);
  return { faceId: face.id, axis, isLoop: false, ends: buildEnds(axis, runs[first]!.cutId, runs[second]!.cutId, spacing) };
}

/**
 * Axis between two chosen cut runs of a face walk, oriented from `runs[first]`
 * to `runs[second]` (walk order: first < second). Any other runs between them
 * — boundary chains and additional small cut runs alike — are treated as
 * wall. The face shape decides the construction:
 *
 * - STRIP: both wall chains substantial — the face passes between its two
 *   cuts (a bar). Pair the walls sample-by-sample.
 * - TURN: one wall is (nearly) just the shared concave corner and the face
 *   stays within ~a stroke width — a valley/elbow where the pen turns. Pair
 *   the outer wall against the corner so the axis follows the turn.
 * - LOBE: one wall degenerate but the face wanders far from its cuts — the
 *   pen goes out and comes back (the fused middle peak of a cursive w).
 *   Fold the wall at its arc midpoint and emit a retraced hairpin axis so
 *   the stroke climbs the lobe and returns, entering on one cut and exiting
 *   on the other.
 *
 * Shared by segment faces (their medial axis) and junction routing (the path
 * a through-stroke takes across a junction face).
 */
export function axisBetweenRuns(runs: WalkRun[], first: number, second: number, options: ResolvedGeometryOptions): AxisPoint[] {
  const spacing = options.resampleSpacing;
  const chainA: Point[] = [];
  for (let i = first + 1; i < second; i++) appendChain(chainA, runs[i]!.points);
  const chainB: Point[] = [];
  for (let i = second + 1; i < first + runs.length; i++) appendChain(chainB, runs[i % runs.length]!.points);

  const endA = runEnd(runs[first]!);
  const endB = runEnd(runs[second]!);
  const lenA = polylineLength(chainA);
  const lenB = polylineLength(chainB);
  const shortLen = Math.min(lenA, lenB);
  const longLen = Math.max(lenA, lenB);

  let axis: AxisPoint[];
  if (longLen < 1e-9) {
    // Both walls degenerate (two cuts back to back): straight 2-point axis.
    axis = [
      { ...endA.point, width: endA.width },
      { ...endB.point, width: endB.width },
    ];
  } else if (shortLen < FOLD_WALL_RATIO * longLen) {
    // Fold family (turn or lobe). Orient the long wall to run first→second —
    // chainA already does; chainB runs second→first, so reverse it.
    const longChain = lenA >= lenB ? chainA : [...chainB].reverse();
    // The fold base: the arc midpoint of the short wall, or (when the two cut
    // runs are adjacent) the corner vertex they share.
    const shortChain = lenA >= lenB ? chainB : chainA;
    const base =
      shortLen > 1e-9 ? pointAtArcLength(shortChain, shortLen / 2) : lenA >= lenB ? runs[first]!.points[0]! : runs[second]!.points[0]!;

    const maxCutLen = Math.max(endA.width, endB.width, 1e-9);
    const n = clampSamples(longLen, spacing);
    const samples = resamplePolyline(longChain, n);
    let extent = 0;
    for (const p of samples) extent = Math.max(extent, dist(p, base));

    if (extent <= options.junctionCompactness * maxCutLen) {
      // TURN: midway between the outer wall and the inner corner.
      axis = samples.map((p) => ({ ...midpoint(p, base), width: dist(p, base) }));
      axis.unshift({ ...endA.point, width: endA.width });
      axis.push({ ...endB.point, width: endB.width });
    } else {
      // LOBE: fold at the arc midpoint, pair the halves, retrace. Widths on
      // each pass are the fused fold width capped at that pass's cut span.
      const half = splitAtArcLength(longChain, longLen / 2);
      const foldAxis = pairChains(half.before, half.after.reverse(), spacing);
      const up = foldAxis.map((p) => ({ x: p.x, y: p.y, width: Math.min(p.width, endA.width) }));
      const down = [...foldAxis]
        .reverse()
        .slice(1)
        .map((p) => ({ x: p.x, y: p.y, width: Math.min(p.width, endB.width) }));
      axis = [{ ...endA.point, width: endA.width }, ...up, ...down, { ...endB.point, width: endB.width }];
    }
  } else {
    // STRIP: chainA runs first→second, chainB runs second→first; reverse B to align.
    axis = pairChains(chainA, [...chainB].reverse(), spacing);
    axis.unshift({ ...endA.point, width: endA.width });
    axis.push({ ...endB.point, width: endB.width });
  }
  return axis;
}

function appendChain(target: Point[], points: Point[]): void {
  for (const p of points) {
    const last = target[target.length - 1];
    if (last && dist(last, p) < 1e-9) continue;
    target.push(p);
  }
}

function splitAtArcLength(points: Point[], target: number): { before: Point[]; after: Point[] } {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i - 1]!, points[i]!);
    if (acc + d >= target) {
      const t = d > 0 ? (target - acc) / d : 0;
      const split = {
        x: points[i - 1]!.x + (points[i]!.x - points[i - 1]!.x) * t,
        y: points[i - 1]!.y + (points[i]!.y - points[i - 1]!.y) * t,
      };
      return {
        before: [...points.slice(0, i), split],
        after: [split, ...points.slice(i)],
      };
    }
    acc += d;
  }
  return { before: [...points], after: [points[points.length - 1]!] };
}

/** Minimum windowed convex turn (rad) for a boundary arc to count as a stroke cap. */
const CAP_MIN_TURN = (100 * Math.PI) / 180;

/**
 * Axis for a cut-free, hole-free face — either a compact dot, or an entire
 * glyph drawn as one smooth ribbon (l, L, U, C, S have no concave corners, so
 * the whole outline is a single face).
 *
 * The pen path's tips are the outline's CAPS: short arcs where ~180° of
 * convex turn concentrates within about a stroke width. Detect them by
 * windowed turn concentration, split the outline at the two best tips into
 * two walls, and pair the longer wall against the CLOSEST point on the other.
 * Closest-point pairing keeps pairs perpendicular to the stroke even where
 * the inner and outer walls of a bend have very different arc lengths —
 * arc-fraction pairing skews diagonally there, over-measuring width and
 * pulling the axis off center (the old farthest-pair fold drew Caveat's L
 * and U as bloated blobs).
 *
 * When several caps qualify (an L's foot and top, plus its heel turn), every
 * candidate tip pair is evaluated and the split with the smallest mean pair
 * width wins — the true tip pair of a ribbon pairs parallel walls, wrong
 * splits pair diverging ones. Outlines with no cap concentration (dots,
 * near-circles) fall back to the farthest-pair fold.
 */
function ribbonAxis(face: Face, options: ResolvedGeometryOptions): AxisPoint[] | null {
  const spacing = options.resampleSpacing;
  const cycle = [...face.polygon, face.polygon[0]!];
  const per = polylineLength(cycle);
  if (per < 1e-9) return null;
  const n = clampSamples(per, spacing);
  const closed = resamplePolyline(cycle, n + 1);
  const samples = closed.slice(0, n);
  if (n < 8) return farthestPairFold(samples, spacing);

  // Signed turn at each sample (positive = convex, region on the left).
  const turns = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const p0 = samples[(k - 1 + n) % n]!;
    const p1 = samples[k]!;
    const p2 = samples[(k + 1) % n]!;
    const v1 = sub(p1, p0);
    const v2 = sub(p2, p1);
    turns[k] = Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y);
  }

  // Windowed concentration over ~1/16 of the perimeter.
  const m = Math.max(2, Math.round(n / 32));
  const windowTurn = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let d = -m; d <= m; d++) s += turns[(k + d + n) % n]!;
    windowTurn[k] = s;
  }

  const circDist = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, n - d);
  };
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => windowTurn[b]! - windowTurn[a]!);
  const tips: number[] = [];
  for (const k of order) {
    if (windowTurn[k]! < CAP_MIN_TURN) break;
    if (tips.some((t) => circDist(t, k) <= 2 * m + 1)) continue;
    tips.push(k);
    if (tips.length === 4) break;
  }
  if (tips.length < 2) return farthestPairFold(samples, spacing);

  let best: AxisPoint[] | null = null;
  let bestScore = Infinity;
  for (let a = 0; a < tips.length; a++) {
    for (let b = a + 1; b < tips.length; b++) {
      const axis = pairSplitChains(samples, Math.min(tips[a]!, tips[b]!), Math.max(tips[a]!, tips[b]!), spacing);
      if (!axis) continue;
      let sum = 0;
      for (const p of axis) sum += p.width;
      const score = sum / axis.length;
      if (score < bestScore) {
        bestScore = score;
        best = axis;
      }
    }
  }
  return best ?? farthestPairFold(samples, spacing);
}

/** Split the sample cycle at indices i < j and pair the two walls by closest point. */
function pairSplitChains(samples: Point[], i: number, j: number, spacing: number): AxisPoint[] | null {
  const chainA = samples.slice(i, j + 1);
  const chainB = [...samples.slice(j), ...samples.slice(0, i + 1)];
  const lenA = polylineLength(chainA);
  const lenB = polylineLength(chainB);
  if (lenA < 1e-9 || lenB < 1e-9) return null;
  const base = lenA >= lenB ? chainA : chainB;
  const other = lenA >= lenB ? chainB : chainA;
  const bs = resamplePolyline(base, clampSamples(polylineLength(base), spacing));
  const axis: AxisPoint[] = [];
  for (const p of bs) {
    const q = closestPointOnPolyline(p, other);
    const mid = midpoint(p, q);
    const last = axis[axis.length - 1];
    if (last && dist(last, mid) < 1e-9) continue;
    axis.push({ ...mid, width: dist(p, q) });
  }
  return axis.length >= 2 ? axis : null;
}

/** Legacy dot/blob axis: fold the sample cycle at its farthest point pair. */
function farthestPairFold(samples: Point[], spacing: number): AxisPoint[] | null {
  const m = samples.length;
  if (m < 3) return null;
  let bi = 0;
  let bj = 0;
  let bestD = -1;
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const d = dist(samples[i]!, samples[j]!);
      if (d > bestD) {
        bestD = d;
        bi = i;
        bj = j;
      }
    }
  }
  const chainA = samples.slice(bi, bj + 1);
  const chainB = [...samples.slice(bj), ...samples.slice(0, bi + 1)];
  const axis = pairChains(chainA, chainB.reverse(), spacing);
  return axis.length >= 2 ? axis : null;
}

/**
 * Clamp each axis sample's width to twice its distance to the nearest WALL
 * (the inscribed-disk bound). Chain pairing over-measures wherever the
 * pairing skews along the stroke (inner/outer arc-length mismatch on bends,
 * asymmetric strips); the local stroke width can never exceed the largest
 * disk centered on the axis point. Cut edges are excluded — they are
 * interior cross-sections, and axis endpoints sit exactly on them.
 */
export function clampWidthsToBoundary(axis: AxisPoint[], face: Face): void {
  const n = face.polygon.length;
  for (const p of axis) {
    let d = Infinity;
    for (let i = 0; i < n; i++) {
      if (face.edgeCutIds[i]! >= 0) continue;
      const dd = distToSegment(p, face.polygon[i]!, face.polygon[(i + 1) % n]!);
      if (dd < d) d = dd;
    }
    for (const hole of face.holes) {
      for (let i = 0; i < hole.length; i++) {
        const dd = distToSegment(p, hole[i]!, hole[(i + 1) % hole.length]!);
        if (dd < d) d = dd;
      }
    }
    if (Number.isFinite(d)) p.width = Math.min(p.width, 2 * d);
  }
}
