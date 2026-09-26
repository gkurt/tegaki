/**
 * Text written by a bundle *at a moment of its animation*: strokes clipped to
 * the font's outlines, drawn up to time `t`, the current stroke's pen tip
 * marked. Stacking a few moments of one word (onion skin) is how the static
 * cards show motion.
 */
import type opentype from 'opentype.js';
import { type BundleLike, type BundleStroke, drawStrokes, f, glyph, glyphOutline, penWidth, pointAt, STROKE_GROUP } from './lib.ts';

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

export interface MomentOpts {
  id: string;
  /** Seconds, or a fraction of the duration when `fraction` is set. */
  t: number;
  fraction?: boolean;
  ink: string;
  /** Colour of the stroke being written (the pen's). */
  accent?: string;
  ghost?: { color: string; opacity: number };
  nib?: boolean;
  weight?: number;
  opacity?: number;
  /** Translate the whole moment (onion-skin drift). */
  shift?: [number, number];
}

export function progressAt(w: Written, t: number): number[] {
  return w.strokes.map((s) => Math.max(0, Math.min(1, (t - s.start) / s.dur)));
}

/** One moment of the writing. */
export function moment(w: Written, o: MomentOpts): string {
  const t = o.fraction ? o.t * w.duration : o.t;
  const prog = progressAt(w, t);
  const current = prog.findIndex((p) => p > 0 && p < 1);
  let out = `<clipPath id="${o.id}-c"><path d="${w.outline}"/></clipPath>`;
  if (o.ghost) out += `<path d="${w.outline}" fill="${o.ghost.color}" opacity="${o.ghost.opacity}"/>`;
  out += `<g clip-path="url(#${o.id}-c)" ${STROKE_GROUP}>${drawStrokes(
    w.strokes.map((s) => s.stroke),
    {
      k: w.k,
      dx: w.dx,
      dy: w.dy,
      color: o.ink,
      weight: o.weight ?? 1.6,
      progress: (i) => prog[i]!,
      strokeColor: (i) => (i === current && o.accent ? o.accent : undefined),
    },
  )}</g>`;
  if (o.nib && current >= 0) {
    const s = w.strokes[current]!.stroke;
    const [px, py] = pointAt(s.p, prog[current]!);
    const r = penWidth(s) * w.k * 0.55;
    const cx = px * w.k + w.dx;
    const cy = py * w.k + w.dy;
    out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 3.2)}" fill="${o.accent ?? o.ink}" opacity="0.12"/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${o.accent ?? o.ink}"/>`;
  }
  const attrs = [
    o.opacity != null && o.opacity < 1 ? `opacity="${f(o.opacity)}"` : '',
    o.shift ? `transform="translate(${f(o.shift[0])} ${f(o.shift[1])})"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return attrs ? `<g ${attrs}>${out}</g>` : out;
}

/** Where the pen is at time t (canvas px), if it's mid-stroke. */
export function penAt(w: Written, t: number): [number, number] | null {
  const prog = progressAt(w, t);
  const i = prog.findIndex((p) => p > 0 && p < 1);
  if (i < 0) return null;
  const [px, py] = pointAt(w.strokes[i]!.stroke.p, prog[i]!);
  return [px * w.k + w.dx, py * w.k + w.dy];
}
