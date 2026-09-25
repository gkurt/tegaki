// KanjiVG SVG loader for the Bun CLI: fetches per-character files from the
// pinned KanjiVG release on GitHub and caches them on disk. Node-only — the
// website supplies its own loader to createKanjiVGProvider instead.

import { createCachedDatasetLoader, type DatasetLoaderOptions } from './dataset-fetch.ts';
import { KANJIVG_RELEASE, kanjiVGFilename, kanjiVGUrl } from './kanjivg.ts';

export const KANJIVG_CACHE_DIR = '.cache/kanjivg';

export interface KanjiVGLoaderOptions extends DatasetLoaderOptions {
  /** Release tag override (defaults to the pinned KANJIVG_RELEASE). */
  release?: string;
}

/** Create a disk-cached SVG loader for createKanjiVGProvider (null for characters KanjiVG does not cover). */
export function createKanjiVGFileLoader(options: KanjiVGLoaderOptions = {}): (char: string) => Promise<string | null> {
  const release = options.release ?? KANJIVG_RELEASE;
  return createCachedDatasetLoader(
    'KanjiVG',
    KANJIVG_CACHE_DIR,
    (char) => `${release}-${kanjiVGFilename(char)}`,
    (char) => kanjiVGUrl(char, release),
    options,
  );
}
