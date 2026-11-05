import { describe, expect, test } from 'bun:test';
import { CHARSET_PRESETS, LATIN_EXTENDED_CHARS } from './charsets.ts';
import { DEFAULT_CHARS } from './constants.ts';

const graphemes = (s: string) => [...s];

describe('CHARSET_PRESETS', () => {
  test('preset names are unique', () => {
    const names = CHARSET_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('every preset includes the Latin baseline', () => {
    for (const { chars } of CHARSET_PRESETS) {
      const set = new Set(graphemes(chars));
      for (const c of graphemes(DEFAULT_CHARS)) expect(set.has(c)).toBe(true);
    }
  });
});

describe('LATIN_EXTENDED_CHARS', () => {
  test('is a preset', () => {
    expect(CHARSET_PRESETS.find((p) => p.name === 'Latin Extended')?.chars).toBe(LATIN_EXTENDED_CHARS);
  });

  test('has no repeated character', () => {
    const g = graphemes(LATIN_EXTENDED_CHARS);
    expect(new Set(g).size).toBe(g.length);
  });

  test('covers the letters of Latin-script European languages', () => {
    const set = new Set(graphemes(LATIN_EXTENDED_CHARS));
    const samples: Record<string, string> = {
      turkish: 'ÇçĞğİıÖöŞşÜü',
      german: 'ÄäÖöÜüß',
      french: 'ÀàÂâÆæÇçÉéÈèÊêËëÎîÏïÔôŒœÙùÛûÜüŸÿ',
      spanish: 'ÁáÉéÍíÑñÓóÚúÜü¡¿',
      polish: 'ĄąĆćĘęŁłŃńÓóŚśŹźŻż',
      czech: 'ÁáČčĎďÉéĚěÍíŇňÓóŘřŠšŤťÚúŮůÝýŽž',
      hungarian: 'ÁáÉéÍíÓóÖöŐőÚúÜüŰű',
      romanian: 'ĂăÂâÎîŞşŢţ',
      nordic: 'ÅåÄäÖöØøÆæÐðÞþ',
      baltic: 'ĀāČčĒēĢģĪīĶķĻļŅņŠšŪūŽžĖėĮįŲų',
      punctuation: '¡¿«»‹›“”‘’„‚–—…•†‡‰′″',
      symbols: '©®™€£¥¢§¶°±×÷½¼¾²³µ',
    };
    for (const [language, letters] of Object.entries(samples)) {
      const missing = graphemes(letters).filter((c) => !set.has(c));
      expect(missing, language).toEqual([]);
    }
  });
});
