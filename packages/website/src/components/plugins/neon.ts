import { createPlugin, expandBox, type StrokePath, seededRandom, unionBoxes } from 'tegaki/core';
import { canvasColor, mix, type Rgba, rgba } from './color.ts';
import { inkRegion, scratchCanvas, shrunk } from './ink-canvas.ts';

/** How bright a tube is (0 off, 1 fully lit) at one moment. */
export interface FlickerOptions {
  /** The hum every lit tube has, 0–1. */
  flicker: number;
  /** Share of the glyphs whose tube is faulty and stutters on and off, 0–1. */
  faulty: number;
  /** Seconds a tube sputters for once it's lit, before it holds steady. */
  warmup: number;
}

/**
 * A glyph's brightness at drawing `step` (the flicker's clock), `age`
 * seconds after its stroke was lit (negative while it's being drawn). Each
 * glyph (`seed`) has its own tube: most hold steady after a sputter as they
 * warm up; the faulty ones stutter in bursts for good. The same seed and
 * step give the same brightness every time.
 */
export function brightness(seed: number, step: number, age: number, o: FlickerOptions): number {
  const hum = 1 - o.flicker * 0.12 * seededRandom(seed, `hum:${step}`)();
  // While the pen draws it the gas is lit where the pen has been.
  if (age < 0) return hum;
  if (age < o.warmup) {
    // Sputtering on: off more often at first, less as it warms.
    const on = seededRandom(seed, `warm:${step}`)() < 0.35 + 0.65 * (age / o.warmup);
    return on ? hum : 0.12;
  }
  if (seededRandom(seed, 'faulty')() < o.faulty) {
    // A burst of stutter every so often, a few steps long.
    const burst = seededRandom(seed, `burst:${Math.floor(step / 8)}`)() < 0.3;
    if (burst) {
      const r = seededRandom(seed, `stutter:${step}`)();
      return r < 0.45 ? 0.1 : r < 0.7 ? 0.55 : hum;
    }
  }
  return hum;
}

const WHITE: Rgba = [255, 255, 255, 1];
/** The color of an unlit tube: dim, see-through glass — so it doesn't cast a dark glow. */
const OFF: Rgba = [96, 90, 104, 0.35];

/**
 * Neon: each stroke a glass tube of lit gas — a hot white core in the
 * tube's color, and a glow around it — that sputters as it's lit and
 * hums once it is, with the odd faulty letter stuttering on and off.
 * `paint` draws the tube and its core, dimmed by the flicker; an `ink`
 * hook lays the glow under it from the ink's own colors, so a dimmed
 * letter glows dimmer. The flicker runs on `steps` with nothing to
 * reshape, so it costs a redraw per step and keeps going after the text is
 * written; in controlled time it comes from the time, so a video flickers
 * the same every render.
 */
export const neonPlugin = createPlugin({
  name: 'neon',
  label: 'Neon',
  description:
    'Glass tubes of lit gas that sputter on and hum, the odd letter stuttering. steps + paint + ink — best on a dark background.',
  params: {
    color: { type: 'color', label: 'Color', default: '#ff2bd6' },
    tube: {
      type: 'number',
      label: 'Tube',
      description: "The tube's width, against the stroke's.",
      default: 0.8,
      min: 0.3,
      max: 2,
      step: 0.05,
    },
    glow: { type: 'number', label: 'Glow', description: 'How far and bright the light spreads.', default: 0.7, min: 0, max: 1, step: 0.05 },
    flicker: { type: 'number', label: 'Hum', description: 'The flutter of a lit tube.', default: 0.4, min: 0, max: 1, step: 0.05 },
    faulty: {
      type: 'number',
      label: 'Faulty',
      description: 'Share of the letters that stutter.',
      default: 0.15,
      min: 0,
      max: 1,
      step: 0.05,
    },
    warmup: {
      type: 'number',
      label: 'Warm-up',
      description: 'Seconds a tube sputters as it lights.',
      default: 0.6,
      min: 0,
      max: 3,
      step: 0.1,
    },
    fps: { type: 'number', label: 'Speed', description: 'Flicker steps a second.', default: 20, min: 4, max: 30, step: 1 },
  },
  presets: {
    Motel: { color: '#ff3b30', faulty: 0.4, flicker: 0.6 },
    Cyan: { color: '#20e3ff', faulty: 0.05 },
    Steady: { flicker: 0, faulty: 0, warmup: 0 },
  },
  setup: ({ color, tube, glow, flicker, faulty, warmup, fps }) => {
    const flickers = { flicker, faulty, warmup };
    const tubes = new WeakMap<StrokePath, { tube: StrokePath; core: StrokePath }>();
    const near = scratchCanvas();
    const far = scratchCanvas();
    let lit: Rgba | null = null;
    return {
      // 600 steps at 20 a second: half a minute before the pattern repeats.
      steps: { count: 600, fps, idle: true },
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((st) => st.path.bounds())), fontSize * 0.3 * glow),
      paint(s, next) {
        lit ??= canvasColor(s.ctx, color) ?? [255, 43, 214, 1];
        const { stroke } = s;
        let t = tubes.get(stroke.path);
        if (!t) {
          t = {
            tube: stroke.path.map((p) => ({ ...p, width: p.width * tube })),
            core: stroke.path.map((p) => ({ ...p, width: p.width * tube * 0.28 })),
          };
          tubes.set(stroke.path, t);
        }
        const b = brightness(stroke.seed, s.step, s.time - (stroke.start + stroke.duration), flickers);
        // Opaque when lit — a stroke of varying width is painted a segment at a time, and see-through segments stack up.
        next({ ...s, style: rgba(mix(OFF, lit, b)), stroke: { ...stroke, path: t.tube } });
        if (b > 0.3) next({ ...s, style: rgba(mix(lit, WHITE, 0.6 * b)), stroke: { ...stroke, path: t.core, nibs: [] } });
      },
      ink({ ctx, ink, bounds, fontSize }) {
        if (glow <= 0) return;
        const k = ctx.getTransform().a;
        const reach = 0.35 * fontSize * k * glow;
        const r = inkRegion(ctx, ink, bounds, reach + 2);
        if (!r) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // Two glows under the tubes: a tight bright one and a wide faint one.
        ctx.globalCompositeOperation = 'destination-over';
        const tight = shrunk(near(1, 1), ink, r, Math.max(2, 0.05 * fontSize * k * glow));
        ctx.globalAlpha = glow;
        ctx.drawImage(tight.canvas, 0, 0, tight.w, tight.h, r.x, r.y, r.w, r.h);
        const wide = shrunk(far(1, 1), ink, r, Math.max(3, 0.16 * fontSize * k * glow));
        ctx.globalAlpha = 0.8 * glow;
        ctx.drawImage(wide.canvas, 0, 0, wide.w, wide.h, r.x, r.y, r.w, r.h);
      },
    };
  },
});
