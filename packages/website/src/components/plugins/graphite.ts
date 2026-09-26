import { createPlugin, expandBox, type StrokeFrame, type StrokePath, unionBoxes } from 'tegaki/core';
import { grainTile } from './noise.ts';

/** A fleck of graphite broken off the point: where it lies, its size and turn, and the draw progress it's shed at. */
export interface Splinter {
  x: number;
  y: number;
  length: number;
  angle: number;
  t: number;
}

/**
 * The flecks a pencil sheds along a stroke: about `amount` × 5 per em of
 * line, each lying a little off the line (most within a stroke width or
 * two), turned roughly along it. `random` gives 0–1, seeded per stroke.
 */
export function splinters(path: StrokePath, fontSize: number, amount: number, random: () => number): Splinter[] {
  if (amount <= 0 || path.points.length < 2) return [];
  const count = Math.round((path.length / fontSize) * amount * 5);
  return Array.from({ length: count }, () => {
    const t = random();
    const at = path.pointAt(t);
    const side = random() < 0.5 ? -1 : 1;
    const off = at.width * (0.6 + random() ** 2 * 2.2) * side;
    return {
      x: at.x - Math.sin(at.angle) * off,
      y: at.y + Math.cos(at.angle) * off,
      length: fontSize * (0.006 + random() ** 2 * 0.02),
      angle: at.angle + (random() - 0.5) * 1.6,
      t,
    };
  });
}

/** A smudge of graphite dust: a soft blot, smeared down and right the way a writing hand drags it. */
export interface Smudge {
  x: number;
  y: number;
  rx: number;
  ry: number;
  angle: number;
  alpha: number;
  t: number;
}

/** Where a stroke leaves dust: blots along it, pushed off down-right, bigger and fainter than the line. */
export function smudges(path: StrokePath, fontSize: number, amount: number, random: () => number): Smudge[] {
  if (amount <= 0) return [];
  const count = Math.max(1, Math.round((path.length / fontSize) * 2.5 * amount));
  return Array.from({ length: count }, () => {
    const t = random();
    const at = path.pointAt(t);
    const drag = fontSize * (0.02 + random() * 0.05);
    return {
      x: at.x + drag,
      y: at.y + drag * 0.6,
      rx: fontSize * (0.05 + random() * 0.08),
      ry: fontSize * (0.02 + random() * 0.03),
      angle: 0.35 + (random() - 0.5) * 0.6,
      alpha: 0.08 + random() * 0.12,
      t,
    };
  });
}

/** Graphite's gray, from hard (0, a pale 2H) to soft (1, a dark 6B). */
export function graphiteGray(darkness: number): string {
  const v = Math.round(125 - 95 * darkness);
  return `rgb(${v}, ${v + 1}, ${v + 5})`;
}

/**
 * A pencil: a grainy gray line with the paper's tooth in it, graphite
 * splinters shed along the strokes, and dust smudged off them the way a
 * writing hand drags it. `paint` lays the line in a grain pattern (fixed to
 * the paper) and the splinters as the pen passes them; the dust is an
 * `underlay`, darkening a little while after each stroke, as the hand
 * passes over it.
 */
