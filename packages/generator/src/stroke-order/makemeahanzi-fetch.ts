// Make Me a Hanzi (hanzi-writer-data) loader for the Bun CLI: fetches
// per-character JSON from jsDelivr at the pinned version and caches it on
// disk. Node-only — the website supplies its own loader to
// createMakeMeAHanziProvider instead.

import { createCachedDatasetLoader, type DatasetLoaderOptions } from './dataset-fetch.ts';
import { HANZI_WRITER_DATA_VERSION, makeMeAHanziUrl } from './makemeahanzi.ts';

export const MAKEMEAHANZI_CACHE_DIR = '.cache/makemeahanzi';

export interface MakeMeAHanziLoaderOptions extends DatasetLoaderOptions {
  /** hanzi-writer-data version override (defaults to the pinned HANZI_WRITER_DATA_VERSION). */
  version?: string;
}

/** Create a disk-cached JSON loader for createMakeMeAHanziProvider (null for characters the dataset does not cover). */
export function createMakeMeAHanziFileLoader(options: MakeMeAHanziLoaderOptions = {}): (char: string) => Promise<string | null> {
  const version = options.version ?? HANZI_WRITER_DATA_VERSION;
  return createCachedDatasetLoader(
    'Make Me a Hanzi',
    MAKEMEAHANZI_CACHE_DIR,
    // Codepoint names keep the cache filenames ASCII.
    (char) => `${version}-${char.codePointAt(0)!.toString(16).padStart(5, '0')}.json`,
    (char) => makeMeAHanziUrl(char, version),
    options,
  );
}
