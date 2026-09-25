import { describe, expect, test } from 'bun:test';
import { clusterAt, parseGlyphKey } from './glyph-cluster.ts';

// "office": o, the ffi ligature (one glyph at grapheme 1), c, e.
const office = [
  { graphemeIndex: 0, glyphId: '146' },
  { graphemeIndex: 1, glyphId: '226' },
  { graphemeIndex: 4, glyphId: '121' },
  { graphemeIndex: 5, glyphId: '177' },
];

describe('clusterAt', () => {
  test('a plain letter is its own cluster', () => {
    expect(clusterAt(office, 0, 6)).toEqual({ start: 0, end: 1, glyphIds: ['146'] });
  });

  test("a ligature's later letters belong to the glyph drawn at its first", () => {
    for (const i of [1, 2, 3]) expect(clusterAt(office, i, 6)).toEqual({ start: 1, end: 4, glyphIds: ['226'] });
  });

  test('the last cluster runs to the end of the text', () => {
    expect(
      clusterAt(
        [
          { graphemeIndex: 0, glyphId: '1' },
          { graphemeIndex: 1, glyphId: '9' },
        ],
        2,
        3,
      ),
    ).toEqual({
      start: 1,
      end: 3,
      glyphIds: ['9'],
    });
  });

  test('a cluster drawn with several glyphs lists them all', () => {
    const entries = [
      { graphemeIndex: 0, glyphId: '5' },
      { graphemeIndex: 0, glyphId: '6' },
    ];
    expect(clusterAt(entries, 0, 1)?.glyphIds).toEqual(['5', '6']);
  });

  test('nothing drawn yet is null', () => {
    expect(clusterAt([], 0, 3)).toBeNull();
  });
});

describe('parseGlyphKey', () => {
  test('reads the primary and extra-subset forms', () => {
    expect(parseGlyphKey('226')).toEqual({ subset: 0, gid: 226 });
    expect(parseGlyphKey('1:1553')).toEqual({ subset: 1, gid: 1553 });
    expect(parseGlyphKey('a.ss01')).toBeNull();
  });
});
