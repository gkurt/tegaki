// Stage G6 — junction continuation matching + stroke assembly.
//
// Each segment axis has up to two ends, each terminating on a cut. A cut is
// shared by two faces; the junction on the far side of the cut is where a
// segment may continue into another segment. For every junction we collect the
// incident segment ends and decide which pairs are "the same stroke passing
// through" using a heuristic on:
//
//   - direction:  the two ends should be roughly antiparallel (the stroke goes
//                 straight through, not making a sharp turn) — cos(bend) test.
//   - width:      matched ends should have similar stroke width.
//   - offset:     the two cut midpoints should be close (the stroke doesn't
//                 jump sideways crossing the junction).
//
// A junction may host several independent strokes (X → 2, asterisk → 3): we
// greedily accept the best-scoring compatible pairs, each end used once. Any
// end left unpaired terminates its stroke at the junction. Accepted pairs are
// then chained across junctions into whole strokes, bridged through each
// junction centroid so the drawn line passes through the crossing.
//
// When candidates CONFLICT (two gated pairs claim the same end) and the
// caller provides a trial-join scorer, each candidate is additionally judged
// on the MERGED shape — the straight skeleton of the two segments' faces
// united with the junction faces, as if the join had already been accepted
// (see trial-join.ts). The trial is strictly a REVERSAL VETO: a join whose
// merged spine turns back on itself (alignment < 0) is demoted below its
// rivals; anything gentler is treated as measurement noise and the tangent
// ranking stands (see the note in matchContinuations). The tangent test
// stays as the compatibility GATE (a trial is never used to admit a pair the
// gate rejected), and unambiguous junctions skip the trial entirely —
// ranking decides nothing there.

import type { Point } from 'tegaki';
import { dist, dot, normalize, sub } from './primitives.ts';
import type { AxisEnd, AxisPoint, GeoStroke, JunctionInfo, ResolvedGeometryOptions, SegmentInfo } from './types.ts';

/** endKey packs (segmentIndex, endIndex) for use in maps/sets. */
const endKey = (seg: number, end: number) => seg * 2 + end;

interface Incidence {
  segmentIndex: number;
  endIndex: number;
  end: AxisEnd;
}

/**
 * A junction "node" the pipeline pre-computes: either a connected component of
 * junction-classified faces, or a bare cut directly separating two segment
 * faces. Both merge segments the same way, so they share this shape.
 */
export interface JunctionNode {
  faceIds: number[];
  /** Cuts bordering this node — a segment end on any of these opens into it. */
  cutIds: number[];
  /** Geometric center used to bridge assembled strokes through the crossing. */
  center: Point;
}

/**
 * Attach segment ends to the junction node they open into. A segment end sits
 * on a cut; that cut borders exactly two faces, so it belongs to at most one
 * node (its own segment face is never a node). Ends are matched to nodes purely
 * by cut membership — no per-face far-side search needed.
 */
export function buildJunctions(segments: SegmentInfo[], nodes: JunctionNode[]): JunctionInfo[] {
  const cutToNode = new Map<number, number>();
  nodes.forEach((node, ni) => {
    for (const c of node.cutIds) cutToNode.set(c, ni);
  });

  const nodeIncidence = new Map<number, Incidence[]>();
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si]!;
    for (let ei = 0; ei < seg.ends.length; ei++) {
      const end = seg.ends[ei]!;
      if (end.cutId < 0) continue;
      const ni = cutToNode.get(end.cutId);
      if (ni == null) continue;
      const list = nodeIncidence.get(ni) ?? [];
      list.push({ segmentIndex: si, endIndex: ei, end });
      nodeIncidence.set(ni, list);
    }
  }

  const junctions: JunctionInfo[] = [];
  for (const [ni, incidences] of nodeIncidence) {
    const node = nodes[ni]!;
    // Prefer the node's own geometric center; fall back to the average of
    // incident cut midpoints (bare cuts carry no face center).
    let center = node.center;
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      let cx = 0;
      let cy = 0;
      for (const inc of incidences) {
        cx += inc.end.point.x;
        cy += inc.end.point.y;
      }
      center = { x: cx / incidences.length, y: cy / incidences.length };
    }
    junctions.push({
      faceIds: node.faceIds,
      centroid: center,
      incident: incidences.map((i) => ({ segmentIndex: i.segmentIndex, endIndex: i.endIndex })),
      pairings: [],
      routes: [],
      extensions: incidences.map(() => null),
    });
  }

  return junctions;
}

interface PairScore {
  i: number;
  j: number;
  score: number;
  widthScore: number;
  offsetScore: number;
}

