import { describe, expect, test } from 'bun:test';
import { GREETINGS } from './components/home/Hero.tsx';
import { SHOWPIECES } from './components/home/Plugins.tsx';
import { SCRIPTS } from './components/home/Scripts.tsx';
import { HOME_FONT_TEXT, homeFontModule } from './home-fonts.ts';

const WRITTEN: { font: string; text: string }[] = [
  ...GREETINGS.map((g) => ({ font: g.font, text: g.word })),
  ...SCRIPTS.map((s) => ({ font: s.font, text: s.word })),
  ...SHOWPIECES.map((p) => ({ font: p.font, text: p.text })),
  { font: 'Klee One', text: '書' }, // the hero's brushed kanji
];

describe('home page fonts', () => {
  test('every string written in a cut-down font stays inside its characters', () => {
    for (const { font, text } of WRITTEN) {
      const chars = HOME_FONT_TEXT[font];
      if (chars === undefined) continue;
      const missing = [...text].filter((c) => !/\s/.test(c) && !chars.includes(c));
      expect({ font, text, missing }).toEqual({ font, text, missing: [] });
    }
  });

  test('a cut-down bundle has glyph data for each of its characters', () => {
    for (const [family, chars] of Object.entries(HOME_FONT_TEXT)) {
      const code = homeFontModule(family, chars);
      const json = code.match(/glyphData: JSON\.parse\((".*")\)/)![1]!;
      const glyphs = JSON.parse(JSON.parse(json)) as Record<string, unknown>;
      const missing = [...new Set(chars)].filter((c) => !/\s/.test(c) && !(c in glyphs));
      expect({ family, missing }).toEqual({ family, missing: [] });
    }
  });
});
