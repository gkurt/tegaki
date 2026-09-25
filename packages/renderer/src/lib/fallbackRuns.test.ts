import { describe, expect, test } from 'bun:test';
import { fallbackRuns } from './fallbackRuns.ts';

/** One entry per grapheme; `hasGlyph` for the characters in `bundled`. */
function entriesOf(chars: string[], bundled = '') {
  return chars.map((char, graphemeIndex) => ({ char, graphemeIndex, hasGlyph: bundled.includes(char) }));
}

describe('fallbackRuns', () => {
  test('consecutive fallback letters form one run, so an Arabic word is drawn joined', () => {
    const chars = [...'مرحبا'];
    const { runs, runOf } = fallbackRuns(entriesOf(chars), chars, () => 0);
    expect(runs).toEqual([{ entries: [0, 1, 2, 3, 4], text: 'مرحبا', direction: 'rtl' }]);
    expect([...runOf]).toEqual([0, 0, 0, 0, 0]);
  });

  test('whitespace and characters the bundle draws end a run', () => {
    const chars = [...'ab cxd'];
    const { runs, runOf } = fallbackRuns(entriesOf(chars, 'x'), chars, () => 0);
    expect(runs.map((r) => r.text)).toEqual(['ab', 'c', 'd']);
    expect([...runOf]).toEqual([0, 0, -1, 1, -1, 2]);
  });

  test('a line break or a direction switch ends a run', () => {
    const chars = [...'abשל'];
    const { runs } = fallbackRuns(entriesOf(chars), chars, (g) => (g < 1 ? 0 : 1));
    expect(runs.map((r) => [r.text, r.direction])).toEqual([
      ['a', 'ltr'],
      ['b', 'ltr'],
      ['של', 'rtl'],
    ]);
  });

  test('neutral characters join the run they follow, and a run of only them has no direction', () => {
    const chars = [...'ש!', ' ', '!'];
    const { runs } = fallbackRuns(entriesOf(chars), chars, () => 0);
    expect(runs.map((r) => [r.text, r.direction])).toEqual([
      ['ש!', 'rtl'],
      ['!', null],
    ]);
  });

  test('a cluster with an entry per code point stays one character of its run: "दुनि" in a Latin font', () => {
    const chars = ['दु', 'नि'];
    const entries = [
      { char: 'दु', graphemeIndex: 0, hasGlyph: false },
      { char: 'दु', graphemeIndex: 0, hasGlyph: false },
      { char: 'नि', graphemeIndex: 1, hasGlyph: false },
      { char: 'नि', graphemeIndex: 1, hasGlyph: false },
    ];
    const { runs, runOf } = fallbackRuns(entries, chars, () => 0);
    expect(runs).toEqual([{ entries: [0, 1, 2, 3], text: 'दुनि', direction: 'ltr' }]);
    expect([...runOf]).toEqual([0, 0, 0, 0]);
  });

  test("a cluster's later graphemes join the run's text", () => {
    // One entry for the cluster starting at grapheme 0, which covers grapheme 1 too.
    const chars = ['a', 'b', 'c'];
    const entries = [
      { char: 'a', graphemeIndex: 0, hasGlyph: false },
      { char: 'c', graphemeIndex: 2, hasGlyph: false },
    ];
    expect(fallbackRuns(entries, chars, () => 0).runs[0]!.text).toBe('abc');
  });
});
