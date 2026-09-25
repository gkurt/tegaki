import { type BundleShaper, paragraphDirection, type ShapeOptions } from 'tegaki/core';

/** A glyph the renderer's shaper draws, with what the pipeline needs to build its strokes. */
export interface ShapedGlyphRef {
  /** The `glyphDataById` key: `"<gid>"` in the primary subset, `"<subsetIdx>:<gid>"` in an extra one. */
  key: string;
  subsetIdx: number;
  gid: number;
  /** First character of the glyph's cluster (drives RTL detection). */
  char: string;
  /**
   * The one character the glyph draws — set when it is the only glyph of a
   * one-character cluster (the letter's nominal glyph or a contextual form),
   * not for ligatures or decompositions. Stroke-order references are looked
   * up by it, as for the char-keyed glyph.
   */
  letter?: string;
  /** The letters the glyph draws when it is the only glyph of a longer cluster — a ligature. */
  ligature?: string;
}

/**
 * Every distinct glyph the renderer's shaper emits for `text`, paragraph by
 * paragraph as the engine lays it out. Collecting from the renderer's own
 * shaper keeps the bundle's `glyphDataById` in step with what gets drawn:
 * contextual alternates (Caveat's calt) depend on the letters before, across
 * spaces too, and any glyph missing here would be drawn with its base letter's
 * strokes under the alternate's clip mask. A wrap drops the context before it,
 * so each word is also shaped as a line of its own — the forms it takes where
 * the text wraps before it. `options` must match the renderer's (letter-spaced
 * text drops ligatures and contextual alternates). Each paragraph is shaped in
 * the whole text's `dir="auto"` direction, as the engine does, unless
 * `options.direction` names one.
 */
export function collectShapedGlyphs(shaper: BundleShaper, text: string, options?: ShapeOptions): ShapedGlyphRef[] {
  const out: ShapedGlyphRef[] = [];
  const seen = new Set<string>();
  const shapeOptions: ShapeOptions = { ...options, direction: options?.direction ?? paragraphDirection(text) };
  const paragraphs = text.split('\n');
  const words = paragraphs.flatMap((p) => p.split(/\s+/u)).filter(Boolean);
  for (const line of [...paragraphs, ...words]) {
    const shaped = shaper.shape(line, shapeOptions);
    const starts = [...new Set(shaped.map((g) => g.cl))].sort((a, b) => a - b);
    const glyphsPerCluster = new Map<number, number>();
    for (const g of shaped) glyphsPerCluster.set(g.cl, (glyphsPerCluster.get(g.cl) ?? 0) + 1);
    for (const g of shaped) {
      if (seen.has(g.g)) continue;
      const sep = g.g.indexOf(':');
      const subsetIdx = sep < 0 ? 0 : Number(g.g.slice(0, sep));
      const gid = Number(sep < 0 ? g.g : g.g.slice(sep + 1));
      const char = line[g.cl];
      if (gid === 0 || !char) continue;
      seen.add(g.g);
      const cluster = line.slice(g.cl, starts.find((c) => c > g.cl) ?? line.length);
      const alone = glyphsPerCluster.get(g.cl) === 1;
      const length = [...cluster].length;
      out.push({
        key: g.g,
        subsetIdx,
        gid,
        char,
        ...(alone && length === 1 ? { letter: cluster } : {}),
        ...(alone && length > 1 ? { ligature: cluster } : {}),
      });
    }
  }
  return out;
}
