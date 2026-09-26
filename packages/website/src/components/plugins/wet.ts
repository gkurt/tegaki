import { createPlugin, offsetPath, type PathPoint, type StrokeFrame, type StrokePath } from 'tegaki/core';
import { canvasColor, mix, type Rgba, rgba } from './color.ts';

const WHITE: Rgba = [255, 255, 255, 1];

const smooth = (f: number) => f * f * (3 - 2 * f);

/**
 * Seconds since the pen passed the point at draw progress `t` of `stroke`,
 * at timeline time `time` — negative where it hasn't got to yet. Reads the
 * pen as moving through the stroke at an even pace, which the stroke's
 * easing bends a little; close enough for ink drying.
 */
export function inkAge(stroke: Pick<StrokeFrame, 'start' | 'duration'>, t: number, time: number): number {
  return time - (stroke.start + stroke.duration * t);
}

/** How dry ink of age `age` is, 0 (just laid) to 1 (dry after `dry` seconds), easing in and out. */
export function dryness(age: number, dry: number): number {
  return dry <= 0 ? 1 : smooth(Math.max(0, Math.min(1, age / dry)));
}

/**
 * Where ink pools along a stroke, as a factor on its width: where the pen
 * touches down and lifts off, and at sharp turns, where it slows — over
 * about a stroke's width of the line. `pool` (0–1) is how much it swells.
 */
export function poolFactors(points: readonly PathPoint[], pool: number): number[] {
  const n = points.length;
  if (n < 2 || pool <= 0) return points.map(() => 1);
  const along = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const total = along[n - 1]!;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const reach = Math.max(1, points[i]!.width);
    const bump = (d: number) => Math.exp(-((d / reach) ** 2));
    // The start pools most: the pen rests there before it moves.
    let f = 0.6 * bump(along[i]!) + 0.4 * bump(total - along[i]!);
    // A turn: the angle between the way in and the way out, a width either side.
    let a = i;
    let b = i;
    while (a > 0 && along[i]! - along[a]! < reach) a--;
    while (b < n - 1 && along[b]! - along[i]! < reach) b++;
    if (a < i && b > i) {
      const p = points[i]!;
      const din = Math.atan2(p.y - points[a]!.y, p.x - points[a]!.x);
      const dout = Math.atan2(points[b]!.y - p.y, points[b]!.x - p.x);
      const turn = Math.abs(Math.atan2(Math.sin(dout - din), Math.cos(dout - din)));
      f = Math.max(f, 0.5 * Math.max(0, turn - 0.6));
    }
    out.push(1 + pool * Math.min(1, f));
  }
  return out;
}

/**
 * Ink that's wet as it goes down: fresh ink is dark and glossy — a sheen of
 * light along it — and dries lighter over a second or so, so the pen leaves
 * a trail of drying ink behind it. A `paint` plugin: it paints the stroke
 * in a color that changes along it with the time since the pen passed each
 * point (`time` against the stroke's `start` and `duration`), then the
 * sheen over the part still wet. Dry ink is mixed toward white, so it's
 * lighter on light paper. With `pool`, a `geometry` hook swells the ink
 * where the pen slows — touching down, lifting off, turning sharply.
 */
export const wetPlugin = createPlugin({
  name: 'wet',
  label: 'Wet ink',
  description: 'Fresh ink dark and glossy, drying lighter behind the pen. paint.',
  params: {
    dry: { type: 'number', label: 'Drying time', description: 'Seconds the ink takes to dry.', default: 1.5, min: 0.2, max: 6, step: 0.1 },
    fade: { type: 'number', label: 'Fade', description: 'How much lighter dry ink is.', default: 0.3, min: 0, max: 0.8, step: 0.05 },
    sheen: { type: 'number', label: 'Sheen', description: 'The gloss on wet ink.', default: 0.55, min: 0, max: 1, step: 0.05 },
    pool: {
      type: 'number',
      label: 'Pooling',
      description: 'How much the ink swells where the pen slows: touching down, lifting off, at sharp turns.',
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.05,
    },
  },
  presets: {
    'Fountain pen': { dry: 2.5, fade: 0.3, sheen: 0.7, pool: 0.45 },
    'Dip pen': { dry: 1.2, fade: 0.25, sheen: 0.5, pool: 0.9 },
    'Quick dry': { dry: 0.5, fade: 0.2, sheen: 0.35 },
    Watercolor: { dry: 4, fade: 0.6, sheen: 0 },
  },
  setup: ({ dry, fade, sheen, pool }) => {
    const sheens = new WeakMap<StrokePath, StrokePath>();
    // The sheen: a thin line along the ink, a little up and to the left of its middle, where light catches the bead.
    const sheenOf = (path: StrokePath) => {
      let s = sheens.get(path);
      if (!s) {
        s = offsetPath(path, (p) => -p.width * 0.22).map((p) => ({ ...p, width: p.width * 0.1 }));
        sheens.set(path, s);
      }
      return s;
    };
    return {
      geometry(path) {
        if (pool <= 0) return path;
        const factors = poolFactors(path.points, pool);
        let i = 0;
        return path.map((p) => ({ ...p, width: p.width * factors[i++]! }));
      },
      paint(s, next) {
        const { stroke, time } = s;
        const ink = typeof s.style === 'string' ? canvasColor(s.ctx, s.style) : null;
        // A gradient or a pattern: nothing to dry.
        if (!ink) return next(s);
        const age = (t: number) => inkAge(stroke, t, time);
        // Opaque colors, mixed toward white: a stroke of varying width is painted a
        // segment at a time, and see-through segments would darken where they overlap.
        const tone = (toward: number) => rgba(mix(ink, WHITE, toward));
        const dried = tone(fade);
        const allDry = age(stroke.progress) >= dry;
        // All dry: one flat color, painted in one go.
        next({ ...s, style: allDry ? dried : (t) => tone(fade * dryness(age(t), dry)) });
        // The gloss goes before the color settles: it's on the ink nearest the pen.
        if (sheen <= 0 || age(stroke.progress) >= dry / 2 || stroke.path.points.length < 2) return;
        const gloss = (t: number) => {
          const wet = 1 - dryness(age(t), dry / 2);
          return tone(fade * dryness(age(t), dry) + (1 - fade) * sheen * 0.6 * wet);
        };
        next({ ...s, style: gloss, stroke: { ...stroke, path: sheenOf(stroke.path), nibs: [] } });
      },
    };
  },
});
