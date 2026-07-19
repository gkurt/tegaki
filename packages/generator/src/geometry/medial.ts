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
import { medialFaceAxes, medialFaceAxesFullBoundary } from './face-medial.ts';
import { straightSkeletonFaceAxes } from './face-straight-skeleton.ts';
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

/**
 * Direction pointing out of the axis at one of its ends (into the junction).
 * The reference point is chosen by EUCLIDEAN distance from the end (bounded
 * by an arc budget, keeping the farthest point seen): pacing by arc length
 * lets a wiggly axis consume the whole lookback while staying euclidean-near
 * the end, which turns local noise into the measured tangent — junction
 * continuation gating then misreads cursive bends as crossings.
 */
function endDirection(axis: AxisPoint[], atStart: boolean, lookback: number): Point {
  if (axis.length < 2) return { x: 0, y: 0 };
  const endIdx = atStart ? 0 : axis.length - 1;
  const step = atStart ? 1 : -1;
  let i = endIdx;
  let travelled = 0;
  let best = endIdx + step;
  let bestD = 0;
  while (i + step >= 0 && i + step < axis.length && travelled < 4 * lookback) {
    travelled += dist(axis[i]!, axis[i + step]!);
    i += step;
    const d = dist(axis[endIdx]!, axis[i]!);
    if (d > bestD) {
      bestD = d;
      best = i;
    }
    if (d >= lookback) break;
  }
  return normalize(sub(axis[endIdx]!, axis[best]!));
}

export function buildEnds(axis: AxisPoint[], startCutId: number, endCutId: number, spacing: number): AxisEnd[] {
  const mk = (atStart: boolean, cutId: number): AxisEnd => {
    const p = atStart ? axis[0]! : axis[axis.length - 1]!;
    const lookback = Math.max(2 * spacing, p.width / 2);
    return { cutId, point: { x: p.x, y: p.y }, direction: endDirection(axis, atStart, lookback), width: p.width };
  };
  return [mk(true, startCutId), mk(false, endCutId)];
}

/**
 * Compute ALL axes for one segment face: the primary axis plus one BRANCH
 * axis per limb the primary cannot reach.
 *
 * Hole-free faces use the true medial axis (`medialFaceAxes` — Voronoi of
 * boundary samples) or the exact straight skeleton (`straightSkeletonFaceAxes`)
 * per `options.medialMethod`; both reach tapered tips and side limbs by
 * construction; a single path can only serve two ports, so extra limbs come
 * back as retraces (2-port faces) or branch segments. Hole faces and any
 * face the medial graph can't handle fall back to chain pairing, where the
 * coverage-based branch pass runs last as a safety net — no area of a face
 * may go unswept. Medial axes skip that net: the medial tree already reaches
 * every limb (anything it prunes sits inside the pen's disks), and the net's
 * looser width+spacing margin turns borderline cap corners into phantom
 * branches.
 */
