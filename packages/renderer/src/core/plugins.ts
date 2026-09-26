import { paintStroke } from '../lib/paintStroke.ts';
import type { StrokePath } from '../lib/strokePath.ts';
import type { StrokeGeometryContext } from '../lib/strokeTimeline.ts';
import type { TegakiGeometryContext, TegakiOutlineContext, TegakiPlugin, TegakiPluginSteps, TegakiStrokePaintContext } from './types.ts';

// Running a list of plugins' hooks as one: `geometry` in sequence, `paint` as
// a chain of `next` calls ending in the default painter. A hook that throws
// is reported and skipped, so one broken plugin can't stop the render.

export type PluginErrorHandler = (plugin: TegakiPlugin, hook: keyof TegakiPlugin, error: unknown) => void;

/** Which drawing of each plugin with steps to show — plugins not in it show their first. */
export type PluginSteps = ReadonlyMap<TegakiPlugin, number>;

/** `steps` made safe: a whole `count` of at least 1, and `null` when there's nothing to cycle (one drawing, or no positive, finite `fps`). */
export function normalizeSteps(steps: TegakiPluginSteps | undefined): Required<TegakiPluginSteps> | null {
  if (!steps) return null;
  const count = Math.max(1, Math.floor(Number.isFinite(steps.count) ? steps.count : 1));
  if (count < 2 || !(steps.fps > 0) || !Number.isFinite(steps.fps)) return null;
  return { count, fps: steps.fps, idle: steps.idle === true };
}

/** The drawing a cycle shows at `clock` seconds: a new one every `1 / fps`, round and round. */
export function stepAt(steps: Required<TegakiPluginSteps>, clock: number): number {
  const tick = Math.floor(Math.max(0, clock) * steps.fps + 1e-9);
  return tick % steps.count;
}

/** The plugins that cycle through drawings, with their steps made safe. */
export function steppedPlugins(plugins: readonly TegakiPlugin[]): { plugin: TegakiPlugin; steps: Required<TegakiPluginSteps> }[] {
  const out: { plugin: TegakiPlugin; steps: Required<TegakiPluginSteps> }[] = [];
  for (const plugin of plugins) {
    const steps = normalizeSteps(plugin.steps);
    if (steps) out.push({ plugin, steps });
  }
  return out;
}

/** Each stepped plugin's drawing at `clock`, and a key naming the combination (`''` with none). */
export function pluginStepsAt(plugins: readonly TegakiPlugin[], clock: number): { steps: PluginSteps; key: string } {
  const steps = new Map<TegakiPlugin, number>();
  for (const { plugin, steps: s } of steppedPlugins(plugins)) steps.set(plugin, stepAt(s, clock));
  return { steps, key: stepsKey(steps) };
}

/** A key naming a combination of drawings, the same for the same steps. */
export function stepsKey(steps: PluginSteps): string {
  return [...steps.values()].join(',');
}

/**
 * Every combination of the stepped plugins' drawings — what the canvas must
 * hold — or only the first `limit` of them when there are more (a few
 * plugins of a few drawings each is the most anyone needs).
 */
export function allPluginSteps(plugins: readonly TegakiPlugin[], limit = 64): PluginSteps[] {
  let combos: Map<TegakiPlugin, number>[] = [new Map()];
  for (const { plugin, steps } of steppedPlugins(plugins)) {
    const next: Map<TegakiPlugin, number>[] = [];
    for (const combo of combos) {
      for (let i = 0; i < steps.count && next.length < limit; i++) next.push(new Map(combo).set(plugin, i));
    }
    combos = next;
  }
  return combos;
}

/** Every `geometry` hook in order, as one reshape; `undefined` when no plugin has one. Each hook is told its plugin's drawing in `ctx.step`. */
export function reshapeWith(
  plugins: readonly TegakiPlugin[],
  extra: Pick<TegakiGeometryContext, 'fontSize' | 'random'>,
  onError: PluginErrorHandler,
  steps?: PluginSteps,
): ((path: StrokePath, ctx: StrokeGeometryContext) => StrokePath) | undefined {
  const hooks = plugins.filter((p) => p.geometry);
  if (hooks.length === 0) return undefined;
  return (path, g) => {
    const ctx: TegakiGeometryContext = { ...g, ...extra, step: 0 };
    let out = path;
    for (const plugin of hooks) {
      try {
        ctx.step = steps?.get(plugin) ?? 0;
        out = plugin.geometry!(out, ctx) ?? out;
      } catch (error) {
        onError(plugin, 'geometry', error);
      }
    }
    return out;
  };
}

/** Every `outline` hook in order, as one; `undefined` when no plugin has one. Each hook is told its plugin's drawing in `ctx.step`. */
export function outlineWith(
  plugins: readonly TegakiPlugin[],
  onError: PluginErrorHandler,
  steps?: PluginSteps,
): ((contour: { x: number; y: number }[], ctx: Omit<TegakiOutlineContext, 'step'>) => { x: number; y: number }[]) | undefined {
  const hooks = plugins.filter((p) => p.outline);
  if (hooks.length === 0) return undefined;
  return (contour, base) => {
    const ctx: TegakiOutlineContext = { ...base, step: 0 };
    let out = contour;
    for (const plugin of hooks) {
      try {
        ctx.step = steps?.get(plugin) ?? 0;
        out = plugin.outline!(out, ctx) ?? out;
      } catch (error) {
        onError(plugin, 'outline', error);
      }
    }
    return out;
  };
}

/**
 * Every `paint` hook as a chain: the first plugin's `next` is the second's
 * hook, and the last one's is `base` (the default painter). Each hook runs
 * between a save and a restore of the canvas state. A hook that throws
 * before calling `next` has the stroke painted as if it weren't there.
 */
export function paintWith(
  plugins: readonly TegakiPlugin[],
  onError: PluginErrorHandler,
  base: (stroke: TegakiStrokePaintContext) => void = paintStroke,
): (stroke: TegakiStrokePaintContext) => void {
  let next = base;
  for (let i = plugins.length - 1; i >= 0; i--) {
    const plugin = plugins[i]!;
    if (!plugin.paint) continue;
    const inner = next;
    next = (stroke) => {
      let called = false;
      const call = (s: TegakiStrokePaintContext) => {
        called = true;
        inner(s);
      };
      stroke.ctx.save();
      try {
        plugin.paint!(stroke, call);
      } catch (error) {
        onError(plugin, 'paint', error);
        if (!called) inner(stroke);
      }
      stroke.ctx.restore();
    };
  }
  return next;
}