/** Component scores for a candidate continuation between two incident ends. */
function pairParts(a: AxisEnd, b: AxisEnd): { alignment: number; widthScore: number; offsetScore: number } {
  // Directions point OUT of each segment into the junction, so a straight
  // through-stroke has antiparallel directions (dot ≈ -1). "Bend" is the
  // deviation from straight; alignment = cos(bend), 1 = perfectly straight.
  const alignment = -dot(a.direction, b.direction);

  // Width compatibility: penalize large relative differences.
  const wMax = Math.max(a.width, b.width, 1e-6);
  const widthScore = Math.min(a.width, b.width) / wMax;

  // Offset: how far apart the two cut midpoints are, relative to width.
  const offsetScore = 1 / (1 + dist(a.point, b.point) / wMax);

  return { alignment, widthScore, offsetScore };
}

/** Direction dominates; width and offset break ties and reject bad matches. */
const composeScore = (alignment: number, widthScore: number, offsetScore: number): number =>
  alignment * 0.6 + widthScore * 0.25 + offsetScore * 0.15;

/**
 * Optional merged-shape scorer for conflicting candidates (see trial-join.ts):
 * cos of the through-bend measured on the straight skeleton of the union of
 * both segments' faces and the junction faces, or null when the trial cannot
 * run. Used only as a reversal veto — a candidate is demoted when this is
 * negative, and ignored otherwise.
 */
export type TrialJoinScorer = (
  a: { segmentIndex: number; endIndex: number },
  b: { segmentIndex: number; endIndex: number },
  junction: JunctionInfo,
) => number | null;

