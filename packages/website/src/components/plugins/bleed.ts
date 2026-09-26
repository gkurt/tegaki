import { createPlugin, expandBox, unionBoxes } from 'tegaki/core';
import { inkRegion, scratchCanvas, silhouette } from './ink-canvas.ts';
import { grainCanvas, grainTile } from './noise.ts';

const TILE = 64;

/**
 * Ink soaking into the paper: a soft, feathered spread of the ink's color
 * under it, broken up by the paper's fibers the way ink wicks along them.
 * An `ink` hook: the finished ink's silhouette, blurred, with the fibers
 * taken out, laid under the ink.
 */
export const bleedPlugin = createPlugin({
  name: 'bleed',
  label: 'Ink bleed',
  description: 'The ink soaking into the paper around each line, along its fibers. ink.',
  params: {
    spread: {
      type: 'number',
      label: 'Spread',
      description: 'How far the ink soaks, in ems.',
      default: 0.02,
      min: 0.002,
      max: 0.08,
      step: 0.002,
    },
    amount: { type: 'number', label: 'Amount', description: 'How strong the soaked ink is.', default: 0.45, min: 0, max: 1, step: 0.05 },
    fibers: {
      type: 'number',
      label: 'Fibers',
      description: 'How much the paper breaks the spread up.',
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
    },
  },
  presets: {
    Blotting: { spread: 0.035, amount: 0.6, fibers: 0.8 },
    'Rice paper': { spread: 0.05, amount: 0.5, fibers: 1 },
    Damp: { spread: 0.012, amount: 0.7, fibers: 0.2 },
  },
  setup: ({ spread, amount, fibers }) => {
    const scratch = scratchCanvas();
    let texture: { k: number; canvas: HTMLCanvasElement } | null = null;
    let tile: Uint8ClampedArray | null = null;
    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * spread * 2),
      ink({ ctx, ink, bounds, color, fontSize, random }) {
        if (amount <= 0) return;
        const k = ctx.getTransform().a;
        const blur = spread * fontSize * k;
        const r = inkRegion(ctx, ink, bounds, blur * 2 + 2);
        if (!r) return;
        const soak = silhouette(scratch(r.w, r.h), ink, r, { color, blur, dx: 0, dy: 0 });
        if (fibers > 0) {
          // Fibers a little coarser than a pixel, fixed to the canvas as the paper is.
          tile ??= grainTile(TILE, 1, 1, random('bleed'));
          if (texture?.k !== k) texture = { k, canvas: grainCanvas(tile, TILE, 1.5 * k) };
          const c = soak.getContext('2d')!;
          const pattern = c.createPattern(texture.canvas, 'repeat');
          if (pattern) {
            pattern.setTransform(new DOMMatrix().translate(-r.x, -r.y));
            c.save();
            c.globalCompositeOperation = 'destination-out';
            c.globalAlpha = fibers;
            c.fillStyle = pattern;
            c.fillRect(0, 0, r.w, r.h);
            c.restore();
          }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'destination-over';
        ctx.globalAlpha = amount;
        ctx.drawImage(soak, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
      },
    };
  },
});
