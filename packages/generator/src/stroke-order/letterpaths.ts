// Letterpaths stroke-order providers: Latin letters as handwriting is taught.
//
// Hershey's faces are plotter paths — its Simplex a draws the stem before
// the bowl, its Script is formal copperplate. Letterpaths
// (https://github.com/RobinL/letterpaths, MIT) models how a hand forms each
// letter: `letterpaths-print` (print letters, a's bowl then its stem in one
// motion) and `letterpaths-cursive` (lowercase with its joins, entering from
// the baseline or, after an o, v or w, from the top — two variants that each
// compete against the font's ink). Like every provider, consultation-only.

import { LETTERPATHS_CURSIVE_HIGH, LETTERPATHS_CURSIVE_LOW, LETTERPATHS_PRINT } from './letterpaths-data.ts';
import type { ReferenceGlyph, StrokeOrderProvider } from './types.ts';

export const LETTERPATHS_LICENSE = 'Letterpaths © 2026 Robin Linacre, MIT (https://github.com/RobinL/letterpaths)';

/** The letterpaths frame: about 1000 units, y-down (only its size matters to registration). */
const LETTERPATHS_VIEWBOX = { width: 1000, height: 1000 };

/** A glyph's strokes from its encoded form: strokes joined by '|', 'x,y' points by spaces. */
export function decodeLetterpaths(encoded: string): { x: number; y: number }[][] {
  return encoded.split('|').map((stroke) =>
    stroke.split(' ').map((point) => {
      const [x, y] = point.split(',').map(Number);
      return { x: x!, y: y! };
    }),
  );
}

function createProvider(name: string, glyphs: Record<string, string>): StrokeOrderProvider {
  const cache = new Map<string, ReferenceGlyph | null>();
  return {
    name,
    async get(char: string): Promise<ReferenceGlyph | null> {
      let entry = cache.get(char);
      if (entry === undefined) {
        const encoded = Object.hasOwn(glyphs, char) ? glyphs[char] : undefined;
        entry = encoded
          ? {
              char,
              strokes: decodeLetterpaths(encoded).map((points) => ({ points })),
              viewBox: LETTERPATHS_VIEWBOX,
              source: name,
              license: LETTERPATHS_LICENSE,
            }
          : null;
        cache.set(char, entry);
      }
      return entry;
    },
  };
}

/** Print Latin letters as taught. */
export function createLetterpathsPrintProvider(): StrokeOrderProvider {
  return createProvider('letterpaths-print', LETTERPATHS_PRINT);
}

/** Cursive lowercase entering from the baseline — the usual join. */
export function createLetterpathsCursiveProvider(): StrokeOrderProvider {
  return createProvider('letterpaths-cursive', LETTERPATHS_CURSIVE_LOW);
}

/** Cursive lowercase entering from the top, as after an o, v or w. */
export function createLetterpathsCursiveHighProvider(): StrokeOrderProvider {
  return createProvider('letterpaths-cursive-high', LETTERPATHS_CURSIVE_HIGH);
}