export const graphitePlugin = createPlugin({
  name: 'graphite',
  label: 'Graphite',
  description: 'A grainy pencil line, graphite splinters shed along it, and dust smudged off it. paint + underlay.',
  params: {
    darkness: {
      type: 'number',
      label: 'Softness',
      description: 'Hard and pale (2H) to soft and dark (6B).',
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
    },
    weight: {
      type: 'number',
      label: 'Weight',
      description: "The line's width, against the stroke's.",
      default: 0.55,
      min: 0.2,
      max: 1.2,
      step: 0.05,
    },
    tooth: {
      type: 'number',
      label: 'Tooth',
      description: 'How much paper shows through the line.',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
    },
    dust: { type: 'number', label: 'Dust', description: 'Graphite smudged off the lines.', default: 0.5, min: 0, max: 1, step: 0.05 },
    splinters: {
      type: 'number',
      label: 'Splinters',
      description: 'Flecks of graphite shed along them.',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
    },
  },
  presets: {
    '2H': { darkness: 0.2, weight: 0.4, tooth: 0.35, dust: 0.15, splinters: 0.1 },
    '6B': { darkness: 1, weight: 0.85, tooth: 0.6, dust: 0.9, splinters: 0.85 },
    Clean: { dust: 0, splinters: 0 },
  },
  setup: ({ darkness, weight, tooth, dust, splinters: shed }) => {
    const gray = graphiteGray(darkness);
    const lines = new WeakMap<StrokePath, StrokePath>();
    const flecks = new WeakMap<StrokePath, Splinter[]>();
    const blots = new WeakMap<StrokePath, Smudge[]>();
    let grain: { ctx: CanvasRenderingContext2D; pattern: CanvasPattern | string } | null = null;
    const patternFor = (ctx: CanvasRenderingContext2D, random: () => number): CanvasPattern | string => {
      if (tooth <= 0) return gray;
      if (grain?.ctx === ctx) return grain.pattern;
      // The line's color, with the paper's tooth taken out of it: a tile of graphite, see-through where the paper shows.
      const n = 64;
      const tile = grainTile(n, tooth, 0.6, random);
      const canvas = document.createElement('canvas');
      canvas.width = n;
      canvas.height = n;
      const c = canvas.getContext('2d')!;
      c.fillStyle = gray;
      c.fillRect(0, 0, n, n);
      const image = c.getImageData(0, 0, n, n);
      for (let i = 0; i < n * n; i++) image.data[i * 4 + 3] = 255 - tile[i]!;
      c.putImageData(image, 0, 0);
      grain = { ctx, pattern: ctx.createPattern(canvas, 'repeat') ?? gray };
      return grain.pattern;
    };
    const cached = <T>(map: WeakMap<StrokePath, T>, s: StrokeFrame, make: () => T): T => {
      let v = map.get(s.path);
      if (v === undefined) {
        v = make();
        map.set(s.path, v);
      }
      return v;
    };
    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((st) => st.path.bounds())), fontSize * 0.15),
      paint(s, next) {
        const { stroke, ctx, fontSize } = s;
        const line = cached(lines, stroke, () => stroke.path.map((p) => ({ ...p, width: p.width * weight })));
        next({ ...s, style: patternFor(ctx, s.random('graphite')), stroke: { ...stroke, path: line } });
        if (shed <= 0) return;
        const list = cached(flecks, stroke, () => splinters(stroke.path, fontSize, shed, s.random(`splinter:${stroke.id}`)));
        ctx.fillStyle = gray;
        for (const f of list) {
          if (f.t > stroke.progress) continue;
          // A sliver: long and thin, pointed at both ends.
          const dx = Math.cos(f.angle) * f.length * 0.5;
          const dy = Math.sin(f.angle) * f.length * 0.5;
          const w = f.length * 0.22;
          ctx.beginPath();
          ctx.moveTo(f.x - dx, f.y - dy);
          ctx.lineTo(f.x - dy * (w / f.length), f.y + dx * (w / f.length));
          ctx.lineTo(f.x + dx, f.y + dy);
          ctx.lineTo(f.x + dy * (w / f.length) * 0.6, f.y - dx * (w / f.length) * 0.6);
          ctx.closePath();
          ctx.fill();
        }
      },
      underlay({ ctx, frame, fontSize, random }) {
        if (dust <= 0) return;
        ctx.fillStyle = gray;
        for (const s of frame.strokes) {
          if (s.state === 'pending') continue;
          const list = cached(blots, s, () => smudges(s.path, fontSize, dust, random(`dust:${s.id}`)));
          for (const b of list) {
            if (b.t > s.progress) continue;
            // The hand comes over the dust a moment after the pen: it darkens in over half a second.
            const age = frame.time - (s.start + s.duration * b.t);
            const grow = Math.max(0, Math.min(1, age / 0.5));
            if (grow <= 0) continue;
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(b.angle);
            ctx.scale(b.rx, b.ry);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            g.addColorStop(0, gray);
            g.addColorStop(1, 'rgba(128, 128, 132, 0)');
            ctx.fillStyle = g;
            ctx.globalAlpha = b.alpha * grow * (0.5 + dust);
            ctx.beginPath();
            ctx.arc(0, 0, 1, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      },
    };
  },
});
