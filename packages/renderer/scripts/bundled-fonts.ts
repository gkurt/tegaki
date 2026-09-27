// The fonts shipped under `tegaki/fonts/*`: what `generate-fonts.ts` builds
// and `scoreboard.ts` scores. The Latin fonts use the generator's default
// ASCII set; the non-Latin fonts pass an explicit `chars` (see the generator's
// `charsets.ts` for what's included).

import {
  ARABIC_CHARS,
  BENGALI_CHARS,
  DEVANAGARI_CHARS,
  HEBREW_CHARS,
  JAPANESE_CHARS,
  KOREAN_CHARS,
  SIMPLIFIED_CHINESE_CHARS,
} from 'tegaki-generator';

export interface FontSpec {
  /** Google Fonts family; for a `file` font, the family its name table carries (the bundle takes that). */
  family: string;
  /** Output directory under `packages/renderer/fonts/`. */
  dir: string;
  /** Custom subset; omit to use the generator's default ASCII set. */
  chars?: string;
  /**
   * A font file from outside Google Fonts, cached under the generator's
   * `.cache/fonts/` as `cacheName`. Only the subset ships: the fonts that
   * need this are CJK, tens of megabytes whole, so characters outside the set
   * fall to the renderer's `fallbackFont` instead.
   */
  file?: { url: string; cacheName: string };
  /** Han stroke-order convention (the generator's `--han-locale`); default `ja`. */
  hanLocale?: 'ja' | 'zh';
}

export const FONTS: FontSpec[] = [
  { family: 'Caveat', dir: 'caveat' },
  { family: 'Italianno', dir: 'italianno' },
  { family: 'Tangerine', dir: 'tangerine' },
  { family: 'Parisienne', dir: 'parisienne' },
  { family: 'Suez One', dir: 'suez-one', chars: HEBREW_CHARS },
  { family: 'Klee One', dir: 'klee-one', chars: JAPANESE_CHARS },
  { family: 'Amiri', dir: 'amiri', chars: ARABIC_CHARS },
  { family: 'Tillana', dir: 'tillana', chars: DEVANAGARI_CHARS },
  { family: 'Atma', dir: 'atma', chars: BENGALI_CHARS },
  { family: 'Nanum Pen Script', dir: 'nanum-pen-script', chars: KOREAN_CHARS },
  // The mainland-form release: Google Fonts carries only LXGW WenKai TC, whose
  // Taiwan-standard forms differ from simplified Chinese.
  {
    family: 'LXGW WenKai',
    dir: 'lxgw-wenkai',
    chars: SIMPLIFIED_CHINESE_CHARS,
    file: {
      url: 'https://github.com/lxgw/LxgwWenKai/releases/download/v1.522/LXGWWenKai-Regular.ttf',
      cacheName: 'LXGWWenKai-Regular-v1.522.ttf',
    },
    hanLocale: 'zh',
  },
];
