import { createPlugin, type StrokePath } from 'tegaki/core';

/**
 * How wide a broad nib draws moving in `direction` (radians, canvas axes):
 * full width across the nib's edge, down to `1 - contrast` along it. `edge`
 * is the edge's angle up from the baseline, in degrees — 45° is the italic
 * hand's.
 */
export function nibFactor(direction: number, edge: number, contrast: number): number {
  // Canvas y runs down, so an edge rising to the right points at -edge.
  const across = Math.abs(Math.sin(direction + (edge * Math.PI) / 180));
  return 1 - contrast + contrast * across;
}

/** How far to look either side of a point for the way the stroke runs, in px — past the jitter of a subdivided polyline. */
const LOOK = 3;

/**
 * `path` drawn with a broad nib: each point's width by the way the stroke
 * runs there, averaged over about a stroke's width of its length either
 * side — a pen's width doesn't jump from point to point.
 */
export function broadNib(path: StrokePath, o: { angle: number; contrast: number; weight: number }): StrokePath {
  const pts = path.points;
  if (pts.length < 2) return path.map((p) => ({ ...p, width: p.width * o.weight }));
  // Distance along the path, to find the points so far either side.
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  const within = (reach: (i: number) => number, visit: (i: number, lo: number, hi: number) => void) => {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < pts.length; i++) {
      const r = reach(i);
      while (along[i]! - along[lo]! > r && lo < i) lo++;
      if (hi < i) hi = i;
      while (hi < pts.length - 1 && along[hi + 1]! - along[i]! <= r) hi++;
      visit(i, lo, hi);
    }
  };
  const factors: number[] = [];
  within(
    () => LOOK,
    (i, lo, hi) => {
      const a = pts[lo === i && i > 0 ? i - 1 : lo]!;
      const b = pts[hi === i && i < pts.length - 1 ? i + 1 : hi]!;
      factors.push(nibFactor(Math.atan2(b.y - a.y, b.x - a.x), o.angle, o.contrast));
    },
  );
  const sums = [0];
  for (const f of factors) sums.push(sums.at(-1)! + f);
  const widths: number[] = [];
  within(
    (i) => Math.max(LOOK, pts[i]!.width * 0.75),
    (i, lo, hi) => widths.push(pts[i]!.width * o.weight * ((sums[hi + 1]! - sums[lo]!) / (hi - lo + 1))),
  );
  let i = 0;
  return path.map((p) => ({ ...p, width: widths[i++]! }));
}

/**
 * A broad-edged pen, as in calligraphy: the ink is widest where the stroke
 * runs across the nib's edge and a hairline where it runs along it, so the
 * same letters take on thick and thin by their direction alone. A `geometry`
 * plugin — it only changes widths, once per layout.
 */
export const nibPlugin = createPlugin({
  name: 'nib',
  label: 'Broad nib',
  description:
    'A calligraphy pen: thick and thin by the way each stroke runs. geometry — turn Clip to text off (Style → Rendering) to see the full width.',
  params: {
    angle: {
      type: 'number',
      label: 'Angle',
      description: "The nib's edge, in degrees up from the baseline.",
      default: 40,
      min: 0,
      max: 90,
      step: 1,
    },
    contrast: { type: 'number', label: 'Contrast', description: 'How thin the hairlines get.', default: 0.85, min: 0, max: 1, step: 0.05 },
    weight: {
      type: 'number',
      label: 'Weight',
      description: "The nib's width, against the stroke's.",
      default: 1.5,
      min: 0.5,
      max: 3,
      step: 0.1,
    },
  },
  presets: {
    Italic: { angle: 45, contrast: 0.85, weight: 1.6 },
    Uncial: { angle: 20, contrast: 0.7, weight: 2 },
    Marker: { angle: 30, contrast: 0.4, weight: 1.2 },
  },
  setup: (options) => ({ geometry: (path) => broadNib(path, options) }),
});
