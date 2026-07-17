// Stage G2 — concave corner detection.
//
// A concave corner is a vertex where the boundary makes a sharp clockwise turn
// (region on the algebraic left ⇒ clockwise turn = reflex interior angle).
// These are the only places where distinct strokes can meet, so they seed the
// cross-section cuts of the next stage.
//
// Tangents are estimated over a short arc-length window rather than a single
// edge: adaptive bezier flattening produces variable-density vertices, and the
// window makes corner strength independent of that density. A genuine corner
// concentrates its turn within a couple of vertices, while a smooth curve of
// radius ≫ window stays under the threshold.

import type { Point } from 'tegaki';
import { add, cross, dot, normalize, scale, sub } from './primitives.ts';
import { castRay } from './raycast.ts';
import type { Contour, Corner, ResolvedGeometryOptions } from './types.ts';

/** Point at (wrapped) arc-length position `s` along the closed contour. */
function pointAtContourArc(contour: Contour, s: number): Point {
  const perimeter = contour.arcLengths[contour.points.length]!;
  let target = s % perimeter;
  if (target < 0) target += perimeter;
  const arcs = contour.arcLengths;
  // Binary search for the edge containing `target`.
  let lo = 0;
  let hi = contour.points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arcs[mid + 1]! < target) lo = mid + 1;
    else hi = mid;
  }
  const a = contour.points[lo]!;
  const b = contour.points[(lo + 1) % contour.points.length]!;
  const edgeLen = arcs[lo + 1]! - arcs[lo]!;
  const t = edgeLen > 0 ? (target - arcs[lo]!) / edgeLen : 0;
  return add(a, scale(sub(b, a), t));
}

/** Chord-estimated travel direction arriving at vertex `i` (over `window` arc units). */
function tangentBefore(contour: Contour, i: number, window: number): Point {
  const at = contour.arcLengths[i]!;
  const from = pointAtContourArc(contour, at - window);
  return normalize(sub(contour.points[i]!, from));
}

/** Chord-estimated travel direction leaving vertex `i`. */
function tangentAfter(contour: Contour, i: number, window: number): Point {
  const at = contour.arcLengths[i]!;
  const to = pointAtContourArc(contour, at + window);
  return normalize(sub(to, contour.points[i]!));
}

export function detectCorners(contours: Contour[], options: ResolvedGeometryOptions): Corner[] {
  const corners: Corner[] = [];

  for (let ci = 0; ci < contours.length; ci++) {
    const contour = contours[ci]!;
    const n = contour.points.length;
    const perimeter = contour.arcLengths[n]!;
    // Tiny contours can't fit the full window without the two chords overlapping.
    const window = Math.min(options.cornerWindow, perimeter / 4);
    if (window <= 0) continue;

    // Signed turn at every vertex.
    const turns = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const u = tangentBefore(contour, i, window);
      const v = tangentAfter(contour, i, window);
      turns[i] = Math.atan2(cross(u, v), dot(u, v));
    }

    // Vertices exceeding the concave threshold (clockwise turn = negative).
    const flagged: number[] = [];
    for (let i = 0; i < n; i++) {
      if (turns[i]! <= -options.cornerAngleThreshold) flagged.push(i);
    }
    if (flagged.length === 0) continue;

    // Cluster flagged vertices within `window` arc distance (with wraparound)
    // and keep the sharpest vertex of each cluster.
    const clusters: number[][] = [];
    let current: number[] = [flagged[0]!];
    for (let k = 1; k < flagged.length; k++) {
      const prev = current[current.length - 1]!;
      const gap = contour.arcLengths[flagged[k]!]! - contour.arcLengths[prev]!;
      if (gap <= window) current.push(flagged[k]!);
      else {
        clusters.push(current);
        current = [flagged[k]!];
      }
    }
    clusters.push(current);
    // Merge first and last cluster across the seam.
    if (clusters.length > 1) {
      const first = clusters[0]!;
      const last = clusters[clusters.length - 1]!;
      const seamGap = perimeter - contour.arcLengths[last[last.length - 1]!]! + contour.arcLengths[first[0]!]!;
      if (seamGap <= window) {
        clusters[0] = [...last, ...first];
        clusters.pop();
      }
    }

    for (const cluster of clusters) {
      let best = cluster[0]!;
      for (const i of cluster) if (turns[i]! < turns[best]!) best = i;

      const point = contour.points[best]!;
      const slotA = tangentBefore(contour, best, window); // incoming wall, continued straight through
      const slotB = scale(tangentAfter(contour, best, window), -1); // outgoing wall, walked backwards

      corners.push({
        contourIndex: ci,
        pointIndex: best,
        point,
        turnAngle: turns[best]!,
        slots: [slotA, slotB],
        localWidth: 0, // filled below
      });
    }
  }

  // Local width per corner: shortest ray-cast into the region along each slot
  // and their bisector. Caps cut lengths so cuts cross strokes rather than
  // running lengthwise along them.
  for (const corner of corners) {
    const exclude = (ci: number, ei: number) => {
      if (ci !== corner.contourIndex) return false;
      const n = contours[ci]!.points.length;
      return ei === corner.pointIndex || ei === (corner.pointIndex - 1 + n) % n;
    };
    const bisector = normalize(add(corner.slots[0], corner.slots[1]));
    const dirs = [corner.slots[0], corner.slots[1], ...(bisector.x !== 0 || bisector.y !== 0 ? [bisector] : [])];
    let min = Infinity;
    for (const dir of dirs) {
      const hit = castRay(corner.point, dir, contours, { excludeContourEdge: exclude, minDist: 1e-6 });
      if (hit && hit.dist < min) min = hit.dist;
    }
    corner.localWidth = Number.isFinite(min) ? min : 0;
  }

  return corners;
}
