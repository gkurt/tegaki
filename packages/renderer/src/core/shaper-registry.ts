import type { BundleShaper } from '../lib/shaper.ts';
import type { TegakiBundle } from '../types.ts';

/**
 * Factory invoked once per bundle to produce (or decline) a shaper.
 *
 * Return `null` when the bundle doesn't need shaping or the environment can't
 * run it — the renderer falls back to its char-keyed glyph path. Return a
 * `Promise<BundleShaper>` when shaper init is async (wasm load, font fetch).
 */
export type ShaperFactory = (bundle: TegakiBundle) => Promise<BundleShaper> | null;

let factory: ShaperFactory | null = null;
const shaperCache = new Map<string, Promise<BundleShaper>>();
/** Settled shapers by the same key — `null` for one that failed to build. */
const settledShapers = new Map<string, BundleShaper | null>();

/**
 * A shaper is built from the bundle's font files and features, so a bundle
 * that changes either (a feature toggled off) needs its own.
 */
function shaperKey(bundle: TegakiBundle): string {
  return JSON.stringify([bundle.fontUrl, bundle.extraFontUrls ?? [], bundle.features ?? []]);
}

/**
 * Register a shaper factory. Shaping is opt-in — without a registered factory,
 * the renderer iterates raw graphemes and uses the bundle's char-keyed
 * `glyphData` map. Use `tegaki/shaper-harfbuzz` for fonts that need complex
 * shaping (ligatures, contextual forms, Arabic/Indic scripts).
 *
 * Re-registering replaces the previous factory and invalidates the shaper
 * cache. Pass `null` to unregister.
 */
export function registerShaper(f: ShaperFactory | null): void {
  factory = f;
  shaperCache.clear();
  settledShapers.clear();
}

/**
 * Build (or reuse) a shaper for a bundle. Returns `null` when no factory is
 * registered or the factory declined this bundle.
 */
export function getShaperForBundle(bundle: TegakiBundle): Promise<BundleShaper> | null {
  if (!factory) return null;
  const key = shaperKey(bundle);
  let entry = shaperCache.get(key);
  if (!entry) {
    const result = factory(bundle);
    if (!result) return null;
    shaperCache.set(key, result);
    result.then(
      (shaper) => settledShapers.set(key, shaper),
      () => settledShapers.set(key, null),
    );
    entry = result;
  }
  return entry;
}

/**
 * The bundle's shaper if it has already been built — `null` when it failed to
 * build, `undefined` while it is still building (or was never requested). Lets
 * the engine switch to a bundle whose shaper is ready without a frame drawn
 * unshaped while it awaits the cached promise.
 */
export function settledShaperForBundle(bundle: TegakiBundle): BundleShaper | null | undefined {
  return settledShapers.get(shaperKey(bundle));
}
