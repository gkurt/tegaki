import { createPlugin, expandBox, type StrokePath, unionBoxes } from 'tegaki/core';
import { canvasColor, type Rgba, rgba } from './color.ts';
import { settle } from './settle.ts';
import { meanWidth } from './svg.ts';

/** A fleck of overspray: where it lands, how big, and at what draw progress it's sprayed. */
export interface Fleck {
  x: number;
  y: number;
  r: number;
  t: number;
}

/** Overspray round a stroke: flecks scattered off the line, thinning out further from it. `amount` (0–1) is how many. */
export function overspray(path: StrokePath, amount: number, random: () => number): Fleck[] {
  if (amount <= 0 || path.points.length === 0) return [];
  const w = meanWidth(path) || 1;
  const count = Math.round(((path.length || w) / w) * 14 * amount);
  return Array.from({ length: count }, () => {
    const t = random();
    const at = path.pointAt(t);
    const a = random() * Math.PI * 2;
    // Mostly close in, a few far out.
    const reach = w * (0.6 + 1.6 * random() ** 2);
    return { x: at.x + Math.cos(a) * reach, y: at.y + Math.sin(a) * reach, r: w * (0.03 + 0.06 * random()), t };
  });
}

/** A drip of paint: where it leaves the line (draw progress), how far it runs, and how wide it is. */
export interface Drip {
  t: number;
  length: number;
  width: number;
  /** Seconds after the can passes before it starts to run. */
  wait: number;
}

/**
 * Where paint pools on a stroke and runs from, as draw progress: the low
 * points of the line — where it bottoms out and turns back up, and an end
 * the line runs down into — lowest first. Gravity pulls wet paint there, and
 * a run from a low point hangs clear of the letter rather than down its side.
 */
export function lowPoints(path: StrokePath): number[] {
  const pts = path.points;
  if (pts.length === 0) return [];
  if (pts.length === 1) return [0];
  const out: { t: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = pts[i - 1];
    const next = pts[i + 1];
    // y runs down: a low point is lower than its neighbours (an end, lower than its one neighbour).
    const low = (!prev || p.y >= prev.y) && (!next || p.y > next.y || (next.y === p.y && i === pts.length - 1));
    if (low && (prev || next)) out.push({ t: p.t, y: p.y });
  }
  return out.sort((a, b) => b.y - a.y).map((l) => l.t);
}

/**
 * Drips down from a stroke's low points (see {@link lowPoints}): the
 * lowest nearly always, the rest now and then. `amount` (0–1) is how often,
 * and how far they run.
 */
export function drips(path: StrokePath, fontSize: number, amount: number, random: () => number): Drip[] {
  if (amount <= 0) return [];
  const w = meanWidth(path) || 1;
  const out: Drip[] = [];
  lowPoints(path).forEach((t, i) => {
    if (random() > (i === 0 ? 0.35 + 0.6 * amount : 0.25 * amount)) return;
    out.push({
      t,
      length: fontSize * amount * (0.12 + 0.5 * random() ** 1.5),
      width: w * (0.16 + 0.12 * random()),
      wait: 0.1 + 0.3 * random(),
    });
  });
  return out;
}

/** How far a drip has run, `age` seconds after the can passed: nothing while it waits, then running down, slowing as it goes. */
export function dripLength(d: Drip, age: number, run: number): number {
  const a = age - d.wait;
  if (a <= 0) return 0;
  return d.length * (1 - Math.exp(-a / Math.max(0.05, run / 3)));
}

/**
 * Spray paint: a soft line — a hard core in a haze of overspray, flecks
 * of paint scattered round it — and runs of paint that drip down where the
 * can lingered, starting a moment after it passes. Painted on the
 * `unclipped` layer, since spray doesn't stop at the letters' edges; a
 * `timing` hook runs the timeline on long enough for the last drips to run.
 */
