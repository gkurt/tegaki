import type { TegakiBundle } from '../types.ts';
import type { BundleShaper, ShapedGlyph } from './shaper.ts';
import type { Timeline } from './timeline.ts';
import { graphemes } from './utils.ts';

// Strong-RTL codepoints: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan,
// Mandaic, plus Arabic Presentation Forms A/B. Sufficient to decide per-line
// shaping direction for `applyShaperPositions`.
const RTL_CHAR_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

export interface TextLayout {
  /** Character indices per line */
  lines: number[][];
  /** X offset within line in em per character index */
  charOffsets: number[];
  /** Width in em per character index */
  charWidths: number[];
  /**
   * Visual-left edge of each line in em (parallel to `lines`). Populated by
   * `applyShaperPositions` and consumed by the engine when a timeline entry
   * carries per-glyph offsets \u2014 engine adds `lineLefts[lineIdx]` to
   * `entry.xOffsetEm` to get the absolute x position. Undefined when the
   * shaper path isn't taken; consumers must fall back to `charOffsets`.
   */
  lineLefts?: number[];
}

/**
 * Axis-aligned bounding box of the laid-out text in the ctx coordinate space
 * used by the engine's glyph loop (i.e. after `padH`/`padV` translation).
 * `width` is the max line advance; `height` is `lines.length * lineHeight`.
 */
export interface LayoutBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the text bounding box from a measured layout. Inputs are in CSS
 * pixels. Assumes the layout's char offsets are em-relative to the left edge
 * of each line (as produced by `computeTextLayout`).
 */
export function computeLayoutBbox(layout: TextLayout, fontSize: number, lineHeight: number): LayoutBBox {
  let maxRight = 0;
  for (const lineIndices of layout.lines) {
    for (const charIdx of lineIndices) {
      const offset = layout.charOffsets[charIdx] ?? 0;
      const width = layout.charWidths[charIdx] ?? 0;
      const right = (offset + width) * fontSize;
      if (right > maxRight) maxRight = right;
    }
  }
  return {
    x: 0,
    y: 0,
    width: maxRight,
    height: layout.lines.length * lineHeight,
  };
}

/**
 * Measure text layout using the Range API on an existing DOM element.
 * The element must already be in the document with correct text content,
 * font, line-height, white-space, and width styles applied.
 */
export function computeTextLayout(el: HTMLElement, fontSize: number): TextLayout;
/**
 * Measure text layout by creating a temporary off-screen DOM element.
 */
export function computeTextLayout(text: string, fontSize: number, fontFamily: string, lineHeight: number, maxWidth: number): TextLayout;
export function computeTextLayout(
  elOrText: HTMLElement | string,
  fontSize: number,
  fontFamily?: string,
  lineHeight?: number,
  maxWidth?: number,
): TextLayout {
  if (typeof elOrText === 'string') {
    return measureWithTempElement(elOrText, fontFamily!, fontSize, lineHeight!, maxWidth!);
  }
  return measureElement(elOrText, fontSize);
}

