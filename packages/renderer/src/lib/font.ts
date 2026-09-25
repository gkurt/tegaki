import type { TegakiBundle } from '../types.ts';
import { toCssFeatureSettings } from './features.ts';

/**
 * One registered face per font URL, with the `font-feature-settings` it was
 * made with: the same file under other settings (a feature toggled off) is a
 * different face.
 */
interface CachedFace {
  settings: string;
  pending: Promise<void>;
  /** The loaded face, once registered. */
  face: FontFace | null;
  /** The face this one takes over from — removed once this one is added. */
  replaces: FontFace | null;
}
const fontFaces = new Map<string, CachedFace>();

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
  // Align DOM shaping with the bundle. Shaper-managed features (Arabic
  // init/medi/fina/isol, rlig) are *omitted* from font-feature-settings
  // because explicitly enabling them suppresses the browser's contextual
  // positional assignment (every glyph would end up the same variant).
  // Legacy bundles without any declared features fall back to disabling
  // liga/calt so 1:1 char-to-glyph fallback holds.
  const featureSettings = toCssFeatureSettings(features ?? []);
  if (urls.every((u) => fontFaces.get(u)?.settings === featureSettings && fontFaces.get(u)?.face)) return null;
  const pending = urls.map((u) => {
    const cached = fontFaces.get(u);
    if (cached?.settings === featureSettings) return cached.pending;
    const entry: CachedFace = {
      settings: featureSettings,
      pending: Promise.resolve(),
      face: null,
      replaces: cached ? (cached.face ?? cached.replaces) : null,
    };
    entry.pending = new FontFace(family, `url(${u})`, { featureSettings }).load().then((loaded) => {
      // Swap in place once the new face is ready, so text never falls back
      // to another font in between; a newer request for this URL wins.
      if (fontFaces.get(u) !== entry) return;
      document.fonts.add(loaded);
      if (entry.replaces) document.fonts.delete(entry.replaces);
      entry.face = loaded;
    });
    fontFaces.set(u, entry);
    return entry.pending;
  });
  return Promise.all(pending).then(() => {});
}
