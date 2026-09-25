// Disk-cached per-character fetch for stroke-order datasets (KanjiVG, Make Me
// a Hanzi) in the Bun CLI, mirroring the font download cache (.cache/fonts)
// layout. Node-only — the website supplies its own loaders instead.

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface DatasetLoaderOptions {
  cacheDir?: string;
  /** Re-download even when a cached file (or miss marker) exists. */
  force?: boolean;
}

/**
 * Create a disk-cached text loader. `cacheName(char)` names the cached file
 * (include the dataset version so a new pin never reads stale files);
 * `url(char)` is where to fetch it. Returns null for characters the dataset
 * does not cover (404), caching the miss in a `.miss` marker file so charset
 * sweeps don't re-hit the network every run.
 */
export function createCachedDatasetLoader(
  dataset: string,
  defaultCacheDir: string,
  cacheName: (char: string) => string,
  url: (char: string) => string,
  options: DatasetLoaderOptions = {},
): (char: string) => Promise<string | null> {
  const cacheDir = resolve(options.cacheDir ?? defaultCacheDir);

  return async (char: string): Promise<string | null> => {
    const filePath = join(cacheDir, cacheName(char));
    const missPath = `${filePath}.miss`;

    if (!options.force) {
      if (existsSync(filePath)) return Bun.file(filePath).text();
      if (existsSync(missPath)) return null;
    }

    const href = url(char);
    const response = await fetch(href);
    mkdirSync(cacheDir, { recursive: true });
    if (response.status === 404) {
      await Bun.write(missPath, '');
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to download ${dataset} file for "${char}" (${href}): ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    await Bun.write(filePath, text);
    return text;
  };
}
