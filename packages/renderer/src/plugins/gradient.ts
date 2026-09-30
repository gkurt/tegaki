import { createPlugin } from '../core/createPlugin.ts';
import { paintsDrawnOnly } from '../core/plugins.ts';
import type { Box } from '../lib/strokePath.ts';

// --- Colors ---

function parseColor(color: string): [number, number, number, number] {
  const h = color.replace('#', '');
  if (h.length === 3) {
    return [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16), 1];
  }
  if (h.length === 4) {
    return [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16), parseInt(h[3]! + h[3]!, 16) / 255];
  }
  if (h.length === 8) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255];
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
}

function lerpColor(a: [number, number, number, number], b: [number, number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  const al = a[3] + (b[3] - a[3]) * t;
  if (al >= 1) return `rgb(${r},${g},${bl})`;
  return `rgba(${r},${g},${bl},${al.toFixed(3)})`;
}

/** How a stroke gradient colors the ink. */
export interface StrokeGradientOptions {
  /** Hex colors to run through along each stroke; none for a rainbow. */
  colors: readonly string[];
  /** The rainbow's saturation, in percent. */
  saturation: number;
  /** The rainbow's lightness, in percent. */
  lightness: number;
}

/** The color at draw progress `t` along a stroke of a glyph drawn with `seed` — each glyph starts the run in its own place. */
export function strokeGradientAt(o: StrokeGradientOptions, seed: number): (t: number) => string {
  const { colors } = o;
  if (colors.length === 0) return (t) => `hsl(${(t * 360 + seed * 137.5) % 360}, ${o.saturation}%, ${o.lightness}%)`;
  if (colors.length === 1) return () => colors[0]!;
  const stops = colors.map(parseColor);
  return (progress) => {
    const t = (((progress + seed * 0.1) % 1) + 1) % 1;
    const scaled = t * (stops.length - 1);
    const i = Math.min(Math.floor(scaled), stops.length - 2);
    return lerpColor(stops[i]!, stops[i + 1]!, scaled - i);
  };
}

/**
 * Each stroke colored along its length: a rainbow, or a run through
 * `colors`, each glyph starting it somewhere else (its seed).
 *
 * ```ts
 * plugins: [strokeGradientPlugin()]                                // a rainbow
 * plugins: [strokeGradientPlugin({ colors: ['#f06', '#fc0'] })]
 * ```
 */
export const strokeGradientPlugin = paintsDrawnOnly(
  createPlugin({
    name: 'strokeGradient',
    label: 'Stroke gradient',
    description: 'Each stroke colored along its length: a rainbow, or a run through your colors. paint + svg.',
    params: {
      colors: { type: 'colors', label: 'Colors', description: 'Hex colors to run through; none for a rainbow.', default: [] },
      saturation: {
        type: 'number',
        label: 'Saturation',
        description: "The rainbow's saturation, %.",
        default: 80,
        min: 0,
        max: 100,
        step: 1,
      },
      lightness: { type: 'number', label: 'Lightness', description: "The rainbow's lightness, %.", default: 55, min: 0, max: 100, step: 1 },
    },
    setup: (options) => {
      const bySeed = new Map<number, (t: number) => string>();
      const colorAt = (seed: number) => {
        let at = bySeed.get(seed);
        if (!at) {
          if (bySeed.size > 4096) bySeed.clear();
          bySeed.set(seed, (at = strokeGradientAt(options, seed)));
        }
        return at;
      };
      return {
        paint: (p, next) => next({ ...p, style: colorAt(p.stroke.seed) }),
        svg(svg) {
          for (const stroke of svg.strokes) svg.style(stroke, { color: colorAt(stroke.seed) });
        },
      };
    },
  }),
);

/**
 * The line and color stops of a linear gradient over `box`: endpoints that
 * cover the whole box at any angle. y grows downward, so `angle` 0 runs
 * left→right and 90 top→bottom — positive angles turn clockwise.
 */
export function globalGradientGeometry(
  box: Box,
  colors: readonly string[],
  angle: number,
): { x1: number; y1: number; x2: number; y2: number; stops: [number, string][] } {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const cx = box.minX + width / 2;
  const cy = box.minY + height / 2;
  const proj = Math.abs((dx * width) / 2) + Math.abs((dy * height) / 2);
  const stops: [number, string][] =
    colors.length === 1
      ? [
          [0, colors[0]!],
          [1, colors[0]!],
        ]
      : colors.map((c, i) => [i / (colors.length - 1), c]);
  return { x1: cx - dx * proj, y1: cy - dy * proj, x2: cx + dx * proj, y2: cy + dy * proj, stops };
}

/**
 * One linear gradient across the whole text, as CSS `background-clip: text`
 * would paint it: the first color at one edge of the text, the last at the
 * other, whatever strokes it falls on.
 *
 * ```ts
 * plugins: [globalGradientPlugin({ colors: ['#f06', '#40f'], angle: 90 })]
 * ```
 */
export const globalGradientPlugin = paintsDrawnOnly(
  createPlugin({
    name: 'globalGradient',
    label: 'Text gradient',
    description: 'One linear gradient across the whole text. paint + svg.',
    params: {
      colors: { type: 'colors', label: 'Colors', description: 'The color stops, in order.', default: ['#ff0000', '#0000ff'] },
      angle: {
        type: 'number',
        label: 'Angle',
        description: 'Direction in degrees: 0 left to right, 90 top to bottom.',
        default: 0,
        min: -360,
        max: 360,
        step: 1,
      },
    },
    setup: ({ colors, angle }) => {
      let cached: { ctx: CanvasRenderingContext2D; box: Box; gradient: CanvasGradient } | null = null;
      return {
        paint(p, next) {
          if (colors.length === 0) return next(p);
          if (cached?.ctx !== p.ctx || cached.box !== p.textBox) {
            const g = globalGradientGeometry(p.textBox, colors, angle);
            const gradient = p.ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
            for (const [offset, color] of g.stops) gradient.addColorStop(offset, color);
            cached = { ctx: p.ctx, box: p.textBox, gradient };
          }
          next({ ...p, style: cached.gradient });
        },
        svg(svg) {
          if (colors.length === 0) return;
          const g = globalGradientGeometry(svg.textBox, colors, angle);
          const id = svg.id('tk-gg');
          svg.defs(
            `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(g.x1)}" y1="${fmt(g.y1)}" x2="${fmt(g.x2)}" y2="${fmt(g.y2)}">` +
              g.stops.map(([o, c]) => `<stop offset="${Math.round(o * 10000) / 10000}" stop-color="${c}" />`).join('') +
              '</linearGradient>',
          );
          for (const stroke of svg.strokes) svg.style(stroke, { color: `url(#${id})` });
        },
      };
    },
  }),
);

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
