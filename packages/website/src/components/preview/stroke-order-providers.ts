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
// Hanzi per character from jsDelivr (hanzi-writer-data, CORS-open), the Hershey
// faces and Letterpaths' taught hands embedded in the generator, Hangul composed from jamo
// templates. The Han locale decides which Han dataset leads; the rest are
// best-fit variants (see createReferenceSet), narrowed to the datasets the Pipeline tab leaves on. Providers memoize; module scope
// makes the caches survive re-renders and are shared by the glyph inspector
// and the text preview.
const han = {
  kanjiVG: createKanjiVGProvider((char) => fetchDatasetFile('KanjiVG', kanjiVGUrl(char))),
  makeMeAHanzi: createMakeMeAHanziProvider((char) => fetchDatasetFile('Make Me a Hanzi', makeMeAHanziUrl(char))),
};

const referenceSets = new Map<string, StrokeOrderProvider[]>();

/** A stable key for a Han locale and dataset set, e.g. for an effect's dependencies. */
export function referenceSetKey(options: Pick<GeometryOptions, 'hanLocale' | 'referenceDatasets'>): string {
  return `${options.hanLocale}:${options.referenceDatasets.join(',')}`;
}

/** The reference providers for a Han locale and dataset set (the same array for the same key). */
export function strokeOrderProviders(options: Pick<GeometryOptions, 'hanLocale' | 'referenceDatasets'>): StrokeOrderProvider[] {
  const key = referenceSetKey(options);
  let set = referenceSets.get(key);
  if (!set) {
    set = createReferenceSet(han, options.hanLocale, options.referenceDatasets);
    referenceSets.set(key, set);
  }
  return set;
}
