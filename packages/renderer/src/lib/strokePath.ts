// Stroke geometry in CSS px: the polyline a stroke's ink follows, and the
// helpers plugins draw alongside it with — offsets that keep clear of the ink,
// distance to the ink, boxes. Pure, so they work headless too.

/** A vertex of a {@link StrokePath}. */
export interface PathPoint {
  x: number;
  y: number;
  /** Width of the ink here, in px. */
  width: number;
  /**
   * Draw progress (0–1) at which the pen reaches this point — for a stroke's
   * own path, `frame.progress` of the stroke is exactly here. A slice runs its
   * own 0–1; an offset keeps its source's.
   */
  t: number;
}

/** An axis-aligned box, in px. */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A point on a path, with the direction the pen travels there. */
export interface PathSample {
  x: number;
  y: number;
  /** Direction of travel, in radians (y down: `π/2` points down). `0` on a single-point path. */
  angle: number;
  width: number;
}

/**
 * Where a path's own sampler puts the point at `t` — for a stroke's ink,
 * where the canvas ends it (the pen moves along the unwobbled stroke and the
 * wobble displaces where it is), which a straight line between two wobbled
 * vertices only approximates.
 */
type ExactSampler = (t: number) => { x: number; y: number; width: number };

/** A polyline with per-point width and draw progress. */
export class StrokePath {
  readonly points: readonly PathPoint[];
  /** Arc length in px. */
  readonly length: number;
  private readonly _exact: ExactSampler | undefined;
  private _bounds: Box | null | undefined;
  private _uniform: boolean | undefined;

  constructor(points: readonly PathPoint[], exact?: ExactSampler) {
    this.points = points;
    this._exact = exact;
    let len = 0;
    for (let i = 1; i < points.length; i++) len += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    this.length = len;
  }

  /** Index of the last point the pen has reached at draw progress `t` (0 before the first). */
  lastIndexAt(t: number): number {
    return lastAtOrBefore(this.points, t);
  }

  /** Whether every point is as wide as the first: the ink can be drawn in one stroke. */
  get uniformWidth(): boolean {
    if (this._uniform === undefined) {
      const w = this.points[0]?.width;
      this._uniform = this.points.every((p) => p.width === w);
    }
    return this._uniform;
  }

  /**
   * Every point passed through `fn` — to move points or change their width,
   * as a `geometry` plugin does. `fn` also places the points {@link pointAt}
   * samples between two points, so where the pen is stays exact: a wobble of
   * the point between two points, not a line between two wobbled points.
   */
  map(fn: (point: PathPoint) => PathPoint): StrokePath {
    const exact: ExactSampler = (t) => {
      const s = this.pointAt(t);
      return fn({ x: s.x, y: s.y, width: s.width, t });
    };
    return new StrokePath(this.points.map(fn), exact);
  }

