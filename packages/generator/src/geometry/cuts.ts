// Stage G3 — cross-section cut generation.
//
// Cuts are straight chords of the filled region that mark where strokes meet.
// Two kinds:
//
// 1. Corner-corner cuts pair two concave corners that "face" each other: the
//    chord must run along a wall-continuation direction of both corners, stay
//    strictly inside the region, and be short relative to the local stroke
//    width (so it crosses a stroke instead of running lengthwise along one —
//    e.g. the two inner corners of an N must NOT be connected).
//
// 2. Projected cuts continue a corner's remaining wall direction into the
//    region until it hits the outline or another cut. These complete junction
//    regions: for a T, the corner-corner cut separates the stem while the two
//    projections lift the junction quad out of the bar.
//
// Every concave corner has two wall slots; each slot is consumed by at most
// one cut, which naturally handles X (4 corners / 4 cuts) and asterisk-style
// junctions (2k corners / 2k cuts) without special cases.

import type { Point } from 'tegaki';
import { add, dist, distToSegment, dot, normalize, pointInRegion, scale, segmentIntersection, sub } from './primitives.ts';
import { castRay } from './raycast.ts';
import type { Contour, Corner, Cut, CutEndpoint, ResolvedGeometryOptions } from './types.ts';

const INTERIOR_SAMPLES = 8;

interface PairCandidate {
  cornerA: number;
  cornerB: number;
  slotA: number;
  slotB: number;
  length: number;
}

/** Best-aligned slot index at a corner for cut direction `dir`, or -1 if neither is within tolerance. */
function matchSlot(corner: Corner, dir: Point, tolerance: number): number {
  const minCos = Math.cos(tolerance);
  const cos0 = dot(corner.slots[0], dir);
  const cos1 = dot(corner.slots[1], dir);
  if (cos0 < minCos && cos1 < minCos) return -1;
  return cos0 >= cos1 ? 0 : 1;
}

/** True when the open chord (a, b) stays strictly inside the filled region. */
function chordIsInterior(a: Point, b: Point, contours: Contour[]): boolean {
  const length = dist(a, b);
  const clearance = Math.max(1e-9, length * 1e-3);
  for (let k = 1; k <= INTERIOR_SAMPLES; k++) {
    const t = k / (INTERIOR_SAMPLES + 1);
    const p = add(a, scale(sub(b, a), t));
    if (!pointInRegion(p, contours)) return false;
    // Clearance check kills chords collinear with a boundary edge (e.g. the
    // bottom edge of A's counter), where the winding test alone is unstable.
    let minD = Infinity;
    for (const contour of contours) {
      const pts = contour.points;
      for (let i = 0; i < pts.length; i++) {
        const d = distToSegment(p, pts[i]!, pts[(i + 1) % pts.length]!);
        if (d < minD) minD = d;
        if (minD < clearance) return false;
      }
    }
  }
  return true;
}

/** True when the chord properly crosses any contour edge not incident to the given corner vertices. */
function chordCrossesBoundary(a: Point, b: Point, contours: Contour[], cornerA: Corner, cornerB: Corner): boolean {
  for (let ci = 0; ci < contours.length; ci++) {
    const pts = contours[ci]!.points;
    const n = pts.length;
    for (let ei = 0; ei < n; ei++) {
      // Skip the four edges incident to the two corner vertices.
      const incidentToA = ci === cornerA.contourIndex && (ei === cornerA.pointIndex || ei === (cornerA.pointIndex - 1 + n) % n);
      const incidentToB = ci === cornerB.contourIndex && (ei === cornerB.pointIndex || ei === (cornerB.pointIndex - 1 + n) % n);
      if (incidentToA || incidentToB) continue;
      const hit = segmentIntersection(a, b, pts[ei]!, pts[(ei + 1) % n]!);
      if (hit && hit.t > 1e-6 && hit.t < 1 - 1e-6) return true;
    }
  }
  return false;
}

