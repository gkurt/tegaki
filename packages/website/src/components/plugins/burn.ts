import { createPlugin, expandBox, type StrokePath, seededRandom, unionBoxes } from 'tegaki/core';
import { mix, type Rgba, rgba } from './color.ts';
import { inkRegion, scratchCanvas, silhouette } from './ink-canvas.ts';
import { inkAge } from './wet.ts';

/** The burn's colors as it cools: white-hot, orange, ember red, char. */
const HOT: Rgba = [255, 244, 200, 1];
const ORANGE: Rgba = [255, 158, 36, 1];
const EMBER: Rgba = [190, 48, 12, 1];
const CHAR: Rgba = [38, 20, 10, 1];

/**
 * The color of a burnt line `age` seconds after the flame passed it:
 * white-hot, flaring orange, glowing ember red, then char — reached after
 * `cool` seconds.
 */
export function burnColor(age: number, cool: number): Rgba {
  if (age <= 0) return HOT;
  const f = cool > 0 ? age / cool : 1;
  if (f < 0.08) return mix(HOT, ORANGE, f / 0.08);
  if (f < 0.35) return mix(ORANGE, EMBER, (f - 0.08) / 0.27);
  return mix(EMBER, CHAR, Math.min(1, (f - 0.35) / 0.65));
}

/** A puff of smoke: where on its stroke it rises from (draw progress), how it drifts, and how long it lasts. */
export interface Puff {
  t: number;
  drift: number;
  rise: number;
  size: number;
  life: number;
}

/** Puffs rising off a stroke: a few per em of line, `amount` (0–1) of them. */
export function puffs(path: StrokePath, fontSize: number, amount: number, random: () => number): Puff[] {
  if (amount <= 0) return [];
  const count = Math.round(Math.max(1, (path.length / fontSize) * 5 * amount));
  return Array.from({ length: count }, () => ({
    t: random(),
    drift: (random() - 0.3) * fontSize * 0.4,
    rise: fontSize * (0.5 + random() * 0.6),
    size: fontSize * (0.05 + random() * 0.07),
    life: 1 + random() * 1.2,
  }));
}

/** A puff `age` seconds after it starts to rise: up and drifting, growing and fading. `null` before and after. */
export function puffAt(p: Puff, age: number): { dx: number; dy: number; r: number; alpha: number } | null {
  if (age < 0 || age > p.life) return null;
  const f = age / p.life;
  return {
    dx: p.drift * f + Math.sin(f * 6 + p.t * 10) * p.size * 0.6,
    dy: -p.rise * f,
    r: p.size * (1 + 2.5 * f),
    alpha: (1 - f) * Math.min(1, f * 6),
  };
}

/**
 * Burnt in: a flame writes the text, the line glowing white-hot where it's
 * just been, flaring orange and cooling through ember red to char, the
 * paper scorched brown round it, smoke curling up behind the flame and
 * sparks thrown off it. `paint` colors the line by how long ago the flame
 * passed each point (the frame's `time`); an `ink` hook lays the scorch
 * under the ink; the smoke, the flame and its sparks are an `overlay`.
 */
