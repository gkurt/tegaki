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
   * The shaping run the glyph came from, when the shaper splits a word into
   * several (a subset or direction switch). Runs come back in logical order,
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
}

export interface BundleShaper {
  shape(text: string, options?: ShapeOptions): ShapedGlyph[];
}
