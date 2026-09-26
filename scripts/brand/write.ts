/**
 * Text written by a bundle, laid out on its own timeline: each stroke with its
 * start and duration, and the font's outlines to clip to. Drawing a few
 * moments of it over one another is how the static card shows motion.
 */
import type opentype from 'opentype.js';
import { type BundleLike, type BundleStroke, glyph, glyphOutline } from './lib.ts';

export interface Timed {
  stroke: BundleStroke;
  start: number;
  dur: number;
}

export interface Written {
  strokes: Timed[];
  /** Outline path of the whole text (for clipping / ghosting), in canvas px. */
  outline: string;
  width: number;
  duration: number;
  k: number;
  dx: number;
  dy: number;
}

const GLYPH_GAP = 0.06;
const SPACE_GAP = 0.18;

/** Lay `text` out at `size` px with its baseline at (x, y), and schedule its strokes glyph after glyph. */
export function layoutWriting(
  bundle: BundleLike,
  font: opentype.Font,
  text: string,
  x: number,
  y: number,
  size: number,
  tracking = 0,
): Written {
  const k = size / bundle.unitsPerEm;
  let pen = 0;
  let clock = 0;
  let outline = '';
  const strokes: Timed[] = [];
  for (const ch of text) {
    if (ch === ' ') {
      pen += font.charToGlyph(' ').advanceWidth ?? bundle.unitsPerEm * 0.25;
      clock += SPACE_GAP;
      continue;
    }
    const g = glyph(bundle, ch);
    for (const s of g.s) strokes.push({ stroke: { ...s, p: s.p.map(([px, py, pw]) => [px + pen, py, pw]) }, start: clock + s.d, dur: s.a });
    outline += glyphOutline(font, ch, k, x + pen * k, y);
    pen += g.w + tracking;
    clock += g.t + GLYPH_GAP;
  }
  return { strokes, outline, width: (pen - tracking) * k, duration: clock - GLYPH_GAP, k, dx: x, dy: y };
}

export function progressAt(w: Written, t: number): number[] {
  return w.strokes.map((s) => Math.max(0, Math.min(1, (t - s.start) / s.dur)));
}
