import { createPlugin, expandBox, type InkStyle, type StrokeFrame, unionBoxes } from 'tegaki/core';

/**
 * How far behind the pen the segment's tail trails, as a share of the
 * stroke: `length` px over the stroke's length, at most the whole stroke —
 * a dot, or a stroke shorter than the segment, is covered from its start.
 */
export function segmentLag(pathLength: number, length: number): number {
  return pathLength > 0 ? Math.min(1, length / pathLength) : 1;
}

/**
 * The part of `stroke` the segment covers at timeline time `time`, as draw
 * progress `from`–`to`, for a segment `length` px long; `null` while the pen
 * hasn't reached the stroke or once the segment has left it. While the stroke
 * is drawn the segment ends at the pen; once it's done, the head rests at the
 * stroke's end and the tail runs on at the pace the pen drew it, until it
 * gets there too.
 */
export function segmentSpan(
  stroke: Pick<StrokeFrame, 'state' | 'progress' | 'start' | 'duration' | 'path'>,
  time: number,
  length: number,
): { from: number; to: number } | null {
  if (stroke.state === 'pending') return null;
  const lag = segmentLag(stroke.path.length, length);
  if (stroke.state === 'drawing') return { from: Math.max(0, stroke.progress - lag), to: stroke.progress };
  const over = stroke.duration > 0 ? Math.max(0, time - (stroke.start + stroke.duration)) / stroke.duration : Number.POSITIVE_INFINITY;
  const from = 1 - lag + over;
  return from < 1 ? { from, to: 1 } : null;
}

/** When the last segment runs off the end of its stroke: the time the timeline has to run to, for segments `length` px long. */
export function segmentsEnd(strokes: readonly Pick<StrokeFrame, 'start' | 'duration' | 'path'>[], length: number): number {
  let end = 0;
  for (const s of strokes) end = Math.max(end, s.start + s.duration * (1 + segmentLag(s.path.length, length)));
  return end;
}

/**
 * A segment of ink that travels along the writing: the stretch of each
 * stroke just behind the pen, `length` ems long, following the pen as it
 * writes and running off the stroke's end after it lifts. In the text's
 * color and at the stroke's width unless set otherwise — wider bulges it,
 * narrower thins it — over the ink, or with Hide strokes on, instead of
 * it: the segment alone crawls through the text.
 *
 * A `paint` plugin: it passes each stroke on (unless hidden), then a slice
 * of its path to the painters after it, so they paint the segment in their
 * own way. A wider segment goes on the `unclipped` layer, since it runs past
 * the letters. A `timing` hook runs the timeline on until the last segment
 * has left the last stroke.
 */
export const segmentPlugin = createPlugin({
  name: 'segment',
  label: 'Segment',
  description: 'A segment of ink traveling along the writing behind the pen, over the strokes or instead of them. paint + timing.',
  params: {
    length: {
      type: 'number',
      label: 'Length',
      description: 'How long the segment is along the stroke, in ems.',
      default: 0.4,
      min: 0.05,
      max: 4,
      step: 0.05,
    },
    width: {
      type: 'number',
      label: 'Width',
      description: "Its width, against the stroke's: over 1 bulges it, under 1 narrows it.",
      default: 1,
      min: 0.2,
      max: 4,
      step: 0.05,
    },
    own: { type: 'boolean', label: 'Own color', description: "The segment's color rather than the text's.", default: false },
    color: { type: 'color', label: 'Color', default: '#ff5a36' },
    hide: { type: 'boolean', label: 'Hide strokes', description: 'Draw only the segment, not the ink it leaves behind.', default: false },
  },
  presets: {
    Snake: { hide: true, length: 0.8 },
    Bead: { own: true, width: 2.4, length: 0.12 },
    Thread: { hide: true, own: true, color: '#2f7bff', width: 0.5, length: 1.6 },
  },
  setup: ({ length, width, own, color, hide }) => ({
    bounds:
      width > 1
        ? ({ strokes }) => {
            let widest = 0;
            for (const s of strokes) for (const p of s.path.points) widest = Math.max(widest, p.width);
            return expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), (widest * (width - 1)) / 2);
          }
        : undefined,
    timing: ({ strokes, duration, fontSize }) => ({ strokes, duration: Math.max(duration, segmentsEnd(strokes, length * fontSize)) }),
    paint(s, next) {
      // Not drawn yet: pass it on, and the default painter shows nothing.
      if (s.stroke.state === 'pending') return next(s);
      if (!hide) next(s);
      const { stroke } = s;
      const span = segmentSpan(stroke, s.frame.time, length * s.fontSize);
      if (!span) return;
      const { from, to } = span;
      const piece = stroke.path.slice(from, to);
      const path = width === 1 ? piece : piece.map((p) => ({ ...p, width: p.width * width }));
      // The slice runs its own 0–1: a color along the stroke is read where the slice lies on it.
      const base = s.style;
      const style: InkStyle = own ? color : typeof base === 'function' ? (t) => base(from + t * (to - from)) : base;
      const nibs = stroke.nibs
        .filter((nib) => nib.t >= from && nib.t <= to)
        .map((nib) => ({ ...nib, t: to > from ? (nib.t - from) / (to - from) : 0 }));
      next({
        ...s,
        // A wider segment runs past the letters: on the layer clip-to-text leaves alone.
        ctx: width > 1 ? s.unclipped : s.ctx,
        style,
        stroke: { ...stroke, path, progress: 1, nibs, head: path.pointAt(1) },
      });
    },
  }),
});
