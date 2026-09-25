import type { TegakiBundle } from '../types.ts';
import { neutralRunDirection, strongDirection } from './bidi.ts';
import type { BundleShaper, ShapedGlyph } from './shaper.ts';
import type { Timeline } from './timeline.ts';
import { graphemes } from './utils.ts';

const WHITESPACE_RE = /\s/u;

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
  /**
   * The paragraph's resolved base direction, as the browser laid it out:
   * `dir="auto"` resolves from the first strong character, so Arabic text
   * that opens with a Latin word is still LTR (left-aligned, runs ordered
   * left to right). Anything redrawing the text itself (the clip mask's
   * `fillText`) must use it to reproduce the same bidi order. Defaults to
   * `'ltr'` when absent.
   */
  direction?: 'ltr' | 'rtl';
}

/** A whitespace-delimited word of a laid-out line, with its visual-left edge in em. */
export interface LineWord {
  text: string;
  leftEm: number;
  /**
   * The direction to draw `text` in — the one the shaper shapes it in, so a
   * bracket is mirrored in the mask where it is in the strokes.
   */
  direction: 'ltr' | 'rtl';
}

/**
 * The words of line `lineIdx`, each anchored at its leftmost measured
 * grapheme — where the browser put it, bidi order included. Redrawing text
 * word by word at these anchors (the clip mask) keeps a word the canvas
 * shapes differently from the DOM from shifting every word after it: the
 * canvas and the DOM can disagree next to another script (Amiri's `1⁄2`
 * beside Arabic measures 19px wider in canvas). Words that measured no width
 * are left out.
 *
 * A word that switches direction is split there, as the shaper splits it into
 * runs: bidi need not keep its halves together. `aכתב` opening an LTR line has
 * its a at the left end and `כתב` at the right end, after the rest of the
 * Hebrew run. Direction-neutral characters stay with the piece they follow,
 * which is drawn in its letters' direction; a piece of nothing but them (a
 * lone bracket) in the direction bidi resolves it to, from the line and the
 * paragraph's direction.
 */
