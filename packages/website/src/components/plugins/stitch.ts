import { createPlugin, expandBox, type StrokePath, unionBoxes } from 'tegaki/core';
import { canvasColor, mix, type Rgba, rgba } from './color.ts';

export type StitchStyle = 'satin' | 'running' | 'cross';

/** One stitch: a length of thread from (x0, y0) to (x1, y1), made when the needle reaches draw progress `t`. */
export interface Stitch {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
}

/**
 * The stitches that sew a stroke. Satin stitch lays thread across the
 * stroke's width side by side, each at a slant, packed `density` (0–1)
 * close; running stitch runs dashes along the line with gaps between; cross
 * stitch sews an X at each step along it. `size` is how much of the
 * stroke's width they cover.
 */
export function stitches(path: StrokePath, style: StitchStyle, density: number, size: number): Stitch[] {
  const pts = path.points;
  if (pts.length === 0) return [];
  const mean = pts.reduce((sum, p) => sum + p.width, 0) / pts.length;
  const out: Stitch[] = [];
  const length = path.length;
  if (pts.length === 1 || length < mean * 0.5) {
    // A dot: a little star of stitches.
    const p = pts[0]!;
    const r = (p.width * size) / 2;
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI) / 3;
      out.push({ x0: p.x - Math.cos(a) * r, y0: p.y - Math.sin(a) * r, x1: p.x + Math.cos(a) * r, y1: p.y + Math.sin(a) * r, t: 0 });
    }
    return out;
  }
  const step =
    style === 'satin'
      ? Math.max(1, (mean * 0.22) / Math.max(0.1, density))
      : style === 'running'
        ? mean * (2.4 - density)
        : mean * size * 1.1;
  const count = Math.max(1, Math.floor(length / step));
  for (let i = 0; i <= count; i++) {
    const t = Math.min(1, (i * step) / length);
    const at = path.pointAt(t);
    const half = (at.width * size) / 2;
    const ax = Math.cos(at.angle);
    const ay = Math.sin(at.angle);
    if (style === 'satin') {
      // Across the stroke, leaning forward.
      const slant = 0.45;
      const nx = -ay + ax * slant;
      const ny = ax + ay * slant;
      const n = Math.hypot(nx, ny);
      out.push({ x0: at.x - (nx / n) * half, y0: at.y - (ny / n) * half, x1: at.x + (nx / n) * half, y1: at.y + (ny / n) * half, t });
    } else if (style === 'running') {
      if (i === count) break;
      const end = path.pointAt(Math.min(1, t + (step * 0.62) / length));
      out.push({ x0: at.x, y0: at.y, x1: end.x, y1: end.y, t });
    } else {
      const d = half * 0.9;
      for (const [sx, sy] of [
        [1, 1],
        [1, -1],
      ] as const) {
        const ux = (ax * sx - ay * sy) * d * Math.SQRT1_2;
        const uy = (ay * sx + ax * sy) * d * Math.SQRT1_2;
        out.push({ x0: at.x - ux, y0: at.y - uy, x1: at.x + ux, y1: at.y + uy, t });
      }
    }
  }
  return out;
}

/** A tile of woven linen, `n` px square: light warp and weft threads over a darker ground. */
function linenTile(color: Rgba): HTMLCanvasElement {
  const n = 6;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const c = canvas.getContext('2d')!;
  c.fillStyle = rgba(mix(color, [0, 0, 0, 1], 0.12));
  c.fillRect(0, 0, n, n);
  c.fillStyle = rgba(color);
  c.fillRect(0, 0, n, n / 2 - 0.5);
  c.fillRect(0, 0, n / 2 - 0.5, n);
  c.fillStyle = rgba(mix(color, [255, 255, 255, 1], 0.25));
  c.fillRect(0, 0, n / 2 - 0.5, n / 2 - 0.5);
  return canvas;
}

/**
 * Embroidery: each stroke sewn in thread as the needle goes — satin stitch
 * packed across it, running stitch along it, or a row of cross stitches —
 * each stitch shaded as a twist of thread, with a shadow where it sits on
 * the cloth, over a woven linen ground if you like. A `paint` plugin,
 * stitching up to where the pen has got, in the stroke's own color (the
 * Colors plugin makes it a sampler); the linen is an `underlay`.
 */
