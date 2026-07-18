// Stage G6b — routing through-strokes across junction faces.
//
// When two segment ends are paired as one continuing stroke, the drawn line
// must cross the junction region between their cuts. Bridging with the
// junction centroid is only right for compact convex crossings: a junction can
// be arc-shaped (the bowl of a script R), where the centroid lies OUTSIDE the
// face and the bridge draws a chord across empty space.
//
// Instead, walk the junction node's faces from the entry cut to the exit cut
// (BFS over the faces' shared cuts) and chain each face's axis between its
// in-cut and out-cut, computed with the same strip/turn/lobe machinery that
// segment faces use. The result follows the junction's actual geometry — an
// arc junction yields an arc path.

import type { Point } from 'tegaki';
import { axisBetweenRuns, clampWidthsToBoundary, extractRuns, type WalkRun } from './medial.ts';
import { dist, midpoint, polylineLength, segmentIntersection } from './primitives.ts';
import type { AxisPoint, Face, JunctionInfo, ResolvedGeometryOptions, SegmentInfo } from './types.ts';

/** Longest run of the given cut on a face walk (a boundary may touch a cut twice). */
function longestRunIndex(runs: WalkRun[], cutId: number): number {
  let best = -1;
  let bestLen = -1;
  for (let i = 0; i < runs.length; i++) {
    if (runs[i]!.cutId !== cutId) continue;
    const len = polylineLength(runs[i]!.points);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  return best;
}

interface PathStep {
  faceIndex: number;
  inCut: number;
  outCut: number;
}

/** BFS across the node's faces (edges = shared cuts) from `fromCut` to `toCut`. */
function findFacePath(faces: Face[], fromCut: number, toCut: number): PathStep[] | null {
  const start = faces.findIndex((f) => f.cutIds.includes(fromCut));
  if (start < 0) return null;

  const visits = new Map<number, { parent: number; enterCut: number }>();
  visits.set(start, { parent: -1, enterCut: fromCut });
  const queue = [start];
  let goal = -1;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (faces[cur]!.cutIds.includes(toCut)) {
      goal = cur;
      break;
    }
    for (let ni = 0; ni < faces.length; ni++) {
      if (ni === cur || visits.has(ni)) continue;
      const shared = faces[ni]!.cutIds.find((c) => faces[cur]!.cutIds.includes(c));
      if (shared == null) continue;
      visits.set(ni, { parent: cur, enterCut: shared });
      queue.push(ni);
    }
  }
  if (goal < 0) return null;

  const path: PathStep[] = [];
  let idx = goal;
  let outCut = toCut;
  while (idx >= 0) {
    const v = visits.get(idx)!;
    path.unshift({ faceIndex: idx, inCut: v.enterCut, outCut });
    outCut = v.enterCut;
    idx = v.parent;
  }
  return path;
}

/** Chain per-face axes along a face path, oriented in-cut → out-cut per step. */
function chainAxisAlongPath(faces: Face[], path: PathStep[], options: ResolvedGeometryOptions): AxisPoint[] | null {
  const out: AxisPoint[] = [];
  for (const step of path) {
    const runs = extractRuns(faces[step.faceIndex]!);
    const i = longestRunIndex(runs, step.inCut);
    const j = longestRunIndex(runs, step.outCut);
    if (i < 0 || j < 0 || i === j) return null;
    // axisBetweenRuns orients min-index → max-index run; flip to in → out.
    let axis = axisBetweenRuns(runs, Math.min(i, j), Math.max(i, j), options);
    if (axis.length < 2) return null;
    clampWidthsToBoundary(axis, faces[step.faceIndex]!);
    if (i > j) axis = [...axis].reverse();
    for (const p of axis) {
      const last = out[out.length - 1];
      if (last && dist(last, p) < 1e-6) continue;
      out.push(p);
    }
  }
  return out.length >= 2 ? out : null;
}

/**
 * Polyline through the junction node's faces from `fromCut` to `toCut`,
 * following each face's own axis. Returns null when no path exists or an axis
 * degenerates (callers fall back to the centroid bridge).
 */
export function routeThroughNode(faces: Face[], fromCut: number, toCut: number, options: ResolvedGeometryOptions): AxisPoint[] | null {
  const path = findFacePath(faces, fromCut, toCut);
  if (!path) return null;
  return chainAxisAlongPath(faces, path, options);
}

