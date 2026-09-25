import { Blob, Direction, Face, Feature, Font, GlyphFlag, Buffer as HbBuffer, shape } from 'harfbuzzjs';
import type { ShaperFactory } from '../core/shaper-registry.ts';
import { paragraphDirection, resolvedDirections } from '../lib/bidi.ts';
import { LETTER_SPACED_OFF_FEATURES } from '../lib/features.ts';
import { resolvedScripts, scriptsDiffer } from '../lib/itemize.ts';
import type { BundleShaper, ShapedGlyph, ShapeOptions } from '../lib/shaper.ts';
import type { TegakiBundle } from '../types.ts';

/** Each character's resolved direction and script, by UTF-16 offset into the shaped line. */
interface LineItems {
  directions: ('ltr' | 'rtl')[];
  scripts: (string | null)[];
}

const SHAPER_MANAGED_FEATURES = new Set(['init', 'medi', 'fina', 'isol', 'rlig', 'frac', 'numr', 'dnom']);

/**
 * A line wrapped at whitespace keeps its end as the paragraph shaped it (see
 * `lineReshapeSpans`). Covers ASCII whitespace plus the Unicode space block —
 * anything browsers also treat as a word separator for line-breaking.
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

/** A cluster of a shaped paragraph: its first UTF-16 offset, and whether the text can be broken before it without changing the shaping. */
export interface ShapedCluster {
  cl: number;
  safe: boolean;
}

/**
 * How Chrome sets one line `[start, end)` of a wrapped paragraph: it shapes
 * the paragraph once, then reshapes only what a break changes. The line's
 * head, `[start, headEnd)`, up to the first cluster the paragraph can be
 * broken before (harfbuzz's unsafe-to-break flag), is shaped on its own: the
 * context before the wrap is gone. So is its tail, `[tailStart, end)`, back
 * from the last such cluster, when `reshapeEnd` — a break inside a word;
 * Chrome keeps a line ending at a space as the paragraph shaped it. The body
 * between keeps the paragraph's glyphs. Caveat's `calt` reaches across
 * spaces, so in `Hello World` wrapped before `World` the `Wor` are drawn as
 * they are alone and the `ld` as they are after `Hello`. A line with no safe
 * cluster is shaped whole (`headEnd === end`).
 *
 * `clusters` are the paragraph's, ascending by `cl`.
 */
