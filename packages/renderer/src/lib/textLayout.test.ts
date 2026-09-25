import { describe, expect, test } from 'bun:test';
import type { ShapedGlyph } from './shaper.ts';
import { lineWords, midWordBreaks, positionLineGlyphs, type TextLayout } from './textLayout.ts';

/** One glyph per UTF-16 unit, each `ax` units wide, in the order given. */
function glyphs(clusters: number[], ax = 500): ShapedGlyph[] {
  return clusters.map((cl) => ({ g: String(cl + 1), cl, ax, ay: 0, dx: 0, dy: 0 }));
}

/** DOM word anchors, keyed by `"start-end"`. */
function anchors(map: Record<string, number>) {
  return (start: number, end: number) => map[`${start}-${end}`];
}

describe('positionLineGlyphs', () => {
  test("an RTL line puts the logically first word at the right, where the browser's bidi put it", () => {
    // "אב גד": the shaper returns words in logical order, each right to left.
    const shaped = glyphs([1, 0, 4, 3]);
    const { glyphs: placed } = positionLineGlyphs(shaped, 'אב גד', anchors({ '0-2': 1.25, '2-3': 1, '3-5': 0 }), 1000);
    expect(placed.map((p) => [p.glyph.cl, p.xEm])).toEqual([
      [1, 1.25],
      [0, 1.75],
      [4, 0],
      [3, 0.5],
    ]);
  });

  test('a Latin word opening an RTL line keeps its letters in order', () => {
    // "Hi שלום" with dir=auto resolves LTR: "Hi" sits at the left, unreversed.
    const shaped = glyphs([0, 1, 6, 5, 4, 3]);
    const { glyphs: placed } = positionLineGlyphs(shaped, 'Hi שלום', anchors({ '0-2': 0, '3-7': 1.25 }), 1000);
    expect(placed.slice(0, 2).map((p) => [p.glyph.cl, p.xEm])).toEqual([
      [0, 0],
      [1, 0.5],
    ]);
    expect(placed[2]!.xEm).toBe(1.25);
  });

  test('a word the DOM cannot measure continues from the previous one', () => {
    const { glyphs: placed } = positionLineGlyphs(glyphs([0, 1, 2]), 'a b', anchors({ '0-1': 0 }), 1000);
    expect(placed.map((p) => p.xEm)).toEqual([0, 0.5, 1]);
  });

  test('letter spacing goes between the clusters of a word, not before its first', () => {
    const { glyphs: placed } = positionLineGlyphs(glyphs([0, 1, 3, 4]), 'ab cd', anchors({ '0-2': 0, '3-5': 2 }), 1000, 0.1);
    expect(placed.map((p) => p.xEm)).toEqual([0, 0.6, 2, 2.6]);
  });

  test('a .notdef cluster and the glyphs after it are anchored where the DOM put them, not walked by the .notdef advance', () => {
    // "手書a" in a Latin font: two .notdef (the browser draws them 1em wide in
    // a fallback font), then a real glyph — one spaceless word.
    const shaped: ShapedGlyph[] = [
      { g: '0', cl: 0, ax: 300, ay: 0, dx: 0, dy: 0 },
      { g: '0', cl: 1, ax: 300, ay: 0, dx: 0, dy: 0 },
      { g: '5', cl: 2, ax: 500, ay: 0, dx: 0, dy: 0 },
    ];
    const { glyphs: placed, clusterAdvance } = positionLineGlyphs(shaped, '手書a', anchors({ '0-1': 0, '1-2': 1, '2-3': 2 }), 1000);
    expect(placed.map((p) => p.xEm)).toEqual([0, 1, 2]);
    expect([...clusterAdvance]).toEqual([[2, 0.5]]);
  });

  test('a run of real glyphs after a .notdef is anchored as a whole', () => {
    const shaped: ShapedGlyph[] = [{ g: '1:0', cl: 0, ax: 300, ay: 0, dx: 0, dy: 0 }, ...glyphs([1, 2])];
    const { glyphs: placed } = positionLineGlyphs(shaped, '手ab', anchors({ '0-1': 0, '1-3': 1 }), 1000);
    expect(placed.map((p) => p.xEm)).toEqual([0, 1, 1.5]);
  });

  test('a word the shaper split into runs anchors each run where the DOM put it: "מדהיםa" in an RTL line has the a at its left', () => {
    // Hebrew run (visual RTL) then the Latin run, in logical order.
    const shaped = glyphs([4, 3, 2, 1, 0]).map((g) => ({ ...g, run: 0 }));
    shaped.push({ g: '9', cl: 5, ax: 400, ay: 0, dx: 0, dy: 0, run: 1 });
    const { glyphs: placed } = positionLineGlyphs(shaped, 'מדהיםa', anchors({ '0-5': 0.4, '5-6': 0 }), 1000);
    expect(placed.map((p) => [p.glyph.cl, p.xEm])).toEqual([
      [4, 0.4],
      [3, 0.9],
      [2, 1.4],
      [1, 1.9],
      [0, 2.4],
      [5, 0],
    ]);
  });

  test('a GPOS x-offset moves the glyph, not its cluster left edge', () => {
    // Cardo's final mem opening "מדהים" visually carries dx 125/2048 em: the
    // ink shifts, but the DOM (and the clip mask anchored on charOffsets) puts
    // the word where the pen is.
    const shaped: ShapedGlyph[] = [
      { g: '78', cl: 1, ax: 1300, ay: 0, dx: 125, dy: 0 },
      { g: '79', cl: 0, ax: 1300, ay: 0, dx: 0, dy: 0 },
    ];
    const { glyphs: placed, clusterLeft } = positionLineGlyphs(shaped, 'מם', anchors({ '0-2': 0 }), 2048);
    expect(placed[0]!.xEm).toBeCloseTo(125 / 2048);
    expect(clusterLeft.get(1)).toBe(0);
  });

  test('offsets are y-down: a positive harfbuzz dy moves the glyph up', () => {
    const shaped: ShapedGlyph[] = [{ g: '1', cl: 0, ax: 0, ay: 0, dx: 100, dy: 250 }];
    const { glyphs: placed } = positionLineGlyphs(shaped, 'a', anchors({ '0-1': 1 }), 1000);
    expect(placed[0]).toMatchObject({ xEm: 1.1, yEm: -0.25 });
  });
});

