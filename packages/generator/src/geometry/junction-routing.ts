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

import { axisBetweenRuns, clampWidthsToBoundary, extractRuns, type WalkRun } from './medial.ts';
import { dist, polylineLength } from './primitives.ts';
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

/**
 * Polyline through the junction node's faces from `fromCut` to `toCut`,
 * following each face's own axis. Returns null when no path exists or an axis
 * degenerates (callers fall back to the centroid bridge).
 */
export function routeThroughNode(faces: Face[], fromCut: number, toCut: number, options: ResolvedGeometryOptions): AxisPoint[] | null {
  const path = findFacePath(faces, fromCut, toCut);
  if (!path) return null;

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