export const stitchPlugin = createPlugin({
  name: 'stitch',
  label: 'Embroidery',
  description: 'Each stroke sewn in thread (satin, running or cross stitch), shaded and shadowed, on linen. paint + underlay.',
  params: {
    style: {
      type: 'select',
      label: 'Stitch',
      default: 'satin',
      options: [
        { value: 'satin', label: 'Satin' },
        { value: 'running', label: 'Running' },
        { value: 'cross', label: 'Cross' },
      ],
    },
    density: { type: 'number', label: 'Density', description: 'How close the stitches sit.', default: 0.6, min: 0.2, max: 1, step: 0.05 },
    size: {
      type: 'number',
      label: 'Size',
      description: "How much of the stroke's width they cover.",
      default: 1.4,
      min: 0.6,
      max: 3,
      step: 0.05,
    },
    thread: {
      type: 'number',
      label: 'Thread',
      description: "The thread's thickness, against the stitch spacing.",
      default: 1,
      min: 0.4,
      max: 2,
      step: 0.05,
    },
    linen: { type: 'boolean', label: 'Linen', description: 'A woven cloth under the text.', default: true },
    cloth: { type: 'color', label: 'Cloth', default: '#ece3d0' },
  },
  presets: {
    Sampler: { style: 'cross', size: 1.6, density: 0.8 },
    Sashiko: { style: 'running', density: 0.5, size: 1, thread: 1.6, cloth: '#1f2f4f' },
    Denim: { cloth: '#44618f', style: 'satin' },
  },
  setup: ({ style, density, size, thread, linen, cloth }) => {
    const sewn = new WeakMap<StrokePath, Stitch[]>();
    const shades = new Map<string, { base: string; light: string; dark: string } | null>();
    let weave: { ctx: CanvasRenderingContext2D; pattern: CanvasPattern | string } | null = null;
    const margin = 0.35;
    return {
      bounds: ({ strokes, fontSize }) =>
        expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * (linen ? margin : 0.1 * size)),
      underlay({ ctx, frame, fontSize }) {
        if (!linen) return;
        const ink = unionBoxes(frame.strokes.map((s) => s.path.bounds()));
        if (!ink) return;
        const b = expandBox(ink, fontSize * margin);
        if (weave?.ctx !== ctx) {
          const rgb = canvasColor(ctx, cloth) ?? [236, 227, 208, 1];
          weave = { ctx, pattern: ctx.createPattern(linenTile(rgb), 'repeat') ?? cloth };
        }
        ctx.fillStyle = weave.pattern;
        ctx.beginPath();
        ctx.roundRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY, fontSize * 0.08);
        ctx.fill();
      },
      paint(s, next) {
        if (s.stroke.state === 'pending') return next(s);
        const { stroke } = s;
        // Stitches wider than the stroke run past the letters: on the layer clip-to-text leaves alone.
        const ctx = size > 1.2 ? s.unclipped : s.ctx;
        let list = sewn.get(stroke.path);
        if (!list) sewn.set(stroke.path, (list = stitches(stroke.path, style, density, size)));
        const key = typeof s.style === 'string' ? s.style : typeof s.style === 'function' ? s.style(0.5) : null;
        if (key === null) return next(s);
        if (!shades.has(key)) {
          const rgb = canvasColor(ctx, key);
          shades.set(
            key,
            rgb && { base: rgba(rgb), light: rgba(mix(rgb, [255, 255, 255, 1], 0.45)), dark: rgba(mix(rgb, [0, 0, 0, 1], 0.45)) },
          );
        }
        const shade = shades.get(key);
        if (!shade) return next(s);
        const mean = stroke.path.points.reduce((sum, p) => sum + p.width, 0) / Math.max(1, stroke.path.points.length);
        const lw = style === 'satin' ? Math.max(0.8, mean * 0.24 * thread) : Math.max(0.8, mean * 0.35 * thread);
        const drawn = list.filter((st) => st.t <= stroke.progress);
        const line = (dx: number, dy: number, width: number, color: string, shorten = 0) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          for (const st of drawn) {
            const mx = (st.x1 - st.x0) * shorten;
            const my = (st.y1 - st.y0) * shorten;
            ctx.moveTo(st.x0 + mx + dx, st.y0 + my + dy);
            ctx.lineTo(st.x1 - mx + dx, st.y1 - my + dy);
          }
          ctx.stroke();
        };
        ctx.save();
        ctx.lineCap = 'round';
        // The shadow on the cloth, the thread, and the light along its twist.
        ctx.globalAlpha = 0.35;
        line(lw * 0.3, lw * 0.45, lw * 1.1, shade.dark);
        ctx.globalAlpha = 1;
        line(0, 0, lw, shade.base);
        ctx.globalAlpha = 0.7;
        line(-lw * 0.15, -lw * 0.2, lw * 0.35, shade.light, 0.18);
        ctx.restore();
      },
    };
  },
});
