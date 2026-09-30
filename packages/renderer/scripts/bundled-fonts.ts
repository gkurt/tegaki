// The fonts shipped under `tegaki/fonts/*`: what `generate-fonts.ts` builds
// and `scoreboard.ts` scores (all but the stroke fonts). The Latin fonts use the generator's default
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
  /**
   * A stroke font (a single-line SVG font), cached like `file`: its strokes are
   * the glyph data as they are (`--stroke-font`), every glyph it has, so no
   * pipeline runs and the scoreboard has nothing to score.
   */
  strokeFont?: { url: string; cacheName: string };
}

/** Evil Mad Scientist's single-line SVG fonts, at a pinned commit (GitLab's raw-file API). */
const svgFont = (path: string) =>
  `https://gitlab.com/api/v4/projects/oskay%2Fsvg-fonts/repository/files/${encodeURIComponent(`fonts/${path}`)}/raw?ref=8c71f2d9e1a5292047bb88e5595a766241b82cc6`;

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
  // Stroke fonts: made of pen strokes, drawn as they are.
  {
    family: 'Hershey Script 1-stroke',
    dir: 'hershey-script',
    strokeFont: { url: svgFont('Hershey/HersheyScript1.svg'), cacheName: 'HersheyScript1-8c71f2d.svg' },
  },
  { family: 'EMS Allure', dir: 'ems-allure', strokeFont: { url: svgFont('EMS/EMSAllure.svg'), cacheName: 'EMSAllure-8c71f2d.svg' } },
];

/** The bundles made by the pipelines — what the scoreboard scores. */
export const PIPELINE_FONTS: FontSpec[] = FONTS.filter((f) => !f.strokeFont);
