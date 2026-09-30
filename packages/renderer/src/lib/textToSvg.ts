import { PluginResolver } from '../core/plugin-registry.ts';
import { outlineWith, reshapeWith, svgDecoration, timingWith } from '../core/plugins.ts';
import { pressurePlugin } from '../core/pressure.ts';
import type { TegakiPlugin, TegakiPluginSpec } from '../core/types.ts';
import type { TegakiBundle, TegakiGlyphData } from '../types.ts';
import { paragraphDirection } from './bidi.ts';
import { MIN_LINE_HEIGHT_EM, MIN_PADDING_V_EM, PADDING_H_EM } from './css-properties.ts';
import { flattenPath } from './flattenPath.ts';
import { seededRandom } from './random.ts';
import type { BundleShaper } from './shaper.ts';
import { type SubdividedStroke, subdivideStroke } from './strokeCache.ts';
import type { Box } from './strokePath.ts';
import { placeStrokes, retimeTimeline, strokeInstances } from './strokeTimeline.ts';
import { placementsToSvg, type SvgGlyphOutline, type SvgGlyphPlacement, type SvgStrokeInk } from './svgExport.ts';
import { headlessShapedLayout } from './textLayout.ts';
import { computeTimeline, type TimelineConfig } from './timeline.ts';
import { graphemes, lookupGlyphData } from './utils.ts';

/** Animation flavour of the emitted SVG. */
export type TextToSvgMode =
  /** Self-drawing, loops forever via CSS keyframes. Best for a README hero / embed. */
  | 'loop'
  /** Self-drawing once on load (SMIL), then stays complete. */
  | 'once'
  /** Static final artwork — every stroke fully drawn, no animation. */
  | 'static';

export interface TextToSvgOptions {
  /** Font size in px. Default `100`. */
  fontSize?: number;
  /** Line height in px. Default: the bundle's em-height (`(ascender − descender) / unitsPerEm × fontSize`). */
  lineHeight?: number;
  /** Extra spacing inserted after each character, in px (CSS `letter-spacing`). Default `0`. */
  letterSpacing?: number;
  /** Stroke color (any CSS color). Default `#1a1a1a`. */
  color?: string;
  /** Animation flavour. Default `'loop'`. */
  mode?: TextToSvgMode;
  /**
   * Per-point width blend (0 = uniform mean width, 1 = full variable width —
   * the canvas look). Default `1`, or `0` in `loop` mode: a constant-width
   * loop reveals plain dashed paths, with no masks.
   */
  pressure?: number;
  /** Smooth strokes onto a Catmull-Rom spline before serializing. Default `false`. */
  smoothing?: boolean;
  /**
   * Stroke subdivision threshold in px. Smaller = more vertices = smoother
   * variable width at a larger file size. Default: `2` when `pressure > 0`, a
   * plugin reshapes or paints the ink, or `smoothing`; otherwise the raw bundled polyline.
   */
  segmentSize?: number;
  /** Timeline timing config (gaps, easing, stagger). Forwarded to `computeTimeline`; its easings shape the reveal. */
  timing?: TimelineConfig;
  /** Playback speed multiplier. Default `1`. */
  speed?: number;
  /** `loop` mode: seconds the finished text holds before it fades out. Default `1.5`. */
  loopHold?: number;
  /** Crop the viewBox to the ink (plus a small margin) instead of the full layout box. Default `true`. */
  crop?: boolean;
  /**
   * Shape with this shaper (see `createHarfbuzzShaper`): the bundle's
   * ligatures and contextual forms, joined scripts and bidi word order. Without
   * it, glyphs are placed one per character by advance width.
   */
  shaper?: BundleShaper | null;
  /**
   * Clip the strokes to the text's glyph outlines, as the renderer's
   * `quality.clipText`: `true`, or a number to also scale every stroke width by
   * it first (the studio uses `1.2` for the geometry pipeline's bundles, so the
   * clip trims the ink to the letter shapes). Needs a `shaper` with outlines;
   * when a drawn glyph has none, the strokes are left unclipped.
   */
  clipText?: boolean | number;
  /**
   * Plugins, as the renderer's `plugins`: plugin objects, or names of
   * registered factories (see `registerPlugin`) — `['taper', ['glow', { radius: 0.15 }]]`.
   * The file draws the ink as their `geometry` shapes it and `timing` times
   * it, and what their `svg` hooks add. A name no factory is registered as throws.
   */
  plugins?: readonly TegakiPluginSpec[];
  /** The seed plugins draw with (a wobble's phase, where a gradient starts); each character adds its index. Default `0`, so output is reproducible. */
  seed?: number;
}

