import { createPlugin } from 'tegaki/core';
import { inkRegion } from './ink-canvas.ts';
import { grainCanvas, grainTile } from './noise.ts';

/** Cells across the tile before it repeats. */
const TILE = 96;

/**
 * Ink on textured paper: specks of the paper show through the ink, and
 * streaks of fiber with them, where the pen skipped over the paper's tooth.
 * An `ink` hook: it takes a texture out of the finished ink each frame. The
 * texture is fixed to the canvas, like paper, so the ink moves over it
 * rather than it moving with the ink.
 */
export const grainPlugin = createPlugin({
  name: 'grain',
  label: 'Paper grain',
  description: "The paper's texture showing through the ink. ink.",
  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      description: 'How much of the paper shows through.',
      default: 0.45,
      min: 0,
      max: 1,
      step: 0.05,
    },
    size: { type: 'number', label: 'Size', description: 'A speck of grain, in px.', default: 1.2, min: 0.5, max: 4, step: 0.1 },
    fibers: { type: 'number', label: 'Fibers', description: 'Streaks of pulp in the paper.', default: 0.4, min: 0, max: 1, step: 0.05 },
  },
  presets: {
    'Cold press': { amount: 0.6, size: 1.8, fibers: 0.2 },
    Newsprint: { amount: 0.35, size: 0.8, fibers: 1 },
    Charcoal: { amount: 0.85, size: 2.4, fibers: 0 },
  },
  setup: ({ amount, size, fibers }) => {
    let tile: Uint8ClampedArray | null = null;
    let texture: { k: number; canvas: HTMLCanvasElement } | null = null;
    let pattern: { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement; pattern: CanvasPattern | null } | null = null;
    return {
      ink({ ctx, ink, bounds, random }) {
        if (amount <= 0) return;
        const r = inkRegion(ctx, ink, bounds, 2);
        if (!r) return;
        // Cells of `size` CSS px, in device px (the ink hook's transform carries the pixel ratio).
        const k = size * ctx.getTransform().a;
        tile ??= grainTile(TILE, amount, fibers, random('grain'));
        if (texture?.k !== k) texture = { k, canvas: grainCanvas(tile, TILE, k) };
        if (pattern?.ctx !== ctx || pattern.canvas !== texture.canvas) {
          pattern = { ctx, canvas: texture.canvas, pattern: ctx.createPattern(texture.canvas, 'repeat') };
        }
        if (!pattern.pattern) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = pattern.pattern;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      },
    };
  },
});
