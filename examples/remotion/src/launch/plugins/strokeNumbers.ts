import { createPlugin, expandBox, unionBoxes } from 'tegaki/core';
import { smooth } from './util.ts';

/** Stroke order for learners: each stroke's number pops in at its start as the pen sets down there. */
export const strokeNumbers = createPlugin({
  name: 'stroke-numbers',
  params: {
    color: { type: 'color', default: '#d33a26' },
  },
  setup: ({ color }) => ({
    bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * 0.12),
    overlay({ ctx, frame, fontSize }) {
      frame.strokes.forEach((st, i) => {
        const pop = smooth(st.start - 0.05, st.start + 0.15, frame.time);
        if (pop <= 0) return;
        const p = st.path.pointAt(0);
        const r = fontSize * 0.042 * (0.6 + 0.4 * pop);
        // Just behind where the pen sets down, so it doesn't sit on the ink.
        const a = p.angle + Math.PI;
        const x = p.x + Math.cos(a) * fontSize * 0.075;
        const y = p.y + Math.sin(a) * fontSize * 0.075;
        ctx.globalAlpha = pop;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `600 ${Math.round(r * 1.2)}px Geist, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x, y + r * 0.05);
      });
    },
  }),
});
