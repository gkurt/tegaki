// Make Me a Hanzi stroke-order provider (Chinese hanzi, PRC stroke order).
//
// Make Me a Hanzi (https://github.com/skishore/makemeahanzi) is copyright ©
// Shaunak Kishore, its graphics derived from Arphic PL fonts and released
// under the Arphic Public License. Hanzi Writer republishes it one JSON file
// per character as the `hanzi-writer-data` npm package, which jsDelivr serves
// CORS-open — the same per-character fetch shape as KanjiVG. Each file holds
// `medians`: one centerline polyline per stroke, in prescribed order, point
// order = pen direction, in a 1024×1024 frame whose y axis points UP with the
// baseline shifted by 900 (the dataset's SVGs apply
// `scale(1, -1) translate(0, -900)`).
//
// KanjiVG and Make Me a Hanzi prescribe different orders for some shared
// characters (Japanese vs PRC convention: 以, 那, 着, the 阝 radical), so the
// two are never offered side by side as best-fit variants — see
// createReferenceSet in providers.ts, which picks one per Han locale.

import type { ReferenceGlyph, StrokeOrderProvider } from './types.ts';

export const MAKEMEAHANZI_LICENSE = 'Make Me a Hanzi © Shaunak Kishore, Arphic Public License (https://github.com/skishore/makemeahanzi)';

/** Pinned hanzi-writer-data version so generated data is reproducible. */
export const HANZI_WRITER_DATA_VERSION = '2.0.1';

/** The dataset frame is 1024 units square. */
const FRAME = 1024;
/** y-up dataset coordinates map to y-down as `Y_FLIP - y`. */
const Y_FLIP = 900;

/** jsDelivr URL of a character's hanzi-writer-data file at the pinned version. */
export function makeMeAHanziUrl(char: string, version: string = HANZI_WRITER_DATA_VERSION): string {
  return `https://cdn.jsdelivr.net/npm/hanzi-writer-data@${version}/${encodeURIComponent(char)}.json`;
}

/**
 * Parse a hanzi-writer-data JSON document into a ReferenceGlyph. Returns null
 * when the document holds no usable medians.
 */
export function parseMakeMeAHanziJson(json: string, char: string): ReferenceGlyph | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const medians = (data as { medians?: unknown }).medians;
  if (!Array.isArray(medians)) return null;

  const strokes = [];
  for (const median of medians) {
    if (!Array.isArray(median)) return null;
    const points = median
      .filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number')
      .map(([x, y]) => ({ x, y: Y_FLIP - y }));
    if (points.length < 2) return null;
    strokes.push({ points });
  }
  if (strokes.length === 0) return null;

  return {
    char,
    strokes,
    viewBox: { width: FRAME, height: FRAME },
    source: 'makemeahanzi',
    license: MAKEMEAHANZI_LICENSE,
  };
}

/**
 * Build a StrokeOrderProvider from a hanzi-writer-data JSON loader. The loader
 * owns all IO and returns the raw JSON text for a character, or null when the
 * dataset has no entry. Parsed results are memoized per character.
 */
export function createMakeMeAHanziProvider(loadJson: (char: string) => Promise<string | null>): StrokeOrderProvider {
  const cache = new Map<string, Promise<ReferenceGlyph | null>>();
  return {
    name: 'makemeahanzi',
    get(char: string): Promise<ReferenceGlyph | null> {
      let entry = cache.get(char);
      if (!entry) {
        entry = loadJson(char).then((json) => (json === null ? null : parseMakeMeAHanziJson(json, char)));
        cache.set(char, entry);
      }
      return entry;
    },
  };
}
