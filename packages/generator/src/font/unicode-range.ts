import type * as opentype from 'opentype.js';

/** Every codepoint the font's cmap maps to a real glyph (not `.notdef`). */
export function fontCodepoints(font: opentype.Font): Set<number> {
  const cmap = (font.tables as { cmap?: { glyphIndexMap?: Record<string, number> } }).cmap?.glyphIndexMap ?? {};
  const out = new Set<number>();
  for (const [cp, gid] of Object.entries(cmap)) if (gid !== 0) out.add(Number(cp));
  return out;
}

/** Format codepoints as a CSS `unicode-range` value (`U+28-29, U+600`); empty for none. */
export function toUnicodeRange(codepoints: Iterable<number>): string {
  const sorted = [...new Set(codepoints)].sort((a, b) => a - b);
  const hex = (cp: number) => cp.toString(16).toUpperCase();
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    const start = sorted[i]!;
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i]!;
    parts.push(start === end ? `U+${hex(start)}` : `U+${hex(start)}-${hex(end)}`);
    i++;
  }
  return parts.join(', ');
}

/**
 * For each subset after the first, the codepoints it covers that no earlier
 * subset does — the ones the renderer's shaper routes to it (it picks the
 * first subset whose cmap has the character). One entry per extra subset, so
 * `result[i]` belongs to `sets[i + 1]`; empty when the subset adds nothing.
 */
export function claimedCodepoints(sets: readonly ReadonlySet<number>[]): number[][] {
  const seen = new Set<number>(sets[0]);
  return sets.slice(1).map((set) => {
    const claimed = [...set].filter((cp) => !seen.has(cp));
    for (const cp of claimed) seen.add(cp);
    return claimed;
  });
}

/**
 * CSS `unicode-range` for each extra subset font (`TegakiBundle.extraFontRanges`).
 * Registered under one family with overlapping ranges, the browser would try
 * the last face first — drawing `(` in Arabic text with Fontsource's Arabic
 * subset, which has no `)` to mirror it into, while the shaper draws it from
 * the Latin one. Limiting each face to the characters the shaper gives it
 * makes the DOM text and the clip mask use the same file as the strokes.
 */
export function subsetUnicodeRanges(font: opentype.Font, extraFonts: readonly opentype.Font[]): string[] {
  return claimedCodepoints([font, ...extraFonts].map(fontCodepoints)).map(toUnicodeRange);
}
