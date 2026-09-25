// Stroke-order reference data — the dataset side of dataset-driven ordering.
//
// A StrokeOrderProvider supplies, per character, the PRESCRIBED strokes: how
// many, in what order, drawn in which direction, in the dataset's own
// coordinate frame. The geometry pipeline extracts strokes from the actual
// font; matching the two is a later stage. Providers never contribute
// geometry to output bundles — reference polylines inform order/direction/
// pairing decisions only, so dataset licenses (CC BY-SA, Arphic PL) do not
// attach to generated bundles.

import type { Point } from 'tegaki';

/** One prescribed stroke: a centerline polyline ordered in pen direction. */
export interface ReferenceStroke {
  /** Flattened centerline in the dataset's viewBox coordinates (y-down). */
  points: Point[];
  /** Dataset stroke-type label when available (e.g. KanjiVG kvg:type "㇐"). */
  type?: string;
  /**
   * Component the stroke belongs to (Hangul: which jamo of the syllable).
   * Guided ordering re-fits each component onto the ink on its own, since
   * handwriting fonts place components far from a textbook layout.
   */
  group?: number;
}

/** All prescribed strokes for one character, in draw order. */
export interface ReferenceGlyph {
  char: string;
  strokes: ReferenceStroke[];
  /** Dataset coordinate frame (KanjiVG: 109×109, y-down, origin top-left). */
  viewBox: { width: number; height: number };
  /** Provider name, e.g. 'kanjivg'. */
  source: string;
  /** Attribution carried with the data (required by CC BY-SA etc.). */
  license: string;
}

/** A source of per-character stroke-order reference data. */
export interface StrokeOrderProvider {
  readonly name: string;
  /** Reference strokes for a character, or null when the dataset has no entry. */
  get(char: string): Promise<ReferenceGlyph | null>;
}

/** Affine map from dataset frame to font units: p' = p·scale + offset. */
export interface ReferenceTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

/** A ReferenceGlyph registered onto a specific glyph's ink (font units, y-down). */
export interface RegisteredReference {
  source: string;
  license: string;
  /** Reference strokes mapped into the glyph's font-unit space, draw order preserved. */
  strokes: ReferenceStroke[];
  transform: ReferenceTransform;
}
