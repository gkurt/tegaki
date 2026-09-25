import { Blob, Direction, Face, Feature, Font, Buffer as HbBuffer, shape } from 'harfbuzzjs';
import type { ShaperFactory } from '../core/shaper-registry.ts';
import { neutralRunDirection, paragraphDirection, strongDirection } from '../lib/bidi.ts';
import { LETTER_SPACED_OFF_FEATURES } from '../lib/features.ts';
import type { BundleShaper, ShapedGlyph, ShapeOptions } from '../lib/shaper.ts';
import type { TegakiBundle } from '../types.ts';

const SHAPER_MANAGED_FEATURES = new Set(['init', 'medi', 'fina', 'isol', 'rlig', 'frac', 'numr', 'dnom']);

/**
 * Whitespace boundaries split shaping runs (see `BundleShaper.shape`).
 * Covers ASCII whitespace plus the Unicode space block — anything browsers
 * also treat as a word separator for line-breaking and text shaping.
 */
export function isShapingWhitespace(code: number): boolean {
  return (
    code === 0x20 || // space
    code === 0x09 || // tab
    code === 0x0a || // LF
    code === 0x0d || // CR
    code === 0x0c || // FF
    code === 0x0b || // VT
    code === 0xa0 || // NBSP
    (code >= 0x2000 && code <= 0x200a) || // en/em quad/space, hair space, etc.
    code === 0x2028 || // line separator
    code === 0x2029 || // paragraph separator
    code === 0x202f || // narrow NBSP
    code === 0x205f || // medium mathematical space
    code === 0x3000 // ideographic space
  );
}

/** A run of consecutive characters with the same `isWhitespace` classification. */
export interface ShapingSegment {
  text: string;
  /** UTF-16 offset of `text` in the original input. */
  offset: number;
  isWhitespace: boolean;
}

/**
 * Tokenise `text` into alternating whitespace / non-whitespace segments.
 * Browsers shape each non-whitespace word in isolation, so contextual
 * features (calt/liga/clig) never bridge a space; we want the same here so
 * canvas output matches the DOM overlay's glyphs.
 */
export function splitForShaping(text: string): ShapingSegment[] {
  const out: ShapingSegment[] = [];
  if (!text) return out;
  let segStart = 0;
  let segIsWs = isShapingWhitespace(text.charCodeAt(0));
  for (let i = 1; i <= text.length; i++) {
    const atEnd = i === text.length;
    const isWs = !atEnd && isShapingWhitespace(text.charCodeAt(i));
    if (atEnd || isWs !== segIsWs) {
      out.push({ text: text.slice(segStart, i), offset: segStart, isWhitespace: segIsWs });
      segStart = i;
      segIsWs = isWs;
    }
  }
  return out;
}

/** Build a harfbuzz feature string from bundle features, filtering shaper-managed enables. */
export function toHbFeatureString(enabled: readonly string[]): string {
  const parts: string[] = [];
  for (const tag of enabled) {
    if (SHAPER_MANAGED_FEATURES.has(tag)) continue;
    parts.push(tag);
  }
  return parts.join(',');
}

/** Parse the filtered feature tags into `Feature[]` for `shape()`. */
function toHbFeatures(enabled: readonly string[]): Feature[] {
  const out: Feature[] = [];
  for (const tag of enabled) {
    if (SHAPER_MANAGED_FEATURES.has(tag)) continue;
    const f = Feature.fromString(tag);
    if (f) out.push(f);
  }
  return out;
}

