import { createPlugin, expandBox, unionBoxes } from 'tegaki/core';
import { deviceBox, scratch } from './util.ts';

const GOLD = ['#5a3a06', '#a8751c', '#f3cf6e', '#b8841f', '#5e3d08', '#d9a93f', '#fbe7a6', '#9a6a14', '#4f3305'];

/**
 * Gold leaf: a metallic gradient across the text that slides as the light
 * moves, a bright sheen sweeping through it, a bevel shadow under the ink,
 * and glints that catch on the strokes and wink out.
 */
export const foil = createPlugin({
  name: 'foil',
  params: {
    speed: { type: 'number', default: 0.35, min: 0, max: 2, description: 'How fast the light moves across, text widths a second.' },
  },
  setup: ({ speed }) => {
    const copy = scratch();
    let memo: { ctx: CanvasRenderingContext2D; time: number; base: CanvasGradient; sheen: CanvasGradient } | null = null;
    const gradients = (ctx: CanvasRenderingContext2D, time: number, box: { minX: number; minY: number; maxX: number; maxY: number }) => {
      if (memo && memo.ctx === ctx && memo.time === time) return memo;
      const w = box.maxX - box.minX;
      const h = box.maxY - box.minY;
      const shift = (time * speed) % 1;
      // A diagonal gradient twice the text's width, slid by the time.
      const x0 = box.minX - w * shift;
      const base = ctx.createLinearGradient(x0, box.minY, x0 + w * 1.2, box.maxY + h * 0.4);
      for (const [i, c] of GOLD.entries()) base.addColorStop(i / (GOLD.length - 1), c);
      const sx = box.minX - w * 0.4 + ((time * speed * 1.6) % 1.6) * w * 1.4;
      const sheen = ctx.createLinearGradient(sx - h * 0.8, box.minY, sx + h * 0.4, box.maxY);
      sheen.addColorStop(0, 'rgba(255,255,240,0)');
      sheen.addColorStop(0.5, 'rgba(255,246,214,0.7)');
      sheen.addColorStop(1, 'rgba(255,255,240,0)');
      memo = { ctx, time, base, sheen };
      return memo;
    };
    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * 0.2),
      paint(s, next) {
        if (s.stroke.state === 'pending') return next(s);
        const g = gradients(s.ctx, s.frame.time, s.textBox);
        next({ ...s, style: g.base });
        next({ ...s, style: g.sheen, stroke: { ...s.stroke, nibs: [] } });
      },
      ink({ ctx, bounds, fontSize }) {
        const k = ctx.getTransform().a;
        const r = deviceBox(ctx, bounds, fontSize * k * 0.1);
        if (!r) return;
        const c = copy(r.w, r.h);
        const cc = c.getContext('2d')!;
        cc.globalCompositeOperation = 'copy';
        cc.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // An inner highlight on the top edge: the ink, lightened, moved down a hair, kept inside the ink.
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = 0.22;
        ctx.filter = 'brightness(1.6) blur(0.6px)';
        ctx.drawImage(c, 0, 0, r.w, r.h, r.x, r.y + fontSize * k * 0.012, r.w, r.h);
        // A cast shadow under it.
        ctx.globalCompositeOperation = 'destination-over';
        ctx.globalAlpha = 1;
        ctx.filter = `drop-shadow(0 ${fontSize * k * 0.02}px ${fontSize * k * 0.025}px rgba(0,0,0,0.7)) brightness(0.35)`;
        ctx.drawImage(c, 0, 0, r.w, r.h, r.x, r.y + fontSize * k * 0.01, r.w, r.h);
        ctx.restore();
      },
      overlay({ ctx, frame, fontSize, random }) {
        ctx.globalCompositeOperation = 'lighter';
        for (const st of frame.strokes) {
          if (st.state !== 'done') continue;
          const r = random(`glint:${st.id}`);
          for (let i = 0; i < 2; i++) {
            const t = r();
            const period = 1.2 + r() * 1.6;
            const phase = r();
            const size = (0.05 + r() * 0.06) * fontSize;
            const wave = Math.sin(((frame.time / period + phase) % 1) * Math.PI * 2);
            const a = Math.max(0, wave) ** 10;
            if (a < 0.02) continue;
            const p = st.path.pointAt(t);
            const s = size * a;
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s);
            g.addColorStop(0, `rgba(255,252,230,${a})`);
            g.addColorStop(1, 'rgba(255,230,160,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            // A four-pointed star.
            ctx.moveTo(p.x, p.y - s);
            ctx.quadraticCurveTo(p.x, p.y, p.x + s, p.y);
            ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s);
            ctx.quadraticCurveTo(p.x, p.y, p.x - s, p.y);
            ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s);
            ctx.fill();
          }
        }
      },
    };
  },
});
