import { createPlugin, expandBox, seededRandom, unionBoxes } from 'tegaki/core';
import { deviceBox, scratch } from './util.ts';

/**
 * A glitch: the ink split into red and cyan that drift apart and snap back,
 * slices of it torn sideways in bursts, scanlines through it, and a block
 * cursor at the pen. The bursts run on `steps`, so a video glitches the same
 * every render.
 */
export const glitch = createPlugin({
  name: 'glitch',
  params: {
    amount: { type: 'number', default: 1, min: 0, max: 3 },
  },
  setup: ({ amount }) => {
    const src = scratch();
    const red = scratch();
    const cyan = scratch();
    const tint = (into: HTMLCanvasElement, from: HTMLCanvasElement, w: number, h: number, color: string) => {
      const c = into.getContext('2d')!;
      c.globalCompositeOperation = 'copy';
      c.drawImage(from, 0, 0, w, h, 0, 0, w, h);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = color;
      c.fillRect(0, 0, w, h);
      return into;
    };
    return {
      steps: { count: 360, fps: 15, paintOnly: true },
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * 0.25),
      ink({ ctx, bounds, fontSize, step }) {
        const k = ctx.getTransform().a;
        const r = deviceBox(ctx, bounds, fontSize * k * 0.2);
        if (!r) return;
        const rnd = seededRandom(step, 'glitch');
        const burst = rnd() < 0.3;
        const split = fontSize * k * 0.012 * amount * (burst ? 2.5 + rnd() * 2 : 0.6 + rnd() * 0.5);
        const s = src(r.w, r.h);
        const sc = s.getContext('2d')!;
        sc.globalCompositeOperation = 'copy';
        sc.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        const R = tint(red(r.w, r.h), s, r.w, r.h, '#ff2d55');
        const Cy = tint(cyan(r.w, r.h), s, r.w, r.h, '#00e5ff');
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(r.x, r.y, r.w, r.h);
        ctx.globalCompositeOperation = 'lighter';
        // Horizontal bands, a few torn sideways.
        let y = 0;
        while (y < r.h) {
          const h = Math.max(4, Math.round((0.02 + rnd() * 0.08) * fontSize * k));
          const tear = burst && rnd() < 0.35 ? (rnd() * 2 - 1) * fontSize * k * 0.12 * amount : 0;
          const hh = Math.min(h, r.h - y);
          ctx.drawImage(R, 0, y, r.w, hh, r.x - split + tear, r.y + y, r.w, hh);
          ctx.drawImage(Cy, 0, y, r.w, hh, r.x + split + tear, r.y + y, r.w, hh);
          ctx.globalAlpha = 0.85;
          ctx.drawImage(s, 0, y, r.w, hh, r.x + tear, r.y + y, r.w, hh);
          ctx.globalAlpha = 1;
          y += h;
        }
        // Scanlines.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        const gap = Math.max(2, Math.round(k * 3));
        for (let yy = r.y; yy < r.y + r.h; yy += gap) ctx.fillRect(r.x, yy, r.w, Math.max(1, gap / 3));
        ctx.restore();
      },
      overlay({ ctx, frame, fontSize, step }) {
        for (const a of frame.active) {
          if (a.progress <= 0 || a.progress >= 1) continue;
          if (step % 4 < 1) continue;
          ctx.fillStyle = '#eafcff';
          ctx.fillRect(a.head.x + fontSize * 0.03, a.head.y - fontSize * 0.12, fontSize * 0.07, fontSize * 0.14);
        }
      },
    };
  },
});
