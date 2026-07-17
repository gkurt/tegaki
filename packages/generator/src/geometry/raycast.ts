// Ray casting against contour edges and cut segments — used for corner
// local-width estimation and for projecting wall-continuation cuts.

import type { Point } from 'tegaki';
import { cross, sub } from './primitives.ts';
import type { Contour } from './types.ts';

export type RayTarget =
  | { type: 'contour'; contourIndex: number; edgeIndex: number; u: number }
  | { type: 'cut'; cutIndex: number; u: number };

export interface RayHit {
  dist: number;
  point: Point;
  target: RayTarget;
}

export interface CastRayOptions {
  /** Return true to skip a contour edge (e.g. edges incident to the ray origin). */
  excludeContourEdge?: (contourIndex: number, edgeIndex: number) => boolean;
  /** Additional segments (existing cuts) the ray can hit. */
  cutSegments?: { a: Point; b: Point }[];
  /** Ignore hits closer than this along the ray. */
  minDist?: number;
}

/** First intersection of the ray (origin, unit dir) with the outline or cut segments. */
export function castRay(origin: Point, dir: Point, contours: Contour[], options: CastRayOptions = {}): RayHit | null {
  const { excludeContourEdge, cutSegments, minDist = 1e-9 } = options;
  let best: RayHit | null = null;

  const consider = (a: Point, b: Point, target: (u: number) => RayTarget) => {
    const e = sub(b, a);
    const denom = cross(dir, e);
    if (Math.abs(denom) < 1e-12) return;
    const oa = sub(a, origin);
    const s = cross(oa, e) / denom;
    const u = cross(oa, dir) / denom;
    if (s <= minDist || u < -1e-9 || u > 1 + 1e-9) return;
    if (best && s >= best.dist) return;
    best = {
      dist: s,
      point: { x: origin.x + dir.x * s, y: origin.y + dir.y * s },
      target: target(Math.max(0, Math.min(1, u))),
    };
  };

  for (let ci = 0; ci < contours.length; ci++) {
    const pts = contours[ci]!.points;
    for (let ei = 0; ei < pts.length; ei++) {
      if (excludeContourEdge?.(ci, ei)) continue;
      consider(pts[ei]!, pts[(ei + 1) % pts.length]!, (u) => ({ type: 'contour', contourIndex: ci, edgeIndex: ei, u }));
    }
  }

  if (cutSegments) {
    for (let i = 0; i < cutSegments.length; i++) {
      consider(cutSegments[i]!.a, cutSegments[i]!.b, (u) => ({ type: 'cut', cutIndex: i, u }));
    }
  }

  return best;
}
