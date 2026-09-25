import { describe, expect, test } from 'bun:test';
import { neutralRunDirection, paragraphDirection, strongDirection } from './bidi.ts';

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

describe('paragraphDirection', () => {
  test('takes the first strong letter, as dir="auto" does', () => {
    expect(paragraphDirection('(שלום) hi')).toBe('rtl');
    expect(paragraphDirection('aכתב')).toBe('ltr');
  });

  test('skips digits, and is LTR with no letter at all', () => {
    expect(paragraphDirection('12 שלום')).toBe('rtl');
    expect(paragraphDirection('(12)')).toBe('ltr');
  });
});

describe('neutralRunDirection', () => {
  test('a run between two strong characters of one direction takes it', () => {
    // "( " inside "שלום ( עולם"
    expect(neutralRunDirection('שלום ( עולם', 5, 6, 'ltr')).toBe('rtl');
  });

  test('a run between two directions, or at an edge facing the other one, takes the paragraph direction', () => {
    expect(neutralRunDirection('a ( שלום', 2, 3, 'ltr')).toBe('ltr');
    expect(neutralRunDirection('a ( שלום', 2, 3, 'rtl')).toBe('rtl');
    expect(neutralRunDirection('( שלום', 0, 1, 'ltr')).toBe('ltr');
    expect(neutralRunDirection('( שלום', 0, 1, 'rtl')).toBe('rtl');
  });

  test('a digit stands with the letter before it: after Hebrew it keeps a bracket RTL', () => {
    expect(neutralRunDirection('שלום ( 123', 5, 6, 'ltr')).toBe('rtl');
    expect(neutralRunDirection('ab ( 123', 3, 4, 'rtl')).toBe('ltr');
  });
});

describe('neutralRunDirection — bracket pairs', () => {
  test('a pair enclosing Latin after a Latin word stays LTR in an RTL paragraph', () => {
    // "( שלום ) a ( b )": the closing bracket of "( b )" sits before the end of an RTL paragraph.
    const text = '( שלום ) a ( b )';
    expect(neutralRunDirection(text, 15, 16, 'rtl')).toBe('ltr');
    expect(neutralRunDirection(text, 11, 12, 'rtl')).toBe('ltr');
  });

  test('a pair enclosing the paragraph direction takes it, whatever surrounds it', () => {
    expect(neutralRunDirection('a ( שלום b )', 2, 3, 'rtl')).toBe('rtl');
    expect(neutralRunDirection('שלום ( a ב )', 5, 6, 'ltr')).toBe('ltr');
  });

  test('a pair enclosing only the other direction takes the paragraph direction when the text before it differs', () => {
    expect(neutralRunDirection('שלום ( b )', 5, 6, 'rtl')).toBe('rtl');
  });
});
