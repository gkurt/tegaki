// Reference-guided order: dataset order without a 1:1 stroke match.
//
// `matchStrokes` needs the font to break its ink where the dataset does. A
// cursive font doesn't: Nanum Pen Script writes ㅎ's bar and ring in one
// stroke and ㄹ in one zigzag, so its syllables match their composed
// references only after splits the pipeline refuses (retracing the font's
// own trajectory). Where stroke order is standardized, the reference still
// knows the order the ink is written in: each extracted stroke is placed at
// the reference positions its ink follows — stroke index plus arc fraction
// along it — and the strokes are drawn in order of where they start in the
// reference, each in the direction of the reference stroke it follows.

import type { Point } from 'tegaki';
import { resamplePolyline } from './match.ts';
import type { ReferenceStroke } from './types.ts';

/** Samples per extracted stroke. */
const SAMPLES = 16;
/**
 * A stroke's reference position is this low percentile of its samples'
 * positions: where its ink starts in the reference, robust to the few
 * samples that pass near an earlier reference stroke (a tick leaving its
 * stem, an end reaching toward the next letter).
 */
const START_PERCENTILE = 0.35;
/** Rounds of moving each reference group (a letter) onto the ink nearest it. */
const REFIT_ROUNDS = 3;
/** A group needs this many nearest samples to move. */
const REFIT_MIN_SAMPLES = 3;
/** A reference stroke whose chord is under this share of its length is closed (ㅇ): its direction is its winding. */
const CLOSED_CHORD_SHARE = 0.3;
/**
 * A stroke whose chord is within this |cos| of perpendicular to the followed
 * reference stroke's (over 60° off) can't tell direction by heading — a
 * horizontal tick whose samples mostly follow the vertical stem it leaves.
 */
const MIN_CHORD_ALIGNMENT = 0.5;

export interface GuidedOrder {
  /** Draw sequence: a permutation of extracted stroke indices. */
  sequence: number[];
  /** Per extracted stroke: reverse its polyline to run the reference's way. */
  reverse: boolean[];
  /** Mean distance from the extracted ink to the nearest reference stroke, as a fraction of `normalize`. */
  meanDistance: number;
}

interface Projection {
  /** Reference stroke index + arc fraction along it (in [0, 1)). */
  position: number;
  distance: number;
}

function arcLengths(points: Point[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  return cum;
}

function project(p: Point, reference: Point[][], arcs: number[][]): Projection {
  let best: Projection = { position: 0, distance: Infinity };
  reference.forEach((ref, r) => {
    const cum = arcs[r]!;
    const total = cum[cum.length - 1]!;
    for (let i = 0; i < ref.length; i++) {
      const a = ref[i]!;
      const b = ref[Math.min(i + 1, ref.length - 1)]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      const d = Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y);
      if (d < best.distance) {
        const along = total > 0 ? (cum[i]! + u * Math.sqrt(l2)) / total : 0;
        best = { position: r + Math.min(along, 0.999), distance: d };
      }
      if (ref.length === 1) break;
    }
  });
  return best;
}

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Move each reference group (a letter) onto the extracted samples nearest
 * it: the whole-glyph registration places letters where a textbook layout
 * does, a handwriting font places them where its hand did. Each round shifts
 * a group by the offset between its own centroid and the centroid of the
 * samples it wins. Translation only — rescaling a group to the samples it
 * wins collapses it (a letter that wins half its ink shrinks, then wins less).
 */
function refitGroups(samples: Point[], reference: ReferenceStroke[]): Point[][] {
  let strokes = reference.map((r) => r.points);
  const groups = [...new Set(reference.map((r) => r.group))];
  if (groups.length < 2 || groups.includes(undefined)) return strokes;
  for (let round = 0; round < REFIT_ROUNDS; round++) {
    const arcs = strokes.map(arcLengths);
    const won = new Map<number | undefined, Point[]>();
    for (const p of samples) {
      const group = reference[Math.floor(project(p, strokes, arcs).position)]!.group;
      won.set(group, [...(won.get(group) ?? []), p]);
    }
    const shifts = new Map<number | undefined, Point>();
    for (const group of groups) {
      const mine = won.get(group) ?? [];
      if (mine.length < REFIT_MIN_SAMPLES) continue;
      const own = strokes.filter((_, j) => reference[j]!.group === group).flatMap((q) => (q.length > 1 ? resamplePolyline(q, SAMPLES) : q));
      const from = centroid(own);
      const to = centroid(mine);
      shifts.set(group, { x: to.x - from.x, y: to.y - from.y });
    }
    strokes = strokes.map((points, i) => {
      const shift = shifts.get(reference[i]!.group);
      return shift ? points.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y })) : points;
    });
  }
  return strokes;
}

function signedArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    area += p.x * q.y - q.x * p.y;
  }
  return area / 2;
}

/**
 * Net advance of arc fractions between consecutive samples on the same
 * reference stroke; steps across strokes and wraps past a closed stroke's
 * seam don't count.
 */
function arcAdvance(positions: number[]): number {
  let advance = 0;
  for (let k = 1; k < positions.length; k++) {
    const a = positions[k - 1]!;
    const b = positions[k]!;
    if (Math.floor(a) !== Math.floor(b) || Math.abs(b - a) > 0.5) continue;
    advance += b - a;
  }
  return advance;
}

/**
 * Whether a stroke runs against the reference stroke most of its samples
 * follow: its chord (over those samples) against that stroke's chord, or,
 * for a closed reference stroke, its winding against the reference's.
 * Headings survive a misplaced reference where arc fractions don't — an end
 * that strays nearer another stroke's end says nothing about direction. A
 * heading far off the reference's falls back to the arc fractions.
 */
function runsAgainst(samples: Point[], positions: number[], reference: Point[][]): boolean {
  if (samples.length < 2) return false;
  const votes = new Map<number, number>();
  for (const q of positions) votes.set(Math.floor(q), (votes.get(Math.floor(q)) ?? 0) + 1);
  const followed = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  const ref = reference[followed]!;
  if (ref.length < 2) return false;
  const chord = (ps: Point[]) => ({ x: ps[ps.length - 1]!.x - ps[0]!.x, y: ps[ps.length - 1]!.y - ps[0]!.y });
  const rc = chord(ref);
  if (Math.hypot(rc.x, rc.y) < CLOSED_CHORD_SHARE * arcLengths(ref).at(-1)!) {
    return Math.sign(signedArea(samples)) !== Math.sign(signedArea(ref));
  }
  const own = samples.filter((_, k) => Math.floor(positions[k]!) === followed);
  const ec = chord(own.length >= 2 ? own : samples);
  const dot = ec.x * rc.x + ec.y * rc.y;
  if (Math.abs(dot) < MIN_CHORD_ALIGNMENT * Math.hypot(ec.x, ec.y) * Math.hypot(rc.x, rc.y)) return arcAdvance(positions) < 0;
  return dot < 0;
}

/**
 * Order extracted strokes by the reference (both in the same frame, e.g.
 * font units after registration). Null when either side is empty.
 */
export function guideOrderByReference(extracted: Point[][], reference: ReferenceStroke[], normalize: number): GuidedOrder | null {
  const kept = reference.filter((r) => r.points.length > 0);
  if (extracted.length === 0 || kept.length === 0 || normalize <= 0) return null;
  const sampled = extracted.map((stroke) => (stroke.length > 1 ? resamplePolyline(stroke, SAMPLES) : stroke));
  const refs = refitGroups(sampled.flat(), kept);
  const arcs = refs.map(arcLengths);
  let distanceSum = 0;
  let sampleCount = 0;
  const keys: number[] = [];
  const reverse: boolean[] = [];
  for (const samples of sampled) {
    const projections = samples.map((p) => project(p, refs, arcs));
    for (const q of projections) distanceSum += q.distance;
    sampleCount += projections.length;
    const positions = projections.map((q) => q.position);
    const sorted = [...positions].sort((a, b) => a - b);
    keys.push(sorted[Math.floor(START_PERCENTILE * (sorted.length - 1))]!);
    reverse.push(runsAgainst(samples, positions, refs));
  }
  const sequence = extracted.map((_, i) => i).sort((a, b) => keys[a]! - keys[b]! || a - b);
  return { sequence, reverse, meanDistance: distanceSum / Math.max(1, sampleCount) / normalize };
}
