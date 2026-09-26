import { createPlugin, type StrokePath } from 'tegaki/core';

/** A pass laid over each stroke before the ink: its color, its width against the ink's, and how far behind the first it starts. */
export interface EchoPass {
  color: string;
  width: number;
  lag: number;
}

/** Draw progress of a pass `lag` behind the lead, finishing with it: 0 until the lead is `lag` along, 1 when it's done. */
export function lagged(progress: number, lag: number): number {
  return lag <= 0 ? progress : Math.max(0, Math.min(1, (progress - lag) / (1 - lag)));
}

/**
 * The passes for the echo's settings, widest first: the lead at `spread`
 * times the ink's width, and the follow (if on) between it and the ink, in
 * width and in lag — halfway behind the lead to where the ink starts.
 */
export function echoPasses(o: { lead: string; follow: string; second: boolean; spread: number; lag: number }): EchoPass[] {
  const passes = [{ color: o.lead, width: o.spread, lag: 0 }];
  if (o.second) passes.push({ color: o.follow, width: 1 + (o.spread - 1) * 0.45, lag: o.lag / 2 });
  return passes;
}

/**
 * Several strokes over the same path, one after another: a wide pass leads,
 * a narrower one follows, and the ink comes last, each a beat behind the one
 * before and all finishing together. A `paint` plugin: it calls `next` once
 * per pass with its own path, color and progress. With clip-to-text on the
 * passes are clipped to the letters, so they show as color running ahead of
 * the ink.
 */
export const echoPlugin = createPlugin({
  name: 'echo',
  label: 'Echo',
  description:
    'Strokes over each path, one a beat behind the other. paint — turn Clip to text off (Style → Rendering) to see the passes around the ink, not just ahead of it.',
  params: {
    lead: { type: 'color', label: 'Lead', default: '#ffd166' },
    second: { type: 'boolean', label: 'Second pass', default: true },
    follow: { type: 'color', label: 'Follow', default: '#ef476f' },
    spread: {
      type: 'number',
      label: 'Spread',
      description: "The lead's width, against the ink's.",
      default: 2.6,
      min: 1,
      max: 5,
      step: 0.1,
    },
    lag: {
      type: 'number',
      label: 'Lag',
      description: 'How far behind the lead the ink starts.',
      default: 0.36,
      min: 0,
      max: 0.8,
      step: 0.02,
    },
  },
  presets: {
    Highlighter: { lead: '#fff176', second: false, spread: 4, lag: 0 },
    Neon: { lead: '#00e5ff', follow: '#ff2bd6', spread: 3.4, lag: 0.2 },
  },
  setup: (options) => {
    const passes = echoPasses(options);
    const widened = new WeakMap<StrokePath, StrokePath[]>();
    return {
      paint(s, next) {
        const { path, progress } = s.stroke;
        let paths = widened.get(path);
        if (!paths) {
          paths = passes.map(({ width }) => path.map((p) => ({ ...p, width: p.width * width })));
          widened.set(path, paths);
        }
        // The passes go under the ink already on the canvas — this stroke's
        // wide passes mustn't cover the strokes it crosses — narrowest first,
        // so each wider one slides in beneath it.
        s.ctx.save();
        s.ctx.globalCompositeOperation = 'destination-over';
        for (let i = passes.length - 1; i >= 0; i--) {
          const p = lagged(progress, passes[i]!.lag);
          if (p > 0) next({ ...s, style: passes[i]!.color, stroke: { ...s.stroke, path: paths[i]!, progress: p, nibs: [] } });
        }
        s.ctx.restore();
        const ink = lagged(progress, options.lag);
        if (ink > 0) next({ ...s, stroke: { ...s.stroke, progress: ink } });
      },
    };
  },
});
