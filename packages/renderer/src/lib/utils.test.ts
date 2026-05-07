import { describe, expect, test } from 'bun:test';
import type { TegakiBundle, TegakiGlyphData } from '../types.ts';
import { lookupGlyphData } from './utils.ts';

const stroke = (d: number, a: number) => ({ p: [[0, 0, 1] as [number, number, number]], d, a });
const glyph = (w: number, t: number): TegakiGlyphData => ({ w, t, s: [stroke(0, t)] });

function makeBundle(glyphData: Record<string, TegakiGlyphData>): TegakiBundle {
  return {
    family: 'test',
    lineCap: 'round',
    fontUrl: '',
    fontFaceCSS: '',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphData,
  };
}

describe('lookupGlyphData', () => {
  test('returns a direct match for a single-codepoint key', () => {
    const bundle = makeBundle({ A: glyph(500, 1) });
    expect(lookupGlyphData(bundle, 'A')?.w).toBe(500);
  });

  test('returns undefined when nothing matches', () => {
    const bundle = makeBundle({});
    expect(lookupGlyphData(bundle, 'A')).toBeUndefined();
  });

  test('falls back to the leading codepoint for a multi-codepoint grapheme cluster', () => {
    // Devanagari "हि" (U+0939 U+093F) is a single grapheme of two codepoints —
    // glyphData is keyed per codepoint, so the cluster string itself is absent.
    // The fallback resolves the leading codepoint so a shaped glyph that landed
    // on this cluster (e.g. nominal `ह`) can pick up its real stroke data
    // instead of the 0.2s `unknownDuration` slot + DOM fillText fallback.
    const bundle = makeBundle({ ह: glyph(700, 1.5) });
    expect(lookupGlyphData(bundle, 'हि')?.w).toBe(700);
  });

  test('does not fall back for single-codepoint keys (preserves miss behavior)', () => {
    // Looking up a missing single-codepoint char must still return undefined —
    // otherwise we'd silently mask genuinely missing glyphs.
    const bundle = makeBundle({ A: glyph(500, 1) });
    expect(lookupGlyphData(bundle, 'B')).toBeUndefined();
  });

  test('returns undefined when the leading codepoint is also absent', () => {
    const bundle = makeBundle({ A: glyph(500, 1) });
    expect(lookupGlyphData(bundle, 'हि')).toBeUndefined();
  });

  test('handles surrogate-pair leading codepoint', () => {
    // 𓀀 (U+13000, an Egyptian hieroglyph) is a surrogate pair; codePointAt(0)
    // must return the full codepoint, not the leading surrogate.
    const bundle = makeBundle({ 𓀀: glyph(900, 2) });
    // ZWJ-attached form: surrogate pair + ZWJ + ASCII letter.
    expect(lookupGlyphData(bundle, '𓀀‍A')?.w).toBe(900);
  });

  test('NFC and NFD forms of "é" resolve to different bundle entries — locks in why engine normalizes input', () => {
    // The bundle is built with NFC keys (precomposed `é` = U+00E9). When the
    // engine receives NFD text (`e` + U+0301), `lookupGlyphData` cannot
    // recover the precomposed entry — its leading-codepoint fallback would
    // return the bare `e` glyph instead. This is why the engine NFC-normalizes
    // text at its public boundary; the test pins the failure mode so the
    // normalization line in engine.ts can never quietly be removed.
    const bundle = makeBundle({ é: glyph(500, 1), e: glyph(450, 0.9) });
    expect(lookupGlyphData(bundle, 'é'.normalize('NFC'))?.w).toBe(500);
    expect(lookupGlyphData(bundle, 'é'.normalize('NFD'))?.w).toBe(450);
  });
});