interface HeadlessLayout {
  /** Grapheme indices per visual line (mirrors `TextLayout.lines`). */
  lines: number[][];
  /** X offset within its line, in em, per grapheme index. */
  charOffsets: number[];
  /** Rightmost ink edge across all lines, in em. */
  maxRightEm: number;
}

/**
 * Lay text out left-to-right from the bundle's advance widths — the headless
 * analogue of the DOM-measured `computeTextLayout`. Lines break only on `\n`
 * (no auto-wrap). Sufficient for the no-shaper Latin/CJK path the CLI targets;
 * complex-script GPOS positioning (Arabic cursive joins, Indic conjuncts) needs
 * the browser shaper and is not modelled here.
 */
function headlessLayout(text: string, font: TegakiBundle, letterSpacingEm = 0): HeadlessLayout {
  const chars = graphemes(text);
  const upm = font.unitsPerEm;
  const lines: number[][] = [];
  const charOffsets: number[] = new Array(chars.length).fill(0);
  let current: number[] = [];
  let penEm = 0;
  let maxRightEm = 0;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === '\n') {
      charOffsets[i] = 0;
      current.push(i);
      lines.push(current);
      current = [];
      penEm = 0;
      continue;
    }
    // Insert letter-spacing before every character except the first on its
    // line, mirroring the DOM/shaper paths (spacing accumulates between units).
    if (current.length > 0) penEm += letterSpacingEm;
    charOffsets[i] = penEm;
    const glyph = lookupGlyphData(font, ch);
    // Unknown glyphs (no bundle entry, no advance) get a half-em placeholder so
    // the cursor still moves — matches the timeline's `unknownDuration` slot.
    const widthEm = glyph?.w != null ? glyph.w / upm : 0.5;
    penEm += widthEm;
    if (penEm > maxRightEm) maxRightEm = penEm;
    current.push(i);
  }
  if (current.length) lines.push(current);

  return { lines, charOffsets, maxRightEm };
}

/** A glyph the font draws for a character, offset from the character's origin in font units (y up). */
interface CharGlyph {
  g: string;
  dx: number;
  dy: number;
}

/**
 * The glyphs the font draws for `char` set alone — the outlines to clip an
 * unshaped timeline's entry to. It carries no glyph id (the bundle has no
 * `glyphDataById`), and is placed one per character as the font draws it
 * alone. `null` when the font has no glyph for it (`.notdef`).
 */
function charGlyphs(shaper: BundleShaper, char: string, cache: Map<string, CharGlyph[] | null>): CharGlyph[] | null {
  let glyphs = cache.get(char);
  if (glyphs === undefined) {
    let pen = 0;
    glyphs = [];
    for (const g of shaper.shape(char)) {
      if (g.g === '0' || g.g.endsWith(':0')) {
        glyphs = null;
        break;
      }
      glyphs.push({ g: g.g, dx: pen + g.dx, dy: g.dy });
      pen += g.ax;
    }
    cache.set(char, glyphs);
  }
  return glyphs;
}

/**
 * Render text to a standalone SVG string headlessly — no DOM, no canvas. Reuses
 * the same pure timeline + serializer the engine's `toSVG()` does, laying the
 * text out itself: from the shaper's glyphs and positions when `shaper` is
 * given (ligatures, contextual forms, Arabic joining, Indic conjuncts, bidi
 * word order), else from the bundle's advance widths. This is what the
 * `tegaki` CLI calls.
 *
 * Characters the bundle has no strokes for are left out — the engine draws
 * them from the fallback font.
 */