export function computeSegmentAxes(face: Face, options: ResolvedGeometryOptions, opts?: { fullBoundaryRescue?: boolean }): SegmentInfo[] {
  let infos: SegmentInfo[] = [];
  // The straight skeleton also serves HOLED faces (O's annulus — the wasm
  // build takes holes natively and the cycle walk in loopAxesFromMedialGraph
  // extracts the ring); the sampled Voronoi build stays hole-free-only.
  const medialApplies = options.medialMethod === 'straight-skeleton' ? true : options.medialMethod === 'voronoi' && face.holes.length === 0;
  if (medialApplies) {
    infos = (options.medialMethod === 'straight-skeleton' ? straightSkeletonFaceAxes(face, options) : medialFaceAxes(face, options)) ?? [];
    // Wall-only sampling can fail outright on hairpin fold wedges (え/る's
    // tip): the cuts run LENGTHWISE, so the walls are just the nose cap and
    // the graph collapses — and every chain construction truncates the tip
    // too (its fold axis stops at the mouth, with the raw cut span as a
    // bogus fat width). The full-boundary medial handles them, but its cut
    // samples put retraces next to ports and wiggle the end tangents, so the
    // caller only permits it for faces whose ends open onto bare cuts
    // (degree-2 merges — tangent-independent), never onto junction nodes
    // where competitive pairing would misread the wiggle (0's crossing
    // kernel).
    if (infos.length === 0 && opts?.fullBoundaryRescue && face.holes.length === 0) {
      infos = medialFaceAxesFullBoundary(face, options) ?? [];
    }
  }
  const usedMedial = infos.length > 0;
  if (!usedMedial) {
    const primary = computeSegmentAxisCore(face, options);
    if (!primary) return [];
    infos = [primary];
  }
  for (const info of infos) clampWidthsToBoundary(info.axis, face);
  const primary = infos[0]!;
  // Keep end metadata consistent with the (possibly lowered) axis widths.
  if (primary.ends.length === 2) {
    primary.ends[0]!.width = primary.axis[0]!.width;
    primary.ends[1]!.width = primary.axis[primary.axis.length - 1]!.width;
  }
  if (!primary.isLoop && !usedMedial) {
    for (const branch of extractBranches(face, infos, options)) {
      clampWidthsToBoundary(branch.axis, face);
      infos.push(branch);
    }
  }
  return infos;
}