/** Greedily accept best-scoring continuation pairs at one junction, each end used once. */
export function matchContinuations(
  junction: JunctionInfo,
  segments: SegmentInfo[],
  options: ResolvedGeometryOptions,
  trialJoin?: TrialJoinScorer,
): void {
  const ends = junction.incident.map((inc) => segments[inc.segmentIndex]!.ends[inc.endIndex]!);

  // Degree-2 junction: exactly two segment ends meet and there is nothing else
  // to continue into. This is a *bend within a single pen stroke* — one concave
  // corner carved the cut — so the two ends are the same stroke and must merge
  // regardless of the turn angle. The bend threshold only exists to *choose*
  // among alternatives, which only arise at higher-degree junctions (T's,
  // crossings). Applying it here wrongly splits sharply-curving handwriting
  // strokes (the belly of ち, the elbow of て) into two.
  if (ends.length === 2 && junction.incident[0]!.segmentIndex !== junction.incident[1]!.segmentIndex) {
    junction.pairings.push([0, 1]);
    return;
  }

  const candidates: PairScore[] = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      // Never pair two ends of the same segment (a segment can't continue into
      // itself across a junction).
      if (junction.incident[i]!.segmentIndex === junction.incident[j]!.segmentIndex) continue;
      const { alignment, widthScore, offsetScore } = pairParts(ends[i]!, ends[j]!);
      if (alignment < options.continuationMinCos) continue;
      const score = composeScore(alignment, widthScore, offsetScore);
      if (score > 0) candidates.push({ i, j, score, widthScore, offsetScore });
    }
  }

  // Trial-join re-ranking: only candidates competing for a shared end are
  // trialed — greedy accepts non-conflicting pairs regardless of order, so a
  // trial there would burn a skeleton build to decide nothing.
  //
  // The trial is a REVERSAL VETO, nothing more: a candidate is demoted only
  // when the merged-shape spine turns back on itself (alignment < 0). That is
  // the one verdict the trial gives reliably (Caveat f's stem×crossbar scored
  // −0.56, k's stem×arm −0.83 — both genuine folds the tangents missed).
  // Anywhere gentler the measurement is NOISE at exactly the junctions that
  // matter: where a stroke crosses itself, the skeleton launders a real 75°
  // pen turn into a smooth curve (Klee One ぁ's stub×tail scored 0.91 and, as
  // a promoter, displaced both true pairs and stranded the ring) and
  // under-scores true joins (ぁ's stub×circle 0.21, む's knot exit 0.39 —
  // as a min() demoter, the latter split む's canonical first stroke). So:
  // never promote, and demote only on a confident doubling-back verdict.
  if (trialJoin && candidates.length >= 2) {
    const endUses = new Map<number, number>();
    for (const cand of candidates) {
      endUses.set(cand.i, (endUses.get(cand.i) ?? 0) + 1);
      endUses.set(cand.j, (endUses.get(cand.j) ?? 0) + 1);
    }
    for (const cand of candidates) {
      if ((endUses.get(cand.i) ?? 0) < 2 && (endUses.get(cand.j) ?? 0) < 2) continue;
      const trialAlignment = trialJoin(junction.incident[cand.i]!, junction.incident[cand.j]!, junction);
      if (typeof process !== 'undefined' && process.env?.GEO_TRIAL_DEBUG) {
        const a = junction.incident[cand.i]!;
        const b = junction.incident[cand.j]!;
        console.error(
          `[trial] seg${a.segmentIndex}.e${a.endIndex} × seg${b.segmentIndex}.e${b.endIndex} @(${junction.centroid.x.toFixed(0)},${junction.centroid.y.toFixed(0)}) tangentScore=${cand.score.toFixed(3)} trialAlign=${trialAlignment == null ? 'null' : trialAlignment.toFixed(3)}`,
        );
      }
      if (trialAlignment != null && trialAlignment < 0) {
        cand.score = composeScore(trialAlignment, cand.widthScore, cand.offsetScore);
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const used = new Set<number>();
  for (const cand of candidates) {
    if (used.has(cand.i) || used.has(cand.j)) continue;
    used.add(cand.i);
    used.add(cand.j);
    junction.pairings.push([cand.i, cand.j]);
  }
}

/**
 * Chain segments into strokes by walking accepted pairings across junctions.
 *
 * Builds an adjacency of (segmentIndex, endIndex) → (segmentIndex, endIndex)
 * links from every junction's pairings, plus the junction centroid to bridge
 * through. Then traverses maximal chains: each stroke is a run of segments
 * whose ends are linked, glued end-to-end and threaded through the junction
 * centroids so the polyline visibly passes through each crossing.
 */
export function assembleStrokes(segments: SegmentInfo[], junctions: JunctionInfo[]): GeoStroke[] {
  // link: endKey -> the far end it continues to, plus the path through the
  // junction — a routed polyline when available (oriented from this end to the
  // other), else the junction centroid as a single bridge point.
  const link = new Map<number, { other: number; route: AxisPoint[]; bridge: Point }>();
  // Unpaired-end extensions into junction bodies, keyed by endKey and
  // ordered from the cut midpoint inward.
  const extensions = new Map<number, AxisPoint[]>();
  for (const junction of junctions) {
    junction.pairings.forEach(([i, j], pi) => {
      const a = junction.incident[i]!;
      const b = junction.incident[j]!;
      const ka = endKey(a.segmentIndex, a.endIndex);
      const kb = endKey(b.segmentIndex, b.endIndex);
      const route = junction.routes[pi] ?? [];
      link.set(ka, { other: kb, route, bridge: junction.centroid });
      link.set(kb, { other: ka, route: [...route].reverse(), bridge: junction.centroid });
    });
    junction.incident.forEach((inc, ii) => {
      const ext = junction.extensions[ii];
      if (ext && ext.length >= 2) extensions.set(endKey(inc.segmentIndex, inc.endIndex), ext);
    });
  }

  const strokes: GeoStroke[] = [];

  // Loops first (annuli have no ends and never chain).
  const consumedSeg = new Set<number>();
  for (let si = 0; si < segments.length; si++) {
    if (segments[si]!.isLoop) {
      strokes.push({ points: segments[si]!.axis.map((p) => ({ ...p })), isLoop: true, segmentIndices: [si] });
      consumedSeg.add(si);
    }
  }

  // Find chain start segments: a segment end with no link, or (for pure cycles)
  // any unconsumed segment. Walk from the free end through links.
  const consumedEnd = new Set<number>();

  const walkFrom = (startSeg: number, startEnd: number): GeoStroke | null => {
    // startEnd is the FREE end (points[0] side). We emit that segment first,
    // then continue out its other end through links.
    const orderedSegs: number[] = [];
    const points: import('./types.ts').AxisPoint[] = [];
    let curSeg = startSeg;
    let entryEnd = startEnd; // the end we're entering the segment from
    // If the starting end is an unpaired junction end, begin inside the
    // junction (extension reversed: interior → cut midpoint).
    const startExt = extensions.get(endKey(startSeg, startEnd));
    if (startExt) {
      for (let i = startExt.length - 1; i >= 0; i--) points.push({ ...startExt[i]! });
    }
    const guard = segments.length + 1;
    let steps = 0;
    while (steps++ < guard) {
      if (consumedSeg.has(curSeg)) break;
      consumedSeg.add(curSeg);
      orderedSegs.push(curSeg);
      const seg = segments[curSeg]!;
      // Orient this segment's axis so it starts at entryEnd.
      const axis = entryEnd === 0 ? seg.axis.map((p) => ({ ...p })) : seg.axis.map((p) => ({ ...p })).reverse();
      // Mark both ends consumed.
      consumedEnd.add(endKey(curSeg, 0));
      consumedEnd.add(endKey(curSeg, 1));
      // Append (dedup the seam).
      for (const p of axis) {
        const last = points[points.length - 1];
        if (last && dist(last, p) < 1e-6) continue;
        points.push(p);
      }
      const exitEnd = entryEnd === 0 ? 1 : 0;
      const outKey = endKey(curSeg, exitEnd);
      const next = link.get(outKey);
      if (!next) {
        // Unpaired junction end: continue into the junction body so the
        // stroke covers it (T-stem into the bar, Y-arms into the crotch).
        const ext = extensions.get(outKey);
        if (ext) {
          for (const p of ext) {
            const last = points[points.length - 1];
            if (last && dist(last, p) < 1e-6) continue;
            points.push({ ...p });
          }
        }
        break;
      }
      if (next.route.length > 0) {
        // Follow the routed path through the junction's own geometry.
        for (const p of next.route) {
          const last = points[points.length - 1];
          if (last && dist(last, p) < 1e-6) continue;
          points.push({ ...p });
        }
      } else {
        // No route (bare cut or degenerate): bridge through the centroid.
        const bridge = next.bridge;
        const last = points[points.length - 1];
        if (last && dist(last, bridge) > 1e-6) {
          points.push({ ...bridge, width: last.width });
        }
      }
      const nextSeg = Math.floor(next.other / 2);
      const nextEntry = next.other % 2;
      if (consumedSeg.has(nextSeg)) break;
      curSeg = nextSeg;
      entryEnd = nextEntry;
    }
    if (orderedSegs.length === 0 || points.length < 2) return null;
    return { points, isLoop: false, segmentIndices: orderedSegs };
  };

  // 1) Start from genuinely free ends (no link at that end).
  for (let si = 0; si < segments.length; si++) {
    if (consumedSeg.has(si)) continue;
    for (let ei = 0; ei < 2; ei++) {
      if (link.has(endKey(si, ei))) continue;
      // This end is free — walk starting here.
      const stroke = walkFrom(si, ei);
      if (stroke) strokes.push(stroke);
      break;
    }
  }

  // 2) Any remaining segments form closed chains (rare); start arbitrarily.
  for (let si = 0; si < segments.length; si++) {
    if (consumedSeg.has(si)) continue;
    const stroke = walkFrom(si, 0);
    if (stroke) strokes.push(stroke);
  }

  return strokes;
}

/** Merge collinear runs and drop near-duplicate points to tidy assembled strokes. */
export function simplifyStroke(points: import('./types.ts').AxisPoint[], epsilon: number): import('./types.ts').AxisPoint[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const rdp = (lo: number, hi: number) => {
    if (hi <= lo + 1) return;
    const a = points[lo]!;
    const b = points[hi]!;
    const ab = sub(b, a);
    const abLen = Math.hypot(ab.x, ab.y);
    let far = -1;
    let farD = epsilon;
    if (abLen < 1e-9) {
      // Degenerate chord: the sub-polyline returns to its start (a closed
      // chain like a B's stem+bowl cycle, or an exact hairpin retrace). The
      // perpendicular distance to a zero-length chord measures nothing, which
      // used to collapse whole loops to 2 points — anchor the farthest point
      // by radial distance instead, then recurse over real chords.
      for (let i = lo + 1; i < hi; i++) {
        const d = Math.hypot(points[i]!.x - a.x, points[i]!.y - a.y);
        if (d > farD) {
          farD = d;
          far = i;
        }
      }
    } else {
      const nx = -ab.y / abLen;
      const ny = ab.x / abLen;
      for (let i = lo + 1; i < hi; i++) {
        const d = Math.abs((points[i]!.x - a.x) * nx + (points[i]!.y - a.y) * ny);
        if (d > farD) {
          farD = d;
          far = i;
        }
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      rdp(lo, far);
      rdp(far, hi);
    }
  };
  rdp(0, points.length - 1);
  const out: import('./types.ts').AxisPoint[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]!);
  return out;
}

/** Unit tangent at the head of a stroke (used only for debug/inspection). */
export function headTangent(points: Point[]): Point {
  if (points.length < 2) return { x: 0, y: 0 };
  return normalize(sub(points[1]!, points[0]!));
}
