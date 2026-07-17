// Stage G1.5 — split contours into independent regions.
//
// Fonts fall into two broad shapes:
//
//   1. Union glyphs — the whole letter is one outline (possibly with holes),
//      and distinct strokes meet at concave corners inside a single filled
//      region (E, H, A, o, ...). These need the cut-based decomposition.
//
//   2. Overlapping-stroke glyphs — the letter is drawn as several contours that
//      overlap and rely on nonzero-winding union (common in script/handwriting
//      fonts: Caveat draws T, X, R this way). Here each contour is essentially
//      one pen stroke, and crossings are formed by *overlap*, not by reflex
//      vertices — so no concave corner exists to cut.
//
// A single decomposition can't serve both. This stage groups contours into
// regions the rest of the pipeline runs independently:
//
//   - Contours that overlap another contour become standalone regions (one pen
//     stroke each), so a crossing of two strokes stays two strokes.
//   - Contours that never overlap are grouped by nesting into outer+holes
//     regions (an O's ring and counter stay one annulus).
//
// With no overlaps this yields exactly one region = all contours, so union
// glyphs are unaffected.

import type { Point } from 'tegaki';
import { dist, pointInPolygon, signedArea } from './primitives.ts';
import type { Contour } from './types.ts';

function cumulativeArcLengths(points: Point[]): number[] {
  const out = [0];
  for (let i = 1; i <= points.length; i++) out.push(out[i - 1]! + dist(points[i - 1]!, points[i % points.length]!));
  return out;
}

/** Return a contour re-oriented to the desired winding (outer=positive area), arc lengths refreshed. */
function reorient(points: Point[], asHole: boolean): Contour {
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  let area = signedArea(pts);
  const wantPositive = !asHole;
  if (wantPositive !== area > 0) {
    pts.reverse();
    area = -area;
  }
  return { points: pts, area, isHole: asHole, arcLengths: cumulativeArcLengths(pts) };
}

/** Group contours into regions; each region is a self-contained outer+holes set. */
export function partitionRegions(contours: Contour[], overlaps: [number, number][]): Contour[][] {
  const n = contours.length;
  if (n === 0) return [];

  const overlapping = new Set<number>();
  for (const [i, j] of overlaps) {
    overlapping.add(i);
    overlapping.add(j);
  }

  // Fast path: no overlaps → one region, keep as already oriented.
  if (overlapping.size === 0) return [contours];

  const regions: Contour[][] = [];

  // Non-overlapping contours: standard even/odd nesting → outer+holes regions.
  const nonOverlap = [];
  for (let i = 0; i < n; i++) if (!overlapping.has(i)) nonOverlap.push(i);

  const depth = new Map<number, number>();
  for (const i of nonOverlap) {
    let d = 0;
    for (const j of nonOverlap) {
      if (i === j) continue;
      if (pointInPolygon(contours[i]!.points[0]!, contours[j]!.points)) d++;
    }
    depth.set(i, d);
  }

  // Each even-depth contour is an outer; odd-depth are holes assigned to the
  // smallest even-depth contour containing them.
  const outerRegion = new Map<number, Contour[]>();
  for (const i of nonOverlap) {
    if (depth.get(i)! % 2 === 0) outerRegion.set(i, [reorient(contours[i]!.points, false)]);
  }
  for (const i of nonOverlap) {
    if (depth.get(i)! % 2 === 0) continue;
    let owner = -1;
    let ownerArea = Infinity;
    for (const [oi] of outerRegion) {
      if (!pointInPolygon(contours[i]!.points[0]!, contours[oi]!.points)) continue;
      const a = Math.abs(contours[oi]!.area);
      if (a < ownerArea) {
        ownerArea = a;
        owner = oi;
      }
    }
    if (owner >= 0) outerRegion.get(owner)!.push(reorient(contours[i]!.points, true));
  }
  for (const region of outerRegion.values()) regions.push(region);

  // Overlapping contours: each its own standalone solid region.
  for (const i of overlapping) regions.push([reorient(contours[i]!.points, false)]);

  return regions;
}
