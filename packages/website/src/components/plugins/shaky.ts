import { createPlugin, offsetPath, type StrokePath } from 'tegaki/core';

/** A few waves along a stroke, each its own frequency and phase — a sum of them reads as a hand's tremor, one as a ripple. */
interface Tremor {
  f: number;
  phase: number;
  weight: number;
}

/**
 * How far off its line a tremor pushes the pen at `along` ems into a
 * stroke, as a share of the amount (about −1 to 1): a few quick waves, at
 * about `speed` shakes per em of line.
 */
export function tremorAt(along: number, waves: readonly Tremor[]): number {
  let sum = 0;
  let norm = 0;
  for (const w of waves) {
    sum += w.weight * Math.sin(w.f * along + w.phase);
    norm += w.weight;
  }
  return norm > 0 ? sum / norm : 0;
}

export function tremorWaves(speed: number, random: () => number): Tremor[] {
  return Array.from({ length: 3 }, (_, i) => ({
    f: Math.PI * 2 * speed * (0.7 + random() * 0.6) * (1 + i * 0.7),
    phase: random() * Math.PI * 2,
    weight: 1 / (1 + i),
  }));
}

/**
 * A shaky hand: every stroke trembles off its line, quickly and a little,
 * as an unsteady hand draws it — and its width trembles too, with the
 * pressure. Unlike line boil it holds still: each stroke shakes its own
 * way, the same every frame. A `geometry` plugin, run once per layout.
 */
export const shakyPlugin = createPlugin({
  name: 'shaky',
  label: 'Shaky hand',
  description: 'Each stroke trembles off its line, the way an unsteady hand draws. geometry.',
  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      description: 'How far the pen strays, in ems.',
      default: 0.006,
      min: 0,
      max: 0.03,
      step: 0.001,
    },
    speed: { type: 'number', label: 'Speed', description: 'Shakes per em of line.', default: 12, min: 2, max: 40, step: 1 },
    pressure: {
      type: 'number',
      label: 'Pressure',
      description: 'How much the width trembles too.',
      default: 0.15,
      min: 0,
      max: 0.6,
      step: 0.05,
    },
  },
  presets: {
    Elderly: { amount: 0.011, speed: 7, pressure: 0.3 },
    'Cold hands': { amount: 0.004, speed: 28, pressure: 0.1 },
    Moving: { amount: 0.018, speed: 4, pressure: 0 },
  },
  setup: ({ amount, speed, pressure }) => ({
    geometry(path: StrokePath, g) {
      if (path.points.length < 2 || amount <= 0) return path;
      const em = g.fontSize;
      const length = path.length / em;
      const random = g.random(`shaky:${g.stroke.id}`);
      const off = tremorWaves(speed, random);
      const press = tremorWaves(speed * 0.6, random);
      // Settle at the ends: the pen is steadiest landing and lifting.
      const ease = (t: number) => Math.min(1, t * 12, (1 - t) * 12);
      const moved = offsetPath(path, (p) => amount * em * ease(p.t) * tremorAt(p.t * length, off));
      return moved.map((p) => ({ ...p, width: p.width * (1 + pressure * tremorAt(p.t * length, press)) }));
    },
  }),
});
