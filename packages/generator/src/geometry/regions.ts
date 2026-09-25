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
//   - Contours that cross another contour become standalone regions (one pen
//     stroke each), so a crossing of two strokes stays two strokes.
//   - Nesting (full containment, which is never a crossing) assigns holes to
//     the smallest outer containing them — INCLUDING outers that cross other
//     contours. Caveat's R draws its bowl+stem as one outline that crosses
//     the leg stroke; the bowl's counter must ride with that outline as its
//     hole. Restricting nesting to non-crossing contours orphaned the
//     counter at depth 0, so it came back as a standalone SOLID region — the
//     hole was drawn as ink with its own medial axis, while the hole-less
//     bowl got a filled-teardrop axis through the middle of the counter.
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

  // Fast path: no overlaps → one region, keep as already oriented.
  if (overlaps.length === 0) return [contours];

  // Boundary-CROSSING pairs (what findContourOverlaps detects): neither
  // contains the other, so they are excluded from the nesting relation.
  // Containment is only tested between non-crossing pairs, where a single
  // vertex test decides the whole contour.
  const crossing = new Set<number>();
  for (const [i, j] of overlaps) {
    crossing.add(i * n + j);
    crossing.add(j * n + i);
  }
  const contains = (outer: number, inner: number): boolean =>
    outer !== inner && !crossing.has(outer * n + inner) && pointInPolygon(contours[inner]!.points[0]!, contours[outer]!.points);

  // Nesting parity over ALL contours: even depth = outer (solid), odd = hole.
  const depth = contours.map((_, i) => {
    let d = 0;
    for (let j = 0; j < n; j++) if (contains(j, i)) d++;
    return d;
  });

  // Each outer is its own region — crossing outers stay separate pen strokes.
  // Holes ride with the smallest outer containing them, whether or not that
  // outer crosses other contours (Caveat R's bowl counter). Unowned holes
  // (degenerate input) are dropped, never emitted as solid ink.
  const regionOf = new Map<number, Contour[]>();
  for (let i = 0; i < n; i++) {
    if (depth[i]! % 2 === 0) regionOf.set(i, [reorient(contours[i]!.points, false)]);
  }
  for (let i = 0; i < n; i++) {
    if (depth[i]! % 2 !== 1) continue;
    let owner = -1;
    let ownerArea = Infinity;
    for (const [oi] of regionOf) {
      if (!contains(oi, i)) continue;
      const a = Math.abs(contours[oi]!.area);
      if (a < ownerArea) {
        ownerArea = a;
        owner = oi;
      }
    }
    if (owner >= 0) regionOf.get(owner)!.push(reorient(contours[i]!.points, true));
  }
  return [...regionOf.values()];
}

/**
 * Split a region into its connected pieces of ink: each outer contour with
 * the holes it owns (the smallest outer containing them). A region's outers
 * don't cross (crossing outers are separate regions), so the pieces are
 * disjoint — the two dots of a colon, a letter and its i-dot.
 */
export function splitComponents(region: Contour[]): Contour[][] {
  const outers = region.filter((c) => !c.isHole);
  if (outers.length <= 1) return [region];
  const parts = outers.map((c) => [c]);
  for (const hole of region) {
    if (!hole.isHole) continue;
    let owner = -1;
    let ownerArea = Infinity;
    outers.forEach((outer, i) => {
      const a = Math.abs(outer.area);
      if (a < ownerArea && pointInPolygon(hole.points[0]!, outer.points)) {
        ownerArea = a;
        owner = i;
      }
    });
    if (owner >= 0) parts[owner]!.push(hole);
  }
  return parts;
}
