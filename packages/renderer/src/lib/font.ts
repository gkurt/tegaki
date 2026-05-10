import type { TegakiBundle } from '../types.ts';
import { toCssFeatureSettings } from './features.ts';

const fontFaceCache = new Map<string, Promise<void>>();
const resolvedUrls = new Set<string>();

/**
 * Ensures the bundle's font face is loaded and available for rendering.
 * Resolves immediately if the font is already loaded.
 */
export async function ensureFontFace(bundle: TegakiBundle): Promise<void> {
  await ensureFont(bundle.family, bundle.fontUrl, bundle.features, bundle.extraFontUrls);
}

export function ensureFont(family: string, url: string, features?: readonly string[], extraFontUrls?: string[]): Promise<void> | null {
  if (typeof document === 'undefined') return Promise.resolve();
  // Register every subset URL under the same family name. Browsers union
  // glyph coverage across same-family faces via cmap, so Arabic text falls
  // through to an Arabic subset even though the primary face is Latin-only.
  const urls = [url, ...(extraFontUrls ?? [])];
  if (urls.every((u) => resolvedUrls.has(u))) return null;
  // Align DOM shaping with the bundle. Shaper-managed features (Arabic
  // init/medi/fina/isol, rlig) are *omitted* from font-feature-settings
  // because explicitly enabling them suppresses the browser's contextual
  // positional assignment (every glyph would end up the same variant).
  // Legacy bundles without any declared features fall back to disabling
  // liga/calt so 1:1 char-to-glyph fallback holds.
  const featureSettings = toCssFeatureSettings(features ?? []);
  const pending = urls.map((u) => {
    let cached = fontFaceCache.get(u);
    if (!cached) {
      cached = new FontFace(family, `url(${u})`, { featureSettings }).load().then((loaded) => {
        document.fonts.add(loaded);
        resolvedUrls.add(u);
      });
      fontFaceCache.set(u, cached);
    }
    return cached;
  });
  return Promise.all(pending).then(() => {});
}
