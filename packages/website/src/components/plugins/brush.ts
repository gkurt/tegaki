import { offsetPath, type StrokePath, type TegakiPlugin, type TegakiStrokePaintContext } from 'tegaki/core';

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
 */
export function bristles(path: StrokePath, count: number, random: () => number): Bristle[] {
  const out: Bristle[] = [];
  for (let i = 0; i < count; i++) {
    const across = (i + 0.5) / count - 0.5;
    const place = across * 0.92 + (random() - 0.5) * 0.06;
    const thickness = (1.5 / count) * (0.6 + random() * 0.7);
    const edge = Math.abs(across) * 2;
    const dryAt = 0.35 + random() * 0.7 - edge * 0.3;
    const reach = Math.min(1, dryAt + FADE);
    const ink = (t: number) => (t <= dryAt ? 1 : Math.max(MIN_INK, 1 - (t - dryAt) / FADE));
    const hair = offsetPath(path, (p) => place * p.width).map((p) => ({ ...p, width: p.width * thickness * ink(p.t) }));
    out.push({ path: reach < 1 ? hair.slice(0, reach) : hair, reach });
  }
  return out;
}

const COUNT = 9;

/**
 * A bristly ink brush, for kanji above all: each stroke is a solid core
 * with hairs across its full width that run dry toward its end. A `paint`
 * plugin — each hair goes to `next`, so gradients and the other painters
 * still apply.
 */
export function brushPlugin(): TegakiPlugin {
  const cache = new WeakMap<StrokePath, { core: StrokePath; hairs: Bristle[] }>();
  const brushOf = (s: TegakiStrokePaintContext) => {
    let brush = cache.get(s.stroke.path);
    if (!brush) {
      const path = s.stroke.path;
      const core = path.map((p) => ({ ...p, width: p.width * (0.45 - 0.25 * p.t) }));
      brush = { core, hairs: bristles(path, COUNT, s.random(`brush:${s.stroke.id}`)) };
      cache.set(path, brush);
    }
    return brush;
  };
  return {
    name: 'brush',
    paint(s, next) {
      // A dot is a single dab.
      if (s.stroke.path.points.length < 2) return next(s);
      const { core, hairs } = brushOf(s);
      const { progress } = s.stroke;
      next({ ...s, stroke: { ...s.stroke, path: core } });
      for (const hair of hairs) {
        const p = Math.min(1, progress / hair.reach);
        next({ ...s, stroke: { ...s.stroke, path: hair.path, progress: p, nibs: [] } });
      }
    },
  };
}
