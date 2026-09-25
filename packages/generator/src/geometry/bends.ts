// Bent strokes: where a Han or katakana stroke may turn a corner.
//
// The ink graph continues a stroke through every corner it can — a box like
// 口 comes out as one closed loop. The script's strokes turn corners only
// one way round: a horizontal running right turns down (横折, 横撇), a
// vertical running down turns right (竖折, 撇折). Every other corner is
// where one stroke ends and another starts (口's top-left: the vertical and
// the top bar; its bottom-right: the right side and the bottom bar). And a
// box's bottom closes it last: a 竖折 whose foot runs into the end of a
// 横折's leg is the left side plus the closing bar (口, 日, 田), not one
// stroke — while 山's 竖折, ending at a plain vertical, stays whole.

import type { AxisPoint, GeoStroke } from './types.ts';

/** A turn this sharp (degrees) within a pen width or two is a corner. */
const CORNER_MIN_TURN_DEG = 60;
/** Directions are read this many local pen widths either side of a corner. */
const CORNER_WINDOW_WIDTHS = 1.5;
/** An arm shorter than this many pen widths is a hook or a serif flick, not a stroke of its own. */
const HOOK_MAX_WIDTHS = 2.5;
/** A hook kicks up (y component at least this, upward) or back left (x component at least this, leftward). */
const HOOK_RISE = 0.3;
const HOOK_BACK = 0.5;
/** A hook is at most this share of the rest of its stroke, and at most this many pen widths long. */
const HOOK_MAX_SHARE = 0.5;
const HOOK_MAX_LONG_WIDTHS = 6;
/** A stroke's tip runs into other ink when it comes within this many pen widths of that ink's edge. */
const TOUCH_WIDTHS = 0.25;
/** A heading within ~40° of an axis counts as running along it. */
const AXIS_COS = 0.75;
/** Loose axis for the second leg of a turn: down-left (横撇) still turns down, a rising 提 still runs right. */
const LEG_COS = 0.5;
/** Two stroke ends this many pen widths apart meet (the enclosure rule). */
const ENDS_MEET_WIDTHS = 1.5;

type Vec = { x: number; y: number };

interface Corner {
  /** Vertex index of the corner. */
  index: number;
  /** Unit heading into the corner, in the polyline's direction. */
  inDir: Vec;
  /** Unit heading out of the corner, in the polyline's direction. */
  outDir: Vec;
}

type Turn = 'across-down' | 'down-across' | null;

function arcLengths(points: AxisPoint[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  return cum;
}

/** The point at arc length `s` along the polyline, clamped to its ends. */
function pointAt(points: AxisPoint[], cum: number[], s: number): Vec {
  if (s <= 0) return points[0]!;
  const total = cum[cum.length - 1]!;
  if (s >= total) return points[points.length - 1]!;
  let k = 1;
  while (cum[k]! < s) k++;
  const a = points[k - 1]!;
  const b = points[k]!;
  const u = (s - cum[k - 1]!) / Math.max(1e-9, cum[k]! - cum[k - 1]!);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

function unit(from: Vec, to: Vec): Vec | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  return len > 1e-9 ? { x: dx / len, y: dy / len } : null;
}

/** Distance from `p` to the nearest point of a polyline's centerline, less the pen radius there. */
function distanceToPolyline(p: Vec, points: AxisPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[Math.min(i + 1, points.length - 1)]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const radius = (a.width + (b.width - a.width) * u) / 2;
    best = Math.min(best, Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y) - radius);
    if (points.length === 1) break;
  }
  return best;
}

function medianWidth(points: AxisPoint[]): number {
  const widths = points
    .map((p) => p.width)
    .filter((w) => w > 0)
    .sort((a, b) => a - b);
  return widths.length > 0 ? widths[Math.floor(widths.length / 2)]! : 1;
}

/**
 * How far a U-turn at arc length `tip` retraces itself: the longest run out
 * and back whose two legs stay within half a pen width of each other (a
 * serif flick walked to its tip and back).
 */
function retraceReach(points: AxisPoint[], cum: number[], tip: number, width: number): number {
  const step = width / 4;
  let reach = 0;
  for (let s = step; tip - s > 0 && tip + s < cum[cum.length - 1]!; s += step) {
    const a = pointAt(points, cum, tip - s);
    const b = pointAt(points, cum, tip + s);
    if (Math.hypot(a.x - b.x, a.y - b.y) > width / 2) break;
    reach = s;
  }
  return reach;
}

/**
 * An end arm leaving a corner heading `out` (away from the corner) is a
 * hook when it kicks up or left and is short beside the rest of the stroke
 * — and, checked by the caller, its tip is free: a short bar that runs into
 * another stroke is a box's bottom (門's inner boxes), not a hook.
 */