function measureElement(el: HTMLElement, fontSize: number): TextLayout {
  const textNode = el.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    return { lines: [], charOffsets: [], charWidths: [] };
  }

  const text = textNode.textContent ?? '';
  const chars = graphemes(text);
  if (!chars.length) return { lines: [], charOffsets: [], charWidths: [] };

  // Use element's left edge as reference so offsets are direction-agnostic.
  // For LTR the first char is near the left edge; for RTL it's near the right —
  // either way, subtracting elLeft produces correct visual x-positions.
  const elRect = el.getBoundingClientRect();
  const elLeft = elRect.left;
  // Ancestor CSS transforms (e.g. Remotion Studio's preview-fit scale) make
  // getClientRects() return pre-scale pixel values while getComputedStyle()
  // returns unscaled fontSize. Divide measured widths by the scale so the em
  // conversion matches fontSize. offsetWidth is layout-box width (unscaled).
  const scale = el.offsetWidth > 0 ? elRect.width / el.offsetWidth : 1;
  const range = document.createRange();

  const charOffsets: number[] = [];
  const charWidths: number[] = [];
  const lines: number[][] = [];
  let currentLine: number[] = [];
  let prevTop = -Infinity;
  let utf16Offset = 0;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;

    if (char === '\n') {
      charOffsets.push(0);
      charWidths.push(0);
      currentLine.push(i);
      lines.push(currentLine);
      currentLine = [];
      prevTop = -Infinity;
      utf16Offset += char.length;
      continue;
    }

    range.setStart(textNode, utf16Offset);
    range.setEnd(textNode, utf16Offset + char.length);
    const rects = range.getClientRects();
    utf16Offset += char.length;

    if (rects.length === 0) {
      charOffsets.push(0);
      charWidths.push(0);
      currentLine.push(i);
      continue;
    }

    const rect = rects[rects.length - 1]!;

    // A significant vertical shift signals a new line. Both rect.top and
    // prevTop are in scaled pixels, so compare against a scaled threshold.
    if (currentLine.length > 0 && rect.top - prevTop > fontSize * 0.25 * scale) {
      lines.push(currentLine);
      currentLine = [];
    }

    if (currentLine.length === 0) {
      prevTop = rect.top;
    }

    charOffsets.push((rect.left - elLeft) / scale / fontSize);
    charWidths.push(rect.width / scale / fontSize);
    currentLine.push(i);
  }
  if (currentLine.length > 0) lines.push(currentLine);

  return { lines, charOffsets, charWidths };
}

/**
 * Replace `layout.charOffsets` and `charWidths` with values computed from the
 * shaper's advances, while preserving the DOM's line-break decisions. When a
 * `timeline` is provided, each entry's `xOffsetEm` and `yOffsetEm` are also
 * filled in from the shaper's per-glyph pen-walk (mutated in place) and
 * `layout.lineLefts` is populated — together they let the engine draw each
 * glyph at its GPOS-positioned origin (cursive-attachment lift, mark
 * attachment) instead of sharing one position per cluster.
 *
 * The DOM's Range API returns imprecise per-grapheme rects inside a complex-
 * shaped cluster (Arabic joining, Indic conjuncts, ligatures with kern/mark
 * GPOS), so strokes positioned from `rect.left` drift relative to the actual
 * glyph origins the shaper produced. Using the shaper's own `ax` walk keeps
 * the stroke positions aligned with the glyph ids the shaper chose.
 *
 * Line anchor (the leftmost visual pixel of each line) is measured from the
 * DOM using a full-line Range — per-grapheme rects inside shaped clusters are
 * not reliable enough to anchor against.
 *
 * `letterSpacingEm` (CSS `letter-spacing` divided by font size) is inserted
 * between clusters during the pen-walk so the shaper path tracks whatever the
 * DOM already applied to line-breaking — the char-keyed fallback path picks it
 * up automatically through the measured `charOffsets`, but the shaper rebuilds
 * positions from glyph advances and would otherwise ignore it. This matches the
 * browser exactly for non-joining scripts (Latin, CJK, Hebrew); for cursive
 * scripts with GPOS cursive attachment (Arabic) the per-cluster HarfBuzz
 * advance doesn't map linearly onto the browser's per-grapheme spacing, so the
 * spaced canvas can drift slightly from the (hidden) DOM overlay — the glyphs
 * are still spread apart, just not pixel-matched to the debug overlay.
 */
