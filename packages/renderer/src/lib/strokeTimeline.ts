import type { TegakiBundle, TegakiGlyphData } from '../types.ts';
import { type SubdividedStroke, subdivideStroke } from './strokeCache.ts';
import { defaultStrokeEasing } from './strokeEffects.ts';
import { type Box, type PathSample, StrokePath, unionBoxes } from './strokePath.ts';
import type { Timeline, TimelineEntry } from './timeline.ts';
import { lookupGlyphData } from './utils.ts';

// The timeline one stroke at a time. `computeTimeline` schedules glyphs (an
// entry per glyph, with per-stroke overrides for deferred dots and stagger
// scaling); this module resolves that into when each stroke draws, and what
// it looks like at a given time — the one clock the canvas, the SVG export and
// `TegakiEngine.frameAt` all read.

type Stroke = TegakiGlyphData['s'][number];

/** One stroke of one glyph on the timeline. */
export interface StrokeInstance {
  /** Stable while the timeline is: `"<entryIndex>:<strokeIndex>"`. */
  id: string;
  /** Index of the glyph's entry in `timeline.entries`. */
  entryIndex: number;
  entry: TimelineEntry;
  glyph: TegakiGlyphData;
  /** Index of the stroke in `glyph.s` — its place in the glyph's stroke order. */
  strokeIndex: number;
  stroke: Stroke;
  /** Timeline seconds the stroke starts drawing (before glyph easing warps it). */
  start: number;
  /** Seconds the stroke takes to draw (before glyph easing warps it). */
  duration: number;
}

/**
 * A glyph's slot on the timeline — a `TimelineEntry`, or anything shaped
 * like one. `duration` defaults to the glyph's `t`.
 */
export interface GlyphSlot {
  offset: number;
  duration?: number;
  strokeDelays?: (number | undefined)[];
  strokeTimeScale?: number;
}

/** The easings that shape stroke timing — the matching `TimelineConfig` fields. */
export interface StrokeTiming {
  /** Each stroke's draw progress easing. Default: ease-out quad. */
  strokeEasing?: (t: number) => number;
  /** Each glyph's local time easing. Default: linear. */
  glyphEasing?: (t: number) => number;
}

/**
 * When stroke `si` draws, in seconds relative to its glyph's slot: the
 * scheduler's deferred delay if it moved the stroke, else the bundled one,
 * scaled with the bundled duration by stagger's fixed `duration`.
 */
export function strokeWindow(glyph: TegakiGlyphData, si: number, slot: Omit<GlyphSlot, 'offset'>): { delay: number; duration: number } {
  const stroke = glyph.s[si]!;
  const scale = slot.strokeTimeScale ?? 1;
  return { delay: slot.strokeDelays?.[si] ?? stroke.d * scale, duration: stroke.a * scale };
}

/**
 * Time into a glyph's slot at timeline time `time`: clamped to the slot, then
 * warped by glyph easing. Every stroke of the glyph reads its progress off
 * this local time.
 */
export function glyphLocalTime(time: number, offset: number, slotDuration: number, glyphEasing?: (t: number) => number): number {
  const local = Math.max(0, Math.min(time - offset, slotDuration));
  return glyphEasing && slotDuration > 0 ? glyphEasing(local / slotDuration) * slotDuration : local;
}

export type StrokeState = 'pending' | 'drawing' | 'done';

export interface StrokeProgress {
  state: StrokeState;
  /** Linear draw progress, 0–1. */
  linear: number;
  /** Eased draw progress, 0–1 — the share of the stroke's length drawn. */
  progress: number;
}

const PENDING: StrokeProgress = { state: 'pending', linear: 0, progress: 0 };
const FINISH_EPSILON = 1e-9;

/** A stroke's progress at `localTime` into its glyph's slot (see {@link glyphLocalTime}). */
export function strokeProgressAt(
  localTime: number,
  delay: number,
  duration: number,
  strokeEasing: (t: number) => number = defaultStrokeEasing,
): StrokeProgress {
  if (localTime < delay) return PENDING;
  let linear = duration > 0 ? Math.min((localTime - delay) / duration, 1) : 1;
  // A glyph's slot is its end less its offset, which can land a hair short
  // of its last stroke's end (0.299 → 0.29899999999999993): the clamped
  // local time would stop the stroke just shy of done, forever.
  if (linear > 1 - FINISH_EPSILON) linear = 1;
  const eased = strokeEasing(linear);
  return { state: linear >= 1 ? 'done' : 'drawing', linear, progress: eased < 0 ? 0 : eased > 1 ? 1 : eased };
}

