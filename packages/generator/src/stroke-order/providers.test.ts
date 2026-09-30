import { describe, expect, test } from 'bun:test';
import { REFERENCE_DATASET_IDS } from './datasets.ts';
import { collectReferences, createReferenceSet, firstMatchProvider } from './providers.ts';
import type { ReferenceGlyph, StrokeOrderProvider } from './types.ts';

const provider = (chars: string): StrokeOrderProvider => ({
  name: 'test',
  get: async (char) =>
    chars.includes(char)
      ? ({ char, strokes: [], viewBox: { width: 1, height: 1 }, source: 'test', license: '' } satisfies ReferenceGlyph)
      : null,
});

describe('collectReferences', () => {
  test("an accented letter no dataset has takes its base letter's reference (é → e)", async () => {
    expect((await collectReferences('é', [provider('e')])).map((r) => r.char)).toEqual(['e']);
  });

  test('a character with its own reference keeps it', async () => {
    expect((await collectReferences('é', [provider('eé')])).map((r) => r.char)).toEqual(['é']);
  });

  test('outside Latin, Greek and Cyrillic there is no fallback (が stays without か)', async () => {
    expect(await collectReferences('が', [provider('か')])).toEqual([]);
  });

  test('whitespace and control characters ask no dataset', async () => {
    const asked: string[] = [];
    const spy: StrokeOrderProvider = {
      name: 'spy',
      get: async (char) => {
        asked.push(char);
        return null;
      },
    };
    for (const char of [' ', '\n', '\t', '\u3000', '\u0007']) expect(await collectReferences(char, [spy])).toEqual([]);
    expect(asked).toEqual([]);
  });
});

const named = (name: string, chars: string): StrokeOrderProvider => ({
  name,
  get: async (char) =>
    chars.includes(char)
      ? ({ char, strokes: [], viewBox: { width: 1, height: 1 }, source: name, license: '' } satisfies ReferenceGlyph)
      : null,
});

describe('firstMatchProvider', () => {
  test('the first dataset with an entry wins; later ones are never offered as variants', async () => {
    const han = firstMatchProvider([named('a', '中'), named('b', '中这')]);
    expect((await collectReferences('中', [han])).map((r) => r.source)).toEqual(['a']);
  });

  test('a character the first dataset lacks falls through to the next', async () => {
    const han = firstMatchProvider([named('a', '中'), named('b', '中这')]);
    expect((await han.get('这'))?.source).toBe('b');
    expect(await han.get('x')).toBeNull();
  });

  test('a failing dataset counts as a miss, not an error', async () => {
    const failing: StrokeOrderProvider = { name: 'down', get: () => Promise.reject(new Error('offline')) };
    expect((await firstMatchProvider([failing, named('b', '中')]).get('中'))?.source).toBe('b');
  });
});

describe('createReferenceSet', () => {
  const han = { kanjiVG: named('kanjivg', '中あ'), makeMeAHanzi: named('makemeahanzi', '中这') };

  test("'ja' takes KanjiVG for shared hanzi, Make Me a Hanzi only for what KanjiVG lacks", async () => {
    const set = createReferenceSet(han, 'ja');
    expect((await collectReferences('中', set)).map((r) => r.source)).toEqual(['kanjivg']);
    expect((await collectReferences('这', set)).map((r) => r.source)).toEqual(['makemeahanzi']);
  });

  test('Make Me a Hanzi is only asked about Han characters', async () => {
    const asked: string[] = [];
    const spy: StrokeOrderProvider = {
      name: 'makemeahanzi',
      get: async (char) => {
        asked.push(char);
        return null;
      },
    };
    for (const locale of ['ja', 'zh'] as const) {
      const set = createReferenceSet({ kanjiVG: named('kanjivg', ''), makeMeAHanzi: spy }, locale);
      for (const char of ['a', 'あ', 'ب', '中']) await collectReferences(char, set);
    }
    expect(asked).toEqual(['中', '中']);
  });

  test("the comma takes the punctuation reference over KanjiVG's, which has no direction", async () => {
    const set = createReferenceSet({ kanjiVG: named('kanjivg', ','), makeMeAHanzi: named('makemeahanzi', '') }, 'ja');
    const [comma, ...others] = await collectReferences(',', set);
    expect(others).toEqual([]);
    expect(comma?.source).toBe('punctuation');
    // Written from the head down to the tail.
    const points = comma!.strokes[0]!.points;
    expect(points[0]!.y).toBeLessThan(points.at(-1)!.y);
  });

  test('every dataset is consulted by default; a switched-off one offers no variant', async () => {
    const all = (await collectReferences('a', createReferenceSet(han, 'ja'))).map((r) => r.source);
    expect(all).toEqual(['hershey-script', 'hershey-simplex', 'letterpaths-print', 'letterpaths-cursive', 'letterpaths-cursive-high']);
    const noCursive = createReferenceSet(
      han,
      'ja',
      REFERENCE_DATASET_IDS.filter((id) => id !== 'letterpaths-cursive'),
    );
    expect((await collectReferences('a', noCursive)).map((r) => r.source)).not.toContain('letterpaths-cursive-high');
  });

  test('with KanjiVG off, Han characters fall to Make Me a Hanzi even for ja', async () => {
    const set = createReferenceSet(han, 'ja', ['makemeahanzi']);
    expect((await collectReferences('中', set)).map((r) => r.source)).toEqual(['makemeahanzi']);
    expect(await collectReferences('あ', set)).toEqual([]);
  });

  test('a drawn dataset orders the characters it has on its own; the rest keep the built-in datasets', async () => {
    const set = createReferenceSet(han, 'ja', undefined, [named('my hand', 'a'), named('their hand', 'a')]);
    expect((await collectReferences('a', set)).map((r) => r.source)).toEqual(['my hand', 'their hand']);
    expect((await collectReferences('b', set)).map((r) => r.source)).toContain('hershey-simplex');
    expect((await collectReferences('中', set)).map((r) => r.source)).toEqual(['kanjivg']);
  });

  test("'zh' takes Make Me a Hanzi for shared hanzi and still finds kana in KanjiVG", async () => {
    const set = createReferenceSet(han, 'zh');
    expect((await collectReferences('中', set)).map((r) => r.source)).toEqual(['makemeahanzi']);
    expect((await collectReferences('あ', set)).map((r) => r.source)).toEqual(['kanjivg']);
  });
});
