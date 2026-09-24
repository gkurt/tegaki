import type { TegakiGlyphData } from '../types.ts';

/**
 * Extent of a glyph's strokes in font units (the glyph's own frame: x from
 * the pen origin, y down from the ascender line as `drawGlyph` maps it).
 * `min*` / `max*` bound the centerlines and nib stamps' centers; `reach` is
 * the widest half-width around them, kept apart so a caller can scale it
 * with the stroke width (clip-to-text draws strokes wider).
 */
export interface GlyphInkBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  reach: number;
}

const cache = new WeakMap<TegakiGlyphData, GlyphInkBounds | null>();

/** Ink bounds of `glyph`, or null when it has no points. Cached per glyph object. */
export function glyphInkBounds(glyph: TegakiGlyphData): GlyphInkBounds | null {
  let bounds = cache.get(glyph);
  if (bounds !== undefined) return bounds;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let reach = 0;
  const add = (x: number, y: number, halfWidth: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (halfWidth > reach) reach = halfWidth;
  };
  for (const stroke of glyph.s) {
    for (const p of stroke.p) add(p[0]!, p[1]!, Math.max(p[2] ?? 0, 0.5) / 2);
    for (const n of stroke.n ?? []) {
      const p = stroke.p[n[0]!];
      if (p) add(p[0]! + n[1]!, p[1]! + n[2]!, Math.max(n[3]!, n[4]!) / 2);
    }
  }
  bounds = Number.isFinite(minX) ? { minX, minY, maxX, maxY, reach } : null;
  cache.set(glyph, bounds);
  return bounds;
}

/** How far the drawing reaches past the canvas's default box, per side, in CSS px. */
export interface CanvasOverflow {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const NO_OVERFLOW: CanvasOverflow = { left: 0, top: 0, right: 0, bottom: 0 };

/**
 * The overflow of an ink box (CSS px, in the default canvas box's frame:
 * 0..width × 0..height) past that box, rounded up to whole pixels so a
 * sub-pixel change doesn't restyle the canvas.
 */
export function inkOverflow(
  ink: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
): CanvasOverflow {
  if (!(ink.minX <= ink.maxX)) return NO_OVERFLOW;
  return {
    left: Math.ceil(Math.max(0, -ink.minX)),
    top: Math.ceil(Math.max(0, -ink.minY)),
    right: Math.ceil(Math.max(0, ink.maxX - width)),
    bottom: Math.ceil(Math.max(0, ink.maxY - height)),
  };
}
