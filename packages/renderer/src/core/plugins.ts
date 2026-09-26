import { paintStroke } from '../lib/paintStroke.ts';
import type { StrokePath } from '../lib/strokePath.ts';
import type { StrokeGeometryContext } from '../lib/strokeTimeline.ts';
import type { TegakiGeometryContext, TegakiOutlineContext, TegakiPlugin, TegakiStrokePaintContext } from './types.ts';

// Running a list of plugins' hooks as one: `geometry` in sequence, `paint` as
// a chain of `next` calls ending in the default painter. A hook that throws
// is reported and skipped, so one broken plugin can't stop the render.

export type PluginErrorHandler = (plugin: TegakiPlugin, hook: keyof TegakiPlugin, error: unknown) => void;

/** Every `geometry` hook in order, as one reshape; `undefined` when no plugin has one. */
export function reshapeWith(
  plugins: readonly TegakiPlugin[],
  extra: Pick<TegakiGeometryContext, 'fontSize' | 'random'>,
  onError: PluginErrorHandler,
): ((path: StrokePath, ctx: StrokeGeometryContext) => StrokePath) | undefined {
  const hooks = plugins.filter((p) => p.geometry);
  if (hooks.length === 0) return undefined;
  return (path, g) => {
    const ctx: TegakiGeometryContext = { ...g, ...extra };
    let out = path;
    for (const plugin of hooks) {
      try {
        out = plugin.geometry!(out, ctx) ?? out;
      } catch (error) {
        onError(plugin, 'geometry', error);
      }
    }
    return out;
  };
}

/** Every `outline` hook in order, as one; `undefined` when no plugin has one. */
export function outlineWith(
  plugins: readonly TegakiPlugin[],
  onError: PluginErrorHandler,
): ((contour: { x: number; y: number }[], ctx: TegakiOutlineContext) => { x: number; y: number }[]) | undefined {
  const hooks = plugins.filter((p) => p.outline);
  if (hooks.length === 0) return undefined;
  return (contour, ctx) => {
    let out = contour;
    for (const plugin of hooks) {
      try {
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