async function buildShaper(bundle: TegakiBundle): Promise<BundleShaper> {
  const urls = [bundle.fontUrl, ...(bundle.extraFontUrls ?? [])];
  const buffers = await Promise.all(urls.map(async (url) => (await fetch(url)).arrayBuffer()));
  const subsets = buffers.map((buf) => {
    const blob = new Blob(buf);
    const face = new Face(blob, 0);
    const font = new Font(face);
    // Pre-scan the cmap so per-cluster routing is a hash lookup, not a wasm
    // call. `collectUnicodes` returns every codepoint the face's cmap maps to
    // a non-`.notdef` glyph — exactly what we need to decide whether this
    // subset can shape a given cluster.
    const codepoints = new Set<number>(face.collectUnicodes());
    return { font, face, blob, codepoints };
  });
  const defaultFeatures = toHbFeatures(bundle.features ?? []);
  // Spaced text: the same list with the features browsers drop between
  // spaced letters switched off — explicitly, since harfbuzz applies
  // liga/clig/calt by default.
  const spacedFeatures = [
    ...toHbFeatures((bundle.features ?? []).filter((tag) => !LETTER_SPACED_OFF_FEATURES.includes(tag))),
    ...LETTER_SPACED_OFF_FEATURES.map((tag) => Feature.fromString(`-${tag}`)!),
  ];

  // Shape `runText` with `subsetIdx`'s font, then prefix output glyph ids with
  // the subset index so lookups in `glyphDataById` pick the right entry.
  // Glyphs from subset 0 (primary) keep their bare numeric key for backward
  // compatibility with single-subset bundles. Every call is its own `run`
  // (see `ShapedGlyph.run`); `direction`, when known, overrides harfbuzz's
  // guess from the script (Arabic-Indic digits would otherwise shape RTL).
  let nextRun = 0;
  const shapeRun = (
    subsetIdx: number,
    runText: string,
    runStart: number,
    features: Feature[],
    direction?: 'ltr' | 'rtl' | null,
  ): ShapedGlyph[] => {
    const subset = subsets[subsetIdx]!;
    const buffer = new HbBuffer();
    buffer.addText(runText);
    buffer.guessSegmentProperties();
    if (direction) buffer.setDirection(direction === 'rtl' ? Direction.RTL : Direction.LTR);
    shape(subset.font, buffer, features);
    const infos = buffer.getGlyphInfosAndPositions();
    const prefix = subsetIdx === 0 ? '' : `${subsetIdx}:`;
    const run = nextRun++;
    return infos.map((g) => ({
      g: `${prefix}${g.codepoint}`,
      cl: runStart + g.cluster,
      ax: g.xAdvance ?? 0,
      ay: g.yAdvance ?? 0,
      dx: g.xOffset ?? 0,
      dy: g.yOffset ?? 0,
      run,
    }));
  };

  // Pick the subset that covers `cp` — primary-first, so shared codepoints
  // (e.g. a space or Latin digit present in both subsets) stick with the
  // primary face. Returns -1 when no subset has a cmap entry — the caller
  // still shapes the run against the primary (produces `.notdef`, which the
  // renderer's char-keyed fallback can handle).
  const pickSubset = (cp: number): number => {
    for (let i = 0; i < subsets.length; i++) {
      if (subsets[i]!.codepoints.has(cp)) return i;
    }
    return -1;
  };

  // Shape a whitespace-free segment as one harfbuzz run per subset and
  // direction: a subset switch changes the font, a direction switch (Hebrew
  // then Latin in one word) the buffer direction harfbuzz shapes with — one
  // buffer would reverse the Latin letters with the Hebrew. Direction-neutral
  // characters stay in the run they're in; a run of nothing but them takes
  // the direction bidi resolves it to from `text` (the whole line) and the
  // paragraph's `base` — harfbuzz would guess LTR and leave a bracket in RTL
  // text unmirrored. Returns glyphs with `cl` already offset to the original
  // text.
  const shapeSegment = (text: string, base: 'ltr' | 'rtl', segText: string, segOffset: number, features: Feature[]): ShapedGlyph[] => {
    const out: ShapedGlyph[] = [];
    let runStart = 0;
    let runSubset = -2;
    let runDirection: 'ltr' | 'rtl' | null = null;
    const flush = (endUtf16: number) => {
      if (endUtf16 === runStart) return;
      const effective = runSubset < 0 ? 0 : runSubset;
      const direction = runDirection ?? neutralRunDirection(text, segOffset + runStart, segOffset + endUtf16, base);
      out.push(...shapeRun(effective, segText.slice(runStart, endUtf16), segOffset + runStart, features, direction));
    };
    for (let i = 0; i < segText.length; ) {
      const cp = segText.codePointAt(i) ?? segText.charCodeAt(i);
      const step = cp > 0xffff ? 2 : 1;
      // A single-subset bundle shapes uncovered characters with its only font
      // too, so they don't split the run.
      const subset = subsets.length === 1 ? 0 : pickSubset(cp);
      const direction = strongDirection(cp);
      if (subset !== runSubset || (direction && runDirection && direction !== runDirection)) {
        flush(i);
        runStart = i;
        runSubset = subset;
        runDirection = null;
      }
      runDirection ??= direction;
      i += step;
    }
    flush(segText.length);
    return out;
  };

  // Pick the dominant subset of a non-whitespace segment from its first
  // codepoint. Used to route an adjacent whitespace segment through the
  // matching font when shaping with neighbour context.
  const dominantSubset = (segText: string): number => {
    if (!segText) return 0;
    const cp = segText.codePointAt(0) ?? segText.charCodeAt(0);
    const sub = pickSubset(cp);
    return sub < 0 ? 0 : sub;
  };

  return {
    shape(text: string, options?: ShapeOptions): ShapedGlyph[] {
      if (!text) return [];
      nextRun = 0;
      const features = options?.letterSpaced ? spacedFeatures : defaultFeatures;
      const base = options?.direction ?? paragraphDirection(text);
      // Browsers tokenise at whitespace before shaping (each word is its
      // own HB run), so contextual features like `calt`, `liga`, and
      // `clig` never see characters across a space. Mirror that here:
      // shape each whitespace-delimited segment in isolation so canvas
      // output matches what the DOM overlay renders. Without this, fonts
      // like Caveat would calt the second `s` of "s s" via the first one
      // — the canvas would diverge from CSS-shaped text.
      //
      // Whitespace segments themselves still need GPOS context: many
      // Arabic fonts (e.g. Aref Ruqaa) shrink the space advance via a
      // contextual lookup when it's flanked by Arabic letters — shaping
      // " " in isolation misses that and the canvas drifts from the DOM
      // overlay by the leftover advance. So for whitespace segments,
      // shape together with a non-whitespace neighbour and emit only the
      // glyphs whose cluster falls inside the whitespace range. The
      // neighbour's own glyphs are still produced by its own isolated
      // shapeSegment call, so cross-space calt/liga stay suppressed.
      const segments = splitForShaping(text);
      const out: ShapedGlyph[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        if (!seg.isWhitespace) {
          out.push(...shapeSegment(text, base, seg.text, seg.offset, features));
          continue;
        }
        // Prefer a preceding neighbour — for scripts whose contextual rules
        // care about post-letter position (Arabic space-after-letter), the
        // preceding word is the relevant context. Fall back to the next
        // neighbour for leading whitespace.
        let neighbourIdx = -1;
        for (let j = i - 1; j >= 0; j--) {
          if (!segments[j]!.isWhitespace) {
            neighbourIdx = j;
            break;
          }
        }
        if (neighbourIdx < 0) {
          for (let j = i + 1; j < segments.length; j++) {
            if (!segments[j]!.isWhitespace) {
              neighbourIdx = j;
              break;
            }
          }
        }
        if (neighbourIdx < 0) {
          // All-whitespace input — no context to borrow, shape standalone.
          out.push(...shapeSegment(text, base, seg.text, seg.offset, features));
          continue;
        }
        const neighbour = segments[neighbourIdx]!;
        const subset = dominantSubset(neighbour.text);
        const composite = neighbourIdx < i ? `${neighbour.text}${seg.text}` : `${seg.text}${neighbour.text}`;
        const compositeOffset = neighbourIdx < i ? neighbour.offset : seg.offset;
        const wsStart = seg.offset;
        const wsEnd = seg.offset + seg.text.length;
        for (const g of shapeRun(subset, composite, compositeOffset, features)) {
          if (g.cl >= wsStart && g.cl < wsEnd) out.push(g);
        }
      }
      return out;
    },
  };
}

/**
 * Harfbuzz shaper factory. Pass to `TegakiEngine.registerShaper` once at app
 * startup to enable complex shaping (ligatures, contextual alternates,
 * Arabic/Indic scripts) for every bundle that declares `glyphDataById`.
 *
 * ```ts
 * import { TegakiEngine } from 'tegaki/core';
 * import harfbuzzShaper from 'tegaki/shaper-harfbuzz';
 * TegakiEngine.registerShaper(harfbuzzShaper);
 * ```
 *
 * Declines bundles without `glyphDataById` (nothing to resolve shaped glyph
 * ids against) and environments without `fetch` (SSR). The renderer's
 * char-keyed fallback handles both cases.
 */
const harfbuzzShaper: ShaperFactory = (bundle) => {
  if (typeof fetch === 'undefined') return null;
  if (!bundle.glyphDataById) return null;
  return buildShaper(bundle);
};

export default harfbuzzShaper;
