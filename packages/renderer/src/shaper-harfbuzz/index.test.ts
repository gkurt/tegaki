import { describe, expect, test } from 'bun:test';
import type { ShapeOptions } from '../lib/shaper.ts';
import type { TegakiBundle } from '../types.ts';
import harfbuzzShaper, { isShapingWhitespace, splitForShaping, strongDirection, toHbFeatureString } from './index.ts';

describe('toHbFeatureString', () => {
  test('returns empty string for empty list', () => {
    expect(toHbFeatureString([])).toBe('');
  });

  test('joins enabled features with commas', () => {
    expect(toHbFeatureString(['calt', 'liga'])).toBe('calt,liga');
  });

  test('drops shaper-managed features so HB keeps its contextual positional assignment', () => {
    // init/medi/fina/isol/rlig must not appear as explicit enables — passing
    // them flat-on collapses every Arabic glyph to one positional variant.
    expect(toHbFeatureString(['calt', 'init', 'medi', 'fina', 'isol', 'rlig', 'liga'])).toBe('calt,liga');
  });

  test('drops the fraction features, which the shaper applies around a fraction slash itself', () => {
    expect(toHbFeatureString(['pnum', 'frac', 'numr', 'dnom', 'liga'])).toBe('pnum,liga');
  });

  test('preserves order of input tags', () => {
    expect(toHbFeatureString(['liga', 'calt', 'smcp'])).toBe('liga,calt,smcp');
  });
});

describe('isShapingWhitespace', () => {
  test('true for ASCII whitespace', () => {
    for (const ch of [' ', '\t', '\n', '\r', '\f', '\v']) {
      expect(isShapingWhitespace(ch.charCodeAt(0))).toBe(true);
    }
  });

  test('true for the Unicode space block (U+2000–U+200A)', () => {
    for (let cp = 0x2000; cp <= 0x200a; cp++) {
      expect(isShapingWhitespace(cp)).toBe(true);
    }
  });

  test('true for NBSP, narrow NBSP, ideographic space, line/paragraph separators', () => {
    for (const cp of [0xa0, 0x202f, 0x205f, 0x3000, 0x2028, 0x2029]) {
      expect(isShapingWhitespace(cp)).toBe(true);
    }
  });

  test('false for letters, digits, and punctuation', () => {
    for (const ch of ['a', 'A', 's', '0', '9', ',', '.', '-', '!', '?']) {
      expect(isShapingWhitespace(ch.charCodeAt(0))).toBe(false);
    }
  });

  test('false for the zero-width-space family', () => {
    // ZWSP / ZWNJ / ZWJ are joiner control characters, not shaping breaks —
    // splitting at them would corrupt e.g. Arabic ligature suppression.
    for (const cp of [0x200b, 0x200c, 0x200d, 0xfeff]) {
      expect(isShapingWhitespace(cp)).toBe(false);
    }
  });
});

