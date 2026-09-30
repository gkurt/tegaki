import { lengthToPx, type TegakiLength } from '../core/createPlugin.ts';
import type { GlyphPlacement } from '../lib/strokeTimeline.ts';

/** A point in a glyph's own font units: x from its origin, y down from its baseline. */
export interface FontPoint {
  x: number;
  y: number;
}

/** A length param as ems of `fontSize`, what the glyph fields measure in: `0.02` stays 0.02, `'2px'` at 100px is 0.02. */
export function inEms(length: TegakiLength, fontSize: number): number {
  return fontSize > 0 ? lengthToPx(length, fontSize) / fontSize : 0;
}

/**
 * `field` — a way of moving a glyph's points, in its own font units — as a
 * move of points in text-box px, for the glyph at `place`. Strokes (in
 * `geometry`) and outline contours (in `outline`) go through the same one,
 * so clip-to-text follows the ink.
 */
export function inPx(field: (p: FontPoint) => FontPoint, place: GlyphPlacement) {
  return <P extends { x: number; y: number }>(p: P): P => {
    const moved = field({ x: (p.x - place.x) / place.scale, y: (p.y - place.y) / place.scale - place.ascender });
    return { ...p, x: place.x + moved.x * place.scale, y: place.y + (moved.y + place.ascender) * place.scale };
  };
}