function isHook(out: Vec, arm: number, rest: number, width: number): boolean {
  const kicks = out.y <= -HOOK_RISE || out.x <= -HOOK_BACK;
  return kicks && arm <= HOOK_MAX_SHARE * rest && arm <= HOOK_MAX_LONG_WIDTHS * width;
}

/**
 * Sharp corners of an open polyline: local maxima of the turn measured a
 * pen width or two either side. A U-turn that retraces itself is a flick
 * on the way, not a corner: the turn is read between the arms either side
 * of it, and the corner sits where the path comes back out.
 */
function findCorners(points: AxisPoint[], touches: (p: AxisPoint, reach: number) => boolean = () => false): Corner[] {
  const cum = arcLengths(points);
  const total = cum[cum.length - 1]!;
  const width = medianWidth(points);
  const window = CORNER_WINDOW_WIDTHS * width;
  const hook = HOOK_MAX_WIDTHS * width;
  const turnAt = (before: number, at: number, after: number) => {
    const inDir = unit(pointAt(points, cum, before), pointAt(points, cum, at));
    const outDir = unit(pointAt(points, cum, at), pointAt(points, cum, after));
    if (!inDir || !outDir) return null;
    const turn = (Math.acos(Math.max(-1, Math.min(1, inDir.x * outDir.x + inDir.y * outDir.y))) * 180) / Math.PI;
    return { turn, inDir, outDir };
  };
  const candidates: { index: number; turn: number }[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const t = turnAt(cum[i]! - window, cum[i]!, cum[i]! + window);
    if (t && t.turn >= CORNER_MIN_TURN_DEG) candidates.push({ index: i, turn: t.turn });
  }
  const corners: Corner[] = [];
  for (const c of candidates) {
    // One corner per bend: the sharpest vertex among those within a window of each other.
    const rival = candidates.find(
      (o) => o !== c && Math.abs(cum[o.index]! - cum[c.index]!) <= window && (o.turn > c.turn || (o.turn === c.turn && o.index < c.index)),
    );
    if (rival) continue;
    const reach = retraceReach(points, cum, cum[c.index]!, width);
    const enter = cum[c.index]! - reach;
    const leave = cum[c.index]! + reach;
    const t = reach > 0 ? turnAt(enter - window, enter, leave + window) : turnAt(enter - window, enter, enter + window);
    if (!t || t.turn < CORNER_MIN_TURN_DEG) continue;
    // An end arm ending in free space keeps the corner when it is too short
    // to be a stroke (a serif flick) or is a hook (竖钩, 横折钩, 卧钩); one
    // that runs into other ink is a stroke of its own, however short (門's
    // inner box bottoms).
    const tailFree = !touches(points[points.length - 1]!, TOUCH_WIDTHS * width);
    const headFree = !touches(points[0]!, TOUCH_WIDTHS * width);
    if ((enter < hook && headFree) || (total - leave < hook && tailFree)) continue;
    if (isHook(t.outDir, total - leave, enter, width) && tailFree) continue;
    if (isHook({ x: -t.inDir.x, y: -t.inDir.y }, enter, total - leave, width) && headFree) continue;
    let index = c.index;
    while (index < points.length - 2 && Math.abs(cum[index + 1]! - leave) < Math.abs(cum[index]! - leave)) index++;
    corners.push({ index, inDir: t.inDir, outDir: t.outDir });
  }
  return corners;
}

/** Which way the pen may take this corner, if either (y points down; the polyline may run either way). */
function turnOf(inDir: Vec, outDir: Vec): Turn {
  // 横折 / 横撇: running right, then down (or down-left).
  const acrossDown = (a: Vec, b: Vec) => a.x >= AXIS_COS && b.y >= LEG_COS;
  // 竖折 / 撇折: running down (or down-left), then right (or rising right, 提).
  const downAcross = (a: Vec, b: Vec) => a.y >= LEG_COS && b.x >= AXIS_COS;
  const backIn = { x: -outDir.x, y: -outDir.y };
  const backOut = { x: -inDir.x, y: -inDir.y };
  if (acrossDown(inDir, outDir) || acrossDown(backIn, backOut)) return 'across-down';
  if (downAcross(inDir, outDir) || downAcross(backIn, backOut)) return 'down-across';
  return null;
}

function slice(stroke: GeoStroke, from: number, to: number): GeoStroke {
  return { points: stroke.points.slice(from, to + 1).map((p) => ({ ...p })), isLoop: false, segmentIndices: [...stroke.segmentIndices] };
}