export const burnPlugin = createPlugin({
  name: 'burn',
  label: 'Burn',
  description:
    'A flame writes the text: white-hot, cooling through ember to char, the paper scorched, smoke curling up. paint + ink + overlay.',
  params: {
    cool: {
      type: 'number',
      label: 'Cooling',
      description: 'Seconds the line takes to cool to char.',
      default: 1.4,
      min: 0.2,
      max: 5,
      step: 0.1,
    },
    width: {
      type: 'number',
      label: 'Width',
      description: "The burn's width, against the stroke's.",
      default: 1.1,
      min: 0.5,
      max: 2.5,
      step: 0.05,
    },
    scorch: {
      type: 'number',
      label: 'Scorch',
      description: 'The brown the paper turns round the line.',
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
    },
    smoke: { type: 'number', label: 'Smoke', default: 0.5, min: 0, max: 1, step: 0.05 },
    sparks: { type: 'boolean', label: 'Sparks', default: true },
  },
  presets: {
    Ember: { cool: 3, smoke: 0.2, scorch: 0.3 },
    Brand: { cool: 0.5, width: 1.5, scorch: 0.9, smoke: 0.8 },
  },
  setup: ({ cool, width, scorch, smoke, sparks }) => {
    const lines = new WeakMap<StrokePath, StrokePath>();
    const risen = new WeakMap<StrokePath, Puff[]>();
    const halo = scratchCanvas();
    return {
      bounds: ({ strokes, fontSize }) => {
        const box = unionBoxes(strokes.map((s) => s.path.bounds()));
        return box && { ...expandBox(box, fontSize * 0.2), minY: box.minY - fontSize * (smoke > 0 ? 1.2 : 0.3) };
      },
      paint(s, next) {
        if (s.stroke.state === 'pending') return next(s);
        const { stroke } = s;
        let line = lines.get(stroke.path);
        if (!line) {
          // A burnt line's edge is ragged: its width wavers along it.
          const r = s.random(`burn:${stroke.id}`);
          const f1 = 3 + r() * 5;
          const p1 = r() * 6;
          const f2 = 11 + r() * 9;
          line = stroke.path.map((p) => ({
            ...p,
            width: p.width * width * (1 + 0.12 * Math.sin(f1 * p.t * 6.28 + p1) + 0.08 * Math.sin(f2 * p.t * 6.28)),
          }));
          lines.set(stroke.path, line);
        }
        const time = s.frame.time;
        const cold = inkAge(stroke, stroke.progress, time) >= cool;
        next({ ...s, style: cold ? rgba(CHAR) : (t) => rgba(burnColor(inkAge(stroke, t, time), cool)), stroke: { ...stroke, path: line } });
      },
      ink({ ctx, bounds, fontSize }) {
        if (scorch <= 0) return;
        const ink = ctx.canvas;
        const k = ctx.getTransform().a;
        const blur = Math.max(2, 0.07 * fontSize * k);
        const r = inkRegion(ctx, ink, bounds, blur * 2 + 2);
        if (!r) return;
        const soft = silhouette(halo(r.w, r.h), ink, r, { color: `rgba(96, 52, 18, ${(0.7 * scorch).toFixed(3)})`, blur, dx: 0, dy: 0 });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'destination-over';
        ctx.drawImage(soft, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
      },
      overlay({ ctx, frame, fontSize, random }) {
        if (smoke > 0) {
          for (const s of frame.strokes) {
            if (s.state === 'pending') continue;
            let list = risen.get(s.path);
            if (!list) risen.set(s.path, (list = puffs(s.path, fontSize, smoke, random(`smoke:${s.id}`))));
            for (const p of list) {
              if (p.t > s.progress) continue;
              const at = puffAt(p, inkAge(s, p.t, frame.time));
              if (!at) continue;
              const from = s.path.pointAt(p.t);
              const x = from.x + at.dx;
              const y = from.y + at.dy;
              const g = ctx.createRadialGradient(x, y, 0, x, y, at.r);
              g.addColorStop(0, `rgba(90, 86, 82, ${(0.28 * at.alpha * smoke).toFixed(3)})`);
              g.addColorStop(1, 'rgba(90, 86, 82, 0)');
              ctx.fillStyle = g;
              ctx.beginPath();
              ctx.arc(x, y, at.r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        ctx.globalCompositeOperation = 'lighter';
        for (const { head, id } of frame.active) {
          // The flame: a flickering glow at the head.
          const flicker = 0.8 + 0.2 * Math.sin(frame.time * 53 + head.x) * Math.sin(frame.time * 31);
          const r = fontSize * 0.13 * flicker;
          const g = ctx.createRadialGradient(head.x, head.y - r * 0.3, 0, head.x, head.y - r * 0.3, r);
          g.addColorStop(0, 'rgba(255, 250, 220, 0.95)');
          g.addColorStop(0.35, 'rgba(255, 170, 40, 0.7)');
          g.addColorStop(1, 'rgba(255, 80, 0, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(head.x, head.y - r * 0.3, r, 0, Math.PI * 2);
          ctx.fill();
          if (!sparks) continue;
          // Sparks thrown up off the flame, new every 1/24 s.
          const rnd = seededRandom(Math.floor(frame.time * 24), `burn-spark:${id}`);
          ctx.fillStyle = 'rgba(255, 190, 80, 0.9)';
          for (let i = 0; i < 4; i++) {
            const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
            const d = fontSize * (0.05 + rnd() * 0.2);
            ctx.beginPath();
            ctx.arc(head.x + Math.cos(a) * d, head.y + Math.sin(a) * d, Math.max(0.6, fontSize * 0.006 * (1 + rnd())), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      },
    };
  },
});
