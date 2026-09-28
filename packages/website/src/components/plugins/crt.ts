import { createPlugin, expandBox, seededRandom, unionBoxes } from 'tegaki/core';
import { inkRegion, type Region, scratchCanvas, shrunk } from './ink-canvas.ts';

export const PHOSPHORS = { green: '#39ff7a', amber: '#ffb000', white: '#dfe8ff' } as const;

/** A band of the picture a bad signal tears sideways at one step: which rows (0–1 of the height) and how far (ems). */
export interface Tear {
  top: number;
  height: number;
  shift: number;
}

/** The tears at drawing `step`: mostly none; with `glitch` (0–1), now and then a few bands jolted sideways. */
export function tearsAt(seed: number, step: number, glitch: number): Tear[] {
  const random = seededRandom(seed, `tear:${step}`);
  if (glitch <= 0 || random() > glitch * 0.35) return [];
  const count = 1 + Math.floor(random() * 3);
  return Array.from({ length: count }, () => ({
    top: random(),
    height: 0.03 + random() * 0.15,
    shift: (random() * 2 - 1) * 0.08 * glitch,
  }));
}

/** How much the picture dims at drawing `step`: a flutter up to `flicker` × 0.2, and a rare deeper dip. */
export function dimAt(seed: number, step: number, flicker: number): number {
  const random = seededRandom(seed, `dim:${step}`);
  const flutter = random() * 0.2;
  const dip = random() < 0.04 ? 0.35 : 0;
  return flicker * (flutter + dip);
}

/**
 * A cathode-ray tube: the ink lit in a phosphor's glow (green, amber, cool
 * white, or its own colors), drawn in scanlines, with the red and blue
 * guns a little out of register, a bright bloom, a flutter, a dark bar
 * rolling down, and — with a bad signal — bands of the picture torn
 * sideways. One `ink` hook over the finished ink, run as a clock by
 * paint-only `steps` so it keeps flickering once the text is written; in
 * controlled time the flicker comes from the time.
 */
