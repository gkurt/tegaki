import { createPlugin, expandBox, offsetPath, type StrokePath, unionBoxes } from 'tegaki/core';
import { canvasColor, type Rgba, rgba } from './color.ts';
import { meanWidth } from './svg.ts';

/**
 * A marker's line: the stroke at one even width (a felt tip doesn't swell
 * or taper), `tip` times the stroke's mean width.
 */
export function markerLine(path: StrokePath, tip: number): StrokePath {
  const width = meanWidth(path) * tip;
  return path.map((p) => ({ ...p, width }));
}

/**
 * A felt-tip marker, or a highlighter: an even, see-through line whose ink
 * darkens where strokes cross — each stroke laid with `multiply`, so where
 * two overlap the ink goes down twice — a little darker along its edges
 * where the ink gathers, and blotted where the tip rests, at each end.
 * A `paint` plugin: each stroke at one width, so it's a single canvas
 * stroke of even color (a stroke of varying width is painted a piece at a
 * time, and see-through pieces would stack up where they meet).
 */
export const markerPlugin = createPlugin({
  name: 'marker',
  label: 'Marker',
  description: 'A felt tip or highlighter: an even, see-through line that darkens where strokes cross, with inky edges and blots. paint.',
  params: {
    own: { type: 'boolean', label: 'Own color', description: "The marker's color rather than the text's.", default: false },
    color: { type: 'color', label: 'Color', default: '#2f6fe0' },
    tip: { type: 'number', label: 'Tip', description: "Its width, against the stroke's.", default: 1.4, min: 0.5, max: 4, step: 0.1 },
    opacity: { type: 'number', label: 'Opacity', default: 0.7, min: 0.1, max: 1, step: 0.05 },
    chisel: { type: 'boolean', label: 'Chisel tip', description: 'Square ends instead of round.', default: false },
    edges: {
      type: 'number',
      label: 'Edges',
      description: 'How much darker the ink runs along its edges.',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
    },
    blots: { type: 'number', label: 'Blots', description: 'Where the tip rests, at each end.', default: 0.5, min: 0, max: 1, step: 0.05 },
  },
  presets: {
    Highlighter: { own: true, color: '#ffe44d', tip: 3, opacity: 0.55, chisel: true, edges: 0.3, blots: 0.2 },
    Sharpie: { own: true, color: '#1b1b1f', tip: 1.2, opacity: 0.92, edges: 0.2, blots: 0.7 },
    Pastel: { own: true, color: '#ff7eb6', tip: 2, opacity: 0.45 },
  },
  setup: ({ own, color, tip, opacity, chisel, edges, blots }) => {
    const lines = new WeakMap<StrokePath, { line: StrokePath; left: StrokePath; right: StrokePath }>();
    const ink = new Map<string, Rgba | null>();
    const inkOf = (ctx: CanvasRenderingContext2D, style: string) => {
      if (!ink.has(style)) ink.set(style, canvasColor(ctx, style));
      return ink.get(style)!;
    };
    return {
      bounds:
        tip > 1 ? ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * 0.02 * tip) : undefined,
      paint(s, next) {
        if (s.stroke.state === 'pending') return next(s);
        const { stroke } = s;
        let shape = lines.get(stroke.path);
        if (!shape) {
          const line = markerLine(stroke.path, tip);
          const w = line.points[0]?.width ?? 1;
          const edge = (side: 1 | -1) => offsetPath(line, side * w * 0.4).map((p) => ({ ...p, width: w * 0.18 }));
          shape = { line, left: edge(1), right: edge(-1) };
          lines.set(stroke.path, shape);
        }
        const style = own ? color : s.style;
        const rgb = typeof style === 'string' ? inkOf(s.ctx, style) : null;
        const paint = rgb ? rgba([rgb[0], rgb[1], rgb[2], 1]) : style;
        // A wide marker runs past the letters: on the layer clip-to-text leaves alone.
        const ctx = tip > 1.2 ? s.unclipped : s.ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = opacity;
        const lineCap = chisel ? 'butt' : 'round';
        next({ ...s, ctx, style: paint, lineCap, stroke: { ...stroke, path: shape.line, nibs: [] } });
        if (edges > 0 && stroke.path.points.length > 1) {
          ctx.globalAlpha = opacity * edges * 0.35;
          for (const path of [shape.left, shape.right])
            next({ ...s, ctx, style: paint, lineCap: 'round', stroke: { ...stroke, path, nibs: [] } });
        }
        if (blots > 0) {
          // The tip rests where it lands, and again where it lifts once the stroke is done.
          ctx.globalAlpha = opacity * blots * 0.4;
          ctx.fillStyle = typeof paint === 'function' ? paint(0.5) : paint;
          const w = shape.line.points[0]?.width ?? 1;
          const ends = stroke.state === 'done' ? [0, 1] : [0];
          for (const t of ends) {
            const at = shape.line.pointAt(t);
            ctx.beginPath();
            if (chisel) {
              ctx.save();
              ctx.translate(at.x, at.y);
              ctx.rotate(at.angle);
              ctx.fillRect(-w * 0.1, -w / 2, w * 0.2, w);
              ctx.restore();
            } else {
              ctx.arc(at.x, at.y, w * 0.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        ctx.restore();
      },
    };
  },
});