export const sprayPlugin = createPlugin({
  name: 'spray',
  label: 'Spray paint',
  description: 'A soft line in a haze of overspray and flecks, with paint dripping down where the can lingered. paint + timing.',
  params: {
    size: {
      type: 'number',
      label: 'Size',
      description: "The line's width, against the stroke's.",
      default: 1.3,
      min: 0.5,
      max: 3,
      step: 0.05,
    },
    haze: {
      type: 'number',
      label: 'Haze',
      description: 'How much the paint spreads round the line.',
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
    },
    flecks: { type: 'number', label: 'Flecks', default: 0.5, min: 0, max: 1, step: 0.05 },
    drips: { type: 'number', label: 'Drips', description: 'How often paint runs, and how far.', default: 0.5, min: 0, max: 1, step: 0.05 },
    run: { type: 'number', label: 'Run time', description: 'Seconds a drip takes to run.', default: 1.2, min: 0.2, max: 4, step: 0.1 },
  },
  presets: {
    Stencil: { haze: 0.15, flecks: 0.2, drips: 0 },
    Wet: { haze: 0.8, drips: 1, run: 2 },
    'Fat cap': { size: 2.2, haze: 0.9, flecks: 0.8 },
  },
  setup: ({ size, haze, flecks: fleckAmount, drips: dripAmount, run }) => {
    const shapes = new WeakMap<StrokePath, { core: StrokePath; soft: StrokePath; wide: StrokePath; flecks: Fleck[]; drips: Drip[] }>();
    const colors = new Map<string, Rgba | null>();
    return {
      bounds: ({ strokes, fontSize }) =>
        expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * (0.1 * size + 0.6 * dripAmount)),
      timing: settle(dripAmount > 0 ? run + 0.4 : 0),
      paint(s, next) {
        if (s.stroke.state === 'pending') return next(s);
        const { stroke, fontSize } = s;
        let shape = shapes.get(stroke.path);
        if (!shape) {
          // Each pass at one width, so its see-through pieces don't stack up where they meet.
          const w = (meanWidth(stroke.path) || 1) * size;
          const at = (k: number) => stroke.path.map((p) => ({ ...p, width: w * k }));
          const random = s.random(`spray:${stroke.id}`);
          shape = {
            core: at(1),
            soft: at(1.6),
            wide: at(2.6),
            flecks: overspray(at(1), fleckAmount, random),
            drips: drips(at(1), fontSize, dripAmount, random),
          };
          shapes.set(stroke.path, shape);
        }
        const style = typeof s.style === 'string' ? s.style : null;
        if (style && !colors.has(style)) colors.set(style, canvasColor(s.ctx, style));
        const rgb = style ? colors.get(style) : null;
        const tint = (alpha: number) => (rgb ? rgba([rgb[0], rgb[1], rgb[2], alpha]) : s.style);
        const ctx = s.unclipped;
        const pass = (path: StrokePath, alpha: number) => next({ ...s, ctx, style: tint(alpha), stroke: { ...stroke, path, nibs: [] } });
        if (haze > 0) {
          pass(shape.wide, 0.08 * haze);
          pass(shape.soft, 0.22 * haze);
        }
        next({ ...s, ctx, style: tint(0.95), stroke: { ...stroke, path: shape.core } });

        ctx.save();
        ctx.fillStyle = typeof s.style === 'function' ? s.style(0.5) : (tint(0.8) as string | CanvasGradient | CanvasPattern);
        for (const f of shape.flecks) {
          if (f.t > stroke.progress) continue;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = typeof s.style === 'function' ? s.style(0.5) : (tint(0.95) as string | CanvasGradient | CanvasPattern);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineCap = 'round';
        for (const d of shape.drips) {
          if (d.t > stroke.progress) continue;
          const length = dripLength(d, s.frame.time - (stroke.start + stroke.duration * d.t), run);
          if (length <= 0.5) continue;
          const at = shape.core.pointAt(d.t);
          // From the bottom edge of the line: a run of paint, a bead at its end.
          const from = { x: at.x, y: at.y + at.width * 0.35 };
          const y1 = from.y + length;
          ctx.lineWidth = d.width;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(from.x, y1);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(from.x, y1, d.width * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      },
    };
  },
});
