import {
  createKanjiVGProvider,
  createMakeMeAHanziProvider,
  createReferenceSet,
  type GeometryOptions,
  kanjiVGUrl,
  makeMeAHanziUrl,
  type StrokeOrderProvider,
} from 'tegaki-generator';

async function fetchDatasetFile(dataset: string, url: string): Promise<string | null> {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${dataset} fetch failed: ${response.status}`);
  return response.text();
}

// Stroke-order reference data: KanjiVG fetched per character straight from
// the pinned release (raw.githubusercontent.com is CORS-open), Make Me a
// Hanzi per character from jsDelivr (hanzi-writer-data, CORS-open), Hershey
// cursive + print Latin embedded in the generator, Hangul composed from jamo
// templates. The Han locale decides which Han dataset leads; the rest are
// best-fit variants (see createReferenceSet). Providers memoize; module scope
// makes the caches survive re-renders and are shared by the glyph inspector
// and the text preview.
const han = {
  kanjiVG: createKanjiVGProvider((char) => fetchDatasetFile('KanjiVG', kanjiVGUrl(char))),
  makeMeAHanzi: createMakeMeAHanziProvider((char) => fetchDatasetFile('Make Me a Hanzi', makeMeAHanziUrl(char))),
};

const referenceSets: Record<GeometryOptions['hanLocale'], StrokeOrderProvider[]> = {
  ja: createReferenceSet(han, 'ja'),
  zh: createReferenceSet(han, 'zh'),
};

/** The reference providers for a Han locale (stable per locale, safe as an effect dependency). */
export function strokeOrderProviders(hanLocale: GeometryOptions['hanLocale']): StrokeOrderProvider[] {
  return referenceSets[hanLocale];
}