export function lineWords(layout: TextLayout, characters: readonly string[], lineIdx: number): LineWord[] {
  const indices = layout.lines[lineIdx] ?? [];
  const lineText = indices.map((idx) => characters[idx] ?? '').join('');
  const base = layout.direction ?? 'ltr';
  const words: LineWord[] = [];
  let text = '';
  let left = Infinity;
  let direction: 'ltr' | 'rtl' | null = null;
  let start = 0;
  let at = 0;
  const flush = () => {
    if (text && Number.isFinite(left)) {
      words.push({ text, leftEm: left, direction: direction ?? neutralRunDirection(lineText, start, start + text.length, base) });
    }
    text = '';
    left = Infinity;
    direction = null;
  };
  for (const charIdx of indices) {
    const char = characters[charIdx] ?? '';
    at += char.length;
    if (!char || WHITESPACE_RE.test(char)) {
      flush();
      continue;
    }
    const charDirection = strongDirection(char.codePointAt(0)!);
    if (charDirection && direction && charDirection !== direction) flush();
    if (!text) start = at - char.length;
    direction ??= charDirection;
    text += char;
    if ((layout.charWidths[charIdx] ?? 0) > 0) left = Math.min(left, layout.charOffsets[charIdx] ?? 0);
  }
  flush();
  return words;
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
  const direction = getComputedStyle(el).direction === 'rtl' ? 'rtl' : 'ltr';

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

  return { lines, charOffsets, charWidths, direction };
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
 * Anchors are measured from the DOM with Ranges over whole spans — the line
 * (its leftmost visual pixel) and each word in it — never per grapheme:
 * per-grapheme rects inside shaped clusters are not reliable enough. Word
 * anchors also carry the browser's bidi ordering; see positionLineGlyphs.
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

    // Word order comes from the browser; glyph order within a word from the
    // shaper. See positionLineGlyphs.
    const lineText = text.slice(lineStartU, lineEndU);
    // Each line alone would pick its own `dir="auto"` direction; the DOM's is the paragraph's.
    const shaped = shaper.shape(lineText, { letterSpaced: letterSpacingEm !== 0, direction: layout.direction ?? 'ltr' });
    if (shaped.length === 0) continue;
    const spanLeftEm = (start: number, end: number): number | undefined => {
      range.setStart(textNode, lineStartU + start);
      range.setEnd(textNode, lineStartU + end);
      let left = Infinity;
      for (const r of range.getClientRects()) if (r.width > 0 && r.left < left) left = r.left;
      return Number.isFinite(left) ? (left - elLeft) / scale / fontSize - lineLeftEm : undefined;
    };
    const { glyphs, clusterLeft, clusterAdvance } = positionLineGlyphs(shaped, lineText, spanLeftEm, font.unitsPerEm, letterSpacingEm);
    if (timeline) {
      for (const { glyph: g, xEm, yEm } of glyphs) {
        const gIdx = utf16ToGrapheme[lineStartU + g.cl];
        if (gIdx === undefined || gIdx < 0) continue;
        const ei = entryQueue.get(`${gIdx}:${g.g}`)?.shift();
        if (ei === undefined) continue;
        const entry = timeline.entries[ei]!;
        entry.xOffsetEm = xEm;
        entry.yOffsetEm = yEm;
      }
    }

    // Assign offsets to the grapheme at each cluster start.
    const assigned = new Set<number>();
    for (const [cl, leftEm] of clusterLeft) {
      const gIdx = utf16ToGrapheme[lineStartU + cl];
      if (gIdx === undefined || gIdx < 0) continue;
      charOffsets[gIdx] = lineLeftEm + leftEm;
      // `.notdef` clusters have no shaper advance: keep the DOM's width.
      charWidths[gIdx] = clusterAdvance.get(cl) ?? charWidths[gIdx] ?? 0;
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

  return { ...layout, charOffsets, charWidths, lineLefts };
}

/** A shaped glyph with its draw origin, in em from the line's visual-left edge (y down). */
export interface PositionedGlyph {
  glyph: ShapedGlyph;
  xEm: number;
  yEm: number;
}

/**
 * Place one line's shaped glyphs. The shaper shapes each whitespace-delimited
 * word on its own and returns the words in LOGICAL order, each word's glyphs
 * already in visual order (an RTL word comes out right to left). Arranging
 * the words visually is the Unicode bidi algorithm's job, with the
 * paragraph's base direction — which `dir="auto"` takes from the first strong
 * character, so an Arabic line opening with a Latin word is laid out LTR. The
 * browser has already done all of that for the overlay, so each word is
 * anchored where the DOM put it (`spanLeftEm`, em from the line's left edge,
 * over a UTF-16 span of `lineText`) and the shaper's advances only walk the
 * glyphs inside it. A word the DOM can't measure continues from the previous
 * one.
 *
 * A word the shaper split into several runs (`ShapedGlyph.run` — a subset or
 * direction switch, as in `מדהיםa`) gets the same treatment per run: the runs
 * come back in logical order, which is not the visual one when the word mixes
 * directions, so each run is anchored where the DOM put it.
 *
 * `letterSpacingEm` is inserted before every cluster but a word's first; the
 * gaps between words are in the DOM's measured positions.
 *
 * A `.notdef` glyph (a character no subset of the bundle's font has) is drawn
 * by the browser in some other font, at an advance the shaper can't know — so
 * each `.notdef` cluster, and the run of real glyphs after it, is anchored to
 * the DOM like a word of its own. Walking the `.notdef` advance instead would
 * pile up the glyphs of a spaceless line (CJK text in a Latin font). Its
 * advance is left out of `clusterAdvance`: the DOM's width is the true one.
 */
export function positionLineGlyphs(
  shaped: ShapedGlyph[],
  lineText: string,
  spanLeftEm: (start: number, end: number) => number | undefined,
  unitsPerEm: number,
  letterSpacingEm = 0,
): { glyphs: PositionedGlyph[]; clusterLeft: Map<number, number>; clusterAdvance: Map<number, number> } {
  // Word (and whitespace-run) spans of the line, as UTF-16 [start, end).
  const spanOf = new Int32Array(lineText.length).fill(-1);
  const spans: [number, number][] = [];
  for (let i = 0; i < lineText.length; ) {
    const ws = WHITESPACE_RE.test(lineText[i]!);
    let j = i + 1;
    while (j < lineText.length && WHITESPACE_RE.test(lineText[j]!) === ws) j++;
    for (let k = i; k < j; k++) spanOf[k] = spans.length;
    spans.push([i, j]);
    i = j;
  }

  // Anchored runs: consecutive glyphs (in shaped order) of one span and
  // shaper run, split around each `.notdef` cluster. Each run's UTF-16
  // extent is the union of its clusters, a cluster ending where the next one
  // in its span starts.
  const clusterStarts = [...new Set(shaped.map((g) => g.cl))].sort((a, b) => a - b);
  const clusterEnd = (cl: number): number => {
    const spanEnd = spans[spanOf[cl] ?? -1]?.[1] ?? lineText.length;
    const next = clusterStarts.find((c) => c > cl);
    return next === undefined ? spanEnd : Math.min(next, spanEnd);
  };
  const runOf: number[] = [];
  const runExtent: [number, number][] = [];
  for (let i = 0; i < shaped.length; i++) {
    const g = shaped[i]!;
    const prev = shaped[i - 1];
    const notdef = isNotdef(g);
    const newRun =
      !prev || spanOf[g.cl] !== spanOf[prev.cl] || g.run !== prev.run || notdef !== isNotdef(prev) || (notdef && g.cl !== prev.cl);
    if (newRun) runExtent.push([g.cl, clusterEnd(g.cl)]);
    const extent = runExtent[runExtent.length - 1]!;
    extent[0] = Math.min(extent[0], g.cl);
    extent[1] = Math.max(extent[1], clusterEnd(g.cl));
    runOf.push(runExtent.length - 1);
  }

  const emPerUnit = 1 / unitsPerEm;
  const glyphs: PositionedGlyph[] = [];
  const clusterLeft = new Map<number, number>();
  const clusterAdvance = new Map<number, number>();
  let penEm = 0;
  let penYEm = 0;
  let span = -1;
  let run = -1;
  let prevCl: number | undefined;
  for (let i = 0; i < shaped.length; i++) {
    const g = shaped[i]!;
    const gSpan = spanOf[g.cl] ?? -1;
    if (gSpan !== span) {
      span = gSpan;
      prevCl = undefined;
    }
    if (runOf[i] !== run) {
      run = runOf[i]!;
      const [start, end] = runExtent[run]!;
      const anchor = gSpan >= 0 ? spanLeftEm(start, end) : undefined;
      if (anchor !== undefined) {
        penEm = anchor;
        penYEm = 0;
        // The DOM position already includes any letter spacing before it.
        prevCl = undefined;
      }
    }
    if (prevCl !== undefined && g.cl !== prevCl) penEm += letterSpacingEm;
    prevCl = g.cl;
    // HarfBuzz is y-up; the draw axis is y-down, so dy / ay are negated.
    const xEm = penEm + g.dx * emPerUnit;
    const yEm = penYEm - g.dy * emPerUnit;
    glyphs.push({ glyph: g, xEm, yEm });
    // A cluster's left edge is the pen, not the glyph origin: `dx` moves the
    // ink, not the advance box the DOM measures and the clip mask anchors on.
    if (!clusterLeft.has(g.cl)) clusterLeft.set(g.cl, penEm);
    if (!isNotdef(g)) clusterAdvance.set(g.cl, (clusterAdvance.get(g.cl) ?? 0) + g.ax * emPerUnit);
    penEm += g.ax * emPerUnit;
    penYEm -= g.ay * emPerUnit;
  }
  return { glyphs, clusterLeft, clusterAdvance };
}

/** Glyph id 0 of any subset (`"0"`, `"1:0"`) — the font has no glyph for the character. */
function isNotdef(g: ShapedGlyph): boolean {
  return g.g === '0' || g.g.endsWith(':0');
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
