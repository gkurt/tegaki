import { type Box, createPlugin, expandBox, type StrokeFrame, type StrokePath, seededRandom, unionBoxes } from 'tegaki/core';
import { canvasColor, rgba } from './color.ts';
import { grainTile } from './noise.ts';
import { meanWidth } from './svg.ts';

/** A mote of chalk dust: where on its stroke it's knocked off (draw progress), how it drifts, how big. */
export interface Mote {
  t: number;
  /** Offset off the line where it's shed, in px. */
  dx: number;
  dy: number;
  /** Sideways drift, px a second. */
  drift: number;
  r: number;
  /** Seconds it takes to fall out of sight. */
  life: number;
}

/** Motes shed along a stroke: a few per em of line, `amount` (0–1) of them. */
export function motes(path: StrokePath, fontSize: number, amount: number, random: () => number): Mote[] {
  if (amount <= 0) return [];
  const count = Math.round(Math.max(1, (path.length / fontSize) * 10 * amount));
  return Array.from({ length: count }, () => ({
    t: random(),
    dx: (random() - 0.5) * fontSize * 0.06,
    dy: (random() - 0.5) * fontSize * 0.04,
    drift: (random() - 0.5) * fontSize * 0.15,
    r: fontSize * (0.004 + random() * 0.009),
    life: 0.6 + random() * 0.9,
  }));
}

/**
 * Where a mote is `age` seconds after it's shed from (x, y), and how much
 * of it shows: it falls under gravity, drifting sideways, and fades as it
 * goes. `null` before it's shed and once it's gone.
 */
export function moteAt(m: Mote, x: number, y: number, age: number, fontSize: number): { x: number; y: number; alpha: number } | null {
  if (age < 0 || age > m.life) return null;
  const fall = 0.5 * fontSize * 2.2 * age * age;
  return { x: x + m.dx + m.drift * age, y: y + m.dy + fall, alpha: 1 - age / m.life };
}

/** The board: the ink's box with a margin, in px. */
export function boardBox(ink: Box, fontSize: number, margin: number): Box {
  return expandBox(ink, margin * fontSize);
}

/**
 * Chalk on a blackboard: a slate laid under the text — a wooden frame
 * round it if you like, and the haze of old erasing on it — and each stroke
 * a powdery line with the board's grain showing through, shedding dust
 * that falls away below the chalk. `underlay` lays the board, `paint` the
 * line (in a grain pattern fixed to the board, so it doesn't crawl as the
 * stroke grows), and the dust is an `overlay`, from the frame's time.
 */