export function applyShaperPositions(
  layout: TextLayout,
  el: HTMLElement,
  text: string,
  fontSize: number,
  font: TegakiBundle,
  shaper: BundleShaper,
  timeline?: Timeline,
  letterSpacingEm = 0,
): TextLayout {
  const chars = graphemes(text);
  if (!chars.length) return layout;

  const textNode = el.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return layout;
  const elRect = el.getBoundingClientRect();
  const elLeft = elRect.left;
  const scale = el.offsetWidth > 0 ? elRect.width / el.offsetWidth : 1;
  const range = document.createRange();

  // utf16 start offset of each grapheme.
  const graphemeStartU: number[] = [];
  {
    let u = 0;
    for (let i = 0; i < chars.length; i++) {
      graphemeStartU.push(u);
      u += chars[i]!.length;
    }
  }
  const utf16ToGrapheme = new Int32Array(text.length + 1).fill(-1);
  for (let i = 0; i < chars.length; i++) utf16ToGrapheme[graphemeStartU[i]!] = i;
  utf16ToGrapheme[text.length] = chars.length;

  const charOffsets = layout.charOffsets.slice();
  const charWidths = layout.charWidths.slice();
  const lineLefts: number[] = new Array(layout.lines.length).fill(0);
  const emPerUnit = 1 / font.unitsPerEm;

  // Index timeline entries by `graphemeIndex:glyphId` so each shaped glyph
  // can find its corresponding entry and fill in xOffsetEm/yOffsetEm.
  // Multiple entries can share the same key if the same glyph repeats inside
  // a cluster (rare); FIFO-pop preserves emission order across the duplicate.
  const entryQueue = new Map<string, number[]>();
  if (timeline) {
    for (let ei = 0; ei < timeline.entries.length; ei++) {
      const e = timeline.entries[ei]!;
      if (e.glyphId === undefined) continue;
      const key = `${e.graphemeIndex}:${e.glyphId}`;
      const list = entryQueue.get(key);
      if (list) list.push(ei);
      else entryQueue.set(key, [ei]);
    }
  }

  for (let li = 0; li < layout.lines.length; li++) {
    const lineIndices = layout.lines[li]!;
    const realIndices = lineIndices.filter((idx) => chars[idx] !== '\n');
    if (realIndices.length === 0) continue;

    const lineStartU = graphemeStartU[realIndices[0]!]!;
    const lastReal = realIndices[realIndices.length - 1]!;
    const lineEndU = graphemeStartU[lastReal]! + chars[lastReal]!.length;

    // Measure the whole line's visual-left edge via a single Range. The
    // line's own aggregate rect is reliable even when per-grapheme rects
    // inside a shaped cluster are not.
    range.setStart(textNode, lineStartU);
    range.setEnd(textNode, lineEndU);
    const lineRects = range.getClientRects();
    if (lineRects.length === 0) continue;
    let lineLeftPx = Infinity;
    for (const r of lineRects) if (r.left < lineLeftPx) lineLeftPx = r.left;
    const lineLeftEm = (lineLeftPx - elLeft) / scale / fontSize;
    lineLefts[li] = lineLeftEm;

    // Harfbuzz emits glyphs in a per-run visual order: within each bidi/word
    // run (contiguous stretch where cluster indices walk monotonically) the
    // glyphs are already in visual left-to-right order, but the *runs* are
    // emitted in logical order. For RTL lines that means each word is
    // shaped correctly internally yet the words themselves appear in the
    // wrong order — pen-walking the raw buffer would put the logical-first
    // word at the visual left edge. Detect run boundaries (cl jumps up for
    // RTL, where within a word cl walks downward) and reverse the list of
    // runs so pen-walking forward produces the true visual-LTR layout.
    const lineText = text.slice(lineStartU, lineEndU);
    const lineRTL = RTL_CHAR_RE.test(lineText);
    const shaped = shaper.shape(lineText);
    if (shaped.length === 0) continue;
    const visualGlyphs = lineRTL ? reverseRTLRuns(shaped) : shaped;

    // Walk glyphs in visual order. Glyph draw position is pen + (dx, dy),
    // and the pen advances by (ax, ay) after each glyph. HarfBuzz uses a
    // y-up coordinate system; we negate dy/ay to match our y-down draw
    // axis. Record each cluster's visual left + summed advance for layout
    // (consumed by the engine's fallback path, the layout bbox, and any
    // consumer that indexes by grapheme), and fill in per-entry x/y for
    // the engine's primary draw path so marks land on their base correctly.
    const clusterLeft = new Map<number, number>();
    const clusterAdvance = new Map<number, number>();
    let penEm = 0;
    let penYEm = 0;
    let prevCl: number | undefined;
    for (const g of visualGlyphs) {
      // CSS `letter-spacing` adds a gap after each typographic unit. Insert it
      // once per cluster boundary (before every cluster except the first) so
      // the extra advance accumulates just like the browser applied it to the
      // overlay the DOM broke lines against.
      if (prevCl !== undefined && g.cl !== prevCl) penEm += letterSpacingEm;
      prevCl = g.cl;
      const axEm = g.ax * emPerUnit;
      const ayEm = g.ay * emPerUnit;
      const dxEm = g.dx * emPerUnit;
      const dyEm = g.dy * emPerUnit;
      const glyphXEm = penEm + dxEm;
      const glyphYEm = penYEm - dyEm;
      if (!clusterLeft.has(g.cl)) clusterLeft.set(g.cl, glyphXEm);
      clusterAdvance.set(g.cl, (clusterAdvance.get(g.cl) ?? 0) + axEm);

      if (timeline) {
        const gIdx = utf16ToGrapheme[lineStartU + g.cl];
        if (gIdx !== undefined && gIdx >= 0) {
          const queue = entryQueue.get(`${gIdx}:${g.g}`);
          const ei = queue?.shift();
          if (ei !== undefined) {
            const entry = timeline.entries[ei]!;
            entry.xOffsetEm = glyphXEm;
            entry.yOffsetEm = glyphYEm;
          }
        }
      }

      penEm += axEm;
      penYEm -= ayEm;
    }

    // Assign offsets to the grapheme at each cluster start.
    const assigned = new Set<number>();
    for (const [cl, leftEm] of clusterLeft) {
      const gIdx = utf16ToGrapheme[lineStartU + cl];
      if (gIdx === undefined || gIdx < 0) continue;
      charOffsets[gIdx] = lineLeftEm + leftEm;
      charWidths[gIdx] = clusterAdvance.get(cl) ?? 0;
      assigned.add(gIdx);
    }

    // Mid-cluster graphemes (ligature interior) share their host cluster's
    // left edge and have zero advance — timeline.ts skips them for drawing,
    // but keep the offset sane for any consumer that indexes by grapheme.
    const sortedCls = [...clusterLeft.keys()].sort((a, b) => a - b);
    for (const idx of realIndices) {
      if (assigned.has(idx)) continue;
      const u = graphemeStartU[idx]! - lineStartU;
      let hostCl = -1;
      for (const cl of sortedCls) {
        if (cl <= u) hostCl = cl;
        else break;
      }
      if (hostCl < 0) continue;
      charOffsets[idx] = lineLeftEm + (clusterLeft.get(hostCl) ?? 0);
      charWidths[idx] = 0;
    }
  }

  return { lines: layout.lines, charOffsets, charWidths, lineLefts };
}

