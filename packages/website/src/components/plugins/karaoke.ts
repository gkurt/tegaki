import { createPlugin, expandBox, type PlacedStroke, unionBoxes } from 'tegaki/core';
import { type PaperLine, paperLayout } from './paper.ts';

/** A glyph the ball lands on: where (the middle of its advance, above its line's ink) and when (its first stroke starts). */
export interface Landing {
  x: number;
  y: number;
  time: number;
}

/** The landings in the order they come: one per glyph that has strokes. */
export function landings(strokes: readonly PlacedStroke[], fontSize: number, lift: number): Landing[] {
  // The top of each line's ink, by baseline: the ball lands just above it.
  const tops = new Map<number, number>();
  for (const s of strokes) {
    const key = Math.round((s.place.y + s.place.ascender * s.place.scale) * 4);
    const box = s.rawPath.bounds();
    if (box) tops.set(key, Math.min(tops.get(key) ?? Infinity, box.minY));
  }
  const byGlyph = new Map<number, Landing>();
  for (const s of strokes) {
    const baseline = s.place.y + s.place.ascender * s.place.scale;
    const top = tops.get(Math.round(baseline * 4)) ?? baseline - fontSize;
    const at = byGlyph.get(s.entryIndex);
    if (at) at.time = Math.min(at.time, s.start);
    else byGlyph.set(s.entryIndex, { x: s.place.x + (s.glyph.w * s.place.scale) / 2, y: top - lift * fontSize, time: s.start });
  }
  return [...byGlyph.values()].sort((a, b) => a.time - b.time);
}

/**
 * The ball at `time`: on each glyph as its first stroke starts, hopping in
 * an arc `height` high (in px) between one and the next; waiting over the
 * first before it, resting on the last after. `null` with nowhere to land.
 */
export function ballAt(stops: readonly Landing[], time: number, height: number): { x: number; y: number; squash: number } | null {
  if (stops.length === 0) return null;
  if (time <= stops[0]!.time) return { ...stops[0]!, squash: 0 };
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (time >= b.time) continue;
    const span = b.time - a.time;
    const f = span > 0 ? (time - a.time) / span : 1;
    // A squash as it lands and pushes off.
    const squash = Math.max(0, 1 - Math.min(f, 1 - f) * 10);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f - height * 4 * f * (1 - f), squash };
  }
  const last = stops.at(-1)!;
  return { x: last.x, y: last.y, squash: 0 };
}

/**
 * Karaoke: a ball bouncing from letter to letter as each is written, and
 * a bar under each line filling up to where the pen has got — the way
 * lyrics light up in time. An `overlay`, from the frame alone, laid out by
 * where each stroke's glyph sits (`place`) and when it starts.
 */
export const karaokePlugin = createPlugin({
  name: 'karaoke',
  label: 'Karaoke',
  description: 'A ball bouncing letter to letter as each is written, and a bar filling under each line. overlay + bounds.',
  params: {
    color: { type: 'color', label: 'Color', default: '#ff3d7f' },
    ball: { type: 'boolean', label: 'Ball', default: true },
    bar: { type: 'boolean', label: 'Bar', default: true },
    bounce: {
      type: 'number',
      label: 'Bounce',
      description: 'How high the ball hops, in ems.',
      default: 0.35,
      min: 0.05,
      max: 1,
      step: 0.05,
    },
    size: { type: 'number', label: 'Size', description: "The ball's size, in ems.", default: 0.09, min: 0.03, max: 0.25, step: 0.01 },
  },
  presets: {
    'Ball only': { bar: false },
    'Bar only': { ball: false },
  },
  setup: ({ color, ball, bar, bounce, size }) => {
    let cached: { first: unknown; count: number; stops: Landing[]; lines: PaperLine[] } | null = null;
    const layoutOf = (strokes: readonly PlacedStroke[], fontSize: number) => {
      if (cached?.first !== strokes[0]?.path || cached?.count !== strokes.length) {
        cached = {
          first: strokes[0]?.path,
          count: strokes.length,
          stops: landings(strokes, fontSize, size),
          lines: paperLayout(strokes, fontSize).lines,
        };
      }
      return cached;
    };
    return {
      bounds: ({ strokes, fontSize }) =>
        expandBox(unionBoxes(strokes.map((s) => s.rawPath.bounds())), fontSize * (bounce + size * 2 + 0.3)),
      overlay({ ctx, frame, fontSize }) {
        const { stops, lines } = layoutOf(frame.strokes, fontSize);
        // How far along the pen has got: the head being drawn, or the end of the last stroke done.
        let reach: { x: number; baseline: number } | null = null;
        for (const s of frame.strokes) {
          if (s.state === 'pending') continue;
          const at = s.head ?? s.path.pointAt(1);
          reach = { x: at.x, baseline: s.place.y + s.place.ascender * s.place.scale };
        }
        if (bar) {
          const thick = Math.max(2, fontSize * 0.03);
          ctx.lineCap = 'round';
          ctx.lineWidth = thick;
          for (const l of lines) {
            const y = l.baseline + fontSize * 0.22;
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.18;
            ctx.beginPath();
            ctx.moveTo(l.left, y);
            ctx.lineTo(l.right, y);
            ctx.stroke();
            // Lines already sung fill whole; the line being sung fills to the pen.
            const done = reach && reach.baseline > l.baseline + 1;
            const on = reach && Math.abs(reach.baseline - l.baseline) <= 1;
            const to = done ? l.right : on ? Math.min(l.right, Math.max(l.left, reach!.x)) : l.left;
            if (to <= l.left) continue;
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.moveTo(l.left, y);
            ctx.lineTo(to, y);
            ctx.stroke();
          }
        }
        if (ball) {
          const at = ballAt(stops, frame.time, bounce * fontSize);
          if (!at) return;
          const r = size * fontSize * 0.5;
          ctx.globalAlpha = 1;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.ellipse(at.x, at.y - r * (1 - 0.3 * at.squash), r * (1 + 0.3 * at.squash), r * (1 - 0.3 * at.squash), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
          ctx.beginPath();
          ctx.arc(at.x - r * 0.35, at.y - r * 1.3, r * 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    };
  },
});