/** Cut an open stroke at the given vertex indices (sorted, interior). */
function cutAt(stroke: GeoStroke, cuts: number[]): GeoStroke[] {
  const out: GeoStroke[] = [];
  let start = 0;
  for (const c of cuts) {
    out.push(slice(stroke, start, c));
    start = c;
  }
  out.push(slice(stroke, start, stroke.points.length - 1));
  return out;
}

/** A loop's vertices without the duplicate seam vertex. */
function ring(stroke: GeoStroke): AxisPoint[] {
  const pts = stroke.points;
  const closed = pts.length > 2 && Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.y - pts[pts.length - 1]!.y) < 1e-6;
  return closed ? pts.slice(0, -1) : pts;
}

/** Open a closed loop at ring vertex `at`, so it runs from there all the way round. */
function openLoopAt(stroke: GeoStroke, at: number): GeoStroke {
  const r = ring(stroke);
  const rotated = [...r.slice(at), ...r.slice(0, at), r[at]!].map((p) => ({ ...p }));
  return { points: rotated, isLoop: false, segmentIndices: [...stroke.segmentIndices] };
}

interface Piece {
  stroke: GeoStroke;
  /** Kept corners with the turn the pen takes there. */
  turns: { index: number; turn: Exclude<Turn, null> }[];
}

function splitPiece(stroke: GeoStroke, touches: (p: AxisPoint, reach: number) => boolean): Piece[] {
  let open = stroke;
  if (stroke.isLoop) {
    // A loop turns at its seam too: find its corners on a rotation that
    // puts the seam mid-run, then open it at the first corner the pen can't take.
    const size = ring(stroke).length;
    const shift = Math.floor(size / 2);
    const breaks = findCorners(openLoopAt(stroke, shift).points, touches).filter((c) => !turnOf(c.inDir, c.outDir));
    if (breaks.length === 0) return [{ stroke, turns: [] }];
    open = openLoopAt(stroke, (breaks[0]!.index + shift) % size);
  }
  const corners = findCorners(open.points, touches);
  const cuts = corners.filter((c) => !turnOf(c.inDir, c.outDir)).map((c) => c.index);
  const pieces = cutAt(open, cuts);
  const bounds = [0, ...cuts, open.points.length - 1];
  return pieces.map((piece, k) => ({
    stroke: piece,
    turns: corners
      .filter((c) => c.index > bounds[k]! && c.index < bounds[k + 1]!)
      .map((c) => ({ index: c.index - bounds[k]!, turn: turnOf(c.inDir, c.outDir)! })),
  }));
}

/** The end of the leg that runs horizontally out of a down-across corner, and of the leg that runs down out of an across-down one. */
function legEnd(piece: Piece, turn: Exclude<Turn, null>): { corner: number; end: AxisPoint } | null {
  const hits = piece.turns.filter((t) => t.turn === turn);
  if (hits.length !== 1) return null;
  const { index } = hits[0]!;
  const pts = piece.stroke.points;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const corner = pts[index]!;
  if (turn === 'down-across') {
    // The foot: whichever end lies right of the corner.
    const end = Math.abs(first.x - corner.x) > Math.abs(last.x - corner.x) ? first : last;
    return end.x > corner.x ? { corner: index, end } : null;
  }
  // The leg: whichever end lies below the corner.
  const end = first.y > last.y ? first : last;
  return end.y > corner.y ? { corner: index, end } : null;
}

/**
 * Split strokes at corners the pen can't take in Han and katakana writing,
 * and split off a box's closing bar (see the file comment).
 */
export function splitBentStrokes(strokes: GeoStroke[]): GeoStroke[] {
  const pieces = strokes.flatMap((s) => {
    if (s.points.length < 3) return [{ stroke: s, turns: [] }];
    const others = strokes.filter((o) => o !== s);
    return splitPiece(s, (p, reach) => others.some((o) => distanceToPolyline(p, o.points) <= reach));
  });
  // Enclosure: a 竖折 whose foot meets the end of a 横折's leg closes a box.
  const legs = pieces.map((p) => legEnd(p, 'across-down'));
  const out: GeoStroke[] = [];
  for (const piece of pieces) {
    const foot = legEnd(piece, 'down-across');
    const closes =
      foot &&
      legs.some((leg) => {
        if (!leg || leg.end === foot.end) return false;
        const reach = ENDS_MEET_WIDTHS * Math.max(foot.end.width, leg.end.width, 1);
        return Math.hypot(leg.end.x - foot.end.x, leg.end.y - foot.end.y) <= reach;
      });
    out.push(...(closes ? cutAt(piece.stroke, [foot.corner]) : [piece.stroke]));
  }
  return out;
}
