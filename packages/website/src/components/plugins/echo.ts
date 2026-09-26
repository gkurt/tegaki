import type { StrokePath, TegakiPlugin } from 'tegaki/core';

/** The passes laid over each stroke before the ink: color, width against the ink's, and how far behind the first it starts. */
const PASSES = [
  { color: '#ffd166', width: 2.6, lag: 0 },
  { color: '#ef476f', width: 1.7, lag: 0.18 },
];
/** How far behind the first pass the ink itself starts. */
const INK_LAG = 0.36;

/** Draw progress of a pass `lag` behind the lead, finishing with it: 0 until the lead is `lag` along, 1 when it's done. */
export function lagged(progress: number, lag: number): number {
  return lag <= 0 ? progress : Math.max(0, Math.min(1, (progress - lag) / (1 - lag)));
}

/**
 * Several strokes over the same path, one after another: a wide yellow pass
 * leads, a pink one follows, and the ink comes last, each a beat behind the
 * one before and all finishing together. A `paint` plugin: it calls `next`
 * once per pass with its own path, color and progress. With clip-to-text on
 * the passes are clipped to the letters, so they show as color running ahead
 * of the ink.
 */
export function echoPlugin(): TegakiPlugin {
  const widened = new WeakMap<StrokePath, StrokePath[]>();
  return {
    name: 'echo',
    paint(s, next) {
      const { path, progress } = s.stroke;
      let passes = widened.get(path);
      if (!passes) {
        passes = PASSES.map(({ width }) => path.map((p) => ({ ...p, width: p.width * width })));
        widened.set(path, passes);
      }
      // The passes go under the ink already on the canvas — this stroke's
      // wide passes mustn't cover the strokes it crosses — narrowest first,
      // so each wider one slides in beneath it.
      s.ctx.save();
      s.ctx.globalCompositeOperation = 'destination-over';
      for (let i = PASSES.length - 1; i >= 0; i--) {
        const p = lagged(progress, PASSES[i]!.lag);
        if (p > 0) next({ ...s, style: PASSES[i]!.color, stroke: { ...s.stroke, path: passes[i]!, progress: p, nibs: [] } });
      }
      s.ctx.restore();
      const ink = lagged(progress, INK_LAG);
      if (ink > 0) next({ ...s, stroke: { ...s.stroke, progress: ink } });
    },
  };
}
