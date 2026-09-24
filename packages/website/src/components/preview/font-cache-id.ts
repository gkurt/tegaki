import type { ParsedFontInfo } from 'tegaki-generator';

const ids = new WeakMap<ParsedFontInfo, number>();
let next = 1;

/**
 * A stable id for one parsed font, to scope pipeline caches. Clearing a
 * cache on font load isn't enough: async work started for the old font
 * (reference fetches, the shaper, per-glyph yields) can still write into
 * it afterwards, and a key without the font then hands the old font's
 * strokes to the new one.
 */
export function fontCacheId(fontInfo: ParsedFontInfo): number {
  let id = ids.get(fontInfo);
  if (id === undefined) {
    id = next++;
    ids.set(fontInfo, id);
  }
  return id;
}
