import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CACHE_DIR, charsHash } from '../constants.ts';

function slugify(family: string): string {
  return family.toLowerCase().replace(/\s+/g, '-');
}

function extractAllTtfUrls(css: string): string[] {
  // Google Fonts returns two URL shapes depending on whether `&text=` is set:
  //   - full-subset files:  url(https://fonts.gstatic.com/s/.../font.ttf) format('truetype')
  //   - subsetted kit URLs: url(https://fonts.gstatic.com/l/font?kit=...&v=v23) format('truetype')
  // Both declare `format('truetype')`, so match on the format descriptor rather than a `.ttf` suffix.
  return [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\(['"]truetype['"]\)/g)]
    .map((m) => m[1])
    .filter((url): url is string => url !== undefined);
}

/**
 * Download a Google Font, returning paths to all subset TTF files.
 *
 * For fonts with a single subset (most Latin fonts), returns one path.
 * For CJK and other multi-subset fonts, Google Fonts serves separate TTF files
 * per Unicode range. When `chars` is provided, the `&text=` parameter limits
 * the response to only the subsets covering those characters, then all matching
 * subset files are downloaded.
 */
export async function downloadFont(
  family: string,
  options: { cacheDir?: string; force?: boolean; chars?: string } = {},
): Promise<string[]> {
  const cacheDir = resolve(options.cacheDir ?? CACHE_DIR);
  const slug = slugify(family);

  mkdirSync(cacheDir, { recursive: true });

  // Build a cache key that includes the character set (if any) so different
  // character requests don't collide in the cache.
  const hashSuffix = options.chars ? `-${charsHash(options.chars)}` : '';
  const cacheKey = `${slug}${hashSuffix}`;
  const manifestPath = join(cacheDir, `${cacheKey}.manifest.json`);

  // Check cache: if all previously-downloaded subset files still exist, reuse them
  if (!options.force && existsSync(manifestPath)) {
    try {
      const manifest: { paths: string[] } = JSON.parse(await Bun.file(manifestPath).text());
      const fullPaths = manifest.paths.map((p) => join(cacheDir, p));
      if (fullPaths.every((p) => existsSync(p))) {
        return fullPaths;
      }
    } catch {
      // Corrupt manifest — re-download
    }
  }

  const encodedFamily = encodeURIComponent(family);
  let cssUrl = `https://fonts.googleapis.com/css2?family=${encodedFamily}`;

  // The &text= parameter makes Google Fonts return only the subsets that cover
  // the requested characters. This is critical for CJK fonts which may have
  // 100+ subsets — without filtering, we'd download them all.
  //
  // For very large character sets (e.g. Simplified Chinese with 3500+ chars),
  // the URL-encoded &text= can exceed Google Fonts' URL length limit (~8 KB).
  // When that happens we skip the parameter and download all subsets instead.
  if (options.chars) {
    const textParam = `&text=${encodeURIComponent(options.chars)}`;
    if (cssUrl.length + textParam.length <= 8000) {
      cssUrl += textParam;
    }
  }

  const cssResponse = await fetch(cssUrl, {
    headers: {
      // A non-browser User-Agent triggers .ttf responses from Google Fonts
      'User-Agent': 'tegaki/1.0',
    },
  });

  if (!cssResponse.ok) {
    throw new Error(`Failed to fetch font CSS for "${family}": ${cssResponse.status} ${cssResponse.statusText}`);
  }

  const css = await cssResponse.text();
  const ttfUrls = extractAllTtfUrls(css);

  if (ttfUrls.length === 0) {
    throw new Error(`Could not find any .ttf URLs in Google Fonts CSS for "${family}". The CSS returned:\n${css.slice(0, 500)}`);
  }

  // Download each subset file
  const filenames: string[] = [];
  for (let i = 0; i < ttfUrls.length; i++) {
    const filename = ttfUrls.length === 1 ? `${cacheKey}.ttf` : `${cacheKey}-${i}.ttf`;
    const fontPath = join(cacheDir, filename);

    const fontResponse = await fetch(ttfUrls[i]!);
    if (!fontResponse.ok) {
      throw new Error(`Failed to download font file: ${fontResponse.status} ${fontResponse.statusText}`);
    }

    const buffer = await fontResponse.arrayBuffer();
    await Bun.write(fontPath, buffer);
    filenames.push(filename);
  }

  // Write manifest so the cache knows which files belong to this request
  await Bun.write(manifestPath, JSON.stringify({ paths: filenames }));

  return filenames.map((f) => join(cacheDir, f));
}
