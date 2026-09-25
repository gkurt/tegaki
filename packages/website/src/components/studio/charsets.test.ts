import { describe, expect, test } from 'bun:test';
import { DEFAULT_CHARS, JAPANESE_CHARS, KOREAN_CHARS, SIMPLIFIED_CHINESE_CHARS } from 'tegaki-generator';
import { charsetCoverage, recommendCharset } from './charsets.ts';

const covering = (...sets: string[]) => {
  const all = new Set(sets.flatMap((s) => [...s]));
  return (c: string) => all.has(c);
};

describe('recommendCharset', () => {
  test('a Latin-only font gets Latin', () => {
    expect(recommendCharset(charsetCoverage(covering(DEFAULT_CHARS)))?.name).toBe('Latin');
  });

  test('a font covering a script gets that script even though it also covers Latin', () => {
    expect(recommendCharset(charsetCoverage(covering(KOREAN_CHARS)))?.name).toBe('Korean');
  });

  test('a Chinese font that also carries kana picks Simplified Chinese — the larger covered script', () => {
    expect(recommendCharset(charsetCoverage(covering(JAPANESE_CHARS, SIMPLIFIED_CHINESE_CHARS)))?.name).toBe('Simplified Chinese');
  });

  test('a Japanese font without the simplified hanzi picks Japanese', () => {
    expect(recommendCharset(charsetCoverage(covering(JAPANESE_CHARS)))?.name).toBe('Japanese');
  });

  test('a font covering nothing has no recommendation', () => {
    expect(recommendCharset(charsetCoverage(() => false))).toBeNull();
  });
});