/** The primary axis of a face (see computeSegmentAxes). */
export function computeSegmentAxis(face: Face, options: ResolvedGeometryOptions): SegmentInfo | null {
  return computeSegmentAxes(face, options)[0] ?? null;
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
    // Single cut run: end cap — the wall runs from one side of the cut around
    // the stroke tip and back.
    const chain: Point[] = [];
    for (let k = 1; k < runs.length; k++) {
      const run = runs[(r1 + k) % runs.length]!;
      appendChain(chain, run.points);
    }
    const end = runEnd(runs[r1]!);
    if (polylineLength(chain) < 1e-9) {
      return null;
    }
    const axis = endCapAxis(chain, spacing);
    if (!axis) return null;
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

  // SLIT RING: a cut id repeated among the wall-treated runs marks a slit —
  // the face is a loop strip crossing itself (す's loop): the partition's cut
  // failed to split it (a slit does not disconnect a disk), so the ring's two
  // parallel walls sit concatenated on ONE side of the walk, joined through
  // the slit's two edges. The fold construction below would split them at
  // the arc midpoint — off the true wall boundary — and the rotational drift
  // collapses the axis onto the counter. Split AT the slit instead and pair
  // the wall chunks directly for the ring. The opposite side's wall flanks
  // the entry/exit corridor (paired against the ring walls by closest point,
  // covering the crossing bulge), and the ring is spliced into the corridor
  // at the crossing: the pen runs in, circles the loop once, and runs out.
  const slitRing = (side: WalkRun[]): AxisPoint[] | null => {
    const counts = new Map<number, number>();
    for (const r of side) if (r.cutId >= 0) counts.set(r.cutId, (counts.get(r.cutId) ?? 0) + 1);
    const slitId = [...counts].find(([, c]) => c >= 2)?.[0];
    if (slitId == null) return null;
    const chunks: Point[][] = [[]];
    for (const r of side) {
      if (r.cutId === slitId) {
        if (chunks[chunks.length - 1]!.length > 0) chunks.push([]);
      } else {
        appendChain(chunks[chunks.length - 1]!, r.points);
      }
    }
    const walls = chunks.filter((c) => polylineLength(c) > 1e-9);
    if (walls.length < 2) return null;
    // Pair by CLOSEST POINT, not arc fraction: the first chunk can carry an
    // exit-funnel stretch and the second an entry stretch on top of the ring
    // proper, and fraction pairing rotationally shifts the match — the axis
    // pinches to near-zero widths and misses the ring's far bulges.
    return pairChainToHoles(walls[0]!, [walls[walls.length - 1]!], spacing);
  };
  const ringWalls = (side: WalkRun[]): Point[][] => side.filter((r) => r.cutId < 0).map((r) => r.points);
  const sideA: WalkRun[] = [];
  for (let i = first + 1; i < second; i++) sideA.push(runs[i]!);
  const sideB: WalkRun[] = [];
  for (let i = second + 1; i < first + runs.length; i++) sideB.push(runs[i % runs.length]!);

  let ring = slitRing(sideA);
  let corridorSide = sideB; // walk order second → first
  let corridorReversed = true; // reorient to first → second
  if (!ring) {
    const fromB = slitRing(sideB);
    if (fromB) {
      ring = [...fromB].reverse(); // side B runs second → first
      corridorSide = sideA;
      corridorReversed = false;
    }
  }
  if (ring) {
    const ringSide = corridorSide === sideB ? sideA : sideB;
    const corridorChain: Point[] = [];
    for (const r of corridorSide) if (r.cutId < 0) appendChain(corridorChain, r.points);
    let corridor: AxisPoint[] = [];
    if (polylineLength(corridorChain) > 1e-9) {
      corridor = pairChainToHoles(corridorChain, ringWalls(ringSide), spacing);
      if (corridorReversed) corridor.reverse();
    }
    // Splice the ring into the corridor where the corridor passes the
    // crossing (both ring ends sit there).
    const crossing = midpoint(ring[0]!, ring[ring.length - 1]!);
    let splice = corridor.length;
    let bestD = Infinity;
    for (let k = 0; k < corridor.length; k++) {
      const d = dist(corridor[k]!, crossing);
      if (d < bestD) {
        bestD = d;
        splice = k + 1;
      }
    }
    const axis = [...corridor.slice(0, splice), ...ring, ...corridor.slice(splice)];
    axis.unshift({ ...endA.point, width: endA.width });
    axis.push({ ...endB.point, width: endB.width });
    return axis;
  }

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

/**
 * Axis from `runs[from]` to `runs[to]` across a RING face (a face with
 * holes), oriented from → to. axisBetweenRuns is hole-blind: pairing the two
 * outer wall chains against each other across the counter collapses the axis
 * onto a small circle hugging the hole (す's loop), leaving the ring
 * unswept. The pen's real path wraps the hole — take the LONGER wall chain
 * between the runs (the way around the ring) and pair it against the hole
 * boundary, exactly like segment ring faces do.
 */
export function axisBetweenRunsAroundHole(
  runs: WalkRun[],
  from: number,
  to: number,
  holes: Point[][],
  options: ResolvedGeometryOptions,
): AxisPoint[] {
  const n = runs.length;
  const chainA: Point[] = []; // walk order from → to
  for (let k = (from + 1) % n; k !== to; k = (k + 1) % n) appendChain(chainA, runs[k]!.points);
  const chainB: Point[] = []; // walk order to → from; reversed to run from → to
  for (let k = (to + 1) % n; k !== from; k = (k + 1) % n) appendChain(chainB, runs[k]!.points);
  chainB.reverse();
  const chain = polylineLength(chainA) >= polylineLength(chainB) ? chainA : chainB;
  if (polylineLength(chain) < 1e-9) return [];

  const axis = pairChainToHoles(chain, holes, options.resampleSpacing);
  const endA = runEnd(runs[from]!);
  const endB = runEnd(runs[to]!);
  axis.unshift({ ...endA.point, width: endA.width });
  axis.push({ ...endB.point, width: endB.width });
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

/**
 * Axis for an end-cap wall chain (a 1-cut face): from the cut side to the
 * stroke TIP. The tip is where convex turn concentrates on the chain — NOT
 * the arc midpoint: on asymmetric caps (a curled flourish like r's arm, whose
 * outer wall is much longer than its inner wall) the arc midpoint sits far
 * from the real tip, truncating the stroke and skewing the pairing. Fold at
 * the detected tip and pair the two sides by closest point; chains with no
 * cap concentration keep the arc-midpoint fold.
 *
 * The returned axis runs cut-side → tip (the caller prepends the exact cut
 * midpoint).
 */
function endCapAxis(chain: Point[], spacing: number): AxisPoint[] | null {
  const total = polylineLength(chain);
  const n = clampSamples(total, spacing);
  const samples = resamplePolyline(chain, n);

  let tip = -1;
  if (n >= 8) {
    // Windowed convex-turn concentration at interior samples.
    const turns = new Float64Array(n);
    for (let k = 1; k < n - 1; k++) {
      const v1 = sub(samples[k]!, samples[k - 1]!);
      const v2 = sub(samples[k + 1]!, samples[k]!);
      turns[k] = Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y);
    }
    const m = Math.max(2, Math.round(n / 32));
    let bestTurn = CAP_MIN_TURN;
    for (let k = 1; k < n - 1; k++) {
      let s = 0;
      for (let d = -m; d <= m; d++) {
        const idx = k + d;
        if (idx >= 1 && idx <= n - 2) s += turns[idx]!;
      }
      if (s > bestTurn) {
        bestTurn = s;
        tip = k;
      }
    }
  }

  if (tip <= 0 || tip >= n - 1) {
    // No cap concentration: fold at the arc midpoint (symmetric caps, blobs).
    const half = splitAtArcLength(chain, total / 2);
    const axis = pairChains(half.before, half.after.reverse(), spacing);
    return axis.length >= 2 ? axis : null;
  }

  const side1 = samples.slice(0, tip + 1);
  const side2 = samples.slice(tip);
  const len1 = polylineLength(side1);
  const len2 = polylineLength(side2);
  if (len1 < 1e-9 || len2 < 1e-9) return null;
  const base = len1 >= len2 ? side1 : side2;
  const other = len1 >= len2 ? side2 : side1;
  const bs = resamplePolyline(base, clampSamples(polylineLength(base), spacing));
  const axis: AxisPoint[] = [];
  for (const p of bs) {
    const q = closestPointOnPolyline(p, other);
    const mid = midpoint(p, q);
    const last = axis[axis.length - 1];
    if (last && dist(last, mid) < 1e-9) continue;
    axis.push({ ...mid, width: dist(p, q) });
  }
  if (axis.length < 2) return null;
  // side1 runs cut→tip, side2 tip→cut: orient the axis cut-side → tip.
  if (base === side2) axis.reverse();
  return axis;
}

/**
 * Distance from a point to the trunk axis, plus the trunk's local width at
 * the closest approach (max of the nearest segment's endpoint widths, so a
 * tapering tip still reports its body width).
 */
/**
 * Widest axis width near one trunk end, walked inward over an adaptive
 * window (arc ≤ ~1.5× the widest width seen, so taper and boundary clamping
 * at the very tip don't hide the true body width).
 */
function bodyWidthNearEnd(trunk: AxisPoint[], fromEnd: boolean, spacing: number): number {
  let wmax = 0;
  let arc = 0;
  const n = trunk.length;
  for (let s = 0; s < n; s++) {
    const i = fromEnd ? n - 1 - s : s;
    wmax = Math.max(wmax, trunk[i]!.width);
    if (s > 0) arc += dist(trunk[i]!, trunk[fromEnd ? i + 1 : i - 1]!);
    if (arc > Math.max(1.5 * wmax, 4 * spacing)) break;
  }
  return wmax;
}

function trunkClearance(p: Point, trunk: AxisPoint[]): { d: number; width: number } {
  let best = Infinity;
  let width = 0;
  for (let i = 1; i < trunk.length; i++) {
    const d = distToSegment(p, trunk[i - 1]!, trunk[i]!);
    if (d < best) {
      best = d;
      width = Math.max(trunk[i - 1]!.width, trunk[i]!.width);
    }
  }
  return { d: best, width };
}

/**
 * Branch axes for face area the primary axis does not reach — the "no area
 * dropped" guarantee, driven by COVERAGE rather than shape heuristics.
 *
 * A face can have more ports than one path serves: Caveat's r holds its arm
 * AND its stem's bottom leg in one 1-cut face (the crotch between them is
 * smooth, so no concave corner ever cut them apart). Wall samples farther
 * from the trunk than its ribbon reaches mark unswept limbs (turn-based cap
 * detection misses soft or chain-end caps — the r's bottom tip measures only
 * ~75°). Each uncovered cluster branches from its farthest sample: pair its
 * two flanking walls outward from there by closest point and trim where the
 * branch's nib reaches the trunk — the same pen model as unpaired-junction
 * extensions.
 */
function extractBranches(face: Face, trunks: SegmentInfo[], options: ResolvedGeometryOptions): SegmentInfo[] {
  const spacing = options.resampleSpacing;
  const runs = extractRuns(face);
  const branches: SegmentInfo[] = [];
  const primary = trunks[0]!;
  const trunk = primary.axis;
  const head = trunk[0]!;
  const tail = trunk[trunk.length - 1]!;

  // Coverage is measured against ALL axes the face already produced (the
  // medial primary plus its limb branches), so recovered limbs don't get
  // re-detected as uncovered.
  const trunkData = trunks.map((t) => ({
    axis: t.axis,
    freeStart: t.ends[0]?.cutId === -1,
    freeEnd: t.ends[1]?.cutId === -1,
    startBody: bodyWidthNearEnd(t.axis, false, spacing),
    endBody: bodyWidthNearEnd(t.axis, true, spacing),
  }));
  const clearanceAll = (p: Point): { d: number; width: number } => {
    let best = { d: Infinity, width: 0 };
    for (const t of trunkData) {
      const c = trunkClearance(p, t.axis);
      if (c.d < best.d) best = c;
    }
    return best;
  };
  const inCapDisk = (p: Point) =>
    trunkData.some(
      (t) =>
        (t.freeStart && dist(p, t.axis[0]!) < 0.75 * t.startBody) || (t.freeEnd && dist(p, t.axis[t.axis.length - 1]!) < 0.75 * t.endBody),
    );

  // Wall chains: maximal boundary stretches between cut runs, or the whole
  // outline when the face has no cuts.
  const chains: { points: Point[]; closed: boolean }[] = [];
  const firstCut = runs.findIndex((r) => r.cutId >= 0);
  if (firstCut < 0) {
    chains.push({ points: [...face.polygon, face.polygon[0]!], closed: true });
  } else {
    let current: Point[] = [];
    for (let k = 1; k <= runs.length; k++) {
      const run = runs[(firstCut + k) % runs.length]!;
      if (run.cutId >= 0) {
        if (current.length >= 2) chains.push({ points: current, closed: false });
        current = [];
      } else {
        appendChain(current, run.points);
      }
    }
    if (current.length >= 2) chains.push({ points: current, closed: false });
  }

  for (const chain of chains) {
    const n = clampSamples(polylineLength(chain.points), spacing);
    if (n < 8) continue;
    const samples = chain.closed ? resamplePolyline(chain.points, n + 1).slice(0, n) : resamplePolyline(chain.points, n);

    // A wall sample is covered when some axis's ribbon plausibly reaches it
    // (walls of a stroke sit at ~width/2 from its axis; margin of one full
    // local width because square-turn outer corners sit at ~0.7×w — pen-
    // unreachable slivers), or when it sits inside a FREE tip's cap disk —
    // the corners of a flat-capped stroke end are un-inked by any round pen
    // (the trunk's own cap, not a limb). Cut-side ends get no cap disk: the
    // axis stops there because the face does, so anything beyond is
    // genuinely unserved (r's bottom leg).
    const clearances = samples.map((p) => clearanceAll(p));
    const uncovered = samples.map((p, i) => !inCapDisk(p) && clearances[i]!.d > clearances[i]!.width + spacing);

    // Cluster consecutive uncovered samples; each cluster is an unswept limb.
    const clusters: { from: number; to: number }[] = [];
    let start = -1;
    const limit = chain.closed ? n : samples.length;
    for (let i = 0; i <= limit; i++) {
      const on = i < limit && uncovered[i]!;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        clusters.push({ from: start, to: i - 1 });
        start = -1;
      }
    }
    // On a closed chain, merge a cluster wrapping around the seam.
    if (chain.closed && clusters.length >= 2 && uncovered[0] && uncovered[n - 1]) {
      const first = clusters[0]!;
      const last = clusters.pop()!;
      first.from = last.from - n; // negative index, resolved modulo n below
    }

    for (const cluster of clusters) {
      // The limb's tip: the cluster's farthest sample from the trunk.
      let k = -1;
      let bestD = -1;
      for (let i = cluster.from; i <= cluster.to; i++) {
        const idx = (i + n) % n;
        if (clearances[idx]!.d > bestD) {
          bestD = clearances[idx]!.d;
          k = idx;
        }
      }
      if (k < 0) continue;

      // The two walls flanking the tip, both starting AT the tip. On a closed
      // outline, stop each side at the sample nearest a trunk tip so the
      // sides don't run past the trunk's own caps.
      let side1: Point[];
      let side2: Point[];
      if (chain.closed) {
        const nearest = (target: Point) => {
          let best = 0;
          let d0 = Infinity;
          for (let i = 0; i < n; i++) {
            const d = dist(samples[i]!, target);
            if (d < d0) {
              d0 = d;
              best = i;
            }
          }
          return best;
        };
        const i0 = nearest(head);
        const i1 = nearest(tail);
        if (i0 === k || i1 === k) continue;
        const walk = (from: number, to: number, step: 1 | -1): Point[] => {
          const out: Point[] = [];
          for (let i = from; ; i = (i + step + n) % n) {
            out.push(samples[i]!);
            if (i === to || out.length > n) break;
          }
          return out;
        };
        // Which trunk tip does the forward direction reach first?
        let fwdStop = i1;
        for (let i = k; ; i = (i + 1) % n) {
          if (i === i0) {
            fwdStop = i0;
            break;
          }
          if (i === i1) break;
        }
        const bwdStop = fwdStop === i0 ? i1 : i0;
        side1 = walk(k, bwdStop, -1);
        side2 = walk(k, fwdStop, 1);
      } else {
        // The limb tip can be the chain-terminal sample (a cut endpoint deep
        // inside the limb, like r's slanted cut): clamp inward so both
        // flanking sides exist.
        k = Math.min(Math.max(k, 1), samples.length - 2);
        side1 = [...samples.slice(0, k + 1)].reverse();
        side2 = samples.slice(k);
      }
      if (polylineLength(side1) < 1e-9 || polylineLength(side2) < 1e-9) continue;

      const base = polylineLength(side1) >= polylineLength(side2) ? side1 : side2;
      const other = base === side1 ? side2 : side1;
      const bs = resamplePolyline(base, clampSamples(polylineLength(base), spacing));
      const axis: AxisPoint[] = [];
      for (const p of bs) {
        const q = closestPointOnPolyline(p, other);
        const mid = midpoint(p, q);
        const last = axis[axis.length - 1];
        if (last && dist(last, mid) < 1e-9) continue;
        const pt = { ...mid, width: dist(p, q) };
        axis.push(pt);
        // The branch has merged into the trunk once its nib reaches it.
        if (axis.length >= 2 && clearanceAll(mid).d <= pt.width * 0.75) break;
      }
      if (axis.length < 2 || polylineLength(axis) < 2 * spacing) continue;
      branches.push({ faceId: face.id, axis, isLoop: false, ends: buildEnds(axis, -1, -1, spacing) });
    }
  }
  return branches;
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