export const crtPlugin = createPlugin({
  name: 'crt',
  label: 'Cathode tube',
  description: 'Phosphor glow, scanlines, color fringes, flicker, a rolling bar and signal tears. Best on a dark background. steps + ink.',
  params: {
    phosphor: {
      type: 'select',
      label: 'Phosphor',
      default: 'green',
      options: [
        { value: 'green', label: 'Green' },
        { value: 'amber', label: 'Amber' },
        { value: 'white', label: 'White' },
        { value: 'ink', label: 'The ink’s own' },
      ],
    },
    scanlines: {
      type: 'number',
      label: 'Scanlines',
      description: 'How dark the gaps between lines are.',
      default: 0.45,
      min: 0,
      max: 1,
      step: 0.05,
    },
    fringe: {
      type: 'number',
      label: 'Fringe',
      description: 'How far out of register the color guns are, in ems.',
      default: 0.006,
      min: 0,
      max: 0.03,
      step: 0.001,
    },
    glow: { type: 'number', label: 'Glow', default: 0.6, min: 0, max: 1, step: 0.05 },
    flicker: { type: 'number', label: 'Flicker', default: 0.35, min: 0, max: 1, step: 0.05 },
    roll: { type: 'boolean', label: 'Rolling bar', default: true },
    glitch: {
      type: 'number',
      label: 'Bad signal',
      description: 'How often bands of the picture tear sideways.',
      default: 0.15,
      min: 0,
      max: 1,
      step: 0.05,
    },
  },
  presets: {
    Terminal: { phosphor: 'green', glitch: 0, fringe: 0.003 },
    Amber: { phosphor: 'amber', flicker: 0.2 },
    'Broken TV': { phosphor: 'ink', fringe: 0.018, flicker: 0.8, glitch: 0.8 },
  },
  setup: ({ phosphor, scanlines, fringe, glow, flicker, roll, glitch }) => {
    const fps = 30;
    const picture = scratchCanvas();
    const gun = scratchCanvas();
    const bloom = scratchCanvas();
    let lines: { ctx: CanvasRenderingContext2D; k: number; pattern: CanvasPattern | null } | null = null;
    const scanPattern = (ctx: CanvasRenderingContext2D, k: number) => {
      if (lines?.ctx === ctx && lines.k === k) return lines.pattern;
      // One line every 3 CSS px: its bottom third dark.
      const period = Math.max(2, Math.round(3 * k));
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = period;
      const g = c.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, period - Math.max(1, Math.round(period / 3)), 1, Math.max(1, Math.round(period / 3)));
      lines = { ctx, k, pattern: ctx.createPattern(c, 'repeat') };
      return lines.pattern;
    };
    /** One gun's picture: the ink's silhouette in `color`. */
    const tinted = (src: HTMLCanvasElement, r: Region, color: string) => {
      const c = gun(r.w, r.h);
      const g = c.getContext('2d')!;
      g.globalCompositeOperation = 'copy';
      g.drawImage(src, 0, 0, r.w, r.h, 0, 0, r.w, r.h);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, r.w, r.h);
      return c;
    };
    return {
      // 900 steps at 30 a second: the flicker repeats after half a minute.
      steps: { count: 900, fps, idle: true },
      bounds: ({ strokes, fontSize }) =>
        expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * (0.12 + fringe + 0.1 * glitch)),
      ink({ ctx, bounds, fontSize, step }) {
        const k = ctx.getTransform().a;
        const canvas = ctx.canvas;
        const r = inkRegion(ctx, canvas, bounds, (0.12 + fringe + 0.1 * glitch) * fontSize * k + 2);
        if (!r) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // The picture: the canvas as the hooks before left it (the ink, and any glow), lit in the phosphor.
        const pic = picture(r.w, r.h);
        const p = pic.getContext('2d')!;
        p.globalCompositeOperation = 'copy';
        p.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        if (phosphor !== 'ink') {
          p.globalCompositeOperation = 'source-in';
          p.fillStyle = PHOSPHORS[phosphor];
          p.fillRect(0, 0, r.w, r.h);
        }
        ctx.clearRect(r.x, r.y, r.w, r.h);
        // Bands torn sideways, drawn row band by row band.
        const tears = tearsAt(0, step, glitch);
        const shiftAt = (y: number) => {
          for (const t of tears) if (y >= t.top * r.h && y < (t.top + t.height) * r.h) return t.shift * fontSize * k;
          return 0;
        };
        const put = (src: HTMLCanvasElement, dx: number, alpha: number, op: GlobalCompositeOperation) => {
          ctx.globalAlpha = alpha;
          ctx.globalCompositeOperation = op;
          if (tears.length === 0) {
            ctx.drawImage(src, 0, 0, r.w, r.h, r.x + dx, r.y, r.w, r.h);
            return;
          }
          const edges = [0, r.h, ...tears.flatMap((t) => [t.top * r.h, (t.top + t.height) * r.h])]
            .map((v) => Math.max(0, Math.min(r.h, Math.round(v))))
            .sort((a, b) => a - b);
          for (let i = 0; i < edges.length - 1; i++) {
            const y0 = edges[i]!;
            const h = edges[i + 1]! - y0;
            if (h <= 0) continue;
            ctx.drawImage(src, 0, y0, r.w, h, r.x + dx + shiftAt(y0), r.y + y0, r.w, h);
          }
        };
        put(pic, 0, 1, 'source-over');
        // The red and blue guns out of register, as fringes under the picture.
        const d = fringe * fontSize * k;
        if (d > 0.3) {
          put(tinted(pic, r, 'rgba(255, 40, 60, 0.9)'), -d, 0.8, 'destination-over');
          put(tinted(pic, r, 'rgba(40, 120, 255, 0.9)'), d, 0.8, 'destination-over');
        }
        // Scanlines: the dark between the lines, fixed to the screen.
        const pattern = scanlines > 0 ? scanPattern(ctx, k) : null;
        if (pattern) {
          ctx.globalAlpha = scanlines;
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = pattern;
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
        // The bloom: the lit picture, soft, under it all.
        if (glow > 0) {
          const soft = shrunk(bloom(1, 1), pic, { x: 0, y: 0, w: r.w, h: r.h }, Math.max(2, 0.05 * fontSize * k));
          ctx.globalAlpha = glow;
          ctx.globalCompositeOperation = 'destination-over';
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(soft.canvas, 0, 0, soft.w, soft.h, r.x, r.y, r.w, r.h);
        }
        // The flutter, and a dark bar rolling down the screen every few seconds.
        ctx.globalCompositeOperation = 'destination-out';
        const dim = dimAt(0, step, flicker);
        if (dim > 0) {
          ctx.globalAlpha = dim;
          ctx.fillStyle = '#000';
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
        if (roll) {
          const period = 4 * fps;
          const y = r.y + ((step % period) / period) * (r.h * 1.4) - r.h * 0.2;
          const band = r.h * 0.18;
          const g = ctx.createLinearGradient(0, y - band, 0, y + band);
          g.addColorStop(0, 'rgba(0, 0, 0, 0)');
          g.addColorStop(0.5, 'rgba(0, 0, 0, 0.3)');
          g.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.globalAlpha = 1;
          ctx.fillStyle = g;
          ctx.fillRect(r.x, Math.max(r.y, y - band), r.w, band * 2);
        }
      },
    };
  },
});
