import type { TegakiBundle } from 'tegaki';
import { glyphLocalTime, type TimelineEntry } from 'tegaki/core';
import { buildProgressFont, type ParsedFontInfo, type ProgressFont, progressAt } from 'tegaki-generator';

/**
 * The self-writing variable font for the glyphs `bundle` has — the renderer's
 * bundle, so the characters of the text — with the stroke easing baked in.
 */
export function studioProgressFont(
  bundle: TegakiBundle,
  fontInfo: ParsedFontInfo | null,
  strokeEasing: ((t: number) => number) | undefined,
  family = `${bundle.family} Progress`,
): ProgressFont {
  const space = fontInfo?.font.charToGlyph(' ');
  return buildProgressFont({
    family,
    unitsPerEm: bundle.unitsPerEm,
    ascender: bundle.ascender,
    descender: bundle.descender,
    glyphData: bundle.glyphData,
    lineCap: bundle.lineCap,
    spaceAdvance: space?.advanceWidth || undefined,
    strokeEasing,
  });
}

/**
 * The `PROG` value of each grapheme of the text at timeline time `time`: how
 * far into its own drawing the renderer's timeline has its glyph, as the font
 * measures it. Graphemes the timeline has no glyph for are drawn whole (100).
 */
export function graphemeProgress(
  entries: readonly TimelineEntry[],
  graphemeCount: number,
  glyphData: TegakiBundle['glyphData'],
  time: number,
  glyphEasing?: (t: number) => number,
): number[] {
  const out = new Array<number>(graphemeCount).fill(100);
  const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.graphemeIndex) || entry.graphemeIndex >= graphemeCount) continue;
    seen.add(entry.graphemeIndex);
    const glyph = glyphData[entry.char];
    if (!entry.hasGlyph || !glyph) continue;
    if (time < entry.offset) {
      out[entry.graphemeIndex] = 0;
      continue;
    }
    // The slot's seconds are the glyph's, scaled by stagger's fixed duration.
    const local = glyphLocalTime(time, entry.offset, entry.duration, glyphEasing) / (entry.strokeTimeScale ?? 1);
    out[entry.graphemeIndex] = entry.duration > 0 && time >= entry.offset + entry.duration ? 100 : progressAt(glyph, local);
  }
  return out;
}
