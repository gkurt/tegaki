import { createPlugin, expandBox, type StrokeFrame, type StrokePath, type StrokeTime, seededRandom, unionBoxes } from 'tegaki/core';
import { canvasColor, mix, type Rgba, rgba } from './color.ts';

export type EraseMode = 'erase' | 'write-erase';
export type EraseOrder = 'reverse' | 'same';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A stroke at one moment of the erasing: how much of it is written and erased (0–1 each), and what's left. */
export interface Erasing {
  /** Share of the stroke written so far. */
  written: number;
  /** Share of the stroke the eraser has been over. */
  erased: number;
  /** The draw-progress stretch still on the paper, `[from, to]` — empty when `to <= from`. */
  from: number;
  to: number;
  /** Where the eraser is on the stroke, while it's erasing it; `null` otherwise. */
  eraser: number | null;
}

/**
 * The timeline an eraser plays, from the strokes' times and the timeline's
 * length (`total`): when each stroke is written and when it's erased, each as
 * long as it took to write, and how long it all runs. In `'write-erase'` the
 * text is written as it would be, then erased over as long again; in
 * `'erase'` it's all there from the start and erased over the timeline.
 * `'reverse'` erases the last stroke first, `'same'` in writing order.
 */
export function eraseTimeline(
  strokes: readonly StrokeTime[],
  total: number,
  mode: EraseMode,
  order: EraseOrder,
): { write: StrokeTime[]; erase: StrokeTime[]; duration: number } {
  const from = mode === 'write-erase' ? total : 0;
  return {
    write:
      mode === 'write-erase'
        ? strokes.map((s) => ({ start: s.start, duration: s.duration }))
        : strokes.map(() => ({ start: 0, duration: 0 })),
    erase: strokes.map((s) => ({ start: from + (order === 'reverse' ? total - (s.start + s.duration) : s.start), duration: s.duration })),
    duration: from + total,
  };
}

/**
 * A stroke at `time`, `written` of it drawn (its draw progress), erased over
 * its `erase` window — `'reverse'` running back along it (its erased part is
 * `[1 - erased, 1]`), `'same'` along it (`[0, erased]`).
 */
export function erasingAt(written: number, erase: StrokeTime, time: number, order: EraseOrder): Erasing {
  const erased = erase.duration > 0 ? clamp01((time - erase.start) / erase.duration) : time >= erase.start ? 1 : 0;
  const erasing = erased > 0 && erased < 1;
  if (order === 'reverse') return { written, erased, from: 0, to: Math.min(written, 1 - erased), eraser: erasing ? 1 - erased : null };
  return { written, erased, from: erased, to: written, eraser: erasing ? erased : null };
}

/** Whether the eraser has been over draw progress `t` of a stroke. */
export function isErased(e: Erasing, t: number, order: EraseOrder): boolean {
  return order === 'reverse' ? t >= 1 - e.erased : t <= e.erased;
}

/** A crumb of rubber the eraser leaves: where, how big, and the draw progress it's rubbed off at. */
export interface Crumb {
  x: number;
  y: number;
  r: number;
  t: number;
}

/** Crumbs along a stroke: a few per em, lying beside where the eraser went. */
export function crumbs(path: StrokePath, fontSize: number, amount: number, random: () => number): Crumb[] {
  if (amount <= 0) return [];
  const count = Math.round(Math.max(1, (path.length / fontSize) * 4 * amount));
  return Array.from({ length: count }, () => {
    const t = random();
    const at = path.pointAt(t);
    const angle = random() * Math.PI * 2;
    const reach = fontSize * (0.03 + random() * 0.09);
    return { x: at.x + Math.cos(angle) * reach, y: at.y + Math.sin(angle) * reach, r: fontSize * (0.006 + random() * 0.012), t };
  });
}

const WHITE: Rgba = [255, 255, 255, 1];

/**
 * An eraser rubbing the text out: stroke by stroke, a rubber block scrubs
 * along the ink, leaving a faint ghost of it and crumbs of rubber. It can
 * erase the text from written, or write it and then erase it — the last
 * stroke first (an undo), or in writing order. `timing` makes the time for
 * the erasing (the timeline runs on past the writing, or starts with it all
 * written), `paint` paints each stroke's stretch still on the paper, and the
 * eraser and crumbs are an `overlay`.
 */
