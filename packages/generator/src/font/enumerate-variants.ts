import type { HbShaper } from './hb-shaper.ts';

export interface VariantGlyph {
  /** OpenType glyph id of the variant. */
  gid: number;
  /** First cluster char observed producing this variant — used for RTL detection. */
  clusterChar: string;
}

/**
 * Discover every glyph id reachable by shaping n-grams of the input character
 * set, including nominal forms. We collect *every* glyph the shaper emits
 * (skipping only `.notdef` = id 0) so the resulting bundle's `glyphDataById`
 * is self-contained for any cluster that fits inside the n-gram window:
 * the renderer never has to fall back through `glyphData[char]` to find the
 * stroke data for a shaped glyph. That fallback is brittle for complex-script
 * clusters where `entry.char` is a multi-codepoint grapheme (Devanagari
 * `"हि"`, `"स्ते"`) and `glyphData` is keyed per single codepoint — the
 * cluster's first codepoint may not be the codepoint a nominal glyph
 * represents (e.g. HB reorders the i-matra in `हि` so both the i-matra and
 * the bare `ह` land at cluster offset 0).
 *
 * For singletons we shape each char in isolation so a font's "default" form
 * for that codepoint always lands in the bundle even when the char never
 * appears in any bigram/trigram cluster (which can happen for scripts where
 * the nominal glyph is only reachable via shaping, e.g. HB picks a different
 * glyph than `cmap.charToGlyph` returns).
 *
 * The first cluster char observed producing each variant is returned so
 * downstream code can infer script direction (RTL for Arabic/Hebrew clusters)
 * when processing variants that lack their own unicode mapping.
 */
export function enumerateVariantGlyphIds(shaper: HbShaper, chars: readonly string[]): Map<number, VariantGlyph> {
  const variants = new Map<number, VariantGlyph>();

  const collectFrom = (seq: string) => {
    const shaped = shaper.shape(seq);
    for (const g of shaped) {
      if (g.g === 0) continue;
      const clusterChar = seq[g.cl];
      if (clusterChar == null) continue;
      if (!variants.has(g.g)) variants.set(g.g, { gid: g.g, clusterChar });
    }
  };

  // Singletons — guarantees the bundle has stroke data for the default form
  // of every input char, even when no bigram/trigram cluster surfaces it.
  for (const a of chars) collectFrom(a);

  // Bigrams
  for (const a of chars) for (const b of chars) collectFrom(a + b);

  // Trigrams — the last N-gram size we sweep exhaustively. Most real-world
  // ligatures fit within 3 codepoints; rare 4+ ligatures would require a
  // smarter BFS walk that prunes based on intermediate shaping output.
  for (const a of chars) for (const b of chars) for (const c of chars) collectFrom(a + b + c);

  return variants;
}
