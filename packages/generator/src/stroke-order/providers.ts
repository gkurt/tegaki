// Multi-provider reference collection: one character can have reference
// VARIANTS from different datasets (KanjiVG's print-style Latin, Hershey's
// cursive). The geometry pipeline evaluates each variant against the
// extracted ink and adopts whichever matches best, so handwriting styles
// coexist without any per-font configuration.

import { baseLetter, hasCombiningMarks } from '../geometry/marks.ts';
import type { GeometryOptions } from '../geometry/types.ts';
import { createHangulProvider } from './hangul.ts';
import { createHersheyProvider, createHersheySimplexProvider } from './hershey.ts';
import type { ReferenceGlyph, StrokeOrderProvider } from './types.ts';

/**
 * One provider out of several, consulted in order: the first non-null answer
 * wins and the rest are never asked. For datasets that are ALTERNATIVE
 * conventions for the same characters (KanjiVG vs Make Me a Hanzi), where
 * letting the best fit pick per glyph would mix two orders in one bundle.
 */
export function firstMatchProvider(providers: StrokeOrderProvider[]): StrokeOrderProvider {
  return {
    name: providers.map((p) => p.name).join('|'),
    async get(char: string): Promise<ReferenceGlyph | null> {
      for (const provider of providers) {
        const ref = await provider.get(char).catch(() => null);
        if (ref) return ref;
      }
      return null;
    },
  };
}

// Pure in-memory datasets: one memoizing instance serves every reference set.
const LATIN_AND_HANGUL: StrokeOrderProvider[] = [createHersheyProvider(), createHersheySimplexProvider(), createHangulProvider()];

/** The Han datasets, with their IO already wired (CLI disk cache, website fetch). */
export interface HanReferenceProviders {
  kanjiVG: StrokeOrderProvider;
  makeMeAHanzi: StrokeOrderProvider;
}

/**
 * Every stroke-order reference source, as the CLI and the Studio use them:
 * the Han datasets as ONE source ordered by `hanLocale` (KanjiVG also covers
 * kana and print Latin, so it stays in the chain for 'zh'), then Hershey
 * cursive + print Latin and composed Hangul as best-fit variants. Cheap to
 * call: every set shares the passed providers' caches and the in-memory ones.
 */
export function createReferenceSet(han: HanReferenceProviders, hanLocale: GeometryOptions['hanLocale']): StrokeOrderProvider[] {
  const hanOrder = hanLocale === 'zh' ? [han.makeMeAHanzi, han.kanjiVG] : [han.kanjiVG, han.makeMeAHanzi];
  return [firstMatchProvider(hanOrder), ...LATIN_AND_HANGUL];
}

async function referencesFor(char: string, providers: StrokeOrderProvider[]): Promise<ReferenceGlyph[]> {
  const refs = await Promise.all(providers.map((p) => p.get(char).catch(() => null)));
  return refs.filter((r): r is ReferenceGlyph => r !== null);
}

/**
 * Gather reference variants for a character, provider order preserved,
 * misses and failures skipped. An accented letter no dataset has (é) takes
 * its base letter's (e): its `char` tells the pipeline to match the body
 * without the marks.
 */
export async function collectReferences(char: string, providers: StrokeOrderProvider[]): Promise<ReferenceGlyph[]> {
  const refs = await referencesFor(char, providers);
  if (refs.length > 0) return refs;
  const base = hasCombiningMarks(char) ? baseLetter(char) : null;
  return base ? referencesFor(base, providers) : [];
}
