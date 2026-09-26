import { createPlugin, expandBox, type StrokeFrame, type StrokePath, unionBoxes } from 'tegaki/core';

/** One sparkle: where along its stroke it's thrown off, and how it moves and turns from there. */
export interface Sparkle {
  /** Draw progress of the point it comes off. */
  t: number;
  /** Where it starts, off that point, in px. */
  ox: number;
  oy: number;
  /** Its drift, in px a second. */
  vx: number;
  vy: number;
  /** Its size, as a share of the sparkle size. */
  size: number;
  spin: number;
  /** How much of `life` it lives. */
  life: number;
}

export interface SparkleOptions {
  density: number;
  spread: number;
  rise: number;
}

/**
 * The sparkles a stroke throws off: about `density` per em of ink, each at
 * a place along it and a little off it (`spread` ems), drifting up by
 * `rise` ems a second (down when negative) and a little sideways. `random`
 * (0–1) is seeded per stroke, so a stroke throws the same sparkles every time.
 */
export function strokeSparkles(path: StrokePath, fontSize: number, o: SparkleOptions, random: () => number): Sparkle[] {
  const count = Math.max(1, Math.round((path.length / fontSize) * o.density));
  return Array.from({ length: count }, (_, i) => {
    const angle = random() * Math.PI * 2;
    const reach = Math.sqrt(random()) * o.spread * fontSize;
    return {
      t: Math.min(1, (i + random()) / count),
      ox: Math.cos(angle) * reach,
      oy: Math.sin(angle) * reach,
      vx: (random() - 0.5) * 0.2 * fontSize,
      vy: -o.rise * fontSize * (0.6 + random() * 0.8),
      size: 0.5 + random() * 0.7,
      spin: (random() - 0.5) * 4,
      life: 0.6 + random() * 0.4,
    };
  });
}

/** Where a sparkle is and how bright, `age` seconds after it's thrown off; `null` before and once it's gone. */
export function sparkleAt(
  s: Sparkle,
  from: { x: number; y: number },
  age: number,
  life: number,
): { x: number; y: number; alpha: number; scale: number; turn: number } | null {
  const span = life * s.life;
  if (age < 0 || age > span) return null;
  const f = age / span;
  return {
    x: from.x + s.ox + s.vx * age,
    y: from.y + s.oy + s.vy * age,
    alpha: 1 - f * f,
    // Pops up fast, then dwindles: at its biggest a quarter of the way through.
    scale: s.size * Math.sin(Math.PI * Math.sqrt(f)),
    turn: s.spin * age,
  };
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = turn + (i * Math.PI) / 4;
    const d = i % 2 === 0 ? r : r * 0.28;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Sparkles thrown off behind the pen, each twinkling and drifting away for
 * a moment after the pen passes. An `overlay` drawn from the frame alone: a
 * sparkle's birth is when the pen passed its point, so scrubbing and
 * controlled time show the same sparkles at the same time.
 */
export const sparklePlugin = createPlugin({
  name: 'sparkle',
  label: 'Sparkles',
  description: 'Sparkles thrown off behind the pen, drifting away as they fade. overlay + bounds.',
  params: {
    color: { type: 'color', label: 'Color', default: '#f5a623' },
    density: { type: 'number', label: 'Density', description: 'Sparkles per em of ink.', default: 6, min: 1, max: 24, step: 1 },
    size: { type: 'number', label: 'Size', description: 'In ems.', default: 0.06, min: 0.02, max: 0.2, step: 0.005 },
    life: { type: 'number', label: 'Life', description: 'Seconds a sparkle lasts.', default: 0.9, min: 0.2, max: 3, step: 0.1 },
    rise: {
      type: 'number',
      label: 'Rise',
      description: 'Ems a second they float up (down when negative).',
      default: 0.12,
      min: -0.6,
      max: 0.6,
      step: 0.02,
    },
    spread: {
      type: 'number',
      label: 'Spread',
      description: 'How far off the ink they start, in ems.',
      default: 0.08,
      min: 0,
      max: 0.3,
      step: 0.01,
    },
  },
  presets: {
    'Fairy dust': { color: '#ff9ff3', density: 12, size: 0.04, rise: 0.18 },
    Embers: { color: '#ff7a1a', density: 8, size: 0.035, life: 1.4, rise: 0.4, spread: 0.04 },
    Snow: { color: '#dbeafe', density: 5, size: 0.05, life: 2, rise: -0.25 },
  },
  setup: ({ color, density, size, life, rise, spread }) => {
    const cache = new WeakMap<StrokePath, Sparkle[]>();
    const sparklesOf = (s: StrokeFrame, fontSize: number, random: (key: string) => () => number) => {
      let list = cache.get(s.path);
      if (!list) {
        list = strokeSparkles(s.path, fontSize, { density, spread, rise }, random(`sparkle:${s.id}`));
        cache.set(s.path, list);
      }
      return list;
    };
    const reach = spread + size + Math.abs(rise) * life + 0.2 * life + 0.05;
    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * reach),
      overlay({ ctx, frame, fontSize, random }) {
        const r = size * fontSize;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = r;
        for (const s of frame.strokes) {
          if (s.state === 'pending' || frame.time > s.start + s.duration + life) continue;
          for (const sparkle of sparklesOf(s, fontSize, random)) {
            const at = sparkleAt(sparkle, s.path.pointAt(sparkle.t), frame.time - (s.start + s.duration * sparkle.t), life);
            if (!at || at.scale <= 0) continue;
            ctx.globalAlpha = at.alpha;
            star(ctx, at.x, at.y, r * at.scale, at.turn);
          }
        }
      },
    };
  },
});
