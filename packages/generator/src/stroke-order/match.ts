// Stroke matching: assign extracted geometry strokes to registered reference
// strokes 1:1 so the dataset's order and pen direction can be applied to the
// font's own geometry.
//
// The cost between two strokes is the mean pointwise distance after both are
// resampled to the same number of arc-length-uniform samples — index-aligned,
// no DTW. Strokes are short, monotone curves; after uniform resampling the
// correspondence IS the index, and the metric stays cheap and deterministic.
// Each pair is scored forward and reversed, so the assignment simultaneously
// decides which reference stroke an extracted stroke is and which way the pen
// travels along it. The global assignment is solved exactly (Hungarian).
// A loop (o, 0, a letter's bowl extracted whole) has no start of its own:
// it is scored from every vertex round it, and the pair says where the pen
// enters it.

import type { Point } from 'tegaki';

/** Samples per stroke for cost evaluation. */
const RESAMPLE_N = 24;

/** Padding cost for rectangular (count-mismatched) assignments — far above any real pair. */
const PAD_COST = 1e6;

/** A loop's ends meet within this share of its length (a polyline closed on its first vertex). */
const CLOSED_CHORD_SHARE = 0.02;
/** Most start vertices tried round a closed loop (spread along its length). */
const MAX_LOOP_STARTS = 64;

export interface StrokeMatchPair {
  /** Index into the extracted strokes. */
  extracted: number;
  /** Index into the reference strokes. */
  reference: number;
  /** Normalized cost (fraction of the normalization length, typically glyph diagonal). */
  cost: number;
  /** True when the extracted stroke matches the reference best when reversed. */
  reversed: boolean;
  /**
   * For a closed extracted loop: the vertex the pen enters it at (see
   * `rotateLoop`), applied before `reversed`. Absent for open strokes.
   */
  start?: number;
  /** The pair's cost with the pen the other way round (from its best start, for a loop). */
  reverseCost: number;
}

export interface StrokeMatchResult {
  /** Matched pairs, one per min(extracted, reference) strokes. */
  pairs: StrokeMatchPair[];
  /** Mean cost over matched pairs (0 when nothing matched). */
  meanCost: number;
  extractedCount: number;
  referenceCount: number;
}

/** Resample a polyline to `n` arc-length-uniform points (endpoints included). */
export function resamplePolyline(points: Point[], n: number): Point[] {
  if (points.length === 0) return [];
  if (points.length === 1) return Array.from({ length: n }, () => ({ ...points[0]! }));
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  }
  const total = cum[cum.length - 1]!;
  if (total <= 0) return Array.from({ length: n }, () => ({ ...points[0]! }));
  const out: Point[] = [];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (seg < points.length - 1 && cum[seg]! < target) seg++;
    const a = points[seg - 1]!;
    const b = points[seg]!;
    const span = cum[seg]! - cum[seg - 1]!;
    const t = span > 0 ? (target - cum[seg - 1]!) / span : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return len;
}

/** Whether a polyline ends where it began, so it can be entered anywhere round it (see `rotateLoop`). */
export function isClosedPolyline(points: Point[]): boolean {
  if (points.length < 4) return false;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  return Math.hypot(b.x - a.x, b.y - a.y) <= CLOSED_CHORD_SHARE * polylineLength(points);
}

/**
 * A closed polyline begun at vertex `start`: the same ring, its seam moved.
 * The closing vertex (the first, repeated) is dropped and re-added at the
 * new seam, so the result is closed again.
 */
export function rotateLoop<T extends Point>(points: T[], start: number): T[] {
  const ring = points.slice(0, -1);
  if (start <= 0 || start >= ring.length) return points;
  const out = [...ring.slice(start), ...ring.slice(0, start)];
  out.push({ ...out[0]! });
  return out;
}