describe('splitForShaping', () => {
  test('empty string yields no segments', () => {
    expect(splitForShaping('')).toEqual([]);
  });

  test('single word produces one non-whitespace segment', () => {
    expect(splitForShaping('hello')).toEqual([{ text: 'hello', offset: 0, isWhitespace: false }]);
  });

  test('leading and trailing spaces produce dedicated whitespace segments', () => {
    expect(splitForShaping('  hi  ')).toEqual([
      { text: '  ', offset: 0, isWhitespace: true },
      { text: 'hi', offset: 2, isWhitespace: false },
      { text: '  ', offset: 4, isWhitespace: true },
    ]);
  });

  test('"s s" splits into word, space, word — preventing calt across the gap', () => {
    // The regression: before the split, harfbuzz shaped "s s" as one buffer
    // and Caveat's calt fired across the space, picking a variant for the
    // second s that the browser-rendered overlay never produced.
    expect(splitForShaping('s s')).toEqual([
      { text: 's', offset: 0, isWhitespace: false },
      { text: ' ', offset: 1, isWhitespace: true },
      { text: 's', offset: 2, isWhitespace: false },
    ]);
  });

  test('"ss" stays in one non-whitespace segment so within-word calt still fires', () => {
    expect(splitForShaping('ss')).toEqual([{ text: 'ss', offset: 0, isWhitespace: false }]);
  });

  test('multi-word sentence splits at every space', () => {
    expect(splitForShaping('Handwriting is awesome')).toEqual([
      { text: 'Handwriting', offset: 0, isWhitespace: false },
      { text: ' ', offset: 11, isWhitespace: true },
      { text: 'is', offset: 12, isWhitespace: false },
      { text: ' ', offset: 14, isWhitespace: true },
      { text: 'awesome', offset: 15, isWhitespace: false },
    ]);
  });

  test('runs of multiple spaces stay together as one whitespace segment', () => {
    expect(splitForShaping('a   b')).toEqual([
      { text: 'a', offset: 0, isWhitespace: false },
      { text: '   ', offset: 1, isWhitespace: true },
      { text: 'b', offset: 4, isWhitespace: false },
    ]);
  });

  test('mixed whitespace kinds (tab + space) collapse into one whitespace segment', () => {
    expect(splitForShaping('a\t b')).toEqual([
      { text: 'a', offset: 0, isWhitespace: false },
      { text: '\t ', offset: 1, isWhitespace: true },
      { text: 'b', offset: 3, isWhitespace: false },
    ]);
  });

  test('all-whitespace input yields a single whitespace segment', () => {
    expect(splitForShaping('   ')).toEqual([{ text: '   ', offset: 0, isWhitespace: true }]);
  });

  test('NBSP is treated as a shaping break', () => {
    expect(splitForShaping('a b')).toEqual([
      { text: 'a', offset: 0, isWhitespace: false },
      { text: ' ', offset: 1, isWhitespace: true },
      { text: 'b', offset: 2, isWhitespace: false },
    ]);
  });

  test('ZWJ stays inside the non-whitespace segment so joiner-driven shaping is preserved', () => {
    // ZWJ (U+200D) is a control character used to force joining; splitting
    // around it would corrupt Arabic / emoji sequence shaping.
    expect(splitForShaping('a‍b')).toEqual([{ text: 'a‍b', offset: 0, isWhitespace: false }]);
  });

  test('offsets sum to original text length (round-trip)', () => {
    const cases = ['', 'a', '   ', 'a b c', '  a  b  ', '\ta\nb\rc'];
    for (const text of cases) {
      const segs = splitForShaping(text);
      const reconstructed = segs.map((s) => s.text).join('');
      expect(reconstructed).toBe(text);
      // Each segment's offset is the sum of preceding lengths.
      let cursor = 0;
      for (const s of segs) {
        expect(s.offset).toBe(cursor);
        cursor += s.text.length;
      }
    }
  });
});

describe('letter-spaced shaping', () => {
  const caveatUrl = new URL('../../fonts/caveat/caveat.ttf', import.meta.url).href;
  const caveat = () => harfbuzzShaper({ fontUrl: caveatUrl, features: ['calt', 'liga'], glyphDataById: {} } as unknown as TegakiBundle)!;
  const ids = (glyphs: { g: string }[]) => glyphs.map((g) => g.g);

  test("Caveat's calt picks alternates in an unspaced word", async () => {
    const shaper = await caveat();
    const alone = [...'World'].flatMap((ch) => ids(shaper.shape(ch)));
    expect(ids(shaper.shape('World'))).not.toEqual(alone);
  });

  test('spaced text drops contextual alternates and ligatures, as browsers do: each letter is drawn as it is alone', async () => {
    const shaper = await caveat();
    for (const word of ['World', 'Hello', 'office']) {
      const alone = [...word].flatMap((ch) => ids(shaper.shape(ch)));
      expect(ids(shaper.shape(word, { letterSpaced: true } satisfies ShapeOptions))).toEqual(alone);
    }
  });
});

describe('strongDirection', () => {
  const dir = (ch: string) => strongDirection(ch.codePointAt(0)!);

  test('Hebrew and Arabic letters are RTL, Latin and CJK letters LTR', () => {
    expect(['ש', 'ب'].map(dir)).toEqual(['rtl', 'rtl']);
    expect(['a', 'Ж', '手'].map(dir)).toEqual(['ltr', 'ltr', 'ltr']);
  });

  test('digits are LTR even in an RTL script — bidi lays ١٢ out left to right', () => {
    expect(['1', '١'].map(dir)).toEqual(['ltr', 'ltr']);
  });

  test('punctuation, combining marks and the Arabic tatweel take their neighbours’ direction', () => {
    expect(['.', '(', '\u0301', '\u0640'].map(dir)).toEqual([null, null, null, null]);
  });
});

describe('mixed-direction words', () => {
  // Suez One carries Hebrew and Latin in one file, so a subset switch can't
  // separate them — the direction switch has to.
  const suezUrl = new URL('../../fonts/suez-one/suez-one.ttf', import.meta.url).href;
  const suez = () => harfbuzzShaper({ fontUrl: suezUrl, features: [], glyphDataById: {} } as unknown as TegakiBundle)!;

  test('"שלוםab" shapes as two runs: the Hebrew right to left, the Latin left to right', async () => {
    const shaped = (await suez()).shape('שלוםab');
    expect(shaped.map((g) => [g.cl, g.run])).toEqual([
      [3, 0],
      [2, 0],
      [1, 0],
      [0, 0],
      [4, 1],
      [5, 1],
    ]);
  });
});
