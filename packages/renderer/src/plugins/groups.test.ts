import { describe, expect, test } from 'bun:test';
import { groupStrokes } from './groups.ts';
import { EM, strokesOf } from './testStrokes.ts';

describe('groupStrokes', () => {
  test('words split where a space leaves a gap', () => {
    const groups = groupStrokes(strokesOf('ab cd e'), 'words', EM);
    expect(groups.map((g) => g.glyphs)).toEqual([[0, 1], [3, 4], [6]]);
  });

  test('lines split on the baseline, and the text is one group across them', () => {
    const strokes = strokesOf('ab\ncd');
    expect(groupStrokes(strokes, 'lines', EM).map((g) => g.line)).toEqual([0, 1]);
    const [text] = groupStrokes(strokes, 'text', EM);
    expect(text!.members).toEqual([0, 1, 2, 3]);
    expect(text!.line).toBe(0);
  });

  test('a word never runs across lines', () => {
    expect(groupStrokes(strokesOf('ab\ncd'), 'words', EM).map((g) => g.glyphs)).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  test('a glyph standing for several characters with no gap after it (a ligature) stays in its word', () => {
    const strokes = strokesOf('abc');
    // "ab" drawn as one glyph: the next glyph is two characters on, right up against it.
    const [lig, , c] = strokes;
    const merged = [lig!, { ...c!, entry: { ...c!.entry, graphemeIndex: 2 }, place: { ...c!.place, x: 50 } }];
    expect(groupStrokes(merged, 'words', EM)).toHaveLength(1);
  });

  test('a group knows its ink, its baseline and the way it runs', () => {
    const [word] = groupStrokes(strokesOf('ab'), 'words', EM);
    expect(word!.baseline).toBe(80);
    expect(word!.ink.minX).toBeCloseTo(2);
    expect(word!.ink.maxX).toBeCloseTo(98);
    expect(word!.rtl).toBe(false);
  });
});