/**
 * Reorder a harfbuzz-shaped RTL line so that pen-walking forward produces
 * visual left-to-right positions. HB emits each word's glyphs in within-word
 * visual order (cl descending for RTL) but keeps the words themselves in
 * logical order — so we split on cl-jumps and reverse the list of runs while
 * preserving each run's internal order.
 */
function reverseRTLRuns(shaped: ShapedGlyph[]): ShapedGlyph[] {
  const runs: ShapedGlyph[][] = [];
  let cur: ShapedGlyph[] = [];
  for (const g of shaped) {
    if (cur.length && g.cl > cur[cur.length - 1]!.cl) {
      runs.push(cur);
      cur = [];
    }
    cur.push(g);
  }
  if (cur.length) runs.push(cur);
  const out: ShapedGlyph[] = [];
  for (let i = runs.length - 1; i >= 0; i--) out.push(...runs[i]!);
  return out;
}

function measureWithTempElement(text: string, fontFamily: string, fontSize: number, lineHeight: number, maxWidth: number): TextLayout {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  el.style.top = '-9999px';
  el.style.visibility = 'hidden';
  el.style.fontFamily = fontFamily;
  el.style.fontSize = `${fontSize}px`;
  el.style.lineHeight = `${lineHeight}px`;
  el.style.whiteSpace = 'pre-wrap';
  el.style.overflowWrap = 'break-word';
  el.style.width = `${maxWidth}px`;
  el.textContent = text;
  document.body.appendChild(el);

  const result = measureElement(el, fontSize);

  document.body.removeChild(el);
  return result;
}
