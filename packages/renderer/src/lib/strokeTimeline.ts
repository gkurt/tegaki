import type { TegakiBundle, TegakiGlyphData } from '../types.ts';
import type { ResolvedEffect } from './effects.ts';
import { type SubdividedStroke, subdivideStroke } from './strokeCache.ts';
import { defaultStrokeEasing, type StrokeEffects, strokeEffects } from './strokeEffects.ts';
import type { Timeline, TimelineEntry } from './timeline.ts';
import { lookupGlyphData } from './utils.ts';

// The timeline one stroke at a time. `computeTimeline` schedules glyphs (an
// entry per glyph, with per-stroke overrides for deferred dots and stagger
// scaling); this module resolves that into when each stroke draws, and what
// it looks like at a given time — the one clock the canvas (`drawGlyph`), the
// SVG export and `TegakiEngine.frameAt` all read.

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

/** The pen at the drawing end of a stroke, in CSS px. */
export interface StrokeHead {
  x: number;
  y: number;
  /** Direction the pen travels, in radians (y down: `π/2` points down). `0` for a dot. */
  angle: number;
  /** Width of the ink under the pen, in px. */
  width: number;
}

/**
 * The pen on a stroke drawn to `progress` — where the canvas ends the ink,
 * wobble, pressure width and taper included. `strokeScale` is clip-to-text's
 * width multiplier.
 */
export function strokeHead(
  stroke: Stroke,
  sub: SubdividedStroke,
  progress: number,
  place: GlyphPlacement,
  fx: Pick<StrokeEffects, 'wobbleDx' | 'wobbleDy' | 'pressure' | 'taper' | 'needsPerSegment'>,
  strokeScale = 1,
): StrokeHead | null {
  const pts = stroke.p;
  if (pts.length === 0) return null;
  const { scale } = place;
  const px = (x: number) => place.x + x * scale;
  const py = (y: number) => place.y + (y + place.ascender) * scale;
  const at = (v: { x: number; y: number; idx: number }): [number, number] => [
    px(v.x + fx.wobbleDx(v.x, v.y, v.idx)),
    py(v.y + fx.wobbleDy(v.x, v.y, v.idx)),
  ];

  const p0 = pts[0]!;
  const isDot = pts.length === 1 || pts.every((p) => p[0] === p0[0] && p[1] === p0[1]);
  if (isDot || sub.vertices.length < 2 || sub.totalLen <= 0) {
    const [x, y] = at({ x: p0[0]!, y: p0[1]!, idx: 0 });
    // A dot's width doesn't vary within it: pressure blends a width with itself.
    return { x, y, angle: 0, width: Math.max(p0[2]!, 0.5) * scale * strokeScale * fx.taper(0.5) };
  }

  const { lastIdx, tail } = pointAlong(sub, sub.totalLen * progress);
  const v = sub.vertices;
  // The sub-segment the pen is on: the one the tail sits in, else the one it just finished.
  const aIdx = tail ? lastIdx : Math.max(0, lastIdx - 1);
  const [ax, ay] = at(v[aIdx]!);
  const [bx, by] = at(v[aIdx + 1]!);
  const head = tail ?? v[lastIdx]!;
  const [x, y] = tail ? at(tail) : lastIdx === aIdx ? [ax, ay] : [bx, by];

  const baseWidth = Math.max(sub.avgWidth, 0.5) * scale * strokeScale;
  let width = baseWidth;
  if (fx.needsPerSegment) {
    const perPoint = head.width * scale * strokeScale;
    width = Math.max(baseWidth + (perPoint - baseWidth) * fx.pressure, 0.5 * scale * strokeScale) * fx.taper(head.cumLen / sub.totalLen);
  }
  return { x, y, angle: Math.atan2(by - ay, bx - ax), width };
}

// ---------------------------------------------------------------------------
// Frames — every stroke at one moment.
// ---------------------------------------------------------------------------

/** A stroke at one moment of the timeline. */
export interface StrokeFrame extends StrokeInstance, StrokeProgress {
  /** The pen at the drawing end of the ink; `null` while the stroke is pending. */
  head: StrokeHead | null;
}

/** A stroke being drawn — it always has a pen. */
export type ActiveStroke = StrokeFrame & { head: StrokeHead };

/** Every stroke the text draws, at one moment of the timeline. */
export interface TegakiFrame {
  /** Timeline seconds. */
  time: number;
  /** Every laid-out stroke, in drawing order (see {@link strokeInstances}). */
  strokes: StrokeFrame[];
  /** The strokes being drawn right now — where the pens are. */
  active: ActiveStroke[];
}

export interface FrameContext {
  timing?: StrokeTiming;
  /**
   * Where entry `entryIndex` is drawn, and the seed its effects use (the
   * engine's seed plus the grapheme index). `null` for an entry the layout
   * doesn't place; its strokes are left out of the frame.
   */
  placeEntry(entryIndex: number): (GlyphPlacement & { seed: number }) | null;
  /** Effects that move the ink or change its width: wobble, pressureWidth, taper. */
  effects?: ResolvedEffect[];
  /** The subdivision the canvas draws each stroke with. Default: the raw polyline. */
  getSubdivided?(stroke: Stroke): SubdividedStroke;
  /** Clip-to-text's width multiplier. Default `1`. */
  strokeScale?: number;
}

/** Sample every stroke at timeline time `time`. */
export function sampleFrame(instances: readonly StrokeInstance[], time: number, ctx: FrameContext): TegakiFrame {
  const strokes: StrokeFrame[] = [];
  const active: ActiveStroke[] = [];
  const subdivide = ctx.getSubdivided ?? ((s: Stroke) => subdivideStroke(s, Infinity));
  // Instances come grouped by entry: place each glyph and resolve its effects once.
  let entryIndex = -1;
  let place: (GlyphPlacement & { seed: number }) | null = null;
  let fx: StrokeEffects | null = null;
  for (const instance of instances) {
    if (instance.entryIndex !== entryIndex) {
      entryIndex = instance.entryIndex;
      place = ctx.placeEntry(entryIndex);
      fx = null;
    }
    if (!place) continue;
    const sample = sampleStroke(instance, time, ctx.timing);
    let head: StrokeHead | null = null;
    if (sample.state !== 'pending') {
      fx ??= strokeEffects(ctx.effects ?? [], place.seed, '');
      head = strokeHead(instance.stroke, subdivide(instance.stroke), sample.progress, place, fx, ctx.strokeScale);
    }
    const frame: StrokeFrame = { ...instance, ...sample, head };
    strokes.push(frame);
    if (sample.state === 'drawing' && head) active.push(frame as ActiveStroke);
  }
  return { time, strokes, active };
}
