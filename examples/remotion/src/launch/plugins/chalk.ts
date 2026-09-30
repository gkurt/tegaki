import { createPlugin, expandBox, type StrokePath, seededRandom, unionBoxes } from 'tegaki/core';
import { css, hex, memo, noise2, penTime } from './util.ts';

interface Grain {
  t: number;
  x: number;
  y: number;
  s: number;
  a: number;
}

/**
 * Chalk on a blackboard: each stroke a drift of chalk grains that catch on
 * the board's grain (so the line skips where the board is low), with dust
 * shaken off as the stick moves, falling and fading.
 */
export const chalk = createPlugin({
  name: 'chalk',
  params: {
    color: { type: 'color', default: '#f4f1ea' },
    dust: { type: 'number', default: 1, min: 0, max: 3 },
  },
  setup: ({ color, dust }) => {
    const rgb = hex(color);
    const grainsOf = memo((path: StrokePath): Grain[][] => {
      const r = seededRandom(path.length, 'chalk');
      const step = 0.9;
      const n = Math.max(1, Math.ceil(path.length / step));
      // Four alpha buckets so a frame sets the fill a few times, not per grain.
      const buckets: Grain[][] = [[], [], [], []];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = path.pointAt(t);
        const nx = -Math.sin(p.angle);
        const ny = Math.cos(p.angle);
        const w = Math.max(1.5, p.width);
        for (let k = 0; k < 3; k++) {
          const off = (r() * 2 - 1) * w * 0.52;
          const x = p.x + nx * off + (r() - 0.5) * 1.2;
          const y = p.y + ny * off + (r() - 0.5) * 1.2;
          // The board's tooth: low spots the chalk skips.
          const tooth = noise2(x * 0.09, y * 0.09) * 0.6 + noise2(x * 0.5, y * 0.5) * 0.4;
          if (tooth < 0.34 + Math.abs(off / w) * 0.35) continue;
          const b = Math.min(3, Math.floor(r() * 4));
          buckets[b]!.push({ t, x, y, s: 0.8 + r() * Math.max(1, w * 0.12), a: 0 });
        }
      }
      for (const b of buckets) b.sort((p, q) => p.t - q.t);
      return buckets;
    });
    const alphas = [0.35, 0.55, 0.75, 0.95];
    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * 0.5),
      paint(s) {
        const { stroke, ctx } = s;
        if (stroke.state === 'pending') return;
        const buckets = grainsOf(stroke.path);
        for (let b = 0; b < buckets.length; b++) {
          ctx.fillStyle = css(rgb, alphas[b]!);
          for (const g of buckets[b]!) {
            if (g.t > stroke.progress) break;
            ctx.fillRect(g.x - g.s / 2, g.y - g.s / 2, g.s, g.s);
          }
        }
      },
      overlay({ ctx, frame, fontSize, random }) {
        if (dust <= 0) return;
        for (const st of frame.strokes) {
          if (st.state === 'pending') continue;
          const r = random(`dust:${st.id}`);
          const count = Math.round((st.path.length / fontSize) * 26 * dust);
          for (let i = 0; i < count; i++) {
            const t = r();
            const life = 0.6 + r() * 1.1;
            const dx = (r() - 0.5) * 0.25 * fontSize;
            const size = (0.004 + r() * 0.008) * fontSize;
            const age = frame.time - penTime(st, t);
            if (age < 0 || age > life) continue;
            const p = st.path.pointAt(t);
            const k = age / life;
            ctx.fillStyle = css(rgb, 0.55 * (1 - k));
            ctx.fillRect(p.x + dx * k, p.y + 0.6 * fontSize * age * age + 0.05 * fontSize * age, size, size);
          }
        }
      },
    };
  },
});
