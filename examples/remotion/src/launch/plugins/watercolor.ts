import { createPlugin, expandBox, type StrokePath, unionBoxes } from 'tegaki/core';
import { css, deviceBox, hex, meanWidth, memo, noise2, ramp, scratch } from './util.ts';

/**
 * Watercolor: each stroke laid in three washes — a wide pale one, a middle
 * one and a narrow deep one — each wandering a little off the line, the
 * color running across the text, multiplied where washes cross, pigment
 * pooling where a stroke ends, and the paper's grain lifting some of it.
 */
export const watercolor = createPlugin({
  name: 'watercolor',
  params: {
    colors: { type: 'colors', default: ['#1f6fb2', '#6a4bc4', '#d6457f', '#e8832a'] },
  },
  setup: ({ colors }) => {
    const stops = colors.map(hex);
    const washes = memo((path: StrokePath) => {
      const w = meanWidth(path);
      const seed = path.length * 0.013;
      return [
        { k: 2.1, a: 0.16, j: 0.4 },
        { k: 1.45, a: 0.22, j: 0.25 },
        { k: 0.85, a: 0.42, j: 0.1 },
      ].map(({ k, a, j }, i) => ({
        a,
        path: path.map((p) => {
          const n = noise2(p.x * 0.02 + seed + i * 7, p.y * 0.02) - 0.5;
          const m = noise2(p.y * 0.02 + i * 3, p.x * 0.02 + seed) - 0.5;
          return { ...p, x: p.x + n * w * j * 2, y: p.y + m * w * j * 2, width: w * k };
        }),
      }));
    });
    let grain: CanvasPattern | null = null;
    const copy = scratch();
    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * 0.12),
      paint(s, next) {
        const { stroke, ctx, textBox } = s;
        if (stroke.state === 'pending') return;
        const across = (stroke.place.x - textBox.minX) / Math.max(1, textBox.maxX - textBox.minX);
        const rgb = ramp(stops, across + stroke.strokeIndex * 0.04);
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        for (const wash of washes(stroke.path)) next({ ...s, style: css(rgb, wash.a), stroke: { ...stroke, path: wash.path, nibs: [] } });
        // Pigment pooled at the end, once the brush lifts.
        if (stroke.state === 'done') {
          const pe = stroke.path.pointAt(1);
          const r = meanWidth(stroke.path) * 0.75;
          const g = ctx.createRadialGradient(pe.x, pe.y, 0, pe.x, pe.y, r);
          g.addColorStop(0, css(rgb, 0.35));
          g.addColorStop(1, css(rgb, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(pe.x, pe.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      },
      ink({ ctx, bounds, fontSize }) {
        const k = ctx.getTransform().a;
        const r = deviceBox(ctx, bounds, 4);
        if (!r) return;
        // Soften the washes' edges a touch.
        const c = copy(r.w, r.h);
        const cc = c.getContext('2d')!;
        cc.globalCompositeOperation = 'copy';
        cc.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'copy';
        ctx.filter = `blur(${Math.max(0.6, fontSize * k * 0.004)}px)`;
        ctx.drawImage(c, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.filter = 'none';
        // The paper's grain lifts some pigment.
        if (!grain) {
          const g = document.createElement('canvas');
          g.width = g.height = 96;
          const gc = g.getContext('2d')!;
          for (let i = 0; i < 1400; i++) {
            const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
            const y = (Math.sin(i * 78.233) * 12543.123) % 1;
            gc.fillStyle = `rgba(0,0,0,${0.25 + ((i * 7) % 10) / 20})`;
            gc.fillRect(Math.abs(x) * 96, Math.abs(y) * 96, 1.4, 1.4);
          }
          grain = ctx.createPattern(g, 'repeat');
        }
        if (grain) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = grain;
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
        ctx.restore();
      },
    };
  },
});