export function lineReshapeSpans(
  clusters: readonly ShapedCluster[],
  start: number,
  end: number,
  reshapeEnd: boolean,
): { headEnd: number; tailStart: number } {
  const headEnd = clusters.find((c) => c.cl >= start && c.cl < end && c.safe)?.cl ?? end;
  if (!reshapeEnd || headEnd === end || clusters.some((c) => c.cl === end && c.safe)) return { headEnd, tailStart: end };
  let tailStart = headEnd;
  for (const c of clusters) if (c.cl > headEnd && c.cl < end && c.safe) tailStart = c.cl;
  // Nothing safe between the head and the end: the whole line is shaped alone.
  return tailStart === headEnd ? { headEnd: end, tailStart: end } : { headEnd, tailStart };
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

/**
 * A harfbuzz shaper for `bundle`, from its font files' bytes — `fontUrl`'s,
 * then each of `extraFontUrls`'s — or fetched from those URLs when omitted.
 * Passing the bytes lets Node (whose `fetch` can't read `file:` URLs) shape
 * too, as the `tegaki` CLI does.
 */
export async function createHarfbuzzShaper(bundle: TegakiBundle, fonts?: readonly ArrayBuffer[]): Promise<BundleShaper> {
  const urls = [bundle.fontUrl, ...(bundle.extraFontUrls ?? [])];
  const buffers = fonts ?? (await Promise.all(urls.map(async (url) => (await fetch(url)).arrayBuffer())));
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
  // guess from the script (Arabic-Indic digits would otherwise shape RTL),
  // and `script` its guess from the text (a lone bracket has none, and
  // harfbuzz would skip the font's Latin or Arabic substitutions for it).
  // The cluster of each glyph harfbuzz flags unsafe to break before goes
  // into `unsafe`, when given.
  const outlines = new Map<string, string | null>();
  let nextRun = 0;
  const shapeRun = (
    subsetIdx: number,
    runText: string,
    runStart: number,
    features: Feature[],
    direction?: 'ltr' | 'rtl' | null,
    script?: string | null,
    unsafe?: Set<number>,
  ): ShapedGlyph[] => {
    const subset = subsets[subsetIdx]!;
    const buffer = new HbBuffer();
    buffer.addText(runText);
    buffer.guessSegmentProperties();
    if (direction) buffer.setDirection(direction === 'rtl' ? Direction.RTL : Direction.LTR);
    if (script) buffer.setScript(script);
    shape(subset.font, buffer, features);
    const infos = buffer.getGlyphInfosAndPositions();
    const prefix = subsetIdx === 0 ? '' : `${subsetIdx}:`;
    const run = nextRun++;
    if (unsafe) for (const g of infos) if (g.flags & GlyphFlag.UNSAFE_TO_BREAK) unsafe.add(runStart + g.cluster);
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

  // Shape a span of the paragraph as one harfbuzz run per subset,
  // direction and script, as browsers itemize text: a subset switch changes
  // the font, a direction switch (Hebrew then Latin in one word) the buffer
  // direction harfbuzz shapes with — one buffer would reverse the Latin
  // letters with the Hebrew — and a script switch the font's substitutions.
  // `line` has each character's direction and script resolved over the whole
  // line (see `resolvedDirections` / `resolvedScripts`), so a neutral one
  // goes where bidi puts it: `[` in `Hello [مرحبا]` is LTR and Latin, drawn
  // unmirrored with the font's Latin bracket as the browser draws it, not in
  // the Arabic run. Returns glyphs with `cl` already offset to the original
  // text.
  const shapeSegment = (line: LineItems, segText: string, segOffset: number, features: Feature[], unsafe?: Set<number>): ShapedGlyph[] => {
    const out: ShapedGlyph[] = [];
    let runStart = 0;
    let runSubset = -2;
    let runDirection: 'ltr' | 'rtl' | null = null;
    let runScript: string | null = null;
    const flush = (endUtf16: number) => {
      if (endUtf16 === runStart) return;
      const effective = runSubset < 0 ? 0 : runSubset;
      out.push(...shapeRun(effective, segText.slice(runStart, endUtf16), segOffset + runStart, features, runDirection, runScript, unsafe));
    };
    for (let i = 0; i < segText.length; ) {
      const cp = segText.codePointAt(i) ?? segText.charCodeAt(i);
      const step = cp > 0xffff ? 2 : 1;
      // A single-subset bundle shapes uncovered characters with its only font
      // too, so they don't split the run.
      const subset = subsets.length === 1 ? 0 : pickSubset(cp);
      const direction = line.directions[segOffset + i] ?? null;
      const script = line.scripts[segOffset + i] ?? null;
      if (subset !== runSubset || direction !== runDirection || scriptsDiffer(script, runScript)) {
        flush(i);
        runStart = i;
        runSubset = subset;
        runDirection = direction;
        runScript = script;
      }
      i += step;
    }
    flush(segText.length);
    return out;
  };

  return {
    shape(text: string, options?: ShapeOptions): ShapedGlyph[] {
      if (!text) return [];
      nextRun = 0;
      const features = options?.letterSpaced ? spacedFeatures : defaultFeatures;
      const base = options?.direction ?? paragraphDirection(text);
      const line: LineItems = { directions: resolvedDirections(text, base), scripts: resolvedScripts(text, options?.scriptBefore ?? null) };
      // Chrome shapes the paragraph whole — contextual lookups reach across
      // spaces (Caveat's `calt` swaps `World`'s letters after `Hello`), and an
      // Arabic font's GPOS narrows the space between two words — so shape it
      // whole too, then reshape each wrapped line's ends as Chrome's line
      // breaker does (see `lineReshapeSpans`).
      const unsafe = new Set<number>();
      const paragraph = shapeSegment(line, text, 0, features, unsafe);
      const breaks = [...new Set(options?.lineBreaks ?? [])].filter((b) => b > 0 && b < text.length).sort((a, b) => a - b);
      if (breaks.length === 0) return paragraph;
      const clusters = [...new Set(paragraph.map((g) => g.cl))].sort((a, b) => a - b).map((cl) => ({ cl, safe: !unsafe.has(cl) }));
      const bounds = [0, ...breaks, text.length];
      const out: ShapedGlyph[] = [];
      for (let i = 0; i + 1 < bounds.length; i++) {
        const start = bounds[i]!;
        const end = bounds[i + 1]!;
        const reshapeEnd = end < text.length && !isShapingWhitespace(text.charCodeAt(end - 1));
        const { headEnd, tailStart } = lineReshapeSpans(clusters, start, end, reshapeEnd);
        if (headEnd > start) out.push(...shapeSegment(line, text.slice(start, headEnd), start, features));
        for (const g of paragraph) if (g.cl >= headEnd && g.cl < tailStart) out.push(g);
        if (tailStart < end) out.push(...shapeSegment(line, text.slice(tailStart, end), tailStart, features));
      }
      return out;
    },

    glyphPath(g: string): string | null {
      let path = outlines.get(g);
      if (path === undefined) {
        const sep = g.indexOf(':');
        const subset = subsets[sep < 0 ? 0 : Number(g.slice(0, sep))];
        const gid = Number(sep < 0 ? g : g.slice(sep + 1));
        path = subset && Number.isInteger(gid) ? subset.font.glyphToPath(gid) : null;
        outlines.set(g, path);
      }
      return path;
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
  return createHarfbuzzShaper(bundle);
};

export default harfbuzzShaper;
