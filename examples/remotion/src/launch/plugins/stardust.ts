import { createPlugin, expandBox, type StrokePath, seededRandom, unionBoxes } from 'tegaki/core';
import { css, hex, meanWidth, memo, penTime, uniform } from './util.ts';

const HUES = ['#ffffff', '#cfe3ff', '#ffd6f5', '#ffe9a8', '#b9fff1'].map(hex);

interface Star {
  t: number;
  dx: number;
  dy: number;
  size: number;
  hue: number;
  phase: number;
}

/**
 * Stardust: a faint thread of light along each stroke, strewn with stars
 * that pop into being as the pen passes and twinkle ever after.
 */
export const stardust = createPlugin({
  name: 'stardust',
  params: {
    density: { type: 'number', default: 1, min: 0.2, max: 3 },
  },
  setup: ({ density }) => {
    const threads = memo((path: StrokePath) => uniform(path, Math.max(1, meanWidth(path) * 0.16)));
    const starsOf = memo((path: StrokePath): Star[] => {
      const r = seededRandom(path.length, 'stars');
      const w = meanWidth(path);
      const n = Math.round((path.length / Math.max(2, w)) * 3.2 * density) + 2;
      const out: Star[] = [];
      for (let i = 0; i < n; i++) {
        // Gaussian-ish spread across the line.
        const g = (r() + r() + r() - 1.5) / 1.5;
        const ang = r() * Math.PI * 2;
        out.push({
          t: r(),
          dx: Math.cos(ang) * g * w * 0.9,
          dy: Math.sin(ang) * g * w * 0.9,
          size: r() ** 3,
          hue: Math.floor(r() * HUES.length),
          phase: r() * 10,
        });
      }
      return out;
    });
    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * 0.2),
      paint(s, next) {
        const { stroke, ctx, frame, fontSize } = s;
        if (stroke.state === 'pending') return;
        next({ ...s, style: 'rgba(200, 215, 255, 0.35)', stroke: { ...stroke, path: threads(stroke.path), nibs: [] } });
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const st of starsOf(stroke.path)) {
          if (st.t > stroke.progress) continue;
          const age = frame.time - penTime(stroke, st.t);
          const pop = age < 0.3 ? Math.sin((Math.min(1, age / 0.3) * Math.PI) / 1.2) * 1.4 : 1;
          const tw = 0.55 + 0.45 * Math.sin(frame.time * 5 + st.phase);
          const p = stroke.path.pointAt(st.t);
          const x = p.x + st.dx;
          const y = p.y + st.dy;
          const size = (0.006 + st.size * 0.03) * fontSize * pop;
          const col = HUES[st.hue]!;
          if (st.size > 0.35) {
            // A bright one: a four-pointed star in a halo.
            const g = ctx.createRadialGradient(x, y, 0, x, y, size * 2.2);
            g.addColorStop(0, css(col, 0.9 * tw));
            g.addColorStop(1, css(col, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, size * 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = css(col, tw);
            ctx.beginPath();
            ctx.moveTo(x, y - size * 2);
            ctx.quadraticCurveTo(x, y, x + size * 2, y);
            ctx.quadraticCurveTo(x, y, x, y + size * 2);
            ctx.quadraticCurveTo(x, y, x - size * 2, y);
            ctx.quadraticCurveTo(x, y, x, y - size * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = css(col, 0.5 + 0.5 * tw);
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      },
    };
  },
});