describe('lineWords', () => {
  const layout = (offsets: number[], widths: number[], lines: number[][]): TextLayout => ({
    lines,
    charOffsets: offsets,
    charWidths: widths,
  });

  test('anchors each word at its leftmost grapheme, so an RTL word starts from its visual left', () => {
    // "אב גד" right-aligned: the first word is at the right, each written right to left.
    const words = lineWords(layout([1.75, 1.25, 1, 0.5, 0], [0.5, 0.5, 0.25, 0.5, 0.5], [[0, 1, 2, 3, 4]]), ['א', 'ב', ' ', 'ג', 'ד'], 0);
    expect(words).toEqual([
      { text: 'אב', leftEm: 1.25, direction: 'rtl' },
      { text: 'גד', leftEm: 0, direction: 'rtl' },
    ]);
  });

  test('zero-width graphemes join their word without moving its anchor', () => {
    const words = lineWords(layout([0.3, 0, 0.5], [0.5, 0, 0.5], [[0, 1, 2]]), ['a', '\u200d', 'b'], 0);
    expect(words).toEqual([{ text: 'a\u200db', leftEm: 0.3, direction: 'ltr' }]);
  });

  test('a word switching direction splits into pieces anchored apart: "aכתב היד" in an LTR line has כתב at the right end', () => {
    // Visual order: a | היד | כתב — bidi keeps the Hebrew run together, not the word.
    const words = lineWords(
      layout([0, 1.5, 1.25, 1, 0.75, 0.5, 0.25], [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25], [[0, 1, 2, 3, 4, 5, 6]]),
      ['a', 'כ', 'ת', 'ב', ' ', 'ה', 'י'],
      0,
    );
    expect(words).toEqual([
      { text: 'a', leftEm: 0, direction: 'ltr' },
      { text: 'כתב', leftEm: 1, direction: 'rtl' },
      { text: 'הי', leftEm: 0.25, direction: 'rtl' },
    ]);
  });

  test('direction-neutral characters stay with the piece they follow', () => {
    const words = lineWords(layout([0, 0.25, 0.5, 0.75], [0.25, 0.25, 0.25, 0.25], [[0, 1, 2, 3]]), ['a', '.', 'b', 'ש'], 0);
    expect(words).toEqual([
      { text: 'a.b', leftEm: 0, direction: 'ltr' },
      { text: 'ש', leftEm: 0.75, direction: 'rtl' },
    ]);
  });

  test('a lone bracket is drawn in the direction bidi resolves it to, so it mirrors where the strokes do', () => {
    // "( b )" after a Latin word in an RTL paragraph: the pair encloses Latin, so both brackets are LTR.
    const l: TextLayout = {
      ...layout([0, 0, 0.5, 0, 1, 0, 1.5], [0.5, 0, 0.5, 0, 0.5, 0, 0.5], [[0, 1, 2, 3, 4, 5, 6]]),
      direction: 'rtl',
    };
    const words = lineWords(l, ['a', ' ', '(', ' ', 'b', ' ', ')'], 0);
    expect(words.map((w) => w.direction)).toEqual(['ltr', 'ltr', 'ltr', 'ltr']);
    const alone = lineWords({ ...l, lines: [[0, 1]] }, ['(', ' '], 0);
    expect(alone.map((w) => w.direction)).toEqual(['rtl']);
  });

  test('brackets resolved LTR and Latin around an Arabic word are pieces of their own: "Hello [مرحبا]"', () => {
    // The DOM draws the brackets with the font's Latin bracket; inside the
    // Arabic piece the canvas would draw its wider Arabic one.
    const chars = ['H', 'i', ' ', '[', 'م', 'ر', ']'];
    const l = layout([0, 0.5, 0.75, 1, 1.5, 1.25, 1.75], [0.5, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25], [[0, 1, 2, 3, 4, 5, 6]]);
    expect(lineWords(l, chars, 0)).toEqual([
      { text: 'Hi', leftEm: 0, direction: 'ltr' },
      { text: '[', leftEm: 1, direction: 'ltr' },
      { text: 'مر', leftEm: 1.25, direction: 'rtl' },
      { text: ']', leftEm: 1.75, direction: 'ltr' },
    ]);
  });

  test('brackets opening and closing an RTL line stay in its Arabic piece: "(العالم)"', () => {
    const l: TextLayout = { ...layout([0.75, 0.5, 0.25, 0], [0.25, 0.25, 0.25, 0.25], [[0, 1, 2, 3]]), direction: 'rtl' };
    expect(lineWords(l, ['(', 'ع', 'م', ')'], 0)).toEqual([{ text: '(عم)', leftEm: 0, direction: 'rtl' }]);
  });

  test('reads only the requested line and drops its newline', () => {
    const l = layout(
      [0, 0, 0, 0.5],
      [0.5, 0, 0.5, 0.5],
      [
        [0, 1],
        [2, 3],
      ],
    );
    expect(lineWords(l, ['a', '\n', 'b', 'c'], 1)).toEqual([{ text: 'bc', leftEm: 0, direction: 'ltr' }]);
  });
});

describe('midWordBreaks', () => {
  /** A layout of `lines` grapheme indices; offsets and widths don't matter here. */
  const layout = (lines: number[][]): TextLayout => ({ lines, charOffsets: [], charWidths: [] });

  test('a word wrapped inside breaks at the first grapheme of the next line ("Handw" / "riting")', () => {
    const text = 'Handwriting is';
    expect(
      midWordBreaks(
        layout([
          [0, 1, 2, 3, 4],
          [5, 6, 7, 8, 9, 10, 11],
          [12, 13],
        ]),
        text,
      ),
    ).toEqual([5]);
  });

  test('wraps at spaces and newlines are not breaks inside a word', () => {
    expect(
      midWordBreaks(
        layout([
          [0, 1],
          [2, 3],
        ]),
        'a b',
      ),
    ).toEqual([]);
    expect(midWordBreaks(layout([[0, 1], [2]]), 'a\nb')).toEqual([]);
  });

  test('offsets are UTF-16, past graphemes wider than one unit', () => {
    expect(midWordBreaks(layout([[0, 1], [2]]), '👍🏽ab')).toEqual([5]);
  });
});