export const chalkPlugin = createPlugin({
  name: 'chalk',
  label: 'Chalk',
  description:
    'Powdery chalk lines on a blackboard, the grain showing through, shedding dust as they’re drawn. underlay + paint + overlay.',
  params: {
    color: { type: 'color', label: 'Chalk', default: '#f3f1e7' },
    board: { type: 'color', label: 'Board', default: '#2c4235' },
    grain: {
      type: 'number',
      label: 'Grain',
      description: 'How much of the board shows through.',
      default: 0.55,
      min: 0,
      max: 1,
      step: 0.05,
    },
    weight: {
      type: 'number',
      label: 'Weight',
      description: "The line's width, against the stroke's.",
      default: 1.1,
      min: 0.4,
      max: 2.5,
      step: 0.05,
    },
    dust: { type: 'number', label: 'Dust', description: 'What falls off the chalk.', default: 0.5, min: 0, max: 1, step: 0.05 },
    frame: { type: 'boolean', label: 'Frame', description: 'A wooden frame round the board.', default: true },
    margin: {
      type: 'number',
      label: 'Margin',
      description: 'Board round the text, in ems.',
      default: 0.45,
      min: 0.1,
      max: 1.5,
      step: 0.05,
    },
  },
  presets: {
    Blackboard: { board: '#1f2224' },
    'Sidewalk chalk': { color: '#ff9ad5', board: '#8b8d8f', grain: 0.75, weight: 1.6, frame: false },
    Clean: { grain: 0.2, dust: 0 },
  },
  setup: ({ color, board, grain, weight, dust, frame, margin }) => {
    const lines = new WeakMap<StrokePath, { line: StrokePath; edge: StrokePath }>();
    const shed = new WeakMap<StrokePath, Mote[]>();
    let texture: { ctx: CanvasRenderingContext2D; pattern: CanvasPattern | string } | null = null;
    const patternFor = (ctx: CanvasRenderingContext2D): CanvasPattern | string => {
      if (grain <= 0) return color;
      if (texture?.ctx === ctx) return texture.pattern;
      // The chalk's color with the board's tooth taken out of it, streaked the way a board is wiped.
      const n = 96;
      const tile = grainTile(n, grain, 1, seededRandom(7, 'chalk'));
      const canvas = document.createElement('canvas');
      canvas.width = n;
      canvas.height = n;
      const c = canvas.getContext('2d')!;
      c.fillStyle = color;
      c.fillRect(0, 0, n, n);
      const image = c.getImageData(0, 0, n, n);
      for (let i = 0; i < n * n; i++) image.data[i * 4 + 3] = Math.max(0, 255 - tile[i]! * 1.6);
      c.putImageData(image, 0, 0);
      texture = { ctx, pattern: ctx.createPattern(canvas, 'repeat') ?? color };
      return texture.pattern;
    };
    const inkBox = (strokes: readonly { path: StrokePath }[]) => unionBoxes(strokes.map((s) => s.path.bounds()));
    const frameWidth = (fontSize: number) => (frame ? fontSize * 0.14 : 0);
    return {
      bounds: ({ strokes, fontSize }) => {
        const ink = inkBox(strokes);
        return ink && expandBox(boardBox(ink, fontSize, margin), frameWidth(fontSize) + fontSize * 0.1);
      },
      underlay({ ctx, frame: f, fontSize, random }) {
        const ink = inkBox(f.strokes);
        if (!ink) return;
        const b = boardBox(ink, fontSize, margin);
        const fw = frameWidth(fontSize);
        if (fw > 0) {
          const wood = ctx.createLinearGradient(b.minX, b.minY - fw, b.minX, b.maxY + fw);
          wood.addColorStop(0, '#8a5a32');
          wood.addColorStop(0.5, '#a06a3c');
          wood.addColorStop(1, '#6f4524');
          ctx.fillStyle = wood;
          ctx.beginPath();
          ctx.roundRect(b.minX - fw, b.minY - fw, b.maxX - b.minX + 2 * fw, b.maxY - b.minY + 2 * fw, fw * 0.6);
          ctx.fill();
        }
        ctx.fillStyle = board;
        ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
        // The haze of old erasing: broad, faint sweeps of chalk.
        const rgb = canvasColor(ctx, color) ?? [243, 241, 231, 1];
        const r = random('chalk:haze');
        ctx.save();
        ctx.beginPath();
        ctx.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
        ctx.clip();
        for (let i = 0; i < 6; i++) {
          const x = b.minX + r() * (b.maxX - b.minX);
          const y = b.minY + r() * (b.maxY - b.minY);
          const rad = fontSize * (0.6 + r() * 1.2);
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, rgba([rgb[0], rgb[1], rgb[2], 0.06 + r() * 0.05]));
          g.addColorStop(1, rgba([rgb[0], rgb[1], rgb[2], 0]));
          ctx.fillStyle = g;
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(1.8, 0.6);
          ctx.translate(-x, -y);
          ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
          ctx.restore();
        }
        ctx.restore();
      },
      paint(s, next) {
        if (s.stroke.state === 'pending') return next(s);
        const { stroke } = s;
        let shape = lines.get(stroke.path);
        if (!shape) {
          const line = stroke.path.map((p) => ({ ...p, width: p.width * weight }));
          // The powder round it at one width, so its see-through pieces don't stack where they meet.
          const wide = (meanWidth(line) || 1) * 1.3;
          shape = { line, edge: line.map((p) => ({ ...p, width: wide })) };
          lines.set(stroke.path, shape);
        }
        const pattern = patternFor(s.ctx);
        s.ctx.globalAlpha = 0.3;
        next({ ...s, style: pattern, stroke: { ...stroke, path: shape.edge, nibs: [] } });
        s.ctx.globalAlpha = 1;
        next({ ...s, style: pattern, stroke: { ...stroke, path: shape.line } });
      },
      overlay({ ctx, frame: f, fontSize, random }) {
        if (dust <= 0) return;
        const rgb = canvasColor(ctx, color) ?? [243, 241, 231, 1];
        for (const s of f.strokes) {
          if (s.state === 'pending') continue;
          // Dust lasts under two seconds: skip strokes long since drawn.
          if (f.time - (s.start + s.duration) > 2) continue;
          let list = shed.get(s.path);
          if (!list) shed.set(s.path, (list = motes(s.path, fontSize, dust, random(`chalk:${s.id}`))));
          drawMotes(ctx, s, list, f.time, fontSize, rgb);
        }
      },
    };
  },
});

function drawMotes(ctx: CanvasRenderingContext2D, s: StrokeFrame, list: readonly Mote[], time: number, fontSize: number, rgb: number[]) {
  for (const m of list) {
    if (m.t > s.progress) continue;
    const at = s.path.pointAt(m.t);
    const p = moteAt(m, at.x, at.y, time - (s.start + s.duration * m.t), fontSize);
    if (!p) continue;
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(0.8 * p.alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, m.r, 0, Math.PI * 2);
    ctx.fill();
  }
}
