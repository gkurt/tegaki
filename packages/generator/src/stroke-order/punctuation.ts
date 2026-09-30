// Punctuation stroke-order references, drawn by hand for this project.
//
// A comma is written from its head down to its tail, but the heuristic
// enters a stroke at its left end and a comma's tail curls down to the left
// — so it drew every comma upward. KanjiVG's comma is an outline traced
// round from the tail and back, which says nothing about direction, and the
// Hershey data here carries letters and digits only. These few polylines
// just say which way the pen goes; registration fits them onto the font's
// own mark.

import type { ReferenceGlyph, StrokeOrderProvider } from './types.ts';

export const PUNCTUATION_LICENSE = 'Tegaki punctuation references — MIT, as the rest of this package';

/** The comma's head at the top right, its tail curling down to the lower left (y-down). */
const COMMA: [number, number][] = [
  [6, 0],
  [7, 2],
  [6.6, 4.5],
  [5, 7],
  [2.5, 10],
];

/** Per-character strokes in pen order, and the frame they're drawn in. */
const GLYPHS: Record<string, { strokes: [number, number][][]; viewBox: { width: number; height: number } }> = {
  ',': { strokes: [COMMA], viewBox: { width: 10, height: 10 } },
  // The dot, then the comma under it.
  ';': {
    strokes: [
      [
        [6, -9],
        [6.3, -8.5],
      ],
      COMMA,
    ],
    viewBox: { width: 10, height: 20 },
  },
};

/** Direction references for the comma and semicolon. */
export function createPunctuationProvider(): StrokeOrderProvider {
  const name = 'punctuation';
  return {
    name,
    async get(char: string): Promise<ReferenceGlyph | null> {
      const glyph = GLYPHS[char];
      if (!glyph) return null;
      return {
        char,
        strokes: glyph.strokes.map((s) => ({ points: s.map(([x, y]) => ({ x, y })) })),
        viewBox: glyph.viewBox,
        source: name,
        license: PUNCTUATION_LICENSE,
      };
    },
  };
}
