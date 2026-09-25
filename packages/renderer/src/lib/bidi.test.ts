import { describe, expect, test } from 'bun:test';
import { strongDirection } from './bidi.ts';

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
