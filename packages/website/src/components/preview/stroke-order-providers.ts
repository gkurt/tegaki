import { createHersheyProvider, createHersheySimplexProvider, createKanjiVGProvider, kanjiVGUrl } from 'tegaki-generator';

// Stroke-order reference data: KanjiVG fetched per character straight from
// the pinned release (raw.githubusercontent.com is CORS-open), Hershey
// cursive + print Latin embedded in the generator. All are queried and the
// pipeline adopts whichever variant matches the extracted ink best. Providers
// memoize; module scope makes the caches survive re-renders and are shared by
// the glyph inspector and the text preview.
export const strokeOrderProviders = [
  createKanjiVGProvider(async (char) => {
    const response = await fetch(kanjiVGUrl(char));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`KanjiVG fetch failed: ${response.status}`);
    return response.text();
  }),
  createHersheyProvider(),
  createHersheySimplexProvider(),
];
