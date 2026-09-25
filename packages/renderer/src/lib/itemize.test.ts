import { describe, expect, test } from 'bun:test';
import { resolvedScripts, scriptsDiffer, trailingScript } from './itemize.ts';

describe('resolvedScripts', () => {
  test('punctuation takes the script before it, across a space: "[" in "Hello [مرحبا]" is Latin', () => {
    const scripts = resolvedScripts('Hi [مر]');
    expect(scripts[3]).toBe('Latn');
    expect(scripts[4]).toBe('Arab');
  });

  test("a closing bracket takes its opening bracket's script, not the word it follows", () => {
    expect(resolvedScripts('Hi [مر]')[6]).toBe('Latn');
  });

  test('punctuation after a closing bracket continues in its script: "(1)" after "[مرحبا]" is Latin, not Arabic', () => {
    const text = 'Hi [مر] (1)';
    expect(resolvedScripts(text).slice(text.indexOf(' ('))).toEqual(['Latn', 'Latn', 'Latn', 'Latn']);
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

describe('trailingScript', () => {
  test('text after a word continues in its script', () => {
    expect(trailingScript('Hi مر ')).toBe('Arab');
  });

  test("text after a closing bracket continues in its opening bracket's script", () => {
    expect(trailingScript('Hi [مر]\n')).toBe('Latn');
  });

  test('text of nothing but punctuation has no script to continue', () => {
    expect(trailingScript('(!)')).toBeNull();
  });
});

describe('scriptsDiffer', () => {
  test('kana and kanji shape in one run; Latin and Arabic do not', () => {
    expect(scriptsDiffer('Hira', 'Hani')).toBe(false);
    expect(scriptsDiffer('Latn', 'Arab')).toBe(true);
    expect(scriptsDiffer(null, 'Latn')).toBe(true);
  });
});
