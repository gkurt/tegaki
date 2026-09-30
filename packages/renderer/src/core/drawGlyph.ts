import { defaultStrokeEasing } from '../lib/easings.ts';
import { paintStroke } from '../lib/paintStroke.ts';
import { seededRandom } from '../lib/random.ts';
import type { SubdividedStroke } from '../lib/strokeCache.ts';
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
import { paintWith, reshapeWith, timingWith } from './plugins.ts';
import { pressurePlugin } from './pressure.ts';
import type { TegakiPlugin, TegakiStrokePaintContext } from './types.ts';

type Stroke = TegakiGlyphData['s'][number];

/** Where a glyph is drawn, and at what size. */
export interface GlyphPosition {
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

/** How {@link drawGlyph} draws. */
export interface DrawGlyphOptions {
  /** The bundle's `lineCap`. Default `'round'`. */
  lineCap?: LineCap;
  /** The ink's color. Default `'#000'`. */
  color?: string;
  /** A gradient or pattern to paint the strokes with in place of `color` (which the plugins still see). */
  style?: string | CanvasGradient | CanvasPattern;
  /** How much the ink's width follows the bundle's pen pressure, 0–1, as the renderer's `pressure`. Default `1`. */
  pressure?: number;
  /** Plugins the strokes go through, as the renderer runs them — except the `ink` hooks, which post-process a whole canvas of ink. */
  plugins?: readonly TegakiPlugin[];
  /** The glyph's seed: what plugins shape it by, and draw `random(key)` from. Default `0`. */
  seed?: number;
  /** A shared, cached subdivision of each stroke (in font units). Default: the strokes as the bundle has them. */
  getSubdivided?: (stroke: Stroke) => SubdividedStroke;
  /** Each stroke's draw progress easing. Default: ease-out quad, as the renderer. */
  strokeEasing?: (t: number) => number;
  /** A multiplier on the painted width (clip-to-text's widening), not the stroke's own. Default `1`. */
  strokeScale?: number;
  /** A sparse per-stroke override of the bundled `d` field (see `TimelineEntry.strokeDelays`). */
  strokeDelays?: (number | undefined)[];
  /** Multiplies the bundled `d` and `a`, so the strokes fit a stretched or compressed slot. Default `1`. */
  strokeTimeScale?: number;
}

/**
 * Draw a single glyph's strokes onto a canvas context, animated up to `localTime`
 * — seconds relative to this glyph's start (0 = glyph begins). The strokes go
 * through the same plugins the engine runs, after the same pressure step. A
 * `timing` hook retimes the glyph's strokes, in seconds from `localTime` 0.
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: TegakiGlyphData,
  pos: GlyphPosition,
  localTime: number,
  options: DrawGlyphOptions = {},
): void {
  const {
    lineCap = 'round',
    color = '#000',
    style,
    pressure = 1,
    plugins = [],
    seed = 0,
    getSubdivided,
    strokeEasing = defaultStrokeEasing,
    strokeScale = 1,
    strokeDelays,
    strokeTimeScale = 1,
  } = options;
  const scale = pos.fontSize / pos.unitsPerEm;
  const all = [pressurePlugin(pressure), ...plugins];
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
    const sample = strokeProgressAt(localTime, stroke.start, stroke.duration, strokeEasing);
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
      style: style ?? color,
      lineCap,
      color,
      clipped: false,
      fontSize: pos.fontSize,
      textBox,
      frame,
      random,
    });
  }
}
