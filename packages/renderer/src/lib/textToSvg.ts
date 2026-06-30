import type { TegakiBundle } from '../types.ts';
import { MIN_LINE_HEIGHT_EM, MIN_PADDING_V_EM, PADDING_H_EM } from './css-properties.ts';
import { placementsToSvg, type SvgGlyphPlacement } from './svgExport.ts';
import { computeTimeline, type TimelineConfig } from './timeline.ts';
import { graphemes, lookupGlyphData } from './utils.ts';

/** Animation flavour of the emitted SVG. */
export type TextToSvgMode =
  /** Self-drawing, loops forever via CSS keyframes (constant width). Best for a README hero / embed. */
  | 'loop'
  /** Self-drawing once on load, then stays complete (variable width via per-stroke mask reveal). */
  | 'once'
  /** Static final artwork — every stroke fully drawn, no animation. */
  | 'static';

export interface TextToSvgOptions {
  /** Font size in px. Default `100`. */
  fontSize?: number;
  /** Line height in px. Default: the bundle's em-height (`(ascender − descender) / unitsPerEm × fontSize`). */
  lineHeight?: number;
  /** Stroke color (any CSS color). Default `#1a1a1a`. */
  color?: string;
  /** Animation flavour. Default `'loop'`. */
  mode?: TextToSvgMode;
  /**
   * Per-point width blend for `once` / `static` (0 = uniform mean width, 1 =
   * full variable width — the canvas look). Ignored in `loop` mode, which is
   * constant width by construction. Default `1`.
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
  /** Timeline timing config (gaps, easing, stagger). Forwarded to `computeTimeline`. */
  timing?: TimelineConfig;
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
function headlessLayout(text: string, font: TegakiBundle): HeadlessLayout {
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
 * the same pure timeline + serializer the engine's `toSVG()` does, but derives
 * glyph positions from the bundle's advance widths instead of a measured DOM
 * overlay. This is what the `tegaki` CLI calls.
 *
 * Variable stroke width (`pressure`) is honoured in `once` / `static`; `loop`
 * is constant width by construction. Glow, wobble, gradient, taper, and
 * clip-to-text effects are not modelled in SVG.
 */
export function textToSvg(text: string, font: TegakiBundle, options: TextToSvgOptions = {}): string {
  const fontSize = options.fontSize ?? 100;
  const mode = options.mode ?? 'loop';
  const color = options.color ?? '#1a1a1a';
  const animated = mode !== 'static';
  const loop = mode === 'loop';

  const upm = font.unitsPerEm;
  const scale = fontSize / upm;
  const emHeightPx = ((font.ascender - font.descender) / upm) * fontSize;
  const lineHeight = options.lineHeight ?? emHeightPx;
  const padH = PADDING_H_EM * fontSize;
  const padV = Math.max(MIN_PADDING_V_EM * fontSize, (MIN_LINE_HEIGHT_EM * fontSize - lineHeight) / 2);
  const halfLeading = (lineHeight - emHeightPx) / 2;

  const timeline = computeTimeline(text, font, options.timing, null);
  const { lines, charOffsets, maxRightEm } = headlessLayout(text, font);

  // grapheme index → visual line index, so timeline entries place onto a line.
  const totalChars = charOffsets.length;
  const graphemeToLine = new Int32Array(totalChars).fill(-1);
  for (let li = 0; li < lines.length; li++) {
    for (const charIdx of lines[li]!) graphemeToLine[charIdx] = li;
  }

  // loop is constant width regardless; otherwise full per-point width by default.
  const pressure = loop ? 0 : Math.max(0, Math.min(options.pressure ?? 1, 1));
  const smoothing = options.smoothing === true;
  const resolvedSegmentSize = options.segmentSize ?? (pressure > 0 || smoothing ? 2 : undefined);
  const segmentLengthFU = resolvedSegmentSize != null ? resolvedSegmentSize / scale : Infinity;

  const placements: SvgGlyphPlacement[] = [];
  for (const entry of timeline.entries) {
    if (entry.char === '\n' || !entry.hasGlyph) continue;
    const charIdx = entry.graphemeIndex;
    const lineIdx = charIdx < totalChars ? graphemeToLine[charIdx]! : -1;
    if (lineIdx < 0) continue;
    const glyph = (entry.glyphId !== undefined ? font.glyphDataById?.[entry.glyphId] : undefined) ?? lookupGlyphData(font, entry.char);
    if (!glyph) continue;
    const x = (charOffsets[charIdx] ?? 0) * fontSize;
    const glyphY = lineIdx * lineHeight + halfLeading;
    placements.push({ glyph, ox: padH + x, oy: padV + glyphY, scale, ascender: font.ascender, offset: entry.offset });
  }

  const width = padH * 2 + maxRightEm * fontSize;
  const height = padV * 2 + lines.length * lineHeight;

  return placementsToSvg(placements, {
    width,
    height,
    lineCap: font.lineCap,
    color,
    pressure,
    segmentLengthFU,
    smoothing,
    strokeScale: 1,
    animated,
    loop,
    totalDuration: timeline.totalDuration,
  });
}
