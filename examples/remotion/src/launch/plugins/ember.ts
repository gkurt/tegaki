import { createPlugin, expandBox, unionBoxes } from 'tegaki/core';
import { css, deviceBox, hex, penTime, ramp, scratch } from './util.ts';

const HEAT = ['#fffbe8', '#ffe27a', '#ffa21f', '#f25a12', '#b3200b', '#5c1007', '#2b0905'].map(hex);
/** Seconds after the pen at which the ink reaches each color of HEAT. */
const COOL = 2.4;

/**
 * Ember: ink laid down white-hot that cools through yellow, orange and red to
 * a smouldering char, glowing while it's hot, with sparks lifting off the
 * fresh line and drifting up.
 */
export const ember = createPlugin({
  name: 'ember',
  params: {
    sparks: { type: 'number', default: 1, min: 0, max: 3 },
  },
  setup: ({ sparks }) => {
    const copy = scratch();
    return {
      bounds: ({ strokes, fontSize }) => {
        const b = unionBoxes(strokes.map((s) => s.path.bounds()));
        return b && expandBox({ ...b, minY: b.minY - fontSize * 0.9 }, fontSize * 0.3);
      },
      paint(s, next) {
        const { stroke, frame } = s;
        if (stroke.state === 'pending') return next(s);
        const flick = 0.93 + 0.07 * Math.sin(frame.time * 23 + stroke.seed);
        next({
          ...s,
          style: (t: number) => {
            const age = frame.time - penTime(stroke, t);
            const c = ramp(HEAT, Math.max(0, age) / COOL);
            return css([c[0] * flick, c[1] * flick, c[2] * flick]);
          },
        });
      },
      ink({ ctx, bounds, fontSize }) {
        const k = ctx.getTransform().a;
        const r = deviceBox(ctx, bounds, fontSize * k * 0.3);
        if (!r) return;
        const c = copy(r.w, r.h);
        const cc = c.getContext('2d')!;
        cc.globalCompositeOperation = 'copy';
        cc.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.filter = `blur(${fontSize * k * 0.05}px) saturate(1.4)`;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(c, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.filter = `blur(${fontSize * k * 0.16}px)`;
        ctx.globalAlpha = 0.55;
        ctx.drawImage(c, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.restore();
      },
      overlay({ ctx, frame, fontSize, random }) {
        if (sparks <= 0) return;
        ctx.globalCompositeOperation = 'lighter';
        for (const st of frame.strokes) {
          if (st.state === 'pending') continue;
          const r = random(`spark:${st.id}`);
          const count = Math.round((st.path.length / fontSize) * 14 * sparks);
          for (let i = 0; i < count; i++) {
            const t = r();
            const delay = r() * 0.8;
            const life = 0.8 + r() * 1.2;
            const rise = (0.35 + r() * 0.6) * fontSize;
            const sway = (r() - 0.5) * 0.3 * fontSize;
            const freq = 2 + r() * 4;
            const size = (0.006 + r() * 0.012) * fontSize;
            const age = frame.time - penTime(st, t) - delay;
            if (age < 0 || age > life) continue;
            const p = st.path.pointAt(t);
            const k = age / life;
            const c = ramp(HEAT, 0.15 + k * 0.6);
            ctx.fillStyle = css(c, (1 - k) * 0.9);
            ctx.beginPath();
            ctx.arc(p.x + Math.sin(age * freq) * sway * k, p.y - rise * age, size * (1 - k * 0.5), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      },
    };
  },
});