export const eraserPlugin = createPlugin({
  name: 'eraser',
  label: 'Eraser',
  description:
    'An eraser rubs the text out stroke by stroke, leaving a ghost and crumbs, or writes it and then erases it. timing + paint + overlay.',
  params: {
    mode: {
      type: 'select',
      label: 'Mode',
      default: 'write-erase',
      options: [
        { value: 'write-erase', label: 'Write, then erase' },
        { value: 'erase', label: 'Erase' },
      ],
    },
    order: {
      type: 'select',
      label: 'Order',
      default: 'reverse',
      options: [
        { value: 'reverse', label: 'Last stroke first' },
        { value: 'same', label: 'As written' },
      ],
    },
    ghost: {
      type: 'number',
      label: 'Ghost',
      description: 'How much of the erased ink is left behind.',
      default: 0.12,
      min: 0,
      max: 0.5,
      step: 0.01,
    },
    crumbs: { type: 'number', label: 'Crumbs', description: 'Bits of rubber left on the paper.', default: 0.5, min: 0, max: 1, step: 0.05 },
    tool: { type: 'boolean', label: 'Show eraser', default: true },
  },
  presets: {
    Undo: { mode: 'write-erase', order: 'reverse', ghost: 0, crumbs: 0 },
    Chalkboard: { mode: 'erase', order: 'same', ghost: 0.3, crumbs: 0 },
  },
  setup: ({ mode, order, ghost, crumbs: crumbAmount, tool }) => {
    // When the eraser goes over each stroke, by id — set once per layout by `timing`.
    let erases = new Map<string, StrokeTime>();
    const erasing = (s: StrokeFrame, time: number) => {
      const erase = erases.get(s.id);
      return erase ? erasingAt(s.state === 'pending' ? 0 : s.progress, erase, time, order) : null;
    };
    const crumbsOf = new WeakMap<StrokePath, Crumb[]>();
    let ink: { style: string; ghost: string | null } | null = null;
    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * (tool ? 0.7 : 0.15)),
      timing({ strokes, duration }) {
        const t = eraseTimeline(strokes, duration, mode, order);
        erases = new Map(strokes.map((s, i) => [s.id, t.erase[i]!]));
        return { strokes: t.write, duration: t.duration };
      },
      paint(s, next) {
        const { stroke, frame } = s;
        const e = erasing(stroke, frame.time);
        if (!e) return next(s);
        const whole = e.from <= 0 && e.to >= 1;
        if (ghost > 0 && e.erased > 0 && typeof s.style === 'string' && stroke.path.points.length > 1) {
          // The ghost of what's been written: the ink, nearly all rubbed away, under what's left.
          if (ink?.style !== s.style) {
            const rgb = canvasColor(s.ctx, s.style);
            ink = { style: s.style, ghost: rgb ? rgba(mix(rgb, WHITE, 1 - ghost)) : null };
          }
          if (ink.ghost && e.written > 0) {
            next({
              ...s,
              style: ink.ghost,
              stroke: { ...stroke, state: 'done', progress: 1, path: stroke.path.slice(0, e.written), nibs: [] },
            });
          }
        }
        if (e.to <= e.from) return;
        const path = whole ? stroke.path : stroke.path.slice(e.from, e.to);
        next({ ...s, stroke: { ...stroke, state: 'done', progress: 1, path, nibs: whole ? stroke.nibs : [] } });
      },
      overlay({ ctx, frame, fontSize, random }) {
        if (crumbAmount > 0) {
          ctx.fillStyle = '#d98f9b';
          ctx.globalAlpha = 0.75;
          for (const s of frame.strokes) {
            const e = erasing(s, frame.time);
            if (!e || e.erased <= 0) continue;
            let list = crumbsOf.get(s.path);
            if (!list) crumbsOf.set(s.path, (list = crumbs(s.path, fontSize, crumbAmount, random(`crumbs:${s.id}`))));
            for (const c of list) {
              if (!isErased(e, c.t, order)) continue;
              ctx.beginPath();
              ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        if (!tool) return;
        for (const s of frame.strokes) {
          const eraser = erasing(s, frame.time)?.eraser ?? null;
          if (eraser === null) continue;
          const at = s.path.pointAt(eraser);
          // Scrubbing: back and forth along the stroke as it goes.
          const scrub = Math.sin(frame.time * 45 + seededRandom(s.seed, 'scrub')() * 6) * fontSize * 0.025;
          drawEraser(ctx, at.x + Math.cos(at.angle) * scrub, at.y + Math.sin(at.angle) * scrub, fontSize);
        }
      },
    };
  },
});

/** A rubber block standing on its corner at (x, y): pink rubber, a darker worn face, and a paper sleeve. */
function drawEraser(ctx: CanvasRenderingContext2D, x: number, y: number, fontSize: number) {
  const w = fontSize * 0.2;
  const h = fontSize * 0.42;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.55);
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = fontSize * 0.05;
  ctx.shadowOffsetX = fontSize * 0.02;
  ctx.shadowOffsetY = fontSize * 0.03;
  // Rubber, worn round at the bottom where it meets the paper.
  ctx.fillStyle = '#f29aa8';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h, w, h, [w * 0.15, w * 0.15, w * 0.4, w * 0.4]);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#d97889';
  ctx.fillRect(w * 0.18, -h, w * 0.32, h * 0.97);
  // Sleeve.
  ctx.fillStyle = '#2f5fb3';
  ctx.fillRect(-w / 2, -h, w, h * 0.5);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-w / 2, -h * 0.8, w, h * 0.12);
  ctx.restore();
}