export function textToSvg(text: string, font: TegakiBundle, options: TextToSvgOptions = {}): string {
  const fontSize = options.fontSize ?? 100;
  const mode = options.mode ?? 'loop';
  const color = options.color ?? '#1a1a1a';
  const animated = mode !== 'static';
  const loop = mode === 'loop';
  const shaper = options.shaper ?? null;

  const upm = font.unitsPerEm;
  const scale = fontSize / upm;
  const emHeightPx = ((font.ascender - font.descender) / upm) * fontSize;
  const lineHeight = options.lineHeight ?? emHeightPx;
  const padH = PADDING_H_EM * fontSize;
  const padV = Math.max(MIN_PADDING_V_EM * fontSize, (MIN_LINE_HEIGHT_EM * fontSize - lineHeight) / 2);
  const halfLeading = (lineHeight - emHeightPx) / 2;

  const letterSpacingEm = (options.letterSpacing ?? 0) / fontSize;
  const shaped = !!shaper && !!font.glyphDataById;
  const timeline = computeTimeline(text, font, options.timing, shaper, {
    letterSpaced: letterSpacingEm !== 0,
    direction: paragraphDirection(text),
  });
  let lines: number[][];
  let charOffsets: number[];
  let lineLefts: number[] | undefined;
  let widthEm: number;
  if (shaped) {
    const layout = headlessShapedLayout(text, font, shaper, timeline, letterSpacingEm);
    ({ lines, charOffsets, lineLefts, widthEm } = layout);
  } else {
    const layout = headlessLayout(text, font, letterSpacingEm);
    ({ lines, charOffsets } = layout);
    widthEm = layout.maxRightEm;
  }

  // grapheme index → visual line index, so timeline entries place onto a line.
  const totalChars = charOffsets.length;
  const graphemeToLine = new Int32Array(totalChars).fill(-1);
  for (let li = 0; li < lines.length; li++) {
    for (const charIdx of lines[li]!) graphemeToLine[charIdx] = li;
  }

  const pressure = Math.max(0, Math.min(options.pressure ?? (loop ? 0 : 1), 1));
  const resolved = new PluginResolver().resolve(options.plugins, { warn: false });
  if (resolved.missing.length > 0) {
    throw new Error(
      `textToSvg: no plugin registered as ${resolved.missing.map((n) => `"${n}"`).join(', ')}. Register it with registerPlugin().`,
    );
  }
  const plugins = [pressurePlugin(pressure), ...resolved.plugins];
  const smoothing = options.smoothing === true;
  const varies = pressure > 0 || resolved.plugins.some((p) => p.geometry || p.paint);
  const resolvedSegmentSize = options.segmentSize ?? (varies || smoothing ? 2 : undefined);
  const segmentLengthFU = resolvedSegmentSize != null ? resolvedSegmentSize / scale : Infinity;
  let clip = options.clipText && shaper?.glyphPath ? options.clipText : false;
  const seed = options.seed ?? 0;
  const random = (key: string | number) => seededRandom(seed, key);
  const onError = (plugin: TegakiPlugin, hook: keyof TegakiPlugin, error: unknown) => {
    throw new Error(`textToSvg: plugin "${plugin.name}" threw in ${hook}: ${error instanceof Error ? error.message : String(error)}`);
  };
  const textBox = { minX: padH, minY: padV, maxX: padH + widthEm * fontSize, maxY: padV + lines.length * lineHeight };

  // Where each entry's glyph is drawn, in the file's px.
  const origins = new Map<number, { x: number; glyphY: number }>();
  timeline.entries.forEach((entry, ei) => {
    if (entry.char === '\n' || !entry.hasGlyph) return;
    const charIdx = entry.graphemeIndex;
    const lineIdx = charIdx < totalChars ? graphemeToLine[charIdx]! : -1;
    if (lineIdx < 0) return;
    const lineLeftEm = lineLefts?.[lineIdx];
    const xEm = entry.xOffsetEm !== undefined && lineLeftEm !== undefined ? lineLeftEm + entry.xOffsetEm : (charOffsets[charIdx] ?? 0);
    origins.set(ei, { x: padH + xEm * fontSize, glyphY: padV + lineIdx * lineHeight + halfLeading + (entry.yOffsetEm ?? 0) * fontSize });
  });

  // The ink as the renderer draws it: every stroke placed and reshaped by the plugins, then retimed by them.
  const subdivided = new WeakMap<TegakiGlyphData['s'][number], SubdividedStroke>();
  const placedInk = placeStrokes(strokeInstances(timeline, font), {
    reshape: reshapeWith(plugins, { fontSize, random, textBox }, onError),
    getSubdivided: (stroke) => {
      let sub = subdivided.get(stroke);
      if (!sub) subdivided.set(stroke, (sub = subdivideStroke(stroke, segmentLengthFU, smoothing)));
      return sub;
    },
    placeEntry: (ei) => {
      const at = origins.get(ei);
      const entry = timeline.entries[ei]!;
      return at ? { x: at.x, y: at.glyphY, scale, ascender: font.ascender, seed: seed + entry.graphemeIndex } : null;
    },
  });
  const retime = timingWith(plugins, { fontSize, random }, onError);
  const timed = retime?.(placedInk, timeline.totalDuration);
  const played = timed ? retimeTimeline(timeline, placedInk, timed.strokes, timed.duration) : timeline;
  const strokes = timed?.strokes ?? placedInk;
  const inks = new Map<number, SvgStrokeInk[]>();
  for (const s of strokes) {
    let list = inks.get(s.entryIndex);
    if (!list) inks.set(s.entryIndex, (list = []));
    list[s.strokeIndex] = { path: s.path, nibs: s.nibs };
  }

  const reshapeOutline = clip ? outlineWith(plugins, onError) : undefined;
  const placements: SvgGlyphPlacement[] = [];
  const outlines: SvgGlyphOutline[] = [];
  const charGlyphCache = new Map<string, CharGlyph[] | null>();
  played.entries.forEach((entry, ei) => {
    const at = origins.get(ei);
    if (!at) return;
    const charIdx = entry.graphemeIndex;
    const glyph = (entry.glyphId !== undefined ? font.glyphDataById?.[entry.glyphId] : undefined) ?? lookupGlyphData(font, entry.char);
    if (!glyph) return;
    placements.push({
      glyph,
      ox: at.x,
      oy: at.glyphY,
      scale,
      ascender: font.ascender,
      offset: entry.offset,
      duration: entry.duration,
      strokeDelays: entry.strokeDelays,
      strokeDurations: entry.strokeDurations,
      strokeTimeScale: entry.strokeTimeScale,
      inks: inks.get(ei) ?? [],
      entryIndex: ei,
    });
    if (clip && shaper && /\S/u.test(entry.char)) {
      const glyphs = entry.glyphId !== undefined ? [{ g: entry.glyphId, dx: 0, dy: 0 }] : charGlyphs(shaper, entry.char, charGlyphCache);
      const paths = glyphs?.map((g) => shaper.glyphPath?.(g.g) ?? null);
      // A glyph with no outline would be masked out whole, so draw every
      // stroke unclipped instead — as the engine falls back from the outlines.
      if (!glyphs || !paths || paths.includes(null)) clip = false;
      else
        glyphs.forEach((g, i) => {
          const outline: SvgGlyphOutline = {
            d: paths[i]!,
            x: at.x + g.dx * scale,
            y: at.glyphY + (font.ascender - g.dy) * scale,
            scale,
            seed: seed + charIdx,
          };
          outlines.push(
            reshapeOutline ? reshapedOutline(outline, segmentLengthFU, font.ascender, fontSize, textBox, reshapeOutline) : outline,
          );
        });
    }
  });
  const strokeScale = typeof clip === 'number' ? clip : 1;

  const width = padH * 2 + widthEm * fontSize;
  const height = padV * 2 + lines.length * lineHeight;

  return placementsToSvg(placements, {
    width,
    height,
    lineCap: font.lineCap,
    color,
    strokeScale,
    animated,
    loop,
    totalDuration: played.totalDuration,
    speed: options.speed,
    strokeEasing: options.timing?.strokeEasing,
    glyphEasing: options.timing?.glyphEasing,
    loopHold: options.loopHold,
    crop: options.crop,
    clipText: clip ? { glyphs: outlines } : undefined,
    decorate: plugins.some((p) => p.svg)
      ? (clock) => svgDecoration(plugins, strokes, clock, { duration: played.totalDuration, fontSize, color, textBox, random }, onError)
      : undefined,
  });
}

/** A glyph outline reshaped by the plugins' `outline` hooks, as the renderer's clip-to-text mask is: flattened, in absolute px. */
function reshapedOutline(
  g: SvgGlyphOutline,
  segmentLengthFU: number,
  ascender: number,
  fontSize: number,
  textBox: Box,
  reshape: NonNullable<ReturnType<typeof outlineWith>>,
): SvgGlyphOutline {
  const place = { x: g.x, y: g.y - ascender * g.scale, scale: g.scale, ascender };
  const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
  const d = flattenPath(g.d, segmentLengthFU)
    .map((contour) => {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < contour.length; i += 2) pts.push({ x: g.x + contour[i]! * g.scale, y: g.y - contour[i + 1]! * g.scale });
      const moved = reshape(pts, { place, seed: g.seed ?? 0, fontSize, textBox });
      return `M ${moved.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(' L ')} Z`;
    })
    .join(' ');
  return { d, x: 0, y: 0, scale: 1, placed: true };
}
