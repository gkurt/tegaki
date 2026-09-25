// Registration: map a ReferenceGlyph from its dataset frame onto a specific
// glyph's ink bounding box (font units, y-down screen space).
//
// A per-axis bbox fit is right for full-bodied characters — dataset kanji and
// font glyphs both fill their frames, and letting x/y scale independently
// absorbs style differences (squeezed descenders, wide fonts). It breaks on
// thin characters: 一's reference bbox height is just the centerline's wiggle
// (a few frame units), and stretching that wiggle onto the glyph's full ink
// height (the stroke's THICKNESS) distorts wildly. Axes whose reference span
// is thin relative to the dataset frame therefore borrow the other axis's
// scale and align centers instead of spans.

import type { BBox } from 'tegaki';
import type { ReferenceGlyph, ReferenceStroke, RegisteredReference } from './types.ts';

/** Below this fraction of the dataset frame, an axis span is 'thin' — bbox fitting on it measures noise. */
const THIN_SPAN_RATIO = 0.2;

/** Bounding box of all reference stroke points, in the dataset frame. */
export function referenceBBox(ref: ReferenceGlyph): BBox {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const stroke of ref.strokes) {
    for (const p of stroke.points) {
      if (p.x < x1) x1 = p.x;
      if (p.y < y1) y1 = p.y;
      if (p.x > x2) x2 = p.x;
      if (p.y > y2) y2 = p.y;
    }
  }
  return { x1, y1, x2, y2 };
}

/**
 * Register a reference glyph onto a glyph's ink bbox (`pathBBox` from the
 * geometry pipeline). Centers always align; spans align on axes where the
 * reference has real extent.
 */
export function registerReference(ref: ReferenceGlyph, inkBBox: BBox): RegisteredReference {
  const rb = referenceBBox(ref);
  const refW = rb.x2 - rb.x1;
  const refH = rb.y2 - rb.y1;
  const inkW = inkBBox.x2 - inkBBox.x1;
  const inkH = inkBBox.y2 - inkBBox.y1;

  const thinX = refW < ref.viewBox.width * THIN_SPAN_RATIO;
  const thinY = refH < ref.viewBox.height * THIN_SPAN_RATIO;

  let scaleX = thinX ? Number.NaN : inkW / refW;
  let scaleY = thinY ? Number.NaN : inkH / refH;
  if (Number.isNaN(scaleX) && Number.isNaN(scaleY)) {
    // Dots and other tiny marks: both spans measure noise. Scale the dataset
    // frame down uniformly so the mark keeps its designed proportion, and let
    // center alignment do the real work.
    scaleX = scaleY = Math.max(inkW / ref.viewBox.width, inkH / ref.viewBox.height) || 1;
  } else if (Number.isNaN(scaleX)) {
    scaleX = scaleY;
  } else if (Number.isNaN(scaleY)) {
    scaleY = scaleX;
  }

  // Aligning centers also aligns edges on span-fitted axes.
  const offsetX = (inkBBox.x1 + inkBBox.x2) / 2 - ((rb.x1 + rb.x2) / 2) * scaleX;
  const offsetY = (inkBBox.y1 + inkBBox.y2) / 2 - ((rb.y1 + rb.y2) / 2) * scaleY;

  const strokes: ReferenceStroke[] = ref.strokes.map((s) => ({
    ...(s.type !== undefined ? { type: s.type } : {}),
    ...(s.group !== undefined ? { group: s.group } : {}),
    points: s.points.map((p) => ({ x: p.x * scaleX + offsetX, y: p.y * scaleY + offsetY })),
  }));

  return {
    source: ref.source,
    license: ref.license,
    strokes,
    transform: { scaleX, scaleY, offsetX, offsetY },
  };
}
