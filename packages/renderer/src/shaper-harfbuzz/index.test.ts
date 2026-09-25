import { describe, expect, test } from 'bun:test';
import type { ShapedGlyph, ShapeOptions } from '../lib/shaper.ts';
import type { TegakiBundle } from '../types.ts';
import harfbuzzShaper, { isShapingWhitespace, lineReshapeSpans, toHbFeatureString } from './index.ts';

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
    // ZWSP / ZWNJ / ZWJ are joiner control characters, not word separators.
    for (const cp of [0x200b, 0x200c, 0x200d, 0xfeff]) {
      expect(isShapingWhitespace(cp)).toBe(false);
    }
  });
});

describe('lineReshapeSpans', () => {
  /** Clusters one UTF-16 unit each over `[0, length)`, safe to break before unless listed. */
  const clusters = (length: number, unsafe: number[] = []) => Array.from({ length }, (_, cl) => ({ cl, safe: !unsafe.includes(cl) }));

  test('a line starting at a safe cluster keeps every glyph the paragraph shaped', () => {
    expect(lineReshapeSpans(clusters(10), 6, 10, false)).toEqual({ headEnd: 6, tailStart: 10 });
  });

  test('a line starting at an unsafe cluster reshapes its head up to the first safe one ("Wor" of a wrapped "World")', () => {
    expect(lineReshapeSpans(clusters(11, [6, 7, 8]), 6, 11, false)).toEqual({ headEnd: 9, tailStart: 11 });
  });

  test('a line ending at a space keeps its end as the paragraph shaped it', () => {
    expect(lineReshapeSpans(clusters(10, [6, 7]), 0, 6, false)).toEqual({ headEnd: 0, tailStart: 6 });
  });

  test('a line broken inside a word reshapes its tail back from the last safe cluster', () => {
    expect(lineReshapeSpans(clusters(10, [4, 5, 6]), 0, 5, true)).toEqual({ headEnd: 0, tailStart: 3 });
  });

  test('a break inside a cluster (a ligature split by the wrap) is never safe', () => {
    const lig = [
      { cl: 0, safe: true },
      { cl: 1, safe: true },
      { cl: 3, safe: true },
    ];
    expect(lineReshapeSpans(lig, 0, 2, true)).toEqual({ headEnd: 0, tailStart: 1 });
    expect(lineReshapeSpans(lig, 2, 4, false)).toEqual({ headEnd: 3, tailStart: 4 });
  });

  test('a line with no safe cluster is shaped whole', () => {
    expect(lineReshapeSpans(clusters(8, [3, 4, 5, 6]), 3, 6, true)).toEqual({ headEnd: 6, tailStart: 6 });
  });

  test('a line whose only safe cluster ends its head is shaped whole', () => {
    expect(lineReshapeSpans(clusters(8, [3, 5, 6]), 3, 6, true)).toEqual({ headEnd: 6, tailStart: 6 });
  });
});

describe('shaping across spaces', () => {
  const caveatUrl = new URL('../../fonts/caveat/caveat.ttf', import.meta.url).href;
  const caveat = () => harfbuzzShaper({ fontUrl: caveatUrl, features: ['calt', 'liga'], glyphDataById: {} } as unknown as TegakiBundle)!;
  const glyphsOf = (shaped: ShapedGlyph[], at: number, length: number) =>
    shaped.filter((g) => g.cl >= at && g.cl < at + length).map((g) => g.g);

  test("Caveat's calt reaches across the space, as Chrome draws it: World after Hello takes other alternates", async () => {
    const shaper = await caveat();
    expect(glyphsOf(shaper.shape('Hello World'), 6, 5)).not.toEqual(glyphsOf(shaper.shape('World'), 0, 5));
  });

  test('"s s" draws its second s as the alternate the first calls for', async () => {
    const shaper = await caveat();
    const [s] = glyphsOf(shaper.shape('s'), 0, 1);
    expect(glyphsOf(shaper.shape('s s'), 2, 1)).not.toEqual([s]);
  });

  test('no wraps shape the text as one paragraph', async () => {
    const shaper = await caveat();
    expect(shaper.shape('Hello World', { lineBreaks: [] })).toEqual(shaper.shape('Hello World'));
  });

  test('a wrap before World redraws its head as World alone and keeps the rest from the paragraph', async () => {
    const shaper = await caveat();
    const wrapped = shaper.shape('Hello World', { lineBreaks: [6] });
    const alone = glyphsOf(shaper.shape('World'), 0, 5);
    const whole = glyphsOf(shaper.shape('Hello World'), 6, 5);
    const drawn = glyphsOf(wrapped, 6, 5);
    expect(drawn[0]).toBe(alone[0]!);
    expect(drawn.at(-1)).toBe(whole.at(-1)!);
    // The line before the wrap ends at a space: nothing on it changes.
    expect(glyphsOf(wrapped, 0, 6)).toEqual(glyphsOf(shaper.shape('Hello World'), 0, 6));
  });

  test('every character of a wrapped paragraph is drawn once, clusters ascending within each line', async () => {
    const shaper = await caveat();
    const text = 'Hello World ss s';
    const wrapped = shaper.shape(text, { lineBreaks: [6, 15] });
    expect(wrapped.map((g) => g.cl)).toEqual([...text].map((_, i) => i));
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

describe('bracket mirroring', () => {
  const suezUrl = new URL('../../fonts/suez-one/suez-one.ttf', import.meta.url).href;
  const suez = () => harfbuzzShaper({ fontUrl: suezUrl, features: [], glyphDataById: {} } as unknown as TegakiBundle)!;
  const glyphOf = (shaped: ShapedGlyph[], cl: number) => shaped.find((g) => g.cl === cl)?.g;

  test('a bracket standing alone between Hebrew words is mirrored, as bidi mirrors it', async () => {
    const shaper = await suez();
    const [open, close] = [shaper.shape('(')[0]!.g, shaper.shape(')')[0]!.g];
    const shaped = shaper.shape('( שלום )');
    expect([glyphOf(shaped, 0), glyphOf(shaped, 7)]).toEqual([close, open]);
  });

  test('a lone bracket between a Latin and a Hebrew word follows the paragraph direction', async () => {
    const shaper = await suez();
    const open = shaper.shape('(')[0]!.g;
    expect(glyphOf(shaper.shape('a ( שלום'), 2)).toBe(open);
    expect(glyphOf(shaper.shape('a ( שלום', { direction: 'rtl' }), 2)).not.toBe(open);
  });
});

describe('script of shared punctuation', () => {
  // Amiri's default brackets are its wide Arabic ones; the narrow Latin ones
  // are swapped in only for Latin text, as browsers itemize it.
  const amiriUrl = new URL('../../fonts/amiri/amiri.ttf', import.meta.url).href;
  const amiri = () => harfbuzzShaper({ fontUrl: amiriUrl, features: [], glyphDataById: {} } as unknown as TegakiBundle)!;
  const glyphsOf = (shaped: ShapedGlyph[], text: string, word: string) => {
    const at = text.indexOf(word);
    return shaped.filter((g) => g.cl >= at && g.cl < at + word.length).map((g) => g.g);
  };

  test('"(1)" after "[مرحبا]" gets the Latin parentheses, as it does after a Latin word', async () => {
    const shaper = await amiri();
    const text = 'Hello [مرحبا] (1) world';
    expect(glyphsOf(shaper.shape(text), text, '(1)')).toEqual(glyphsOf(shaper.shape('a (1)'), 'a (1)', '(1)'));
  });
});
