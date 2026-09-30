import { createPlugin, type GlyphPlacement } from 'tegaki/core';

/** How the ink wobbles. */
export interface WobbleOptions {
  /** How far a point moves, in font units. */
  amplitude: number;
  /** How many waves run through a glyph (`'sine'`). */
  frequency: number;
  /** A regular wave, or smooth noise. */
  mode: 'sine' | 'noise';
}

function hash(x: number): number {
  let h = (x * 2654435761) | 0;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = (h >>> 16) ^ h;
  return (h & 0x7fffffff) / 0x7fffffff; // 0-1
}

function noise1d(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f); // smoothstep
  return hash(i + seed * 7919) * (1 - t) + hash(i + 1 + seed * 7919) * t;
}

/**
 * A glyph's wobble: how far the point at `x`, `y` (font units, y down) moves,
 * `idx` along its stroke's points (a fractional index keeps the phase
 * continuous). dx depends on y and dy on x — the asymmetry keeps the
 * perpendicular part of the wobble out of phase with the part along the stroke.
 */
export function wobbleField(o: WobbleOptions, seed: number): (x: number, y: number, idx: number) => { dx: number; dy: number } {
  const { amplitude: a, frequency: f } = o;
  if (o.mode === 'noise') {
    return (x, y, idx) => ({
      dx: a * (noise1d(y * 0.1 + idx * 0.7, seed) * 2 - 1),
      dy: a * (noise1d(x * 0.1 + idx * 0.5, seed * 1.3 + 1000) * 2 - 1),
    });
  }
  return (x, y, idx) => ({
    dx: a * Math.sin(f * (y * 0.01 + idx * 0.7) + seed),
    dy: a * Math.cos(f * (x * 0.01 + idx * 0.5) + seed * 1.3),
  });
}

/**
 * A hand that doesn't hold still: the ink displaced by a wave (or noise) of
 * each point's place in the glyph and along its stroke, each glyph in its own
 * phase (its seed). With clip-to-text the letters' edges wobble with it.
 *
 * ```ts
 * plugins: [wobblePlugin({ amplitude: 4, mode: 'noise' })]
 * ```
 */
export const wobblePlugin = createPlugin({
  name: 'wobble',
  label: 'Wobble',
  description: "The ink displaced by a wave or noise, each glyph in its own phase; clip-to-text's edges follow. geometry + outline.",
  params: {
    amplitude: {
      type: 'number',
      label: 'Amplitude',
      description: 'How far a point moves, in font units.',
      default: 1.5,
      min: 0,
      max: 50,
      step: 0.5,
    },
    frequency: { type: 'number', label: 'Frequency', description: 'Waves through a glyph (sine).', default: 8, min: 0, max: 50, step: 1 },
    mode: { type: 'select', label: 'Mode', description: 'A regular wave, or smooth noise.', default: 'sine', options: ['sine', 'noise'] },
  },
  setup: (options) => {
    const fields = new Map<number, ReturnType<typeof wobbleField>>();
    const fieldFor = (seed: number) => {
      let field = fields.get(seed);
      if (!field) {
        if (fields.size > 4096) fields.clear();
        fields.set(seed, (field = wobbleField(options, seed)));
      }
      return field;
    };
    const displace = <P extends { x: number; y: number }>(p: P, place: GlyphPlacement, seed: number, idx: number): P => {
      const x = (p.x - place.x) / place.scale;
      const y = (p.y - place.y) / place.scale - place.ascender;
      const d = fieldFor(seed)(x, y, idx);
      return { ...p, x: p.x + d.dx * place.scale, y: p.y + d.dy * place.scale };
    };
    return {
      geometry: (path, g) => path.map((p) => displace(p, g.place, g.seed, g.bundleIndexAt(p.t))),
      outline: (contour, o) => contour.map((p, k) => displace(p, o.place, o.seed, k)),
    };
  },
});
