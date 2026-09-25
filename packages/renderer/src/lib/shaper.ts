export interface ShapedGlyph {
  /**
   * Shaper output key — the opentype glyph id for primary-subset glyphs (e.g.
   * `"42"`), or `"<subsetIndex>:<gid>"` for glyphs from an `extraFontUrls`
   * subset (e.g. `"1:42"`). Used directly to look up `glyphDataById`.
   */
  g: string;
  /** Cluster offset (utf16 code-unit index into the shaped substring). */
  cl: number;
  /** X advance in font units. */
  ax: number;
  /** Y advance in font units. */
  ay: number;
  /** X offset (displacement from pen position) in font units. */
  dx: number;
  /** Y offset (displacement from pen position) in font units. */
  dy: number;
  /**
   * The shaping run the glyph came from, when the shaper splits the text into
   * several (a subset, direction or script switch, or a wrapped line's ends
   * reshaped on their own). Runs come back in logical order,
   * each in its own visual order, so the layout anchors each where the DOM's
   * bidi put it instead of walking one into the next.
   */
  run?: number;
}

export interface ShapeOptions {
  /**
   * The text is drawn with non-zero `letter-spacing`. Browsers then drop
   * optional ligatures and contextual alternates (CSS Text: no optional
   * ligatures between spaced letters; Chrome drops `calt` too), so the
   * shaper must drop them as well to pick the glyphs the DOM draws.
   */
  letterSpaced?: boolean;
  /**
   * The paragraph's base direction, as the DOM lays it out. A run of only
   * direction-neutral characters (a bracket between spaces, or one in a font
   * subset of its own) is shaped in the direction bidi resolves it to, so it
   * is mirrored where the browser mirrors it. Defaults to `dir="auto"`'s
   * pick for the text shaped — pass it when shaping a paragraph line by line.
   */
  direction?: 'ltr' | 'rtl';
  /**
   * The script the text before this line ends in (see `trailingScript`).
   * The DOM itemizes the whole text, so punctuation opening a line takes the
   * script of the line above — `Hi` then `(العالم)` draws a Latin `(` —
   * where the line shaped alone would give it the Arabic after it.
   */
  scriptBefore?: string | null;
  /**
   * The UTF-16 offsets where the layout wraps the text onto a new line (not
   * `\n`s: shape each paragraph on its own). The text is shaped whole as one
   * paragraph, as the browser shapes it, and each wrapped line's ends are
   * reshaped where the browser reshapes them — so pass the wraps the DOM
   * made, or the glyphs around them won't be the ones it draws.
   */
  lineBreaks?: readonly number[];
}

export interface BundleShaper {
  shape(text: string, options?: ShapeOptions): ShapedGlyph[];
  /**
   * A shaped glyph's outline (a `ShapedGlyph.g` key) as SVG path data in font
   * units, y up — how SVG export draws text without embedding the font.
   * Optional; null when the glyph is unknown.
   */
  glyphPath?(g: string): string | null;
}
