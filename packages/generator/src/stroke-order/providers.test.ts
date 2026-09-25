import { describe, expect, test } from 'bun:test';
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

  test("'zh' takes Make Me a Hanzi for shared hanzi and still finds kana in KanjiVG", async () => {
    const set = createReferenceSet(han, 'zh');
    expect((await collectReferences('中', set)).map((r) => r.source)).toEqual(['makemeahanzi']);
    expect((await collectReferences('あ', set)).map((r) => r.source)).toEqual(['kanjivg']);
  });
});