/**
 * Distance from `origin` along `dir` to the junction node's boundary: wall
 * edges and OUTGOING cuts stop the ray; cuts internal to the node (shared by
 * two of its faces) and the entry cut are passed through.
 */
function rayHitDistance(origin: Point, dir: Point, faces: Face[], entryCutId: number, internalCuts: Set<number>, reach: number): number {
  const target = { x: origin.x + dir.x * reach, y: origin.y + dir.y * reach };
  let best = Infinity;
  for (const face of faces) {
    const n = face.polygon.length;
    for (let i = 0; i < n; i++) {
      const cutId = face.edgeCutIds[i]!;
      if (cutId >= 0 && (cutId === entryCutId || internalCuts.has(cutId))) continue;
      const hit = segmentIntersection(origin, target, face.polygon[i]!, face.polygon[(i + 1) % n]!);
      if (!hit) continue;
      const d = hit.t * reach;
      if (d > 1e-6 && d < best) best = d;
    }
  }
  return best;
}

/** Midpoint of a run's chord (its two end vertices). */
function runMid(run: WalkRun): Point {
  return midpoint(run.points[0]!, run.points[run.points.length - 1]!);
}

/**
 * Route an unpaired end from its entry cut through the node faces no pairing
 * route covers: BFS the uncovered faces to the deepest one, then aim across it
 * at its farthest cut mouth. Returns the face path (for coverage bookkeeping)
 * and the chained axis, or null when no axis can be built.
 */
function routeIntoUncovered(
  faces: Face[],
  entryFace: number,
  entryCut: number,
  covered: Set<number>,
  options: ResolvedGeometryOptions,
): { path: PathStep[]; axis: AxisPoint[] } | null {
  const visits = new Map<number, { parent: number; enterCut: number }>();
  visits.set(entryFace, { parent: -1, enterCut: entryCut });
  const queue = [entryFace];
  let deepest = entryFace;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    deepest = cur; // BFS order: the last face dequeued is the farthest by hops
    for (let ni = 0; ni < faces.length; ni++) {
      if (ni === cur || visits.has(ni) || covered.has(ni)) continue;
      const shared = faces[ni]!.cutIds.find((c) => faces[cur]!.cutIds.includes(c));
      if (shared == null) continue;
      visits.set(ni, { parent: cur, enterCut: shared });
      queue.push(ni);
    }
  }

  // The terminal face has no exit pairing to aim at — cross it toward the cut
  // mouth farthest from where we enter, so the extension spans the whole face.
  const terminal = faces[deepest]!;
  const terminalIn = visits.get(deepest)!.enterCut;
  const runs = extractRuns(terminal);
  const inRun = longestRunIndex(runs, terminalIn);
  if (inRun < 0) return null;
  const inMid = runMid(runs[inRun]!);
  let outCut = -1;
  let outD = -1;
  for (const run of runs) {
    if (run.cutId < 0 || run.cutId === terminalIn) continue;
    const d = dist(inMid, runMid(run));
    if (d > outD) {
      outD = d;
      outCut = run.cutId;
    }
  }
  if (outCut < 0) return null;

  const path: PathStep[] = [];
  let idx = deepest;
  while (idx >= 0) {
    const v = visits.get(idx)!;
    path.unshift({ faceIndex: idx, inCut: v.enterCut, outCut });
    outCut = v.enterCut;
    idx = v.parent;
  }
  const axis = chainAxisAlongPath(faces, path, options);
  return axis ? { path, axis } : null;
}

/**
 * Extend every UNPAIRED incident end into its junction. Without this, an
 * unpaired end stops dead at its cut and the junction area past it is drawn
 * by nobody — for a junction with no pairings at all, the entire face
 * disappears from the glyph.
 *
 * Two pen models, chosen by whether a pairing route already sweeps the face
 * the end opens into:
 *
 * - Covered: continue straight along the end's direction until the nib
 *   reaches the node's far boundary (hit distance − half the stroke width),
 *   the way a T's stem is written into the bar and the arms of a Y fill
 *   their crotch.
 * - Uncovered: the face is drawn by NOBODY else, and it can be long and
 *   curved (家's hook corridor is a 270-unit bend absorbed into the center
 *   node) — a straight ray dies on the first wall. Route through the
 *   uncovered faces along their own axes instead, exactly like a pairing
 *   route would.
 *
 * Returns the node faces that remain swept by NO route and NO extension —
 * possible when every incident end is paired but the routes bypass a face
 * (わ's corridor sits between two crossings whose ends pair among
 * themselves). The caller must rescue those faces; silently dropping them
 * loses glyph area.
 */
