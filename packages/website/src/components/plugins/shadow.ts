import { createPlugin, expandBox, unionBoxes } from 'tegaki/core';
import { inkRegion, scratchCanvas, silhouette } from './ink-canvas.ts';

/**
 * A shadow under the ink, the way it falls under a raised letter: the
 * finished ink's silhouette in the shadow's color, moved and blurred, laid
 * under it. An `ink` hook, with `bounds` to make room for where it falls.
 */
export const shadowPlugin = createPlugin({
  name: 'shadow',
  label: 'Shadow',
  description: 'A shadow under the ink, moved and blurred. ink + bounds.',
  params: {
    color: { type: 'color', label: 'Color', default: '#000000' },
    opacity: { type: 'number', label: 'Opacity', default: 0.3, min: 0, max: 1, step: 0.05 },
    x: { type: 'number', label: 'X', description: 'How far right it falls, in ems.', default: 0.02, min: -0.2, max: 0.2, step: 0.005 },
    y: { type: 'number', label: 'Y', description: 'How far down it falls, in ems.', default: 0.03, min: -0.2, max: 0.2, step: 0.005 },
    blur: { type: 'number', label: 'Blur', description: 'How soft it is, in ems.', default: 0.02, min: 0, max: 0.2, step: 0.005 },
  },
  presets: {
    Hard: { opacity: 0.5, x: 0.03, y: 0.03, blur: 0 },
    Floating: { opacity: 0.22, x: 0, y: 0.12, blur: 0.08 },
    Retro: { color: '#ff4d6d', opacity: 1, x: 0.05, y: 0.05, blur: 0 },
  },
  setup: ({ color, opacity, x, y, blur }) => {
    const scratch = scratchCanvas();
    const reach = Math.max(Math.abs(x), Math.abs(y)) + 1.5 * blur;
    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * reach),
      ink({ ctx, ink, bounds, fontSize }) {
        if (opacity <= 0) return;
        const k = ctx.getTransform().a;
        const r = inkRegion(ctx, ink, bounds, fontSize * reach * k + 2);
        if (!r) return;
        const shade = silhouette(scratch(r.w, r.h), ink, r, {
          color,
          blur: blur * fontSize * k,
          dx: x * fontSize * k,
          dy: y * fontSize * k,
        });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'destination-over';
        ctx.globalAlpha = opacity;
        ctx.drawImage(shade, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
      },
    };
  },
});
