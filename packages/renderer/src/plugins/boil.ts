import { createPlugin } from '../core/createPlugin.ts';
import { seededRandom } from '../lib/random.ts';
import { type FontPoint, inPx } from './glyphSpace.ts';

/** How the lines boil. */
export interface BoilOptions {
  /** How many drawings the cycle has. */
  drawings: number;
  /** Drawings a second: 12 is hand-drawn animation "on twos", 8 is choppier. */
  fps: number;
  /** How far a point wanders from the font's line, in ems. */
  amount: number;
  /** 0: the lines bend slowly, as if redrawn with a steady hand; 1: they jitter along their length. */
  detail: number;
  /** Ink width wander, as a share of the stroke's. */
  width: number;
  /** Keep boiling once the text is written (and while it's paused). */
  idle: boolean;
}

/** A few waves in a glyph, each at its own angle and phase. */
interface Wave {
  fx: number;
  fy: number;
  phase: number;
  weight: number;
}

/** Waves per axis — a sum of a few reads as a hand, one reads as a ripple. */
const WAVES = 3;

/**
 * Drawing `step` of a glyph's boil: a smooth field moving any point of it,
 * in its own font units — its strokes and its outline alike. Built from the
 * glyph's `seed` and the drawing alone, so each drawing is the same every
 * time it comes round. `em` is the font's units per em.
 */
export function boilField(seed: number, step: number, o: Pick<BoilOptions, 'amount' | 'detail'>, em: number): (p: FontPoint) => FontPoint {
  const random = seededRandom(seed, `boil:${step}`);
  // Waves a glyph fits: about one across it at detail 0, several at 1.
  const frequency = 1.5 + o.detail * 8;
  const waves = (): Wave[] =>
    Array.from({ length: WAVES }, (_, i) => {
      const angle = random() * Math.PI * 2;
      const f = frequency * (0.6 + random() * 0.8) * (1 + i * 0.5);
      return { fx: Math.cos(angle) * f, fy: Math.sin(angle) * f, phase: random() * Math.PI * 2, weight: 1 / (1 + i) };
    });
  const wx = waves();
  const wy = waves();
  const norm = 1 / wx.reduce((sum, w) => sum + w.weight, 0);
  const reach = o.amount * em * norm;
  const sum = (ws: Wave[], u: number, v: number) => ws.reduce((acc, w) => acc + w.weight * Math.sin(w.fx * u + w.fy * v + w.phase), 0);
  return ({ x, y }) => {
    const u = x / em;
    const v = y / em;
    return { x: x + reach * sum(wx, u, v), y: y + reach * sum(wy, u, v) };
  };
}

/** A stroke's width along it in drawing `step`: a gentle, slow wander either way. */
export function boilWidth(seed: number, strokeKey: string, step: number, width: number): (t: number) => number {
  const random = seededRandom(seed, `boil-width:${strokeKey}:${step}`);
  const base = random() * 2 - 1;
  const phase = random() * Math.PI * 2;
  return (t) => Math.max(0.05, 1 + width * (0.6 * base + 0.4 * Math.sin(Math.PI * 2 * t + phase)));
}

/**
 * Line boil: the ink redrawn a few slightly different ways, one after
 * another, several times a second — the shimmer of hand-drawn animation,
 * stop motion and games drawn that way. A handful of drawings are made once
 * per layout (`steps`), each glyph moving through its own smooth field, and
 * the engine shows them in turn. The clip outline boils with the ink.
 *
 * It boils while the text is written; `idle: true` keeps it boiling after.
 * In controlled time the drawing comes from the time given, so a video
 * renders the same every time — keep passing time (in seconds) past the
 * end for the boil to go on over a hold. Reduced motion holds the first
 * drawing.
 *
 * ```ts
 * plugins: [boilPlugin()]                           // while it writes
 * plugins: [boilPlugin({ idle: true, fps: 8 })]     // and after, choppier
 * ```
 */
export const boilPlugin = createPlugin({
  name: 'boil',
  label: 'Boil',
  description: 'The lines redrawn a few ways in turn, like hand-drawn animation or stop motion. steps + geometry + outline.',
  params: {
    drawings: { type: 'number', label: 'Drawings', description: 'How many drawings the cycle has.', default: 3, min: 2, max: 8, step: 1 },
    fps: { type: 'number', label: 'Speed', description: 'Drawings a second.', default: 12, min: 2, max: 24, step: 1 },
    amount: {
      type: 'number',
      label: 'Amount',
      description: 'How far the line wanders, in ems.',
      default: 0.012,
      min: 0,
      max: 0.05,
      step: 0.001,
    },
    detail: {
      type: 'number',
      label: 'Detail',
      description: 'Slow bends (0) to fine jitter (1).',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
    },
    width: {
      type: 'number',
      label: 'Width',
      description: "Ink width wander, as a share of the stroke's.",
      default: 0.08,
      min: 0,
      max: 0.4,
      step: 0.01,
    },
    idle: {
      type: 'boolean',
      label: 'Keep boiling',
      description: 'Go on after the text is written or paused — in uncontrolled and CSS time; controlled time boils as its time moves.',
      default: false,
    },
  },
  presets: {
    Cartoon: { drawings: 3, fps: 8, amount: 0.02, detail: 0.15, idle: true },
    Nervous: { drawings: 4, fps: 16, amount: 0.008, detail: 0.8 },
    Sketchy: { amount: 0.025, detail: 0.5, width: 0.2, idle: true },
  },
  setup: (options) => {
    const drawings = Math.round(options.drawings);
    const fields = new Map<string, (p: FontPoint) => FontPoint>();
    const fieldFor = (seed: number, step: number, em: number) => {
      const key = `${seed}|${step}|${em}`;
      let field = fields.get(key);
      if (!field) {
        if (fields.size > 4096) fields.clear();
        fields.set(key, (field = boilField(seed, step, options, em)));
      }
      return field;
    };
    return {
      steps: { count: drawings, fps: options.fps, idle: options.idle },
      geometry(path, g) {
        const move = inPx(fieldFor(g.seed, g.step, g.fontSize / g.place.scale), g.place);
        const width = boilWidth(g.seed, String(g.stroke.strokeIndex), g.step, options.width);
        return path.map((p) => ({ ...move(p), width: p.width * width(p.t) }));
      },
      outline(contour, o) {
        return contour.map(inPx(fieldFor(o.seed, o.step, o.fontSize / o.place.scale), o.place));
      },
    };
  },
});
