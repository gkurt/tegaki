import type { TegakiPlugin } from './types.ts';

/**
 * The ink's width from the bundle's pen pressure — the `pressure` option,
 * run ahead of every plugin: the stroke's mean width blended toward the width
 * the bundle gives each point, by `strength` (0: one width along the whole
 * stroke; 1: the bundle's widths). Never thinner than half a font unit.
 */
export function pressurePlugin(strength: number): TegakiPlugin {
  const s = Math.max(0, Math.min(Number.isFinite(strength) ? strength : 1, 1));
  return {
    name: 'pressure',
    geometry(path, g) {
      const min = 0.5 * g.place.scale;
      // A dot's width doesn't vary within it.
      if (path.points.length === 1) return path.map((p) => ({ ...p, width: Math.max(p.width, min) }));
      const pts = g.stroke.stroke.p;
      let sum = 0;
      for (const q of pts) sum += q[2]!;
      const mean = Math.max(sum / pts.length, 0.5) * g.place.scale;
      if (s === 0) return path.map((p) => ({ ...p, width: mean }));
      return path.map((p) => ({ ...p, width: Math.max(mean + (p.width - mean) * s, min) }));
    },
  };
}

/** The `pressure` option as a strength: finite, within 0–1, `1` when unset. */
export function resolvePressure(pressure: number | undefined): number {
  return pressure === undefined || !Number.isFinite(pressure) ? 1 : Math.max(0, Math.min(pressure, 1));
}
