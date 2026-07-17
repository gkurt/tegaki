// Small 2D geometry toolkit shared by the geometry pipeline stages.
// Everything is pure algebra over {x, y} points — no assumptions about y-up vs
// y-down beyond "positive signed area means region on the algebraic left".

import type { Point } from 'tegaki';

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
export const len = (a: Point): number => Math.sqrt(a.x * a.x + a.y * a.y);
export const dist = (a: Point, b: Point): number => len(sub(a, b));
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function normalize(a: Point): Point {
  const l = len(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** Signed area of a closed polygon (no duplicate closing point required). */
export function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += cross(a, b);
  }
  return sum / 2;
}

/** Area centroid of a closed polygon. Falls back to vertex average for degenerate areas. */
export function polygonCentroid(points: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const w = cross(p, q);
    a += w;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of points) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / points.length, y: sy / points.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Winding number of `p` w.r.t. one closed polygon. */
function windingNumber(p: Point, polygon: Point[]): number {
  let wn = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    if (a.y <= p.y) {
      if (b.y > p.y && cross(sub(b, a), sub(p, a)) > 0) wn++;
    } else if (b.y <= p.y && cross(sub(b, a), sub(p, a)) < 0) {
      wn--;
    }
  }
  return wn;
}

/** True when `p` is inside the filled region defined by all contours (nonzero winding rule). */
export function pointInRegion(p: Point, contours: { points: Point[] }[]): boolean {
  let wn = 0;
  for (const c of contours) wn += windingNumber(p, c.points);
  return wn !== 0;
}

/** True when `p` is inside a single simple polygon (nonzero on one contour). */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  return windingNumber(p, polygon) !== 0;
}

/** Distance from point `p` to segment [a, b]. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const abLen2 = dot(ab, ab);
  if (abLen2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / abLen2));
  return dist(p, add(a, scale(ab, t)));
}

export interface SegmentHit {
  /** Parameter along the first segment (0..1). */
  t: number;
  /** Parameter along the second segment (0..1). */
  u: number;
  point: Point;
}

/**
 * Intersection of segments [p, p2] and [q, q2]. Returns null for parallel /
 * non-crossing pairs. `t`/`u` are unclamped exact parameters; callers apply
 * their own epsilon policy at the endpoints.
 */
export function segmentIntersection(p: Point, p2: Point, q: Point, q2: Point): SegmentHit | null {
  const r = sub(p2, p);
  const s = sub(q2, q);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(q, p);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { t, u, point: add(p, scale(r, t)) };
}

/** Total length of an open polyline. */
export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!);
  return total;
}

/** Point at arc-length `target` along an open polyline (clamped to the ends). */
export function pointAtArcLength(points: Point[], target: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (target <= 0) return { ...points[0]! };
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i - 1]!, points[i]!);
    if (acc + d >= target && d > 0) {
      const t = (target - acc) / d;
      return add(points[i - 1]!, scale(sub(points[i]!, points[i - 1]!), t));
    }
    acc += d;
  }
  return { ...points[points.length - 1]! };
}

/** Resample an open polyline to exactly `n` points, uniformly by arc length. */
export function resamplePolyline(points: Point[], n: number): Point[] {
  if (points.length === 0) return [];
  if (n <= 1) return [{ ...points[0]! }];
  const total = polylineLength(points);
  if (total === 0) return Array.from({ length: n }, () => ({ ...points[0]! }));
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    out.push(pointAtArcLength(points, (total * i) / (n - 1)));
  }
  return out;
}

/** Closest point on an open polyline to `p`. */
export function closestPointOnPolyline(p: Point, points: Point[]): Point {
  let best = points[0]!;
  let bestD = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const ab = sub(b, a);
    const abLen2 = dot(ab, ab);
    const t = abLen2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / abLen2));
    const cand = add(a, scale(ab, t));
    const d = dist(p, cand);
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  return best;
}
