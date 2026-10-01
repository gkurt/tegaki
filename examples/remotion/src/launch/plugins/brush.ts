import { createPlugin, expandBox, lengthToPx, offsetPath, type StrokePath, seededRandom, unionBoxes } from 'tegaki/core';
import { memo, noise2 } from './util.ts';

/**
 * A sumi brush of middling size: each stroke set down with a blunt, pressed
 * head, a body that breathes a little, and a tail lifted off into a flick —
 * the outer bristles running dry before the middle ones, so the end splits
 * into strands — with dry streaks through the body where the hairs part.
 * `geometry` gives the width; `paint` lays the bristles and the streaks.
 */
export const brush = createPlugin({
  name: 'brush',
  params: {
    size: { type: 'length', default: 0.085, min: 0.02, max: 0.3, description: 'The brush body, in em or px.' },
    dry: { type: 'number', default: 0.7, min: 0, max: 1, description: 'How much the hairs split and streak.' },
  },
  setup: ({ size, dry }) => {
    // The bristles and streaks of a stroke, made once per layout.
    const hairsOf = memo((path: StrokePath) => {
      const r = seededRandom(path.length, 'brush');
      const n = 7;
      const hairs = Array.from({ length: n }, (_, k) => {
        const across = (k / (n - 1) - 0.5) * 0.86;
        const width = 0.15 + r() * 0.08;
        return {
          path: offsetPath(path, (p) => p.width * across).map((p) => ({ ...p, width: p.width * width })),
          // The outer hairs give out first.
          end: 1 - dry * (0.02 + Math.abs(across) * (0.25 + r() * 0.35)),
        };
      });
      const streaks = Array.from({ length: 3 }, () => {
        const across = (r() - 0.5) * 0.6;
        const from = 0.25 + r() * 0.4;
        return {
          path: offsetPath(path, (p) => p.width * across).map((p) => ({ ...p, width: p.width * (0.04 + r() * 0.05) })),
          from,
          to: Math.min(1, from + 0.2 + r() * 0.4),
        };
      });
      return { hairs, streaks, core: 1 - dry * 0.14 };
    });
    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), lengthToPx(size, fontSize)),
      geometry(path, ctx) {
        const base = lengthToPx(size, ctx.fontSize) * (0.9 + 0.2 * ctx.random(ctx.stroke.id)());
        if (path.points.length < 2) return path.map((p) => ({ ...p, width: base * 1.3 }));
        const seed = ctx.seed * 3.1 + ctx.stroke.strokeIndex * 1.7;
        return path.map((p) => {
          const t = p.t;
          // Pressed down at the head, settling into the body, lifted off at the tail.
          const head = t < 0.08 ? 0.8 + 0.4 * Math.sin((t / 0.08) * (Math.PI / 2)) : 1.2 - 0.2 * Math.min(1, (t - 0.08) / 0.12);
          const tail = t > 0.62 ? 1 - 0.86 * ((t - 0.62) / 0.38) ** 1.4 : 1;
          const breathe = 0.92 + 0.16 * noise2(seed, t * 3);
          return { ...p, width: base * head * tail * breathe };
        });
      },
      paint(s, next) {
        const { stroke, ctx } = s;
        if (stroke.state === 'pending' || stroke.path.points.length < 2) return next(s);
        const { hairs, streaks, core } = hairsOf(stroke.path);
        const at = (end: number) => {
          const progress = Math.min(stroke.progress, end);
          return { ...stroke, progress, state: progress >= end ? ('done' as const) : stroke.state, nibs: [] };
        };
        // The body, ending before the hairs do.
        next({ ...s, stroke: at(core) });
        for (const h of hairs) next({ ...s, stroke: { ...at(h.end), path: h.path } });
        // Dry streaks where the hairs part, cut out of the ink the pen has passed.
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 0.55 * dry;
        for (const st of streaks) {
          if (stroke.progress <= st.from) continue;
          const to = Math.min(stroke.progress, st.to);
          next({ ...s, style: '#000', stroke: { ...stroke, path: st.path.slice(st.from, to), progress: 1, state: 'done', nibs: [] } });
        }
        ctx.restore();
      },
    };
  },
});
