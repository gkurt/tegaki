import { COMPATIBLE_BUNDLE_VERSIONS, type TegakiBundle } from '../types.ts';

const bundles = new Map<string, TegakiBundle>();
const warnedBundles = new Set<TegakiBundle>();

function checkBundleVersion(bundle: TegakiBundle): void {
  if (warnedBundles.has(bundle)) return;
  if (bundle.version == null || !COMPATIBLE_BUNDLE_VERSIONS.has(bundle.version)) {
    warnedBundles.add(bundle);
    console.warn(
      `[tegaki] Bundle "${bundle.family}" has version ${bundle.version ?? 'undefined'}, ` +
        `but this engine supports versions [${[...COMPATIBLE_BUNDLE_VERSIONS].join(', ')}]. ` +
        'The bundle may not render correctly. Regenerate it with a compatible version of tegaki-generator.',
    );
  }
}

/** Register a font bundle so it can be referenced by family name. */
export function registerBundle(bundle: TegakiBundle): void {
  checkBundleVersion(bundle);
  bundles.set(bundle.family, bundle);
  if (bundle.fullFamily && bundle.fullFamily !== bundle.family) {
    bundles.set(bundle.fullFamily, bundle);
  }
}

/** Look up a registered bundle by family name. */
export function getBundle(family: string): TegakiBundle | undefined {
  return bundles.get(family);
}

export function resolveBundle(font: TegakiBundle | string | undefined): TegakiBundle | undefined {
  if (typeof font === 'string') {
    const bundle = getBundle(font);
    if (!bundle) throw new Error(`TegakiEngine: no bundle registered for "${font}". Call TegakiEngine.registerBundle() first.`);
    return bundle;
  }
  if (font) checkBundleVersion(font);
  return font;
}
