import type { ResolvedEffect } from '../lib/effects.ts';
import { paintStroke } from '../lib/paintStroke.ts';
import { seededRandom } from '../lib/random.ts';
import type { SubdividedStroke } from '../lib/strokeCache.ts';
import { defaultStrokeEasing } from '../lib/strokeEffects.ts';
import type { StrokePath } from '../lib/strokePath.ts';
import {
  type ActiveStroke,
  placeStrokes,
  type StrokeFrame,
  type StrokeInstance,
  strokeProgressAt,
  strokeWindow,
  type TegakiFrame,
} from '../lib/strokeTimeline.ts';
import type { TimelineEntry } from '../lib/timeline.ts';
import type { LineCap, TegakiGlyphData } from '../types.ts';
import { effectPlugins } from './effectPlugins.ts';
import { paintWith, reshapeWith, timingWith } from './plugins.ts';
import type { TegakiPlugin, TegakiStrokePaintContext } from './types.ts';

type Stroke = TegakiGlyphData['s'][number];

interface GlyphPosition {
  /** X offset in CSS pixels */
  x: number;
  /** Y offset in CSS pixels (top of em square) */
  y: number;
  /** Font size in CSS pixels */
  fontSize: number;
  /** Units per em from the font */
  unitsPerEm: number;
  /** Font ascender in font units */
  ascender: number;
  /** Font descender in font units (negative) */
  descender: number;
}

const linear = (t: number) => t;

/**
 * Draw a single glyph's strokes onto a canvas context, animated up to `localTime`.
 * `localTime` is seconds relative to this glyph's start (0 = glyph begins).
 *
 * The strokes go through the same plugins the engine runs — `effects` as the
 * built-in effect plugins, then `plugins` — except the `ink` hooks (the glow
 * among them), which post-process a whole canvas of finished ink, not a glyph.
 * A `timing` hook retimes the glyph's strokes, in seconds from `localTime` 0.
 *
 * `getSubdivided` returns a shared, cached subdivision of each stroke (in font
 * units, pre-wobble); if omitted, strokes are drawn as the bundle has them.
 *
 * `strokeDelays` is a sparse per-stroke override of the bundled `d` field (see
 * `TimelineEntry.strokeDelays`), and `strokeTimeScale` multiplies the bundled
 * `d` and `a` so the strokes fit a stretched or compressed slot.
 * `strokeStyleOverride` paints the strokes with a gradient or pattern instead
 * of `color` (and replaces `globalGradient`, which otherwise spans the glyph's em box).
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: TegakiGlyphData,
  pos: GlyphPosition,
  localTime: number,
  lineCap: LineCap,
  color: string,
  effects: ResolvedEffect[] = [],
  seed = 0,
  getSubdivided?: (stroke: Stroke) => SubdividedStroke,
  strokeEasing: ((t: number) => number) | undefined = defaultStrokeEasing,
  strokeScale = 1,
  strokeStyleOverride?: string | CanvasGradient | CanvasPattern,
  strokeDelays?: (number | undefined)[],
  strokeTimeScale = 1,
  plugins: readonly TegakiPlugin[] = [],
): void {
  const scale = pos.fontSize / pos.unitsPerEm;
  const all = [...effectPlugins(strokeStyleOverride ? effects.filter((e) => e.effect !== 'globalGradient') : effects), ...plugins];
  const random = (key: string | number) => seededRandom(seed, key);
  const onError = (plugin: TegakiPlugin, hook: keyof TegakiPlugin, error: unknown) =>
    console.error(`[tegaki] plugin "${plugin.name}" threw in ${hook}:`, error);

  const entry: TimelineEntry = { char: '', graphemeIndex: 0, offset: 0, duration: glyph.t, hasGlyph: true, strokeDelays };
  const windows = glyph.s.map((_, si) => strokeWindow(glyph, si, { strokeDelays, strokeTimeScale }));
  const instances: StrokeInstance[] = glyph.s.map((stroke, si) => ({
    id: `0:${si}`,
    entryIndex: 0,
    entry,
    glyph,
    strokeIndex: si,
    stroke,
    start: windows[si]!.delay,
    duration: windows[si]!.duration,
  }));
  const textBox = {
    minX: pos.x,
    minY: pos.y,
    maxX: pos.x + glyph.w * scale,
    maxY: pos.y + (pos.ascender - pos.descender) * scale,
  };
  const shaped = placeStrokes(instances, {
    placeEntry: () => ({ x: pos.x, y: pos.y, scale, ascender: pos.ascender, seed }),
    reshape: reshapeWith(all, { fontSize: pos.fontSize, random, textBox }, onError),
    getSubdivided,
  });
  // The plugins' `timing`, over the glyph's own strokes.
  const placed = timingWith(all, { fontSize: pos.fontSize, random }, onError)?.(shaped, glyph.t).strokes ?? shaped;

  // Clip-to-text's width multiplier is how the ink is painted, not the stroke's own width.
  const widened = new WeakMap<StrokePath, StrokePath>();
  const painter =
    strokeScale === 1
      ? paintStroke
      : (s: TegakiStrokePaintContext) => {
          if (s.stroke.state === 'pending') return;
          let path = widened.get(s.stroke.path);
          if (!path) widened.set(s.stroke.path, (path = s.stroke.path.map((p) => ({ ...p, width: p.width * strokeScale }))));
          paintStroke({ ...s, stroke: { ...s.stroke, path } });
        };
  const paint = paintWith(all, onError, painter);
  const strokes: StrokeFrame[] = placed.map((stroke) => {
    const sample = strokeProgressAt(localTime, stroke.start, stroke.duration, strokeEasing ?? linear);
    return { ...stroke, ...sample, head: sample.state === 'pending' ? null : stroke.path.pointAt(sample.progress) };
  });
  const frame: TegakiFrame = {
    time: localTime,
    strokes,
    active: strokes.filter((s): s is ActiveStroke => s.state === 'drawing' && s.head !== null),
  };
  for (const stroke of strokes) {
    paint({
      ctx,
      stroke,
      style: strokeStyleOverride ?? color,
      lineCap,
      color,
      fontSize: pos.fontSize,
      textBox,
      frame,
      random,
    });
  }
}
