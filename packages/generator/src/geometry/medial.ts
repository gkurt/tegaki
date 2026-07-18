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
    // Isolated blob (dot, comma): fold the cycle at its farthest point pair.
    const cycle = [...face.polygon, face.polygon[0]!];
    const m = Math.min(48, Math.max(8, face.polygon.length));
    const samples = resamplePolyline(cycle, m);
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
    if (axis.length < 2) return null;
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
