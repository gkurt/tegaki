import { createPlugin } from '../core/createPlugin.ts';

/** How much of a stroke thins toward its ends. */
export interface TaperOptions {
  /** Share of the stroke, from its start, that thins toward it (0–1). */
  startLength: number;
  /** Share of the stroke, from its end, that thins toward it (0–1). */
  endLength: number;
}

/** The ink's width factor (0–1) at draw progress `t` along a stroke. */
export function taperAt(o: TaperOptions, t: number): number {
  let m = 1;
  if (o.startLength > 0 && t < o.startLength) m = Math.min(m, t / o.startLength);
  if (o.endLength > 0 && t > 1 - o.endLength) m = Math.min(m, (1 - t) / o.endLength);
  return m;
}

/**
 * Strokes that thin to a point toward their ends, the way a brush lifts off
 * the page. A dot takes the width of a stroke's middle.
 *
 * ```ts
 * plugins: [taperPlugin({ startLength: 0.1, endLength: 0.3 })]
 * ```
 */
export const taperPlugin = createPlugin({
  name: 'taper',
  label: 'Taper',
  description: 'Strokes thinning toward their ends. geometry.',
  params: {
    startLength: {
      type: 'number',
      label: 'Start',
      description: 'Share of the stroke that thins toward its start.',
      default: 0.15,
      min: 0,
      max: 1,
      step: 0.01,
    },
    endLength: {
      type: 'number',
      label: 'End',
      description: 'Share of the stroke that thins toward its end.',
      default: 0.15,
      min: 0,
      max: 1,
      step: 0.01,
    },
  },
  setup: (options) => ({
    geometry(path) {
      if (path.points.length === 1) {
        const m = taperAt(options, 0.5);
        return path.map((p) => ({ ...p, width: p.width * m }));
      }
      return path.map((p) => ({ ...p, width: p.width * taperAt(options, p.t) }));
    },
  }),
});