  /** The point the pen reaches at draw progress `t` (clamped to the path). */
  pointAt(t: number): PathSample {
    const pts = this.points;
    if (pts.length === 0) return { x: 0, y: 0, angle: 0, width: 0 };
    if (pts.length === 1) return { x: pts[0]!.x, y: pts[0]!.y, angle: 0, width: pts[0]!.width };
    const k = lastAtOrBefore(pts, t);
    const a = pts[k]!;
    const b = pts[k + 1];
    const inside = b !== undefined && t > a.t && b.t > a.t;
    // Direction: the segment the point is inside, else the one just finished
    // (the first one at the very start).
    const s0 = inside ? k : Math.max(0, k - 1);
    const angle = Math.atan2(pts[s0 + 1]!.y - pts[s0]!.y, pts[s0 + 1]!.x - pts[s0]!.x);
    if (this._exact) {
      const e = this._exact(Math.max(pts[0]!.t, Math.min(t, pts[pts.length - 1]!.t)));
      return { x: e.x, y: e.y, angle, width: e.width };
    }
    if (!inside) return { x: a.x, y: a.y, angle, width: a.width };
    const f = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle, width: a.width + (b.width - a.width) * f };
  }

  /** The part between draw progress `from` and `to`, re-timed to its own 0–1. */
  slice(from: number, to: number): StrokePath {
    const pts = this.points;
    if (pts.length < 2) return this;
    const t0 = pts[0]!.t;
    const t1 = pts[pts.length - 1]!.t;
    const lo = Math.max(t0, Math.min(Math.min(from, to), t1));
    const hi = Math.max(t0, Math.min(Math.max(from, to), t1));
    const span = hi - lo;
    const retime = (t: number) => (span > 0 ? (t - lo) / span : 0);
    const at = (t: number): PathPoint => {
      const p = this.pointAt(t);
      return { x: p.x, y: p.y, width: p.width, t: retime(t) };
    };
    const out: PathPoint[] = [at(lo)];
    for (const p of pts) if (p.t > lo && p.t < hi) out.push({ ...p, t: retime(p.t) });
    out.push(at(hi));
    const exact = this._exact;
    return new StrokePath(out, exact ? (t) => exact(lo + t * span) : undefined);
  }

  /** The box the ink covers: every point, padded by half its width. `null` for an empty path. */
  bounds(): Box | null {
    if (this._bounds !== undefined) return this._bounds;
    let box: Box | null = null;
    for (const p of this.points) {
      const r = p.width / 2;
      if (!box) box = { minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r };
      else {
        box.minX = Math.min(box.minX, p.x - r);
        box.minY = Math.min(box.minY, p.y - r);
        box.maxX = Math.max(box.maxX, p.x + r);
        box.maxY = Math.max(box.maxY, p.y + r);
      }
    }
    this._bounds = box;
    return box;
  }
}

