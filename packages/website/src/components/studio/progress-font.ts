import { zipSync } from 'fflate';
import type { TegakiBundle, TegakiGlyphData } from 'tegaki';
import type { TimelineEntry } from 'tegaki/core';
import { glyphLocalTime, LETTER_SPACED_OFF_FEATURES, toCssFeatureSettings, UNSHAPED_OFF_FEATURES } from 'tegaki/internal';
import { buildProgressFont, type ParsedFontInfo, type ProgressFont, progressAt, readSourceFont } from 'tegaki-generator';

/** One file of the self-writing font: a subset of the bundle's font, remade. */
export interface ProgressFontFile {
  font: ProgressFont;
  /** The subset's bundle index: 0 the primary font, `i` its `extraFontUrls[i - 1]`. */
  subset: number;
  /** Where the browser draws from it — an extra subset only, as the bundle's `extraFontRanges` has it. */
  unicodeRange?: string;
}

/**
 * The self-writing variable font for the glyphs `bundle` has — the renderer's
 * bundle, so the characters of the text and the variants it shapes them into
 * — with the stroke easing baked in: one file per font file of the bundle
 * (`sources`, read back from `fontUrl` and `extraFontUrls`), each keeping its
 * glyph ids and layout tables, so the browser shapes the text as the renderer
 * does. A character belongs to the first file that maps it, as the renderer's
 * shaper picks. An unreadable source leaves its characters to the primary
 * file, unshaped.
 */
export function studioProgressFonts(
  bundle: TegakiBundle,
  fontInfo: ParsedFontInfo | null,
  strokeEasing: ((t: number) => number) | undefined,
  sources: readonly (ArrayBuffer | undefined)[],
  family = `${bundle.family} Progress`,
): ProgressFontFile[] {
  const readable = sources.map((s) => {
    if (!s) return null;
    try {
      return { bytes: s, cmap: readSourceFont(s).cmap };
    } catch {
      return null;
    }
  });
  const ownerOf = (char: string) =>
    Math.max(
      0,
      readable.findIndex((r) => r?.cmap.has(char.codePointAt(0)!)),
    );
  const space = fontInfo?.font.charToGlyph(' ');

  const files: ProgressFontFile[] = [];
  for (let subset = 0; subset < Math.max(1, sources.length); subset++) {
    const glyphData = Object.fromEntries(Object.entries(bundle.glyphData).filter(([char]) => ownerOf(char) === subset));
    const byId: Record<string, TegakiGlyphData> = {};
    for (const [key, glyph] of Object.entries(bundle.glyphDataById ?? {})) {
      const m = /^(?:(\d+):)?(\d+)$/.exec(key);
      if (m && Number(m[1] ?? 0) === subset) byId[m[2]!] = glyph;
    }
    if (subset > 0 && (!readable[subset] || Object.keys(glyphData).length + Object.keys(byId).length === 0)) continue;
    const input = {
      family,
      unitsPerEm: bundle.unitsPerEm,
      ascender: bundle.ascender,
      descender: bundle.descender,
      glyphData,
      glyphDataById: byId,
      lineCap: bundle.lineCap,
      spaceAdvance: space?.advanceWidth || undefined,
      strokeEasing,
    };
    const source = readable[subset]?.bytes;
    let font: ProgressFont;
    try {
      font = buildProgressFont(source ? { ...input, source } : input);
    } catch (err) {
      if (!source) throw err;
      // The builder can't take this source after all: its characters, unshaped.
      font = buildProgressFont(input);
    }
    const unicodeRange = subset > 0 ? bundle.extraFontRanges?.[subset - 1] : undefined;
    files.push({ font, subset, ...(unicodeRange ? { unicodeRange } : {}) });
  }
  // A file with nothing to draw (the Latin one for Arabic text) is left out, unless it's the only one.
  const drawing = files.filter((f) => f.font.glyphs > 0);
  return drawing.length > 0 ? drawing : files.slice(0, 1);
}

/** {@link studioProgressFonts} from the bundle's own font files, fetched from its URLs. */
export async function loadStudioProgressFonts(
  bundle: TegakiBundle,
  fontInfo: ParsedFontInfo | null,
  strokeEasing: ((t: number) => number) | undefined,
): Promise<ProgressFontFile[]> {
  const sources = await Promise.all(
    [bundle.fontUrl, ...(bundle.extraFontUrls ?? [])].map((url) =>
      fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : undefined))
        .catch(() => undefined),
    ),
  );
  return studioProgressFonts(bundle, fontInfo, strokeEasing, sources);
}

const slug = (family: string) => family.toLowerCase().replace(/\s+/g, '-');

/** A file's name: `<family>-progress.ttf`, and `-1`, `-2`, … for the extra subsets. */
export function progressFontFileName(bundle: Pick<TegakiBundle, 'family'>, subset = 0): string {
  return `${slug(bundle.family)}-progress${subset > 0 ? `-${subset}` : ''}.ttf`;
}

