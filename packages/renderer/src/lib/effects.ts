import type { TegakiEffectConfigs, TegakiEffectName } from '../types.ts';
import type { LayoutBBox, TextLayout } from './textLayout.ts';
import { resolveCSSLength } from './utils.ts';

export interface ResolvedEffect<K extends TegakiEffectName = TegakiEffectName> {
  effect: K;
  order: number;
  config: TegakiEffectConfigs[K];
}

/**
 * Context passed to effect render hooks. Covers everything a hook might need
 * to prepare or finalize state that spans the whole text layout (as opposed
 * to the per-glyph state owned by `drawGlyph`).
 *
 * The `ctx` has already been translated so its origin is the top-left of the
 * content box (i.e. `(0, 0)` is the top-left of `bbox`). Hooks that mutate ctx
 * state (transforms, strokeStyle, compositing, filters) are expected to
 * save/restore as needed so they don't leak into adjacent effects or the
 * glyph loop unintentionally.
 */
export interface RenderStageContext {
  ctx: CanvasRenderingContext2D;
  layout: TextLayout;
  fontSize: number;
  lineHeight: number;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  /** Text bounding box in the current ctx coordinate space (CSS pixels). */
  bbox: LayoutBBox;
  /** The base color string resolved from `getComputedStyle().color`. */
  baseColor: string;
  /** Engine seed, offset by whatever the caller chose (currently the engine root seed). */
  seed: number;
  /**
   * Stroke paint override for the whole glyph loop. A `beforeRender` hook sets
   * this to e.g. a `CanvasGradient` when the effect wants every stroke to share
   * a single canvas-space paint. The engine reads it after all hooks have run
   * and threads it through to `drawGlyph`. `shadowColor` (used by `glow`) still
   * reads from `baseColor` since Canvas shadows don't accept gradients.
   */
  strokeStyle?: string | CanvasGradient | CanvasPattern;
}

/**
 * Metadata describing how an effect participates in rendering. The per-glyph
 * branch of an effect still lives inside `drawGlyph`; these hooks exist for
 * effects whose behavior spans the full layout (e.g. a gradient whose color
 * stops map to canvas-space position rather than per-stroke progress).
 *
 * `beforeRender` hooks run in forward order (same order as `_resolvedEffects`
 * after sorting by `order`). `afterRender` hooks run in reverse order so
 * save/restore-style pairs nest correctly.
 */
export interface EffectDefinition {
  beforeRender?(stage: RenderStageContext, config: any): void;
  afterRender?(stage: RenderStageContext, config: any): void;
}

const defaultEffects: Record<string, any> = { pressureWidth: true };

const knownEffects: Record<string, EffectDefinition> = {
  glow: {},
  wobble: {},
  pressureWidth: {},
  taper: {},
  strokeGradient: {},
  globalGradient: {
    beforeRender(stage, config: { colors?: string[]; angle?: number }) {
      const colors = config.colors;
      if (!Array.isArray(colors) || colors.length === 0) return;
      const { ctx, bbox } = stage;

      // Project the bbox onto the direction vector to find gradient endpoints
      // that cover the full box at any angle. y grows downward on canvas, so
      // `angle=0` (dx=1, dy=0) is left→right and `angle=90` (dx=0, dy=1) is
      // top→bottom — positive angles rotate clockwise.
      const rad = ((config.angle ?? 0) * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;
      const halfW = bbox.width / 2;
      const halfH = bbox.height / 2;
      const proj = Math.abs(dx * halfW) + Math.abs(dy * halfH);

      const grad = ctx.createLinearGradient(cx - dx * proj, cy - dy * proj, cx + dx * proj, cy + dy * proj);
      if (colors.length === 1) {
        grad.addColorStop(0, colors[0]!);
        grad.addColorStop(1, colors[0]!);
      } else {
        for (let i = 0; i < colors.length; i++) {
          grad.addColorStop(i / (colors.length - 1), colors[i]!);
        }
      }
      stage.strokeStyle = grad;
    },
  },
};

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
      effectName = (Object.hasOwn(knownEffects, key) ? key : undefined) as TegakiEffectName;
      if (!effectName) continue;
      config = {};
      order = 0;
    } else {
      if (value.enabled === false) continue;
      effectName = value.effect ?? (Object.hasOwn(knownEffects, key) ? key : undefined);
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

/** Look up the render-hook metadata for an effect name. Unknown names return undefined. */
export function getEffectDefinition(name: string): EffectDefinition | undefined {
  return Object.hasOwn(knownEffects, name) ? knownEffects[name] : undefined;
}

/** True when any resolved effect defines a before/after render hook. */
export function hasRenderHooks(effects: ResolvedEffect[]): boolean {
  for (const e of effects) {
    const def = getEffectDefinition(e.effect);
    if (def?.beforeRender || def?.afterRender) return true;
  }
  return false;
}

/**
 * How far effects paint past the strokes themselves, in CSS px: a glow's
 * blur plus its offset, a wobble's displacement. `scale` converts font
 * units (wobble amplitude, glow offsets) to px.
 */
export function effectInkMargin(effects: ResolvedEffect[], fontSize: number, scale: number): number {
  let margin = 0;
  for (const glow of findEffects(effects, 'glow')) {
    const { radius = 8, offsetX = 0, offsetY = 0 } = glow.config;
    margin = Math.max(margin, resolveCSSLength(radius, fontSize) + Math.max(Math.abs(offsetX), Math.abs(offsetY)) * scale);
  }
  const wobble = findEffect(effects, 'wobble');
  if (wobble) margin += Math.abs(wobble.config.amplitude ?? 1.5) * scale;
  return margin;
}
