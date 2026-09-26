import { createPlugin, expandBox, offsetPath, StrokePath, type TegakiStrokePaintContext, unionBoxes } from 'tegaki/core';

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
 * A stroke's width as a brush lays it, as a factor along it (`t`, 0–1):
 * `size` times the stroke's, swollen by `press` where the brush is pressed
 * down at the start, and lifting off to a point at the end.
 */
export function brushWidth(t: number, size: number, press: number): number {
  const down = Math.exp(-((t / 0.12) ** 2));
  const lift = t > 0.8 ? 1 - 0.55 * ((t - 0.8) / 0.2) ** 2 : 1;
  return size * (1 + press * down) * lift;
}

/** A drop of ink flung off the brush: where it lands, how big, and at what draw progress it's thrown. */
export interface Splash {
  x: number;
  y: number;
  r: number;
  t: number;
}

/**
 * Drops a big brush throws: most where it's pressed down at the start, some
 * where it flicks off the end, flung forward along the stroke. `amount`
 * (0–1) is how many; `random` gives 0–1, seeded per stroke.
 */
export function splashes(path: StrokePath, amount: number, random: () => number): Splash[] {
  if (amount <= 0 || path.points.length < 2) return [];
  const count = Math.round(amount * (3 + random() * 6));
  return Array.from({ length: count }, () => {
    const end = random() < 0.35;
    const t = end ? 0.97 : 0.03 + random() * 0.08;
    const at = path.pointAt(t);
    // Flung ahead of the brush at the end, scattered round it at the start.
    const angle = end ? at.angle + (random() - 0.5) * 0.9 : random() * Math.PI * 2;
    const reach = at.width * (end ? 0.6 + random() * 1.4 : 0.55 + random() * 0.6);
    return { x: at.x + Math.cos(angle) * reach, y: at.y + Math.sin(angle) * reach, r: at.width * (0.03 + random() ** 2 * 0.1), t };
  });
}

/**
 * A bristly ink brush, for kanji above all: each stroke is a solid core
 * with hairs across its full width that run dry toward its end. A `paint`
 * plugin — each hair goes to `next`, so gradients and the other painters
 * still apply. `size` and `press` make it a great brush, the kind the
 * ancient scrolls were written with: a `geometry` hook widens each stroke,
 * pressed down fat at its start and lifting to a point, and `splatter`
 * flings drops of ink where the brush lands and leaves.
 */
export const brushPlugin = createPlugin({
  name: 'brush',
  label: 'Brush',
  description:
    'A bristly ink brush whose hairs run dry toward the end of each stroke; a great scroll brush when Size is up. paint + geometry — turn Clip to text off (Style → Rendering) for the full width.',
  params: {
    bristles: { type: 'number', label: 'Bristles', default: 9, min: 3, max: 40, step: 1 },
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
    size: {
      type: 'number',
      label: 'Size',
      description: "The brush's width, against the stroke's.",
      default: 1,
      min: 0.5,
      max: 4,
      step: 0.1,
    },
    press: {
      type: 'number',
      label: 'Press',
      description: 'How fat the stroke swells where the brush is pressed down.',
      default: 0,
      min: 0,
      max: 1.5,
      step: 0.05,
    },
    splatter: {
      type: 'number',
      label: 'Splatter',
      description: 'Drops flung where the brush lands and leaves.',
      default: 0,
      min: 0,
      max: 1,
      step: 0.05,
    },
  },
  presets: {
    'Wet brush': { dryness: 0.1, core: 0.7 },
    'Dry brush': { bristles: 16, dryness: 0.85, core: 0.15 },
    Scroll: { bristles: 32, dryness: 0.6, core: 0.5, size: 2, press: 0.6, splatter: 0.5 },
  },
  setup: ({ bristles: count, dryness, core: coreWidth, size, press, splatter }) => {
    const drops = new WeakMap<StrokePath, Splash[]>();
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
    const sized = size !== 1 || press > 0;
    return {
      // Drops can land a couple of stroke widths off the ink.
      bounds:
        splatter > 0
          ? ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((st) => st.path.bounds())), fontSize * 0.12 * size)
          : undefined,
      geometry: sized
        ? (path) =>
            path.points.length < 2
              ? path.map((p) => ({ ...p, width: p.width * size }))
              : path.map((p) => ({ ...p, width: p.width * brushWidth(p.t, size, press) }))
        : undefined,
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
        if (splatter <= 0) return;
        let list = drops.get(s.stroke.path);
        if (!list) {
          list = splashes(s.stroke.path, splatter, s.random(`splash:${s.stroke.id}`));
          drops.set(s.stroke.path, list);
        }
        for (const d of list) {
          if (progress < d.t) continue;
          next({ ...s, stroke: { ...s.stroke, path: new StrokePath([{ x: d.x, y: d.y, width: d.r * 2, t: 0 }]), progress: 1, nibs: [] } });
        }
      },
    };
  },
});
