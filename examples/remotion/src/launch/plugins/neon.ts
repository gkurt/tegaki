import { createPlugin, expandBox, type StrokePath, seededRandom, unionBoxes } from 'tegaki/core';
import { css, deviceBox, hex, meanWidth, memo, mixRgb, scratch, uniform } from './util.ts';

/** How lit a tube is at flicker step `step`, `age` seconds after the pen lit it. */
function brightness(seed: number, step: number, age: number): number {
  const hum = 1 - 0.1 * seededRandom(seed, `hum:${step}`)();
  if (age < 0) return hum;
  if (age < 0.5) return seededRandom(seed, `warm:${step}`)() < 0.3 + 1.4 * age ? hum : 0.15;
  // One faulty letter in five stutters now and then.
  if (seededRandom(seed, 'faulty')() < 0.22 && seededRandom(seed, `burst:${Math.floor(step / 10)}`)() < 0.3) {
    return seededRandom(seed, `stutter:${step}`)() < 0.5 ? 0.12 : hum;
  }
  return hum;
}

/**
 * Neon: glass tubes bent into the letters, the whole word there unlit from
 * the start, each tube lighting as the pen reaches it — sputtering while it
 * warms, humming once it has, colored from `from` to `to` across the text.
 * The glow is the lit ink blurred twice and added back.
 */
export const neon = createPlugin({
  name: 'neon',
  params: {
    from: { type: 'color', default: '#ff3fd2' },
    to: { type: 'color', default: '#27e8ff' },
    glow: { type: 'number', default: 1, min: 0, max: 2 },
  },
  setup: ({ from, to, glow }) => {
    const a = hex(from);
    const b = hex(to);
    const tubes = memo((path: StrokePath) => {
      const w = meanWidth(path);
      return { glass: uniform(path, w * 0.9), tube: uniform(path, w * 0.7), core: uniform(path, w * 0.22) };
    });
    const copy = scratch();
    return {
      steps: { count: 480, fps: 24, paintOnly: true },
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * 0.45),
      paint(s, next) {
        const { stroke, textBox } = s;
        const t = tubes(stroke.path);
        const across = (stroke.place.x - textBox.minX) / Math.max(1, textBox.maxX - textBox.minX);
        const col = mixRgb(a, b, Math.max(0, Math.min(1, across)));
        // The glass, unlit, for the whole stroke.
        next({ ...s, style: 'rgba(170, 160, 190, 0.13)', stroke: { ...stroke, path: t.glass, progress: 1, state: 'done', nibs: [] } });
        if (stroke.state === 'pending') return;
        const lit = brightness(stroke.seed, s.step, s.frame.time - (stroke.start + stroke.duration));
        next({ ...s, style: css(mixRgb([60, 50, 70], col, lit)), stroke: { ...stroke, path: t.tube, nibs: [] } });
        if (lit > 0.4) next({ ...s, style: css(mixRgb(col, [255, 255, 255], 0.75)), stroke: { ...stroke, path: t.core, nibs: [] } });
      },
      ink({ ctx, bounds, fontSize }) {
        if (glow <= 0) return;
        const k = ctx.getTransform().a;
        const r = deviceBox(ctx, bounds, fontSize * k * 0.45);
        if (!r) return;
        const c = copy(r.w, r.h);
        const cc = c.getContext('2d')!;
        cc.globalCompositeOperation = 'copy';
        cc.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.filter = `blur(${fontSize * k * 0.035}px)`;
        ctx.globalAlpha = 0.9 * glow;
        ctx.drawImage(c, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.filter = `blur(${fontSize * k * 0.13}px)`;
        ctx.globalAlpha = 0.8 * glow;
        ctx.drawImage(c, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.restore();
      },
    };
  },
});
