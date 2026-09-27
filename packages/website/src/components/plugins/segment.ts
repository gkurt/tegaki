import {
  createPlugin,
  expandBox,
  type InkStyle,
  type PathPoint,
  paintStroke,
  type StrokeFrame,
  type StrokePaint,
  StrokePath,
  type TegakiFrame,
  unionBoxes,
} from 'tegaki/core';

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
 * How wide a tapered segment is, as a share of its full width, `from` px
 * from its nearer end: narrowing to a point over `reach` px at each end
 * (a quarter sine, so the point is round rather than a wedge), full width
 * past it. `reach` 0 is no taper.
 */
export function taperAt(from: number, reach: number): number {
  if (reach <= 0 || from >= reach) return 1;
  return Math.sin((Math.PI / 2) * Math.max(0, from / reach));
}

/**
 * `path` tapered toward both ends over `reach` px, resampled about every
 * `spacing` px so the narrowing reads smooth however far apart its own
 * points are. Its points keep the path's 0–1 `t`.
 */
export function taperPath(path: StrokePath, reach: number, spacing = 1): StrokePath {
  const length = path.length;
  if (reach <= 0 || length <= 0) return path;
  const n = Math.max(2, Math.min(256, Math.ceil(length / spacing)));
  const points: PathPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const at = path.pointAt(t);
    const along = t * length;
    points.push({ x: at.x, y: at.y, width: at.width * taperAt(Math.min(along, length - along), reach), t });
  }
  return new StrokePath(points);
}

/**
 * A segment of ink that travels along the writing: the stretch of each
 * stroke just behind the pen, `length` ems long, following the pen as it
 * writes and running off the stroke's end after it lifts. In the text's
 * color and at the stroke's width unless set otherwise — wider bulges it,
 * narrower thins it, Taper narrows it to a point at both ends — over the
 * ink or under it, with the text written as usual, drawn whole from the
 * start (the segment alone moves), or hidden (the segment alone crawls
 * through the text).
 *
 * A `paint` plugin: it passes each stroke on (unless hidden), then a slice
 * of its path to the painters after it, so they paint the segment in their
 * own way. Under the ink, the slice goes on the `unclipped` layer beneath
 * what's drawn; a wider segment over the ink runs past the letters and must
 * stay on top of every stroke, so it's kept for the `overlay` and painted
 * there. A `timing` hook runs the timeline on until the last segment has
 * left the last stroke.
 */
export const segmentPlugin = createPlugin({
  name: 'segment',
  label: 'Segment',
  description:
    'A segment of ink traveling along the writing behind the pen, over the strokes, under them or instead of them. paint + overlay + timing.',
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
    taper: {
      type: 'number',
      label: 'Taper',
      description: 'How far it narrows to a point toward both ends: 0 not at all, 1 from its middle.',
      default: 0,
      min: 0,
      max: 1,
      step: 0.05,
    },
    own: { type: 'boolean', label: 'Own color', description: "The segment's color rather than the text's.", default: false },
    color: { type: 'color', label: 'Color', default: '#ff5a36' },
    under: { type: 'boolean', label: 'Under the ink', description: 'The strokes drawn over the segment, not under it.', default: false },
    whole: {
      type: 'boolean',
      label: 'Whole text',
      description: 'Every stroke drawn whole from the start, not written: only the segment moves along them.',
      default: false,
    },
    hide: { type: 'boolean', label: 'Hide strokes', description: 'Draw only the segment, not the ink it leaves behind.', default: false },
  },
  presets: {
    Snake: { hide: true, length: 0.8, taper: 0.4 },
    Bead: { own: true, width: 2.4, length: 0.12 },
    Thread: { hide: true, own: true, color: '#2f7bff', width: 0.5, length: 1.6 },
    Tracer: { whole: true, own: true, width: 1.6, taper: 1, length: 0.6 },
  },
  setup: ({ length, width, taper, own, color, under, whole, hide }) => {
    // Wide segments over the ink, kept from this frame's paint for its overlay.
    let front: { frame: TegakiFrame; strokes: StrokePaint[] } | null = null;
    const onTop = !under && width > 1;
    return {
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
        const { stroke } = s;
        // The strokes: written as usual, drawn whole from the start, or — hidden — passed on
        // only while pending, which the default painter shows as nothing.
        if (!hide) next(whole ? { ...s, stroke: { ...stroke, state: 'done', progress: 1, linear: 1 } } : s);
        else if (stroke.state === 'pending') next(s);
        const span = segmentSpan(stroke, s.frame.time, length * s.fontSize);
        if (!span) return;
        const { from, to } = span;
        const piece = stroke.path.slice(from, to);
        const wide = width === 1 ? piece : piece.map((p) => ({ ...p, width: p.width * width }));
        // Tapered over the ends of a segment at its full length, so one just setting off is the tip of the same shape.
        const path = taper > 0 ? taperPath(wide, (taper * length * s.fontSize) / 2) : wide;
        // The slice runs its own 0–1: a color along the stroke is read where the slice lies on it.
        const base = s.style;
        const style: InkStyle = own ? color : typeof base === 'function' ? (t) => base(from + t * (to - from)) : base;
        const nibs = stroke.nibs
          .filter((nib) => nib.t >= from && nib.t <= to)
          .map((nib) => ({ ...nib, t: to > from ? (nib.t - from) / (to - from) : 0 }));
        const segment: StrokeFrame = { ...stroke, path, progress: 1, nibs, head: path.pointAt(1) };
        if (onTop) {
          if (front?.frame !== s.frame) front = { frame: s.frame, strokes: [] };
          front.strokes.push({ ctx: s.ctx, stroke: segment, style, lineCap: s.lineCap });
        } else if (under) {
          // Beneath the ink already drawn; the strokes after it paint over it as they come.
          const ctx = s.unclipped;
          ctx.save();
          ctx.globalCompositeOperation = 'destination-over';
          next({ ...s, ctx, style, stroke: segment });
          ctx.restore();
        } else {
          next({ ...s, style, stroke: segment });
        }
      },
      overlay({ ctx, frame }) {
        if (front?.frame === frame) for (const s of front.strokes) paintStroke({ ...s, ctx });
        front = null;
      },
    };
  },
});
