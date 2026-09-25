import type { TegakiBundle } from '../types.ts';
import { paragraphDirection } from './bidi.ts';
import { MIN_LINE_HEIGHT_EM, MIN_PADDING_V_EM, PADDING_H_EM } from './css-properties.ts';
import { findEffect, globalGradientGeometry, resolveEffects } from './effects.ts';
import type { BundleShaper } from './shaper.ts';
import { placementsToSvg, type SvgExportConfig, type SvgGlyphOutline, type SvgGlyphPlacement } from './svgExport.ts';
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
   * variable width at a larger file size. Default: `2` when `pressure > 0` or
   * `smoothing`, otherwise the raw bundled polyline.
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
   * clip trims the ink to the letter shapes). Needs a `shaper` with outlines.
   */
  clipText?: boolean | number;
  /** Effects, as the renderer's `effects` prop: glow, wobble, taper, strokeGradient, globalGradient. Width blending is `pressure`. */
  effects?: Record<string, unknown>;
  /** Effect seed (wobble phase, gradient hue); each character adds its index. Default `0`, so output is reproducible. */
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

  const effects = resolveEffects({ pressureWidth: false, ...options.effects });
  const pressure = Math.max(0, Math.min(options.pressure ?? (loop ? 0 : 1), 1));
  const smoothing = options.smoothing === true;
  const effectsNeedSubdivision =
    pressure > 0 || !!findEffect(effects, 'wobble') || !!findEffect(effects, 'strokeGradient') || !!findEffect(effects, 'taper');
  const resolvedSegmentSize = options.segmentSize ?? (effectsNeedSubdivision || smoothing ? 2 : undefined);
  const segmentLengthFU = resolvedSegmentSize != null ? resolvedSegmentSize / scale : Infinity;
  const clip = options.clipText && shaper?.glyphPath ? options.clipText : false;
  const strokeScale = typeof clip === 'number' ? clip : 1;

  const placements: SvgGlyphPlacement[] = [];
  const outlines: SvgGlyphOutline[] = [];
  for (const entry of timeline.entries) {
    if (entry.char === '\n' || !entry.hasGlyph) continue;
    const charIdx = entry.graphemeIndex;
    const lineIdx = charIdx < totalChars ? graphemeToLine[charIdx]! : -1;
    if (lineIdx < 0) continue;
    const glyph = (entry.glyphId !== undefined ? font.glyphDataById?.[entry.glyphId] : undefined) ?? lookupGlyphData(font, entry.char);
    if (!glyph) continue;
    const lineLeftEm = lineLefts?.[lineIdx];
    const xEm = entry.xOffsetEm !== undefined && lineLeftEm !== undefined ? lineLeftEm + entry.xOffsetEm : (charOffsets[charIdx] ?? 0);
    const glyphY = lineIdx * lineHeight + halfLeading + (entry.yOffsetEm ?? 0) * fontSize;
    placements.push({
      glyph,
      ox: padH + xEm * fontSize,
      oy: padV + glyphY,
      scale,
      ascender: font.ascender,
      offset: entry.offset,
      duration: entry.duration,
      strokeDelays: entry.strokeDelays,
      strokeTimeScale: entry.strokeTimeScale,
      seed: (options.seed ?? 0) + charIdx,
    });
    if (clip && entry.glyphId !== undefined && /\S/u.test(entry.char)) {
      const d = shaper?.glyphPath?.(entry.glyphId);
      if (d) outlines.push({ d, x: padH + xEm * fontSize, y: padV + glyphY + font.ascender * scale, scale });
    }
  }

  const width = padH * 2 + widthEm * fontSize;
  const height = padV * 2 + lines.length * lineHeight;

  let globalGradient: SvgExportConfig['globalGradient'];
  const gg = findEffect(effects, 'globalGradient');
  if (Array.isArray(gg?.config.colors) && gg.config.colors.length > 0) {
    const g = globalGradientGeometry(
      { x: padH, y: padV, width: widthEm * fontSize, height: lines.length * lineHeight },
      gg.config.colors,
      gg.config.angle ?? 0,
    );
    globalGradient = { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, stops: g.stops };
  }

  return placementsToSvg(placements, {
    width,
    height,
    lineCap: font.lineCap,
    color,
    pressure,
    segmentLengthFU,
    smoothing,
    strokeScale,
    animated,
    loop,
    totalDuration: timeline.totalDuration,
    effects,
    fontSize,
    speed: options.speed,
    strokeEasing: options.timing?.strokeEasing,
    glyphEasing: options.timing?.glyphEasing,
    loopHold: options.loopHold,
    crop: options.crop,
    globalGradient,
    clipText: clip ? { glyphs: outlines } : undefined,
  });
}
