import { describe, expect, test } from 'bun:test';
import { resolvedScripts, scriptsDiffer } from './itemize.ts';

describe('resolvedScripts', () => {
  test('punctuation takes the script before it, across a space: "[" in "Hello [مرحبا]" is Latin', () => {
    const scripts = resolvedScripts('Hi [مر]');
    expect(scripts[3]).toBe('Latn');
    expect(scripts[4]).toBe('Arab');
  });

  test("a closing bracket takes its opening bracket's script, not the word it follows", () => {
    expect(resolvedScripts('Hi [مر]')[6]).toBe('Latn');
  });

  test('leading punctuation takes the first script after it: "(العالم)" is Arabic throughout', () => {
    expect(resolvedScripts('(عم)')).toEqual(['Arab', 'Arab', 'Arab', 'Arab']);
  });

  test('text of nothing but punctuation has no script — harfbuzz guesses', () => {
    expect(resolvedScripts('(!)')).toEqual([null, null, null]);
  });

  test('a surrogate pair gets its script on both halves', () => {
    expect(resolvedScripts('a😀')).toEqual(['Latn', 'Latn', 'Latn']);
  });
});

describe('scriptsDiffer', () => {
  test('kana and kanji shape in one run; Latin and Arabic do not', () => {
    expect(scriptsDiffer('Hira', 'Hani')).toBe(false);
    expect(scriptsDiffer('Latn', 'Arab')).toBe(true);
    expect(scriptsDiffer(null, 'Latn')).toBe(true);
  });
});
