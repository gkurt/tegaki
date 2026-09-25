import type { BundleShaper, ShapeOptions } from 'tegaki/core';

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
}

/**
 * Every distinct glyph the renderer's shaper emits for `text`, line by line
 * as the engine lays it out. Collecting from the renderer's own shaper keeps
 * the bundle's `glyphDataById` in step with what gets drawn: it shapes each
 * word in isolation, so contextual alternates (Caveat's calt) differ from a
 * line shaped whole, and any glyph missing here would be drawn with its base
 * letter's strokes under the alternate's clip mask. `options` must match the
 * renderer's (letter-spaced text drops ligatures and contextual alternates).
 */
export function collectShapedGlyphs(shaper: BundleShaper, text: string, options?: ShapeOptions): ShapedGlyphRef[] {
  const out: ShapedGlyphRef[] = [];
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const shaped = shaper.shape(line, options);
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
      const letter = glyphsPerCluster.get(g.cl) === 1 && [...cluster].length === 1 ? cluster : undefined;
      out.push(letter === undefined ? { key: g.g, subsetIdx, gid, char } : { key: g.g, subsetIdx, gid, char, letter });
    }
  }
  return out;
}