export function extendUnpairedEnds(
  junctions: JunctionInfo[],
  segments: SegmentInfo[],
  faceById: Map<number, Face>,
  options: ResolvedGeometryOptions,
): Face[] {
  const unswept: Face[] = [];
  for (const junction of junctions) {
    if (junction.faceIds.length === 0) continue;
    const faces = junction.faceIds.map((id) => faceById.get(id)).filter((f): f is Face => f != null);
    if (faces.length === 0) continue;

    const cutUses = new Map<number, number>();
    for (const face of faces) {
      for (const c of face.cutIds) cutUses.set(c, (cutUses.get(c) ?? 0) + 1);
    }
    const internalCuts = new Set([...cutUses].filter(([, uses]) => uses >= 2).map(([c]) => c));
    const paired = new Set(junction.pairings.flat());
    const reach = options.resampleSpacing * 200; // ~4 em — longer than any face

    // Faces swept by a pairing route (re-derive each route's face path; a
    // route that fell back to the centroid bridge sweeps nothing).
    const covered = new Set<number>();
    junction.pairings.forEach(([i, j], pi) => {
      if ((junction.routes[pi] ?? []).length === 0) return;
      const a = junction.incident[i]!;
      const b = junction.incident[j]!;
      const cutA = segments[a.segmentIndex]!.ends[a.endIndex]!.cutId;
      const cutB = segments[b.segmentIndex]!.ends[b.endIndex]!.cutId;
      const path = findFacePath(faces, cutA, cutB);
      if (path) for (const step of path) covered.add(step.faceIndex);
    });
    // Faces some extension at least enters (ray or routed) — for the warning.
    const touched = new Set<number>();

    junction.incident.forEach((inc, ii) => {
      if (paired.has(ii)) return;
      const end = segments[inc.segmentIndex]!.ends[inc.endIndex]!;
      if (end.cutId < 0) return;
      const dir = end.direction;
      if (Math.hypot(dir.x, dir.y) < 0.5) return;

      const entry = faces.findIndex((f) => f.cutIds.includes(end.cutId));
      if (entry >= 0 && !covered.has(entry)) {
        const routed = routeIntoUncovered(faces, entry, end.cutId, covered, options);
        if (routed) {
          for (const step of routed.path) {
            covered.add(step.faceIndex);
            touched.add(step.faceIndex);
          }
          junction.extensions[ii] = [{ ...end.point, width: end.width }, ...routed.axis];
          return;
        }
      }

      const hit = rayHitDistance(end.point, dir, faces, end.cutId, internalCuts, reach);
      if (!Number.isFinite(hit)) return;
      const len = hit - end.width / 2;
      if (len < options.resampleSpacing * 0.5) return;
      if (entry >= 0) touched.add(entry);
      junction.extensions[ii] = [
        { ...end.point, width: end.width },
        { x: end.point.x + dir.x * len, y: end.point.y + dir.y * len, width: end.width },
      ];
    });

    for (let fi = 0; fi < faces.length; fi++) {
      if (covered.has(fi) || touched.has(fi)) continue;
      unswept.push(faces[fi]!);
    }
  }
  return unswept;
}

/**
 * Fill `junction.routes` (aligned with `junction.pairings`) with polylines
 * routed through the junction's faces. Bare-cut junctions get empty routes —
 * the two segment axes already meet at the shared cut midpoint.
 */
export function routeJunctionPaths(
  junctions: JunctionInfo[],
  segments: SegmentInfo[],
  faceById: Map<number, Face>,
  options: ResolvedGeometryOptions,
): void {
  for (const junction of junctions) {
    junction.routes = junction.pairings.map(() => []);
    if (junction.faceIds.length === 0) continue;
    const faces = junction.faceIds.map((id) => faceById.get(id)).filter((f): f is Face => f != null);
    if (faces.length === 0) continue;

    junction.pairings.forEach(([i, j], pi) => {
      const a = junction.incident[i]!;
      const b = junction.incident[j]!;
      const cutA = segments[a.segmentIndex]!.ends[a.endIndex]!.cutId;
      const cutB = segments[b.segmentIndex]!.ends[b.endIndex]!.cutId;
      if (cutA < 0 || cutB < 0 || cutA === cutB) return;
      const route = routeThroughNode(faces, cutA, cutB, options);
      if (route) junction.routes[pi] = route;
    });
  }
}
