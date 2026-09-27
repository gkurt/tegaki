import { createPlugin, offsetPath, type StrokePath } from 'tegaki/core';
import { mix, type Rgba, rgba } from './color.ts';

export const METALS = {
  gold: [
    [110, 72, 14, 1],
    [201, 150, 43, 1],
    [250, 228, 146, 1],
  ],
  silver: [
    [84, 90, 98, 1],
    [170, 178, 187, 1],
    [246, 248, 250, 1],
  ],
  rose: [
    [124, 64, 60, 1],
    [211, 142, 130, 1],
    [250, 214, 200, 1],
  ],
  copper: [
    [98, 45, 18, 1],
    [184, 101, 47, 1],
    [244, 180, 124, 1],
  ],
} as const satisfies Record<string, readonly [Rgba, Rgba, Rgba]>;

export type Metal = keyof typeof METALS;

/**
 * How brightly foil catches the light where the line runs at `angle`
 * (radians), lit from `light`: 0–1, brightest where the line runs across
 * the light and dark along it — so a curve shimmers from dark to bright as
 * it turns, the way foil does.
 */
export function sheen(angle: number, light: number): number {
  return 0.5 + 0.5 * Math.cos(2 * (angle - light));
}

/**
 * Where the glint is at drawing `step` of `count`, across a text box `width`
 * px wide, as a share of its sweep: it crosses in `sweep` seconds out of
 * every `period`, off the text the rest of the time. `null` while it's off.
 */
export function glintAt(step: number, count: number, period: number, sweep: number): number | null {
  const t = ((step % count) / count) * period;
  return t < sweep ? t / sweep : null;
}

/** The foil's color at `shade` (0 dark – 1 bright), lifted toward white by a glint of `glint` (0–1). */
export function foilColor(metal: readonly [Rgba, Rgba, Rgba], shade: number, glint: number): Rgba {
  const [dark, mid, light] = metal;
  const base = shade < 0.5 ? mix(dark, mid, shade * 2) : mix(mid, light, (shade - 0.5) * 2);
  return glint > 0 ? mix(base, [255, 255, 255, 1], Math.min(1, glint)) : base;
}

/** Drawings a second the glint moves at. */
const FPS = 30;

/**
 * Gold leaf: each stroke laid in foil that catches the light as it turns —
 * dark where it runs with the light, bright where it runs across it — with
 * a bevel along its edge, and a glint that sweeps across the text every few
 * seconds, going on after it's written. `paint` colors each point of the
 * line by the way it runs; the glint runs on `steps`, with nothing to
 * reshape, so it costs a redraw per step, and comes from the time in
 * controlled time.
 */
export const foilPlugin = createPlugin({
  name: 'foil',
  label: 'Gold foil',
  description: 'Metal leaf that catches the light as the line turns, with a bevel and a glint sweeping across. paint + steps.',
  params: {
    metal: {
      type: 'select',
      label: 'Metal',
      default: 'gold',
      options: [
        { value: 'gold', label: 'Gold' },
        { value: 'silver', label: 'Silver' },
        { value: 'rose', label: 'Rose gold' },
        { value: 'copper', label: 'Copper' },
      ],
    },
    light: {
      type: 'number',
      label: 'Light',
      description: 'Where the light comes from, in degrees.',
      default: -40,
      min: -180,
      max: 180,
      step: 5,
    },
    shine: { type: 'number', label: 'Glint', description: 'How bright the sweeping glint is.', default: 0.8, min: 0, max: 1, step: 0.05 },
    every: { type: 'number', label: 'Every', description: 'Seconds between glints.', default: 3, min: 1, max: 10, step: 0.5 },
    bevel: { type: 'number', label: 'Bevel', description: 'The lit edge along the line.', default: 0.6, min: 0, max: 1, step: 0.05 },
  },
  presets: {
    Silver: { metal: 'silver', light: -70 },
    'Rose gold': { metal: 'rose', shine: 0.6 },
    Matte: { shine: 0, bevel: 0.2 },
  },
  setup: ({ metal, light, shine, every, bevel }) => {
    const ramp = METALS[metal];
    const lit = (light * Math.PI) / 180;
    const sweep = Math.min(every, 1.1);
    const count = Math.round(every * FPS);
    const edges = new WeakMap<StrokePath, StrokePath>();
    return {
      steps: shine > 0 ? { count, fps: FPS, idle: true } : undefined,
      paint(s, next) {
        if (s.stroke.state === 'pending') return next(s);
        const { stroke, textBox, fontSize } = s;
        const path = stroke.path;
        const at = glintAt(s.step, count, every, sweep);
        const band = fontSize * 0.9;
        const gx = at === null ? null : textBox.minX - band + at * (textBox.maxX - textBox.minX + 2 * band);
        const glintOf = (x: number) => (gx === null ? 0 : shine * Math.exp(-(((x - gx) / (band * 0.35)) ** 2)));
        next({
          ...s,
          style: (t) => {
            const p = path.pointAt(t);
            return rgba(foilColor(ramp, sheen(p.angle, lit), glintOf(p.x)));
          },
        });
        if (bevel <= 0 || path.points.length < 2) return;
        let edge = edges.get(path);
        if (!edge) {
          // A thin lit edge toward the light: as far out as the line faces it (the pen's left
          // is `sin(angle - light)` toward the light), in the middle where it runs straight at it.
          edge = offsetPath(path, (p) => 0.25 * p.width * Math.sin(path.pointAt(p.t).angle - lit)).map((p) => ({
            ...p,
            width: p.width * 0.18,
          }));
          edges.set(path, edge);
        }
        s.ctx.globalAlpha = bevel * 0.8;
        next({
          ...s,
          style: (t) => {
            const p = edge!.pointAt(t);
            return rgba(foilColor(ramp, 0.75 + 0.25 * sheen(p.angle, lit), glintOf(p.x) * 1.2));
          },
          stroke: { ...stroke, path: edge, nibs: [] },
        });
      },
    };
  },
});
