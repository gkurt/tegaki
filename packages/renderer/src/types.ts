/**
 * Current bundle format version: 1 since tegaki 1.0, which fixed the format.
 * Incremented only when the format changes in a way that older engines cannot
 * consume; new optional fields don't change it.
 */
export const BUNDLE_VERSION = 1;

/**
 * Set of bundle versions that this engine can consume. The engine logs a
 * console warning (once per bundle) when it encounters a version outside
 * this set. Version 0, the pre-1.0 bundles, is the same format, so it's read
 * as it is.
 */
export const COMPATIBLE_BUNDLE_VERSIONS: ReadonlySet<number> = new Set([0, BUNDLE_VERSION]);

export type LineCap = 'round' | 'butt' | 'square';

export interface Point {
  x: number;
  y: number;
}

/**
 * An elliptic ink stamp the pen leaves at a point: ink beyond the round pen's
 * reach (the point of a V, a pointed terminal, a bulge on a shoulder), drawn
 * as the pen passes the point — the pen pressed and turned for an instant.
 * Coordinates share the glyph's units and frame (y-down).
 */
export interface Nib {
  /** Ellipse center relative to the point. */
  dx: number;
  dy: number;
  /** Full diameter along `angle`. */
  major: number;
  /** Full diameter across `angle`. */
  minor: number;
  /** Direction of the major axis, radians. */
  angle: number;
}

export interface TimedPoint extends Point {
  t: number;
  width: number;
  nib?: Nib;
}

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Stroke {
  points: TimedPoint[];
  order: number;
  length: number;
  animationDuration: number;
  delay: number;
  /**
   * Draw-priority rank. `0` (default) is the glyph body; negative numbers are
   * rendered later within word-level scheduling, one phase per value, highest
   * first, after every body stroke in the word:
   * - `-0.5` — a headline (Devanagari shirorekha, Bengali matra). Values in
   *   (−1, 0) are CONNECTING tiers: their phase runs glyph to glyph without
   *   a gap, so the pieces draw as one line across the word.
   * - `-1` — disconnected marks: i-dots, Arabic nuqṭa, diacritics.
   * The range is open for future priority tiers.
   */
  priority?: number;
}

export interface GlyphData {
  char: string;
  unicode: number;
  advanceWidth: number;
  boundingBox: BBox;
  path: string;
  skeleton: Point[][];
  strokes: Stroke[];
  totalLength: number;
  totalAnimationDuration: number;
}

export interface FontOutput {
  font: {
    family: string;
    style: string;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    lineCap: LineCap;
  };
  glyphs: Record<string, GlyphData>;
}

export interface PathCommand {
  type: 'M' | 'L' | 'Q' | 'C' | 'Z';
  x: number;
  y: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

/**
 * Compact glyph data for rendering.
 * - `w`: advance width
 * - `t`: total animation duration
 * - `s`: strokes, each with `p` (points as `[x, y, width]` tuples), `d` (delay),
 *   `a` (animation duration), optional `r` (priority — see `Stroke.priority`;
 *   omitted when `0`), and optional `n` (nibs — see `Nib`; omitted when none)
 */
export interface TegakiGlyphData {
  w: number;
  t: number;
  s: {
    p: ([x: number, y: number, width: number] | number[])[];
    d: number;
    a: number;
    r?: number;
    /** Nib stamps as `[pointIndex, dx, dy, major, minor, angle]` (see `Nib`). */
    n?: ([pointIndex: number, dx: number, dy: number, major: number, minor: number, angle: number] | number[])[];
  }[];
}

export interface TegakiBundle {
  /** Bundle format version. Used by the engine to warn about incompatible bundles. */
  version?: number;
  family: string;
  /**
   * Original font family name, used as a CSS fallback for characters not in
   * the generated glyph set. Present when the bundle was generated from a
   * subset of the font (the default). When absent, `family` is the original
   * name (full-font bundle).
   */
  fullFamily?: string;
  lineCap: LineCap;
  fontUrl: string;
  /**
   * Additional subset font URLs (e.g. Arabic/Hebrew/CJK subsets served alongside
   * Latin). Registered under the same `family` as `fontUrl` for DOM layout and
   * fed into the shaper so cross-script text gets shaped against the subset
   * that actually contains its glyphs — required for positional forms in
   * Arabic, conjuncts in Indic, etc.
   */
  extraFontUrls?: readonly string[];
  /**
   * CSS `unicode-range` for each `extraFontUrls` face: the characters it has
   * that neither the primary nor an earlier subset does, which is where the
   * shaper draws them from. Without it the browser, which tries same-family
   * faces last-first, can draw a character with a different subset than the
   * strokes (an unmirrorable bracket in Arabic text). An empty range means
   * the subset adds nothing, so it isn't registered for DOM text.
   */
  extraFontRanges?: readonly string[];
  /** URL to the full (non-subsetted) font file bundled for fallback rendering. */
  fullFontUrl?: string;
  fontFaceCSS: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  /** Default glyphs keyed by character. Used as a fallback when a shaped glyph id is absent. */
  glyphData: Record<string, TegakiGlyphData>;
  /**
   * Glyphs keyed by shaper output. Populated when the bundle was generated
   * with ligature/contextual-alternate support. Keys are the shaper's
   * opentype glyph id as a string (e.g. `"42"`) for glyphs from the primary
   * font, or `"<subsetIndex>:<gid>"` (e.g. `"1:42"`) for glyphs from an
   * `extraFontUrls` subset — subset index matches the position in
   * `extraFontUrls` + 1 (0 is reserved for the primary). Includes every glyph
   * the shaper emits — nominal, ligature, contextual variant — so a shaped
   * glyph never needs to fall back through `glyphData[char]`. That fallback
   * is brittle for complex-script clusters where `entry.char` is a
   * multi-codepoint grapheme (Devanagari `"हि"`, `"स्ते"`) and `glyphData`
   * is keyed per single codepoint. Misses still fall back to `glyphData[char]`
   * for the no-shaper path.
   */
  glyphDataById?: Record<string, TegakiGlyphData>;
  /**
   * OpenType feature tags the bundle was generated with (e.g. `['liga', 'calt']`).
   * The renderer enables these during shaping. Absent when no variant glyphs
   * were generated.
   */
  features?: readonly string[];
}