/**
 * What Download gives: the font, or — split into subsets — a .zip of its
 * files and a stylesheet registering them under one family, each extra one
 * limited to its `unicode-range`.
 */
export function progressFontDownload(
  bundle: Pick<TegakiBundle, 'family'>,
  files: readonly ProgressFontFile[],
): { blob: Blob; name: string } {
  if (files.length === 1) return { blob: new Blob([files[0]!.font.buffer], { type: 'font/ttf' }), name: progressFontFileName(bundle) };
  const family = `${bundle.family} Progress`;
  const css = files
    .map((f) => {
      const range = f.unicodeRange ? `\n  unicode-range: ${f.unicodeRange};` : '';
      return `@font-face {\n  font-family: '${family}';\n  src: url('./${progressFontFileName(bundle, f.subset)}') format('truetype');${range}\n}\n`;
    })
    .join('\n');
  const zip = zipSync({
    ...Object.fromEntries(files.map((f) => [progressFontFileName(bundle, f.subset), f.font.buffer])),
    'progress.css': new TextEncoder().encode(css),
  });
  return { blob: new Blob([zip], { type: 'application/zip' }), name: `${slug(bundle.family)}-progress.zip` };
}

/** Graphemes `[start, end)` of the text drawn as one span, and its `PROG` value. */
export interface ProgressSpan {
  start: number;
  end: number;
  progress: number;
}

/** The glyph the renderer draws for an entry, looked up as the engine does. */
function entryGlyph(entry: TimelineEntry, bundle: Pick<TegakiBundle, 'glyphData' | 'glyphDataById'>): TegakiGlyphData | undefined {
  return (entry.glyphId !== undefined ? bundle.glyphDataById?.[entry.glyphId] : undefined) ?? bundle.glyphData[entry.char];
}

/**
 * The text as spans, one per shaping cluster, each with the `PROG` value of
 * its glyphs at timeline time `time` (null: written). A span's font setting
 * splits shaping at its edges, so a ligature, a letter with its marks, or an
 * Indic cluster has to be one span. The timeline has an entry per glyph at
 * the grapheme its cluster starts on: a cluster runs to the next grapheme
 * with entries (a ligature's later letters have none). One glyph goes through
 * its own drawing as the renderer times it; several write together, over the
 * cluster's time. Clusters with nothing drawn are written (100).
 */
export function progressSpans(
  entries: readonly TimelineEntry[],
  graphemeCount: number,
  bundle: Pick<TegakiBundle, 'glyphData' | 'glyphDataById'>,
  time: number | null,
  glyphEasing?: (t: number) => number,
): ProgressSpan[] {
  const byStart = new Map<number, TimelineEntry[]>();
  for (const entry of entries) {
    if (entry.graphemeIndex >= graphemeCount) continue;
    const list = byStart.get(entry.graphemeIndex);
    if (list) list.push(entry);
    else byStart.set(entry.graphemeIndex, [entry]);
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  if (graphemeCount > 0 && starts[0] !== 0) starts.unshift(0);

  return starts.map((start, i) => {
    const end = starts[i + 1] ?? graphemeCount;
    if (time === null) return { start, end, progress: 100 };
    const drawn = (byStart.get(start) ?? []).filter((e) => e.hasGlyph && entryGlyph(e, bundle));
    if (drawn.length === 0) return { start, end, progress: 100 };
    const from = Math.min(...drawn.map((e) => e.offset));
    const to = Math.max(...drawn.map((e) => e.offset + e.duration));
    if (time < from) return { start, end, progress: 0 };
    if (time >= to) return { start, end, progress: 100 };
    if (drawn.length > 1) return { start, end, progress: ((time - from) / (to - from)) * 100 };
    const entry = drawn[0]!;
    // The slot's seconds are the glyph's, scaled by stagger's fixed duration.
    const local = glyphLocalTime(time, entry.offset, entry.duration, glyphEasing) / (entry.strokeTimeScale ?? 1);
    return { start, end, progress: progressAt(entryGlyph(entry, bundle)!, local) };
  });
}

/**
 * The `font-feature-settings` that makes the browser pick the glyphs the
 * renderer drew: the bundle's features as its font face has them, and what
 * its text overlay switches off — everything but the nominal glyphs when the
 * shaper is off, the features browsers drop between spaced letters otherwise.
 */
export function progressFeatureSettings(features: readonly string[] | undefined, shaped: boolean, letterSpaced: boolean): string {
  const off = (tags: readonly string[]) => tags.map((tag) => `'${tag}' 0`).join(', ');
  const parts = [toCssFeatureSettings(features ?? [])].filter((s) => s !== 'normal');
  if (!shaped) parts.push(off(UNSHAPED_OFF_FEATURES));
  else if (letterSpaced) parts.push(off(LETTER_SPACED_OFF_FEATURES));
  return parts.join(', ') || 'normal';
}