/** Index of the last point with `t` at or before `t` (0 when `t` precedes them all). */
function lastAtOrBefore(pts: readonly PathPoint[], t: number): number {
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (pts[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Offsets
// ---------------------------------------------------------------------------

/** A distance for {@link offsetPath}: px, or px per point. */
export type OffsetDistance = number | ((point: PathPoint) => number);

/** Past this, a corner's miter becomes a bevel (in multiples of the offset). */
const MITER_LIMIT = 2;

/**
 * `path` moved sideways by `distance` px — positive to the pen's left (as it
 * travels), negative to its right. A function gives each point its own
 * distance: {@link inkEdge} keeps a constant gap from the edge of ink whose
 * width varies. Points keep their source's `t`.
 *
 * Corners sharper than the offset can follow are beveled on the outside; on
 * the inside, where the offset line would loop back over itself, the loop is
 * cut out.
 */
export function offsetPath(path: StrokePath, distance: OffsetDistance): StrokePath {
  const d = typeof distance === 'number' ? () => distance : distance;
  // Drop repeated points: they have no direction.
  const src: PathPoint[] = [];
  for (const p of path.points) {
    const last = src[src.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) src.push(p);
  }
  if (src.length < 2) {
    return new StrokePath(src.map((p) => ({ ...p })));
  }

  // Left normal and unit direction of each segment (y down: the left of a
  // pen moving right is up).
  const dirs: [number, number][] = [];
  for (let i = 0; i + 1 < src.length; i++) {
    const dx = src[i + 1]!.x - src[i]!.x;
    const dy = src[i + 1]!.y - src[i]!.y;
    const len = Math.hypot(dx, dy);
    dirs.push([dx / len, dy / len]);
  }
  const left = ([dx, dy]: [number, number]): [number, number] => [dy, -dx];

  const out: PathPoint[] = [];
  // For each output segment (out[i] → out[i+1]), the direction the source travels there.
  const travel: [number, number][] = [];
  const push = (p: PathPoint, [nx, ny]: [number, number], dist: number, dir: [number, number]) => {
    if (out.length > 0) travel.push(dir);
    out.push({ x: p.x + nx * dist, y: p.y + ny * dist, width: p.width, t: p.t });
  };

  for (let i = 0; i < src.length; i++) {
    const p = src[i]!;
    const dist = d(p);
    const din = dirs[i - 1];
    const dout = dirs[i];
    if (!din || !dout) {
      const dir = (din ?? dout)!;
      push(p, left(dir), dist, dir);
      continue;
    }
    const n0 = left(din);
    const n1 = left(dout);
    const mx = n0[0] + n1[0];
    const my = n0[1] + n1[1];
    const mLen = Math.hypot(mx, my);
    // cos of half the turn: 1 straight on, 0 for a full reversal.
    const cosHalf = mLen / 2;
    if (cosHalf > 1 / MITER_LIMIT) {
      push(p, [mx / mLen / cosHalf, my / mLen / cosHalf], dist, din);
    } else {
      const bisector: [number, number] = [din[0] + dout[0], din[1] + dout[1]];
      push(p, n0, dist, din);
      push(p, n1, dist, bisector);
    }
  }
  return new StrokePath(cutLoops(out, travel));
}

/**
 * Cut the loops an inside offset makes at a turn tighter than the offset:
 * where two segments cross and the stretch between them runs backwards
 * against the source (a real crossing — a cursive loop — keeps running
 * forwards and is kept). Nearest crossing first, so a small loop inside a
 * real one goes alone.
 */
function cutLoops(pts: PathPoint[], travel: [number, number][]): PathPoint[] {
  const backwards = (i: number) => {
    const dx = pts[i + 1]!.x - pts[i]!.x;
    const dy = pts[i + 1]!.y - pts[i]!.y;
    return dx * travel[i]![0] + dy * travel[i]![1] < 0;
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let j = i + 2; j + 1 < pts.length; j++) {
      const hit = segmentIntersection(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!);
      if (!hit) continue;
      let reversed = false;
      for (let k = i; k <= j && !reversed; k++) reversed = backwards(k);
      if (!reversed) continue;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const cut: PathPoint = {
        x: a.x + (b.x - a.x) * hit,
        y: a.y + (b.y - a.y) * hit,
        width: a.width + (b.width - a.width) * hit,
        t: a.t + (b.t - a.t) * hit,
      };
      pts.splice(i + 1, j - i, cut);
      travel.splice(i + 1, j - i, travel[j]!);
      // The shortened segment may cross further on: look again from it.
      i--;
      break;
    }
  }
  return pts;
}

/** Where segment ab crosses segment cd, as a fraction along ab; null if they don't. */
function segmentIntersection(a: PathPoint, b: PathPoint, c: PathPoint, d: PathPoint): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const u = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const v = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return u > 0 && u < 1 && v > 0 && v < 1 ? u : null;
}

/**
 * An {@link offsetPath} distance that keeps `gap` px clear of the ink's edge
 * — half the ink's width, which pressure and taper vary, plus the gap — on
 * the pen's left (`side = 1`) or right (`side = -1`).
 */
export function inkEdge(gap: number, side: 1 | -1 = 1): (point: PathPoint) => number {
  return (p) => side * (p.width / 2 + gap);
}

// ---------------------------------------------------------------------------
// Distance and boxes
// ---------------------------------------------------------------------------

/**
 * How far `point` is from the nearest ink of `paths`, in px: distance to the
 * centreline less half the ink's width there. Negative inside the ink;
 * `Infinity` with no paths.
 */
export function clearance(point: { x: number; y: number }, paths: Iterable<StrokePath>): number {
  let best = Infinity;
  for (const path of paths) {
    const pts = path.points;
    if (pts.length === 1) best = Math.min(best, Math.hypot(point.x - pts[0]!.x, point.y - pts[0]!.y) - pts[0]!.width / 2);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const f = len2 > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)) : 0;
      const dist = Math.hypot(point.x - (a.x + dx * f), point.y - (a.y + dy * f));
      best = Math.min(best, dist - (a.width + (b.width - a.width) * f) / 2);
    }
  }
  return best;
}

/** The box around every given box; `null` when there are none. */
export function unionBoxes(boxes: Iterable<Box | null | undefined>): Box | null {
  let out: Box | null = null;
  for (const b of boxes) {
    if (!b) continue;
    if (!out) out = { ...b };
    else {
      out.minX = Math.min(out.minX, b.minX);
      out.minY = Math.min(out.minY, b.minY);
      out.maxX = Math.max(out.maxX, b.maxX);
      out.maxY = Math.max(out.maxY, b.maxY);
    }
  }
  return out;
}

/** `box` grown by `by` px on every side; no box stays none, so `bounds()` and `unionBoxes` results pass straight in. */
export function expandBox(box: Box, by: number): Box;
export function expandBox(box: Box | null, by: number): Box | null;
export function expandBox(box: Box | null, by: number): Box | null {
  return box && { minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by };
}
