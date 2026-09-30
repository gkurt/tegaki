import { createPlugin, expandBox, unionBoxes } from 'tegaki/core';
import { clamp01, css, hex, penTime, whole } from './util.ts';

/**
 * A comet at the pen: a white-hot head with a halo, a tail of sparks shed
 * behind it, a burst where each stroke ends, and ink that's still hot for a
 * moment after the pen has passed — white cooling to the text's color.
 */
export const comet = createPlugin({
  name: 'comet',
  params: {
    color: { type: 'color', default: '#ffcf8a' },
    hot: { type: 'number', default: 0.35, min: 0, max: 2, description: 'Seconds the ink stays hot.' },
    sparks: { type: 'number', default: 26, min: 0, max: 80 },
  },
  setup: ({ color, hot, sparks }) => {
    const tint = hex(color);
    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * 0.4),
      paint(s, next) {
        next(s);
        const { stroke } = s;
        if (stroke.state === 'pending' || hot <= 0 || stroke.path.points.length < 2) return;
        // The last stretch the pen drew, still glowing: slices of the drawn
        // path, each whiter the more recently the pen was there.
        const now = s.frame.time;
        const bands = 6;
        for (let b = 0; b < bands; b++) {
          const age0 = (hot * (b + 1)) / bands;
          const age1 = (hot * b) / bands;
          // Draw progress where the pen was `age` seconds ago.
          const at = (age: number) => {
            const tt = (now - age - stroke.start) / stroke.duration;
            if (tt <= 0) return 0;
            if (tt >= 1) return 1;
            return 1 - (1 - tt) * (1 - tt);
          };
          const from = at(age0);
          const to = Math.min(stroke.progress, at(age1));
          if (to - from < 0.002) continue;
          const heat = 1 - b / bands;
          next(whole(s, stroke.path.slice(from, to), css([255, 250, 235], 0.55 * heat * heat)));
        }
      },
      overlay({ ctx, frame, fontSize, random }) {
        ctx.globalCompositeOperation = 'lighter';
        for (const st of frame.strokes) {
          if (st.state === 'pending') continue;
          const r = random(st.id);
          // Sparks shed behind the pen: each born at a point of the stroke as the pen passes it, drifting and fading.
          for (let i = 0; i < sparks; i++) {
            const t = r();
            const dir = r() * Math.PI * 2;
            const speed = (0.15 + r() * 0.6) * fontSize;
            const life = 0.25 + r() * 0.45;
            const size = (0.006 + r() * 0.014) * fontSize;
            const born = penTime(st, t);
            const age = frame.time - born;
            if (age < 0 || age > life) continue;
            const k = age / life;
            const p = st.path.pointAt(t);
            const x = p.x + Math.cos(dir) * speed * age;
            const y = p.y + Math.sin(dir) * speed * age + 0.4 * fontSize * age * age;
            ctx.fillStyle = css(tint, (1 - k) * (1 - k));
            ctx.beginPath();
            ctx.arc(x, y, size * (1 - k * 0.6), 0, Math.PI * 2);
            ctx.fill();
          }
          // A burst where the stroke ends.
          const end = st.start + st.duration;
          const since = frame.time - end;
          if (st.state === 'done' && since >= 0 && since < 0.5) {
            const p = st.path.pointAt(1);
            const k = since / 0.5;
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, fontSize * (0.05 + 0.25 * k));
            g.addColorStop(0, css([255, 255, 255], 0.5 * (1 - k)));
            g.addColorStop(1, css(tint, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, fontSize * (0.05 + 0.25 * k), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // The head: a hot core in a wide halo.
        for (const a of frame.active) {
          if (a.progress <= 0 || a.progress >= 1) continue;
          const { x, y } = a.head;
          const flick = 0.85 + 0.15 * random(`${a.id}:${Math.round(frame.time * 30)}`)();
          const halo = fontSize * 0.22 * flick;
          const g = ctx.createRadialGradient(x, y, 0, x, y, halo);
          g.addColorStop(0, css([255, 255, 255], 0.95));
          g.addColorStop(0.12, css(tint, 0.8));
          g.addColorStop(0.4, css(tint, 0.18));
          g.addColorStop(1, css(tint, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, halo, 0, Math.PI * 2);
          ctx.fill();
          // A glint across it, along the pen's travel.
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(a.head.angle);
          const lg = ctx.createLinearGradient(-halo * 1.6, 0, halo * 1.6, 0);
          lg.addColorStop(0, css(tint, 0));
          lg.addColorStop(0.5, css([255, 255, 255], 0.55 * clamp01(flick)));
          lg.addColorStop(1, css(tint, 0));
          ctx.fillStyle = lg;
          ctx.fillRect(-halo * 1.6, -fontSize * 0.006, halo * 3.2, fontSize * 0.012);
          ctx.restore();
        }
      },
    };
  },
});
