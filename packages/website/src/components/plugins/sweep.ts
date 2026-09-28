import { createPlugin, type StrokePath, type StrokeTime } from 'tegaki/core';

export type SweepMode = 'wipe' | 'rise' | 'center' | 'scatter' | 'together';

/**
 * Where each stroke comes in a sweep, from 0 (first) to 1 (last), by where
 * it sits: left to right (`wipe`), bottom to top (`rise`), from the middle
 * of the text out (`center`), in a random order glyph by glyph (`scatter`),
 * or all at once (`together`).
 */
export function sweepOrder(
  strokes: readonly { path: StrokePath; seed: number }[],
  mode: SweepMode,
  random: (key: number) => () => number,
): number[] {
  if (mode === 'together' || strokes.length === 0) return strokes.map(() => 0);
  if (mode === 'scatter') return strokes.map((s) => random(s.seed)());
  const centers = strokes.map((s) => {
    const b = s.path.bounds();
    return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : s.path.pointAt(0);
  });
  const values = centers.map((c, i) => {
    if (mode === 'wipe') return c.x;
    if (mode === 'rise') return -c.y;
    const mid = centers.reduce((m, p) => ({ x: m.x + p.x / centers.length, y: m.y + p.y / centers.length }), { x: 0, y: 0 });
    return Math.hypot(centers[i]!.x - mid.x, centers[i]!.y - mid.y);
  });
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  return values.map((v) => (span > 0 ? (v - min) / span : 0));
}

/**
 * The strokes drawn by where they are rather than in writing order: `across`
 * seconds for the sweep to cross the text, each stroke taking `draw`
 * seconds of it.
 */
export function sweepTimes(order: readonly number[], across: number, draw: number): StrokeTime[] {
  return order.map((at) => ({ start: at * across, duration: draw }));
}

/**
 * A sweep: the text drawn by where each stroke is, not in writing order —
 * a wipe from left to right, rising from the bottom, spreading from the
 * middle, scattered glyph by glyph, or every stroke at once. A `timing`
 * plugin: when a stroke draws follows where the layout put it.
 */
export const sweepPlugin = createPlugin({
  name: 'sweep',
  label: 'Sweep',
  description: 'Strokes drawn by where they are: a wipe, a rise, from the middle, scattered or all at once. timing.',
  params: {
    mode: {
      type: 'select',
      label: 'Mode',
      default: 'wipe',
      options: [
        { value: 'wipe', label: 'Wipe' },
        { value: 'rise', label: 'Rise' },
        { value: 'center', label: 'From the middle' },
        { value: 'scatter', label: 'Scatter' },
        { value: 'together', label: 'All at once' },
      ],
    },
    across: {
      type: 'number',
      label: 'Across',
      description: 'Seconds the sweep takes to cross the text.',
      default: 1.5,
      min: 0,
      max: 6,
      step: 0.1,
    },
    draw: { type: 'number', label: 'Draw', description: 'Seconds each stroke takes.', default: 0.6, min: 0.05, max: 3, step: 0.05 },
  },
  presets: {
    Bloom: { mode: 'center', across: 1.2, draw: 0.9 },
    Stamp: { mode: 'together', draw: 0.25 },
    Confetti: { mode: 'scatter', across: 2, draw: 0.3 },
  },
  setup: ({ mode, across, draw }) => ({
    timing: ({ strokes, random }) => ({
      strokes: sweepTimes(
        sweepOrder(strokes, mode, (k) => random(`sweep:${k}`)),
        across,
        draw,
      ),
    }),
  }),
});
