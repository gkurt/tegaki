import type { BundleShaper } from 'tegaki/core';

/** A glyph the renderer's shaper draws, with what the pipeline needs to build its strokes. */
export interface ShapedGlyphRef {
  /** The `glyphDataById` key: `"<gid>"` in the primary subset, `"<subsetIdx>:<gid>"` in an extra one. */
  key: string;
  subsetIdx: number;
  gid: number;
  /** First character of the glyph's cluster (drives RTL detection). */
  char: string;
}

/**
 * Every distinct glyph the renderer's shaper emits for `text`, line by line
 * as the engine lays it out. Collecting from the renderer's own shaper keeps
 * the bundle's `glyphDataById` in step with what gets drawn: it shapes each
 * word in isolation, so contextual alternates (Caveat's calt) differ from a
 * line shaped whole, and any glyph missing here would be drawn with its base
 * letter's strokes under the alternate's clip mask.
 */
export function collectShapedGlyphs(shaper: BundleShaper, text: string): ShapedGlyphRef[] {
  const out: ShapedGlyphRef[] = [];
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    for (const g of shaper.shape(line)) {
      if (seen.has(g.g)) continue;
      const sep = g.g.indexOf(':');
      const subsetIdx = sep < 0 ? 0 : Number(g.g.slice(0, sep));
      const gid = Number(sep < 0 ? g.g : g.g.slice(sep + 1));
      const char = line[g.cl];
      if (gid === 0 || !char) continue;
      seen.add(g.g);
      out.push({ key: g.g, subsetIdx, gid, char });
    }
  }
  return out;
}
