import { Blob, Face, Feature, Font, Buffer as HbBuffer, shape } from 'harfbuzzjs';

/**
 * List every feature tag declared in the font's GSUB table — these are the
 * substitutions the font is capable of (ligatures, contextual alternates,
 * positional forms for Arabic, stylistic sets, etc.). We enable all of them
 * during variant discovery so the pipeline captures every glyph the font can
 * produce, not just the `liga`/`calt` subset.
 *
 * `aalt` ("access all alternates") is filtered out: it's a UI/menu feature
 * whose lookups indiscriminately swap every glyph with any alternate to some
 * default alternate. Enabling it would produce a visually destructive bundle
 * that doesn't match what browsers render by default.
 */
export async function getGsubFeatures(fontBuffer: ArrayBuffer): Promise<string[]> {
  const blob = new Blob(fontBuffer);
  const face = new Face(blob, 0);
  // `getTableFeatureTags` returns one entry per (script, language) feature
  // registration, so tags like `ccmp` or `locl` show up once per script the
  // font covers. Dedupe while preserving first-seen order so the UI list
  // stays stable.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of face.getTableFeatureTags('GSUB')) {
    if (tag === 'aalt' || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export interface ShapedGlyph {
  /** OpenType glyph id returned by harfbuzz shaping. */
  g: number;
  /** Source-text cluster (utf16 code-unit offset into the input string). */
  cl: number;
  /** X advance in font units. */
  ax: number;
  /** Y advance in font units. */
  ay: number;
  /** X offset (displacement from pen position) in font units. */
  dx: number;
  /** Y offset (displacement from pen position) in font units. */
  dy: number;
}

export interface HbShaper {
  /** Shape `text`, returning one entry per output glyph. */
  shape(text: string): ShapedGlyph[];
  /** Glyph id the font would emit for `char` with no shaping / features. */
  charToGlyphId(char: string): number;
  destroy(): void;
}

/**
 * Create a harfbuzz shaper bound to `fontBuffer`. `features` are applied on
 * top of harfbuzz's script-based defaults during shaping. Pass the font's
 * GSUB feature list (see `getGsubFeatures`) to surface every substitution the
 * font can produce. The resulting shaper is stateful and owns wasm memory —
 * call `destroy()` when done.
 */
// Features harfbuzz's complex-text shapers apply context-sensitively based on
// script. Passing them in the explicit enable list makes HB apply them
// unconditionally across the whole text range, which breaks positional
// assignment — e.g. every Arabic glyph collapses to the `fina` variant.
// Leave these to HB's script defaults.
const SHAPER_MANAGED_FEATURES = new Set(['init', 'medi', 'fina', 'isol', 'rlig']);

export async function createHbShaper(fontBuffer: ArrayBuffer, features: string[] = []): Promise<HbShaper> {
  const blob = new Blob(fontBuffer);
  const face = new Face(blob, 0);
  const font = new Font(face);
  const featureList: Feature[] = [];
  for (const tag of features) {
    if (SHAPER_MANAGED_FEATURES.has(tag)) continue;
    const f = Feature.fromString(tag);
    if (f) featureList.push(f);
  }

  // A fresh buffer per shape keeps state isolated and avoids the need to
  // guess-reset between calls. Shaping is cheap; reusing a buffer would only
  // matter in very tight loops.
  const shapeText = (text: string): ShapedGlyph[] => {
    const buffer = new HbBuffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    shape(font, buffer, featureList);
    const infos = buffer.getGlyphInfosAndPositions();
    return infos.map((g) => ({
      g: g.codepoint,
      cl: g.cluster,
      ax: g.xAdvance ?? 0,
      ay: g.yAdvance ?? 0,
      dx: g.xOffset ?? 0,
      dy: g.yOffset ?? 0,
    }));
  };

  // Pre-parse the "no shaping" feature list once; reused for every charToGlyphId call.
  const nominalFeatures: Feature[] = [];
  for (const tag of ['-liga', '-calt', '-clig', '-dlig', '-rlig']) {
    const f = Feature.fromString(tag);
    if (f) nominalFeatures.push(f);
  }

  const charToGlyphId = (char: string): number => {
    // Shape the char with all features disabled to get the nominal glyph id.
    // Faster than querying the cmap via a dedicated API and produces the same
    // result for isolated characters.
    const buffer = new HbBuffer();
    buffer.addText(char);
    buffer.guessSegmentProperties();
    shape(font, buffer, nominalFeatures);
    const infos = buffer.getGlyphInfos();
    return infos[0]?.codepoint ?? 0;
  };

  return {
    shape: shapeText,
    charToGlyphId,
    destroy() {
      // Finalization-registry based destruction means explicit destroy is a
      // no-op for objects we still hold references to; release our refs to
      // let GC clean up.
    },
  };
}