/** True when segment (a,b) properly crosses any accepted cut (shared endpoints allowed). */
function crossesAcceptedCut(a: Point, b: Point, cuts: Cut[]): boolean {
  for (const cut of cuts) {
    const hit = segmentIntersection(a, b, cut.a.point, cut.b.point);
    if (hit && hit.t > 1e-6 && hit.t < 1 - 1e-6 && hit.u > 1e-6 && hit.u < 1 - 1e-6) return true;
  }
  return false;
}

export function generateCuts(contours: Contour[], corners: Corner[], options: ResolvedGeometryOptions): Cut[] {
  const cuts: Cut[] = [];
  // slotUsed[cornerIndex][slotIndex]
  const slotUsed = corners.map(() => [false, false]);
  const connected = new Set<string>();

  // ── 1. Corner-corner candidates ─────────────────────────────────────────
  const candidates: PairCandidate[] = [];
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const ca = corners[i]!;
      const cb = corners[j]!;
      const chord = sub(cb.point, ca.point);
      const length = dist(ca.point, cb.point);
      if (length < 1e-6) continue;

      const widthCap = options.maxCutLengthFactor * Math.min(ca.localWidth || Infinity, cb.localWidth || Infinity);
      if (length > widthCap) continue;

      const dir = normalize(chord);
      const slotA = matchSlot(ca, dir, options.cutAlignTolerance);
      const slotB = matchSlot(cb, scale(dir, -1), options.cutAlignTolerance);
      if (slotA < 0 || slotB < 0) continue;

      if (chordCrossesBoundary(ca.point, cb.point, contours, ca, cb)) continue;
      if (!chordIsInterior(ca.point, cb.point, contours)) continue;

      candidates.push({ cornerA: i, cornerB: j, slotA, slotB, length });
    }
  }

  // Shortest-first greedy keeps genuine cross-sections and starves long
  // diagonal alternatives (e.g. X prefers the four short quad sides).
  candidates.sort((a, b) => a.length - b.length);
  for (const cand of candidates) {
    if (slotUsed[cand.cornerA]![cand.slotA] || slotUsed[cand.cornerB]![cand.slotB]) continue;
    const pairKey = `${cand.cornerA}:${cand.cornerB}`;
    if (connected.has(pairKey)) continue;
    const a = corners[cand.cornerA]!;
    const b = corners[cand.cornerB]!;
    if (crossesAcceptedCut(a.point, b.point, cuts)) continue;

    slotUsed[cand.cornerA]![cand.slotA] = true;
    slotUsed[cand.cornerB]![cand.slotB] = true;
    connected.add(pairKey);
    cuts.push({
      a: { kind: 'corner', cornerIndex: cand.cornerA, point: a.point },
      b: { kind: 'corner', cornerIndex: cand.cornerB, point: b.point },
      source: 'pair',
      length: cand.length,
    });
  }

  // ── 2. Projected cuts from unused slots ─────────────────────────────────
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[i]!;
    for (let slot = 0; slot < 2; slot++) {
      if (slotUsed[i]![slot]) continue;
      const dir = corner.slots[slot as 0 | 1];
      const excludeOwnEdges = (ci: number, ei: number) => {
        if (ci !== corner.contourIndex) return false;
        const n = contours[ci]!.points.length;
        return ei === corner.pointIndex || ei === (corner.pointIndex - 1 + n) % n;
      };
      const hit = castRay(corner.point, dir, contours, {
        excludeContourEdge: excludeOwnEdges,
        cutSegments: cuts.map((c) => ({ a: c.a.point, b: c.b.point })),
        minDist: 1e-6,
      });
      if (!hit) continue;
      const cap = options.maxCutLengthFactor * (corner.localWidth || Infinity);
      if (hit.dist > cap || hit.dist < 1e-6) continue;

      let endpoint: CutEndpoint;
      if (hit.target.type === 'cut') {
        endpoint = { kind: 'cut', cutIndex: hit.target.cutIndex, point: hit.point };
      } else {
        endpoint = { kind: 'edge', contourIndex: hit.target.contourIndex, edgeIndex: hit.target.edgeIndex, point: hit.point };
      }

      slotUsed[i]![slot] = true;
      cuts.push({
        a: { kind: 'corner', cornerIndex: i, point: corner.point },
        b: endpoint,
        source: 'projected',
        length: hit.dist,
      });
    }
  }

  return cuts;
}