/** A stroke's progress at timeline time `time`. */
export function sampleStroke(instance: StrokeInstance, time: number, timing?: StrokeTiming): StrokeProgress {
  const { entry } = instance;
  // Before its glyph's slot opens a stroke hasn't started, even one with no delay.
  if (time < entry.offset) return PENDING;
  const local = glyphLocalTime(time, entry.offset, entry.duration, timing?.glyphEasing);
  return strokeProgressAt(local, instance.start - entry.offset, instance.duration, timing?.strokeEasing);
}

/**
 * Every stroke on the timeline, in drawing order within each glyph and glyph
 * order across the text (the order the canvas paints them). Characters drawn
 * from the fallback font have no strokes and no instances.
 */
export function strokeInstances(timeline: Timeline, font: TegakiBundle): StrokeInstance[] {
  const out: StrokeInstance[] = [];
  const entries = timeline.entries;
  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei]!;
    if (!entry.hasGlyph || entry.char === '\n') continue;
    const glyph = (entry.glyphId !== undefined ? font.glyphDataById?.[entry.glyphId] : undefined) ?? lookupGlyphData(font, entry.char);
    if (!glyph) continue;
    for (let si = 0; si < glyph.s.length; si++) {
      const { delay, duration } = strokeWindow(glyph, si, entry);
      out.push({
        id: `${ei}:${si}`,
        entryIndex: ei,
        entry,
        glyph,
        strokeIndex: si,
        stroke: glyph.s[si]!,
        start: entry.offset + delay,
        duration,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geometry — where the pen is along a stroke.
// ---------------------------------------------------------------------------

/**
 * The point `len` font units along a subdivided stroke: the last vertex at or
 * before it (`lastIdx`) and, when it falls inside the next sub-segment, the
 * interpolated point there (`tail`). `len` past the end stops on the last vertex.
 */
export function pointAlong(sub: SubdividedStroke, len: number): { lastIdx: number; tail: SubVertexLike | null } {
  const { vertices } = sub;
  // Binary search for the largest i with vertices[i].cumLen <= len.
  let lo = 0;
  let hi = vertices.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (vertices[mid]!.cumLen <= len) lo = mid;
    else hi = mid - 1;
  }
  if (lo + 1 >= vertices.length || len <= vertices[lo]!.cumLen) return { lastIdx: lo, tail: null };
  const a = vertices[lo]!;
  const b = vertices[lo + 1]!;
  const segLen = b.cumLen - a.cumLen;
  const t = segLen > 0 ? (len - a.cumLen) / segLen : 0;
  return {
    lastIdx: lo,
    tail: {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      width: a.width + (b.width - a.width) * t,
      idx: a.idx + (b.idx - a.idx) * t,
      cumLen: len,
    },
  };
}

interface SubVertexLike {
  x: number;
  y: number;
  width: number;
  idx: number;
  cumLen: number;
}

/** Where a glyph sits: its origin in CSS px (`y` at the top of the em square) and scale. */
export interface GlyphPlacement {
  x: number;
  y: number;
  /** fontSize / unitsPerEm. */
  scale: number;
  /** Font ascender in font units. */
  ascender: number;
}

/** The pen at the drawing end of a stroke, in CSS px. `angle` is `0` for a dot. */
export type StrokeHead = PathSample;

/**
 * A stroke as the bundle has it, in CSS px at `place`: its subdivided
 * polyline, each point as wide as the bundle says (times `strokeScale`,
 * clip-to-text's width multiplier). A point's `t` is the draw progress at
 * which the pen reaches it. A dot — one point, or points that all coincide —
 * is a path of one point. `null` for a stroke with no points.
 */
export function rawStrokePath(stroke: Stroke, sub: SubdividedStroke, place: GlyphPlacement, strokeScale = 1): StrokePath | null {
  const pts = stroke.p;
  if (pts.length === 0) return null;
  const { scale } = place;
  const ws = scale * strokeScale;
  const px = (x: number) => place.x + x * scale;
  const py = (y: number) => place.y + (y + place.ascender) * scale;
  const p0 = pts[0]!;
  if (isDot(stroke) || sub.vertices.length < 2 || sub.totalLen <= 0) {
    return new StrokePath([{ x: px(p0[0]!), y: py(p0[1]!), width: p0[2]! * ws, t: 0 }]);
  }
  const inv = 1 / sub.totalLen;
  return new StrokePath(sub.vertices.map((v) => ({ x: px(v.x), y: py(v.y), width: v.width * ws, t: v.cumLen * inv })));
}

function isDot(stroke: Stroke): boolean {
  const pts = stroke.p;
  const p0 = pts[0]!;
  return pts.length === 1 || pts.every((p) => p[0] === p0[0] && p[1] === p0[1]);
}

/**
 * A nib stamp (see `Nib`): an ellipse of ink the stroke leaves at one point,
 * such as a calligraphic terminal. It is placed relative to the stroke's path,
 * so it moves with the ink and swells and thins with it.
 */
export interface StrokeNib {
  /** Draw progress of the point it sits on; it appears once the pen gets there. */
  t: number;
  /** Offset of its centre from the path's point at `t`, in px. */
  dx: number;
  dy: number;
  /** Radii, as multiples of the ink's width at `t`. */
  rx: number;
  ry: number;
  /** Rotation of the `rx` axis, in radians. */
  angle: number;
}

function strokeNibs(stroke: Stroke, sub: SubdividedStroke, scale: number): StrokeNib[] {
  const nibs = stroke.n;
  if (!nibs) return NO_NIBS;
  const out: StrokeNib[] = [];
  const dot = isDot(stroke) || sub.totalLen <= 0;
  for (const nib of nibs) {
    const k = nib[0]!;
    const at = stroke.p[k];
    if (!at) continue;
    // A radius against the width of the point it sits on, so it scales as that width does.
    const width = Math.max(at[2]!, 0.5);
    out.push({
      t: dot ? 0 : (sub.pointCumLen[k] ?? 0) / sub.totalLen,
      dx: nib[1]! * scale,
      dy: nib[2]! * scale,
      rx: nib[3]! / 2 / width,
      ry: nib[4]! / 2 / width,
      angle: nib[5]!,
    });
  }
  return out;
}

const NO_NIBS: StrokeNib[] = [];

// ---------------------------------------------------------------------------
// Placed strokes and frames.
// ---------------------------------------------------------------------------

/** A stroke placed in the layout: its geometry, which doesn't change with time. */
export interface PlacedStroke extends StrokeInstance {
  /**
   * The ink as the canvas draws it, in CSS px from the top-left of the text
   * box: `rawPath` reshaped by every plugin's `geometry` (the built-in
   * wobble, pressure width and taper among them).
   */
  path: StrokePath;
  /** The stroke as the bundle has it, before any plugin reshapes it (see {@link rawStrokePath}). */
  rawPath: StrokePath;
  /** Nib stamps along `path`. */
  nibs: readonly StrokeNib[];
  /** A number fixed per glyph, for effects that vary from glyph to glyph. */
  seed: number;
}

/** What a `geometry` hook knows about the stroke it reshapes. */
export interface StrokeGeometryContext {
  stroke: StrokeInstance;
  /** The stroke as the bundle has it — the first hook's input. */
  rawPath: StrokePath;
  /** Where its glyph sits: px from font units are `x + fx * scale`, `y + (fy + ascender) * scale`. */
  place: GlyphPlacement;
  /** px of ink width per font unit of the bundle's widths: `place.scale` times clip-to-text's width multiplier. */
  widthScale: number;
  /** A number fixed per glyph. */
  seed: number;
  /** Where along the bundle's own points draw progress `t` falls: `0` at the first point, `1` at the second, and so on. */
  bundleIndexAt(t: number): number;
}

export interface PlaceContext {
  /**
   * Where entry `entryIndex` is drawn, and the seed its effects use (the
   * engine's seed plus the grapheme index). `null` for an entry the layout
   * doesn't place; its strokes are left out.
   */
  placeEntry(entryIndex: number): (GlyphPlacement & { seed: number }) | null;
  /** Reshape each stroke's `rawPath` into the ink (the plugins' `geometry` hooks). Default: the raw path. */
  reshape?(path: StrokePath, ctx: StrokeGeometryContext): StrokePath;
  /** The subdivision the canvas draws each stroke with. Default: the raw polyline. */
  getSubdivided?(stroke: Stroke): SubdividedStroke;
  /** Clip-to-text's width multiplier. Default `1`. */
  strokeScale?: number;
}

/** The box a placed stroke's ink covers once drawn — its path and its nib stamps. `null` for an empty path. */
export function strokeInkBounds(stroke: Pick<PlacedStroke, 'path' | 'nibs'>): Box | null {
  const box = stroke.path.bounds();
  if (stroke.nibs.length === 0) return box;
  return unionBoxes([
    box,
    ...stroke.nibs.map((nib) => {
      const at = stroke.path.pointAt(nib.t);
      const r = Math.max(nib.rx, nib.ry) * at.width;
      return { minX: at.x + nib.dx - r, minY: at.y + nib.dy - r, maxX: at.x + nib.dx + r, maxY: at.y + nib.dy + r };
    }),
  ]);
}

/** Place every stroke in the layout. Strokes with no points, or of glyphs the layout doesn't place, are left out. */
export function placeStrokes(instances: readonly StrokeInstance[], ctx: PlaceContext): PlacedStroke[] {
  const out: PlacedStroke[] = [];
  const subdivide = ctx.getSubdivided ?? ((s: Stroke) => subdivideStroke(s, Infinity));
  const strokeScale = ctx.strokeScale ?? 1;
  // Instances come grouped by entry: place each glyph once.
  let entryIndex = -1;
  let place: (GlyphPlacement & { seed: number }) | null = null;
  for (const instance of instances) {
    if (instance.entryIndex !== entryIndex) {
      entryIndex = instance.entryIndex;
      place = ctx.placeEntry(entryIndex);
    }
    if (!place) continue;
    const sub = subdivide(instance.stroke);
    const rawPath = rawStrokePath(instance.stroke, sub, place, strokeScale);
    if (!rawPath) continue;
    const path = ctx.reshape
      ? ctx.reshape(rawPath, {
          stroke: instance,
          rawPath,
          place,
          widthScale: place.scale * strokeScale,
          seed: place.seed,
          bundleIndexAt: (t) => {
            if (sub.totalLen <= 0) return 0;
            const { lastIdx, tail } = pointAlong(sub, sub.totalLen * t);
            return (tail ?? sub.vertices[lastIdx]!).idx;
          },
        })
      : rawPath;
    out.push({ ...instance, path, rawPath, nibs: strokeNibs(instance.stroke, sub, place.scale), seed: place.seed });
  }
  return out;
}

/** A stroke at one moment of the timeline. */
export interface StrokeFrame extends PlacedStroke, StrokeProgress {
  /** The pen at the drawing end of the ink — `path.pointAt(progress)`; `null` while the stroke is pending. */
  head: StrokeHead | null;
}

/** A stroke being drawn — it always has a pen. */
export type ActiveStroke = StrokeFrame & { head: StrokeHead };

/** Every stroke the text draws, at one moment of the timeline. */
export interface TegakiFrame {
  /** Timeline seconds. */
  time: number;
  /** Every placed stroke, in drawing order (see {@link strokeInstances}). */
  strokes: StrokeFrame[];
  /** The strokes being drawn right now — where the pens are. */
  active: ActiveStroke[];
}

/** Sample every placed stroke at timeline time `time`. */
export function sampleFrame(placed: readonly PlacedStroke[], time: number, timing?: StrokeTiming): TegakiFrame {
  const strokes: StrokeFrame[] = [];
  const active: ActiveStroke[] = [];
  for (const stroke of placed) {
    const sample = sampleStroke(stroke, time, timing);
    const head = sample.state === 'pending' ? null : stroke.path.pointAt(sample.progress);
    const frame: StrokeFrame = { ...stroke, ...sample, head };
    strokes.push(frame);
    if (head && sample.state === 'drawing') active.push(frame as ActiveStroke);
  }
  return { time, strokes, active };
}
