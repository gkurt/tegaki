// Stage G1 — normalize flattened sub-paths into oriented contours.
//
// Input: `flattenPath` output (closed sub-paths repeat their first point at the
// end). Output: deduplicated closed polygons, oriented so the filled region is
// on the algebraic left of travel (outer contours: positive signed area, holes:
// negative), with hole flags derived from containment nesting parity.

import type { Point } from 'tegaki';
import { dist, pointInPolygon, signedArea } from './primitives.ts';
import type { Contour } from './types.ts';

function cumulativeArcLengths(points: Point[]): number[] {
  const out = [0];
  for (let i = 1; i <= points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i % points.length]!;
    out.push(out[i - 1]! + dist(a, b));
  }
  return out;
}

/**
 * Collapse the zero-width spikes of a closed polygon: vertices where the
 * outline runs out and straight back along the same line (Caveat's `F` has
 * one at the tip of its top bar). A spike holds no ink, and its two edges
 * overlap, so no triangulation can hold both — the ink mesh splits them over
 * and over and the glyph comes out in dozens of fragments. Removing each tip
 * in turn folds the spike back to its base.
 */
export function dropSpikes(points: Point[]): Point[] {
  const out = [...points];
  let i = 0;
  let stable = 0;
  while (out.length >= 3 && stable < out.length) {
    const n = out.length;
    const a = out[(i + n - 1) % n]!;
    const p = out[i % n]!;
    const b = out[(i + 1) % n]!;
    const ux = p.x - a.x;
    const uy = p.y - a.y;
    const vx = b.x - p.x;
    const vy = b.y - p.y;
    const cross = ux * vy - uy * vx;
    const dot = ux * vx + uy * vy;
    // Turning back (dot < 0) with a sine of the turn under 1e-6: a hairline.
    if (dot < 0 && Math.abs(cross) <= 1e-6 * Math.hypot(ux, uy) * Math.hypot(vx, vy)) {
      out.splice(i % n, 1);
      // The spike's base may now repeat itself.
      const m = out.length;
      const at = (i + m - 1) % m;
      if (m > 1 && dist(out[at]!, out[(at + 1) % m]!) < 1e-9) out.splice((at + 1) % m, 1);
      i = Math.max(0, i - 2);
      stable = 0;
    } else {
      i = (i + 1) % n;
      stable++;
    }
  }
  return out;
}

export function buildContours(subPaths: Point[][]): Contour[] {
  const cleaned: Point[][] = [];

  for (const path of subPaths) {
    const points: Point[] = [];
    for (const p of path) {
      const prev = points[points.length - 1];
      if (prev && dist(prev, p) < 1e-9) continue;
      points.push({ x: p.x, y: p.y });
    }
    // Drop the duplicate closing point flattenPath appends on 'Z'.
    if (points.length > 1 && dist(points[0]!, points[points.length - 1]!) < 1e-9) points.pop();
    const unspiked = dropSpikes(points);
    if (unspiked.length < 3) continue;
    points.splice(0, points.length, ...unspiked);
    if (Math.abs(signedArea(points)) < 1e-9) continue;
    cleaned.push(points);
  }

  // Containment nesting parity: a contour inside an odd number of others is a
  // hole. Test a single vertex — fine for well-formed (non-overlapping) fonts.
  const contours: Contour[] = cleaned.map((points) => {
    return { points, area: signedArea(points), isHole: false, arcLengths: [] };
  });

  for (let i = 0; i < contours.length; i++) {
    let containedIn = 0;
    for (let j = 0; j < contours.length; j++) {
      if (i === j) continue;
      if (pointInPolygon(contours[i]!.points[0]!, contours[j]!.points)) containedIn++;
    }
    contours[i]!.isHole = containedIn % 2 === 1;
  }

  // Orient: outer → positive area (region on algebraic left), holes → negative.
  for (const c of contours) {
    const wantPositive = !c.isHole;
    if (wantPositive !== c.area > 0) {
      c.points.reverse();
      c.area = -c.area;
    }
    c.arcLengths = cumulativeArcLengths(c.points);
  }

  return contours;
}

/**
 * Detect pairs of contours whose edges intersect. Overlapping contours mean the
 * font relies on nonzero-winding union, which this pipeline does not resolve —
 * callers surface this as a warning so bad output is explainable.
 */
export function findContourOverlaps(contours: Contour[]): [number, number][] {
  const overlaps: [number, number][] = [];
  for (let i = 0; i < contours.length; i++) {
    for (let j = i + 1; j < contours.length; j++) {
      if (contoursIntersect(contours[i]!.points, contours[j]!.points)) overlaps.push([i, j]);
    }
  }
  return overlaps;
}

function contoursIntersect(a: Point[], b: Point[]): boolean {
  // Cheap bbox reject first.
  const bb = (pts: Point[]) => {
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const p of pts) {
      if (p.x < x1) x1 = p.x;
      if (p.y < y1) y1 = p.y;
      if (p.x > x2) x2 = p.x;
      if (p.y > y2) y2 = p.y;
    }
    return { x1, y1, x2, y2 };
  };
  const ba = bb(a);
  const bbx = bb(b);
  if (ba.x2 < bbx.x1 || bbx.x2 < ba.x1 || ba.y2 < bbx.y1 || bbx.y2 < ba.y1) return false;

  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j]!;
      const b2 = b[(j + 1) % b.length]!;
      const r = { x: a2.x - a1.x, y: a2.y - a1.y };
      const s = { x: b2.x - b1.x, y: b2.y - b1.y };
      const denom = r.x * s.y - r.y * s.x;
      if (Math.abs(denom) < 1e-12) continue;
      const qp = { x: b1.x - a1.x, y: b1.y - a1.y };
      const t = (qp.x * s.y - qp.y * s.x) / denom;
      const u = (qp.x * r.y - qp.y * r.x) / denom;
      // Strict interior crossing only — shared endpoints are not overlaps.
      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) return true;
    }
  }
  return false;
}