/** Start vertices worth trying round a loop: every vertex, or `MAX_LOOP_STARTS` of them spread along its length. */
function loopStarts(points: Point[]): number[] {
  const ring = points.length - 1;
  if (ring <= MAX_LOOP_STARTS) return Array.from({ length: ring }, (_, i) => i);
  const cum = [0];
  for (let i = 1; i < points.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const total = cum[cum.length - 1]!;
  const starts = new Set<number>();
  let v = 0;
  for (let k = 0; k < MAX_LOOP_STARTS; k++) {
    const target = (k / MAX_LOOP_STARTS) * total;
    while (v < ring - 1 && cum[v + 1]! <= target) v++;
    starts.add(v);
  }
  return [...starts];
}

/** Mean index-aligned distance between two equal-length sample arrays. */
function sampleDistance(a: Point[], b: Point[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.hypot(a[i]!.x - b[i]!.x, a[i]!.y - b[i]!.y);
  return sum / a.length;
}

/**
 * Exact minimum-cost assignment for a square cost matrix (Kuhn-Munkres with
 * potentials, O(n³)). Returns the assigned column for each row.
 */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const colToRow = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    colToRow[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = colToRow[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[colToRow[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }
      j0 = j1;
    } while (colToRow[j0] !== 0);
    do {
      const j1 = way[j0]!;
      colToRow[j0] = colToRow[j1]!;
      j0 = j1;
    } while (j0);
  }
  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) {
    if (colToRow[j]! > 0) rowToCol[colToRow[j]! - 1] = j - 1;
  }
  return rowToCol;
}

/**
 * Match extracted strokes to reference strokes (both in the same coordinate
 * space — register the reference first). `normalize` scales costs into a
 * resolution-independent fraction, typically the glyph bbox diagonal.
 * `loops` flags the extracted strokes that are loops (`GeoStroke.isLoop`):
 * those are entered wherever fits best. A path that merely ends where it
 * began (a chain retracing its way back) keeps its start.
 */
export function matchStrokes(extracted: Point[][], reference: Point[][], normalize: number, loops?: readonly boolean[]): StrokeMatchResult {
  const n = extracted.length;
  const m = reference.length;
  if (n === 0 || m === 0 || normalize <= 0) {
    return { pairs: [], meanCost: 0, extractedCount: n, referenceCount: m };
  }

  // Each extracted stroke as the pen could enter it: once for an open
  // stroke, from every start vertex for a closed loop.
  const extEntries = extracted.map((pts, i) =>
    loops?.[i] && isClosedPolyline(pts)
      ? loopStarts(pts).map((start) => ({ start, samples: resamplePolyline(rotateLoop(pts, start), RESAMPLE_N) }))
      : [{ start: undefined, samples: resamplePolyline(pts, RESAMPLE_N) }],
  );
  const refSamples = reference.map((pts) => resamplePolyline(pts, RESAMPLE_N));
  const refSamplesRev = refSamples.map((s) => [...s].reverse());

  const size = Math.max(n, m);
  const cost: number[][] = [];
  const reversedFlags: boolean[][] = [];
  const startIndices: (number | undefined)[][] = [];
  const reverseCosts: number[][] = [];
  for (let i = 0; i < size; i++) {
    const row = new Array<number>(size).fill(PAD_COST);
    const revRow = new Array<boolean>(size).fill(false);
    const startRow = new Array<number | undefined>(size).fill(undefined);
    const reverseRow = new Array<number>(size).fill(PAD_COST);
    if (i < n) {
      for (let j = 0; j < m; j++) {
        // The best entry each way round; the pair takes the better way.
        let bestForward = { cost: Infinity, start: undefined as number | undefined };
        let bestBackward = { cost: Infinity, start: undefined as number | undefined };
        for (const entry of extEntries[i]!) {
          const forward = sampleDistance(entry.samples, refSamples[j]!) / normalize;
          const backward = sampleDistance(entry.samples, refSamplesRev[j]!) / normalize;
          if (forward < bestForward.cost) bestForward = { cost: forward, start: entry.start };
          if (backward < bestBackward.cost) bestBackward = { cost: backward, start: entry.start };
        }
        const reversed = bestBackward.cost < bestForward.cost;
        const [taken, other] = reversed ? [bestBackward, bestForward] : [bestForward, bestBackward];
        row[j] = taken.cost;
        revRow[j] = reversed;
        startRow[j] = taken.start;
        reverseRow[j] = other.cost;
      }
    }
    cost.push(row);
    reversedFlags.push(revRow);
    startIndices.push(startRow);
    reverseCosts.push(reverseRow);
  }

  const assignment = hungarian(cost);
  const pairs: StrokeMatchPair[] = [];
  for (let i = 0; i < n; i++) {
    const j = assignment[i]!;
    if (j < 0 || j >= m) continue;
    const start = startIndices[i]![j];
    pairs.push({
      extracted: i,
      reference: j,
      cost: cost[i]![j]!,
      reversed: reversedFlags[i]![j]!,
      reverseCost: reverseCosts[i]![j]!,
      ...(start !== undefined ? { start } : {}),
    });
  }
  const meanCost = pairs.length > 0 ? pairs.reduce((s, p) => s + p.cost, 0) / pairs.length : 0;
  return { pairs, meanCost, extractedCount: n, referenceCount: m };
}
