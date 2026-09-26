import type { TegakiEffectConfigs, TegakiEffectName } from '../types.ts';
import type { LayoutBBox } from './textLayout.ts';

export interface ResolvedEffect<K extends TegakiEffectName = TegakiEffectName> {
  effect: K;
  order: number;
  config: TegakiEffectConfigs[K];
}

/**
 * The line and color stops of a `globalGradient` over `bbox`: endpoints that
 * cover the whole box at any angle. y grows downward, so `angle=0` is
 * left→right and `angle=90` top→bottom — positive angles rotate clockwise.
 */
export function globalGradientGeometry(
  bbox: LayoutBBox,
  colors: string[],
  angle: number,
): { x1: number; y1: number; x2: number; y2: number; stops: [number, string][] } {
  // Project the bbox onto the direction vector.
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const proj = Math.abs((dx * bbox.width) / 2) + Math.abs((dy * bbox.height) / 2);
  const stops: [number, string][] =
    colors.length === 1
      ? [
          [0, colors[0]!],
          [1, colors[0]!],
        ]
      : colors.map((c, i) => [i / (colors.length - 1), c]);
  return { x1: cx - dx * proj, y1: cy - dy * proj, x2: cx + dx * proj, y2: cy + dy * proj, stops };
}

const defaultEffects: Record<string, any> = { pressureWidth: true };

/** The built-in effects, drawn by the plugins in `core/effectPlugins.ts`. */
const knownEffects = new Set<string>(['glow', 'wobble', 'pressureWidth', 'taper', 'strokeGradient', 'globalGradient']);

/**
 * Normalizes an effects record into a sorted array of resolved effects.
 * Known keys infer the effect name; custom keys read it from the `effect` field.
 * Boolean `true` becomes an empty config. `false`/absent entries are skipped.
 */
export function resolveEffects(effects: Record<string, any> | undefined): ResolvedEffect[] {
  const merged = { ...defaultEffects, ...effects };

  const result: ResolvedEffect[] = [];

  for (const [key, value] of Object.entries(merged)) {
    if (value === false || value == null) continue;

    let effectName: TegakiEffectName;
    let config: Record<string, any>;
    let order: number;

    if (value === true) {
      effectName = (knownEffects.has(key) ? key : undefined) as TegakiEffectName;
      if (!effectName) continue;
      config = {};
      order = 0;
    } else {
      if (value.enabled === false) continue;
      effectName = value.effect ?? (knownEffects.has(key) ? key : undefined);
      if (!effectName) continue;
      const { effect: _, order: o, enabled: __, ...rest } = value;
      config = rest;
      order = o ?? 0;
    }

    result.push({ effect: effectName, order, config });
  }

  result.sort((a, b) => a.order - b.order);
  return result;
}

/** Check if a specific effect is active. */
export function findEffect<K extends TegakiEffectName>(effects: ResolvedEffect[], name: K): ResolvedEffect<K> | undefined {
  return effects.find((e) => e.effect === name) as ResolvedEffect<K> | undefined;
}

/** Get all instances of a specific effect (for duplicates). */
export function findEffects<K extends TegakiEffectName>(effects: ResolvedEffect[], name: K): ResolvedEffect<K>[] {
  return effects.filter((e) => e.effect === name) as ResolvedEffect<K>[];
}
