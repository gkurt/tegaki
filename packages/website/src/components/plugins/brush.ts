import { createPlugin, offsetPath, type StrokePath, type TegakiStrokePaintContext } from 'tegaki/core';

/** One hair of the brush: its own path, and how much of the stroke it lasts before it runs dry. */
export interface Bristle {
  path: StrokePath;
  /** Share of the stroke's draw progress this hair's path covers (its path runs its own 0–1 over it). */
  reach: number;
}

/** Share of the stroke over which a hair's ink gives out, once it starts to. */
const FADE = 0.3;
/** The thinnest a drying hair gets before it's cut, as a share of its width. */
const MIN_INK = 0.12;

/**
 * Split a stroke into hairs across its width. Each hair sits at its own
 * place across the ink and has its own thickness, and runs dry somewhere
 * along the stroke — the outer hairs sooner — thinning out and stopping, so
 * the tail of a fast stroke breaks into streaks (飛白, "flying white").
 * `random` gives 0–1; seed it per stroke so the hairs stay put frame to frame.
 * `dryness` (0–1) is how soon the hairs give out: 0 never, 1 almost at once.
 */
export function bristles(path: StrokePath, count: number, random: () => number, dryness = 0.5): Bristle[] {
  const dryFrom = 1.05 - 1.4 * dryness;
  const out: Bristle[] = [];
  for (let i = 0; i < count; i++) {
    const across = (i + 0.5) / count - 0.5;
    const place = across * 0.92 + (random() - 0.5) * 0.06;
    const thickness = (1.5 / count) * (0.6 + random() * 0.7);
    const edge = Math.abs(across) * 2;
    const dryAt = dryFrom + random() * 0.7 - edge * 0.3;
    const reach = Math.min(1, dryAt + FADE);
    const ink = (t: number) => (t <= dryAt ? 1 : Math.max(MIN_INK, 1 - (t - dryAt) / FADE));
    const hair = offsetPath(path, (p) => place * p.width).map((p) => ({ ...p, width: p.width * thickness * ink(p.t) }));
    out.push({ path: reach < 1 ? hair.slice(0, reach) : hair, reach });
  }
  return out;
}

/**
 * A bristly ink brush, for kanji above all: each stroke is a solid core
 * with hairs across its full width that run dry toward its end. A `paint`
 * plugin — each hair goes to `next`, so gradients and the other painters
 * still apply.
 */
export const brushPlugin = createPlugin({
  name: 'brush',
  label: 'Brush',
  description: 'A bristly ink brush whose hairs run dry toward the end of each stroke. paint.',
  params: {
    bristles: { type: 'number', label: 'Bristles', default: 9, min: 3, max: 24, step: 1 },
    dryness: { type: 'number', label: 'Dryness', description: 'How soon the hairs run dry.', default: 0.5, min: 0, max: 1, step: 0.05 },
    core: {
      type: 'number',
      label: 'Core',
      description: "The solid core's width, against the stroke's.",
      default: 0.45,
      min: 0,
      max: 1,
      step: 0.05,
    },
  },
  presets: {
    'Wet brush': { dryness: 0.1, core: 0.7 },
    'Dry brush': { bristles: 16, dryness: 0.85, core: 0.15 },
  },
  setup: ({ bristles: count, dryness, core: coreWidth }) => {
    const cache = new WeakMap<StrokePath, { core: StrokePath | null; hairs: Bristle[] }>();
    const brushOf = (s: TegakiStrokePaintContext) => {
      let brush = cache.get(s.stroke.path);
      if (!brush) {
        const path = s.stroke.path;
        // The core thins toward the end, as the brush lifts; none at all when set to 0.
        const core = coreWidth > 0 ? path.map((p) => ({ ...p, width: p.width * coreWidth * (1 - 0.55 * p.t) })) : null;
        brush = { core, hairs: bristles(path, Math.round(count), s.random(`brush:${s.stroke.id}`), dryness) };
        cache.set(path, brush);
      }
      return brush;
    };
    return {
      paint(s, next) {
        // A dot is a single dab.
        if (s.stroke.path.points.length < 2) return next(s);
        const { core, hairs } = brushOf(s);
        const { progress } = s.stroke;
        if (core) next({ ...s, stroke: { ...s.stroke, path: core } });
        for (const hair of hairs) {
          const p = Math.min(1, progress / hair.reach);
          next({ ...s, stroke: { ...s.stroke, path: hair.path, progress: p, nibs: [] } });
        }
      },
    };
  },
});
