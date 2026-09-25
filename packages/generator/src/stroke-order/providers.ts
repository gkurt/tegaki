// Multi-provider reference collection: one character can have reference
// VARIANTS from different datasets (KanjiVG's print-style Latin, Hershey's
// cursive). The geometry pipeline evaluates each variant against the
// extracted ink and adopts whichever matches best, so handwriting styles
// coexist without any per-font configuration.

import { baseLetter, hasCombiningMarks } from '../geometry/marks.ts';
import type { ReferenceGlyph, StrokeOrderProvider } from './types.ts';

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
