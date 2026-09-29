import { createPlugin, type StrokePath, type TegakiFrame } from 'tegaki/core';

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
 * per pass with its own path, color and progress. The passes go on a layer
 * under all the ink — the paint context's `unclipped` with clip-to-text on,
 * so they still show around the letters, and one of its own without, laid
 * under the ink by its `ink` hook — every stroke's lead under every
 * stroke's follow, so where strokes cross the bands stay in their order.
 */
export const echoPlugin = createPlugin({
  name: 'echo',
  label: 'Echo',
  description:
    "Strokes over each path, one a beat behind the other, around the letters even with Clip to text on. paint (unclipped), ink (the passes' layer without it).",
  params: {
    lead: { type: 'color', label: 'Lead', default: '#ffd166' },
    second: { type: 'boolean', label: 'Second pass', default: true },
    follow: { type: 'color', label: 'Follow', default: '#ef476f' },
    spread: {
      type: 'number',
      label: 'Spread',
      description: "The lead's width, against the ink's.",
      default: 1,
      min: 1,
      max: 5,
      step: 0.1,
    },
    lag: {
      type: 'number',
      label: 'Lag',
      description: 'How far behind the lead the ink starts.',
      default: 0.8,
      min: 0,
      max: 0.8,
      step: 0.02,
    },
  },
  presets: {
    Halo: { spread: 2.6, lag: 0.36 },
    Highlighter: { lead: '#fff176', second: false, spread: 4, lag: 0 },
    Neon: { lead: '#00e5ff', follow: '#ff2bd6', spread: 3.4, lag: 0.2 },
  },
  setup: (options) => {
    const passes = echoPasses(options);
    const widened = new WeakMap<StrokePath, StrokePath[]>();
    // Without clip-to-text `unclipped` is the canvas itself, under the ink
    // no more: the passes go on this layer, for the frame it was cleared for.
    let layer: CanvasRenderingContext2D | null = null;
    let layerFrame: TegakiFrame | null = null;
    const passLayer = (s: { ctx: CanvasRenderingContext2D; unclipped: CanvasRenderingContext2D; frame: TegakiFrame }) => {
      if (s.unclipped !== s.ctx) return s.unclipped;
      const { canvas } = s.ctx;
      layer ??= document.createElement('canvas').getContext('2d')!;
      if (layerFrame !== s.frame) {
        layerFrame = s.frame;
        if (layer.canvas.width !== canvas.width || layer.canvas.height !== canvas.height) {
          layer.canvas.width = canvas.width;
          layer.canvas.height = canvas.height;
        }
        layer.setTransform(1, 0, 0, 1, 0, 0);
        layer.clearRect(0, 0, canvas.width, canvas.height);
      }
      layer.setTransform(s.ctx.getTransform());
      return layer;
    };
    return {
      paint(s, next) {
        // Not drawn yet: pass it on, and the default painter shows nothing.
        if (s.stroke.state === 'pending') return next(s);
        const { path, progress } = s.stroke;
        let paths = widened.get(path);
        if (!paths) {
          paths = passes.map(({ width }) => path.map((p) => ({ ...p, width: p.width * width })));
          widened.set(path, paths);
        }
        // The passes go past the letters' edges, so on a layer under all the
        // ink that clip-to-text leaves alone: the lead beneath every pass
        // already there, the follow over the leads but under the follows
        // before it, so neither band of this stroke covers the strokes it crosses.
        const under = passLayer(s);
        for (let i = 0; i < passes.length; i++) {
          const p = lagged(progress, passes[i]!.lag);
          if (p <= 0) continue;
          under.save();
          under.globalCompositeOperation = i === 0 ? 'destination-over' : 'source-over';
          next({ ...s, ctx: under, style: passes[i]!.color, stroke: { ...s.stroke, path: paths[i]!, progress: p, nibs: [] } });
          under.restore();
        }
        const ink = lagged(progress, options.lag);
        if (ink > 0) next({ ...s, stroke: { ...s.stroke, progress: ink } });
      },
      ink({ ctx, frame }) {
        if (!layer || layerFrame !== frame) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'destination-over';
        ctx.drawImage(layer.canvas, 0, 0);
      },
    };
  },
});
