import { type Box, createPlugin, inkEdge, offsetPath, type StrokePath, seededRandom } from 'tegaki/core';

/** A hatch line across a box: from one end to the other, in px. */
export interface HatchLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Parallel lines at `angle` (radians), `spacing` px apart, across `box` —
 * the same lines wherever they're drawn from, since each is placed on the
 * page rather than in the box (the `k`th line is `k × spacing` from the
 * page's origin), so strokes that overlap share their hatching. Each line
 * wavers a little off true by `jitter` px, the same for the same line every time.
 */
export function hatchLines(box: Box, angle: number, spacing: number, jitter: number, seed: number): HatchLine[] {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // The lines run along (dx, dy); they're spaced along the normal (-dy, dx).
  const corners = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.minX, box.maxY],
    [box.maxX, box.maxY],
  ] as const;
  const across = corners.map(([x, y]) => -dy * x + dx * y);
  const along = corners.map(([x, y]) => dx * x + dy * y);
  const k0 = Math.floor(Math.min(...across) / spacing);
  const k1 = Math.ceil(Math.max(...across) / spacing);
  const a0 = Math.min(...along) - spacing;
  const a1 = Math.max(...along) + spacing;
  const out: HatchLine[] = [];
  for (let k = k0; k <= k1; k++) {
    const r = seededRandom(seed, `hatch:${k}`);
    const n0 = k * spacing + (r() * 2 - 1) * jitter;
    const n1 = k * spacing + (r() * 2 - 1) * jitter;
    out.push({ x0: dx * a0 - dy * n0, y0: dy * a0 + dx * n0, x1: dx * a1 - dy * n1, y1: dy * a1 + dx * n1 });
  }
  return out;
}

/** The ink of a path as a closed outline: along its left edge, round its end, back along its right edge. For a dot, `null`. */
export function inkOutline(path: StrokePath): { x: number; y: number }[] | null {
  if (path.points.length < 2) return null;
  const left = offsetPath(path, inkEdge(0, 1)).points;
  const right = offsetPath(path, inkEdge(0, -1)).points;
  return [...left.map(({ x, y }) => ({ x, y })), ...[...right].reverse().map(({ x, y }) => ({ x, y }))];
}

/**
 * Hatching: each stroke drawn not as a line but filled with fine parallel
 * lines — one way, or cross-hatched both ways — the way an engraving or a
 * pen sketch shades. A `paint` plugin: it widens each stroke, clips to its
 * ink as far as the pen has drawn it and rules the lines inside, in the
 * stroke's own color; with clip-to-text on, the widened ink fills the
 * letters, so the hatching fills their shapes. A thin line can trace each
 * stroke too.
 */
export const hatchPlugin = createPlugin({
  name: 'hatch',
  label: 'Hatching',
  description: 'Each stroke filled with fine ruled lines — hatched or cross-hatched — like an engraving. paint — best with Clip to text.',
  params: {
    spacing: {
      type: 'number',
      label: 'Spacing',
      description: 'Between the lines, in ems.',
      default: 0.04,
      min: 0.012,
      max: 0.12,
      step: 0.002,
    },
    angle: { type: 'number', label: 'Angle', description: 'Of the lines, in degrees.', default: 45, min: -90, max: 90, step: 5 },
    cross: { type: 'boolean', label: 'Cross-hatch', default: false },
    line: { type: 'number', label: 'Line', description: "The lines' width, in ems.", default: 0.012, min: 0.002, max: 0.04, step: 0.001 },
    size: {
      type: 'number',
      label: 'Size',
      description: "The filled ink's width, against the stroke's.",
      default: 1.8,
      min: 1,
      max: 4,
      step: 0.1,
    },
    trace: {
      type: 'number',
      label: 'Trace',
      description: 'A thin line along each stroke, against its width.',
      default: 0,
      min: 0,
      max: 0.6,
      step: 0.05,
    },
    jitter: {
      type: 'number',
      label: 'Waver',
      description: 'How far the lines stray, against their spacing.',
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.05,
    },
  },
  presets: {
    Engraving: { spacing: 0.022, line: 0.006, cross: true, jitter: 0.05 },
    Sketch: { spacing: 0.05, line: 0.01, jitter: 0.6, trace: 0.2, angle: 60 },
  },
  setup: ({ spacing, angle, cross, line, size, trace, jitter }) => {
    const wide = new WeakMap<StrokePath, StrokePath>();
    const widen = (path: StrokePath) => {
      let out = wide.get(path);
      if (!out) wide.set(path, (out = path.map((p) => ({ ...p, width: p.width * size }))));
      return out;
    };
    const angles = cross ? [angle, angle - 90] : [angle];
    return {
      paint(s, next) {
        if (s.stroke.state === 'pending') return next(s);
        const { stroke, fontSize, ctx } = s;
        const inked = widen(stroke.path);
        const drawn = stroke.progress >= 1 ? inked : inked.slice(0, stroke.progress);
        const outline = inkOutline(drawn);
        const box = drawn.bounds();
        if (box) {
          const style = typeof s.style === 'function' ? s.style(0.5) : s.style;
          ctx.save();
          ctx.beginPath();
          if (outline) {
            ctx.moveTo(outline[0]!.x, outline[0]!.y);
            for (const p of outline) ctx.lineTo(p.x, p.y);
            ctx.closePath();
          }
          // Round ends, as the pen's are; a dot is a disc.
          for (const p of [drawn.points[0]!, drawn.points[drawn.points.length - 1]!]) {
            ctx.moveTo(p.x + p.width / 2, p.y);
            ctx.arc(p.x, p.y, p.width / 2, 0, Math.PI * 2);
          }
          ctx.clip('nonzero');
          ctx.strokeStyle = style;
          ctx.lineWidth = Math.max(0.5, line * fontSize);
          ctx.lineCap = 'round';
          const gap = spacing * fontSize;
          ctx.beginPath();
          for (const a of angles) {
            for (const l of hatchLines(box, (a * Math.PI) / 180, gap, jitter * gap, a)) {
              ctx.moveTo(l.x0, l.y0);
              ctx.lineTo(l.x1, l.y1);
            }
          }
          ctx.stroke();
          ctx.restore();
        }
        if (trace > 0) next({ ...s, stroke: { ...stroke, path: stroke.path.map((p) => ({ ...p, width: p.width * trace })), nibs: [] } });
      },
    };
  },
});
