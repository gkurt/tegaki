import { CHARSET_PRESETS, DEFAULT_CHARS, type ParsedFontInfo } from 'tegaki-generator';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s: string) => [...segmenter.segment(s)].map((g) => g.segment);
const LATIN = new Set(graphemes(DEFAULT_CHARS));

export interface CharsetCoverage {
  name: string;
  chars: string;
  total: number;
  covered: number;
  /** The preset's own script — every non-Latin preset also carries the Latin set. */
  scriptTotal: number;
  scriptCovered: number;
}

export interface CharsetInfo {
  coverage: CharsetCoverage[];
  recommended: CharsetCoverage | null;
}

/** A glyph lookup across the font and its subset files (Google Fonts splits CJK into many). */
export function fontHasChar(info: ParsedFontInfo): (c: string) => boolean {
  const fonts = [info.font, ...(info.extraFonts ?? [])];
  return (c) => fonts.some((f) => (f.charToGlyph(c)?.index ?? 0) !== 0);
}

/** How much of each charset preset a font maps. */
export function charsetCoverage(hasChar: (c: string) => boolean): CharsetCoverage[] {
  return CHARSET_PRESETS.map(({ name, chars }) => {
    const all = graphemes(chars);
    const script = name === 'Latin' ? all : all.filter((c) => !LATIN.has(c));
    let covered = 0;
    let scriptCovered = 0;
    const scriptSet = new Set(script);
    for (const c of all) {
      if (!hasChar(c)) continue;
      covered++;
      if (scriptSet.has(c)) scriptCovered++;
    }
    return { name, chars, total: all.length, covered, scriptTotal: script.length, scriptCovered };
  });
}

/** Share of the preset's own script that must be mapped for it to count as the font's script. */
const SCRIPT_THRESHOLD = 0.9;

/**
 * The charset a font is made for: the non-Latin preset whose script it covers
 * (≥ 90%) with the most glyphs — so a Chinese font that also carries kana
 * picks Simplified Chinese, while a Japanese font lacking simplified hanzi
 * picks Japanese — else Latin, else whichever preset it covers best.
 */
export function recommendCharset(coverage: CharsetCoverage[]): CharsetCoverage | null {
  const scripts = coverage.filter((c) => c.name !== 'Latin' && c.scriptTotal > 0 && c.scriptCovered / c.scriptTotal >= SCRIPT_THRESHOLD);
  if (scripts.length > 0) return scripts.reduce((a, b) => (b.scriptCovered > a.scriptCovered ? b : a));
  const latin = coverage.find((c) => c.name === 'Latin');
  if (latin && latin.covered / latin.total >= 0.8) return latin;
  const best = coverage.reduce<CharsetCoverage | null>((a, b) => (!a || b.covered / b.total > a.covered / a.total ? b : a), null);
  return best && best.covered > 0 ? best : null;
}
