import { createPlugin, StrokePath, type TegakiStrokePaintContext } from 'tegaki/core';

/**
 * Where a ballpoint's line skips: the stretches of a stroke `length` px long
 * that get ink, as draw progress `[from, to]` pairs in order. About `skips`
 * gaps per em of line, each about `gap` ems long, placed by `random` (0–1),
 * none in the first or last tenth of the stroke, where the ball is loaded
 * or pressing hard.
 */
export function skipPieces(length: number, fontSize: number, o: { skips: number; gap: number }, random: () => number): [number, number][] {
  if (length <= 0 || o.skips <= 0) return [[0, 1]];
  const expected = (length / fontSize) * o.skips;
  // A whole number of gaps with the right mean: the fraction left over is a chance of one more.
  const count = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);
  const gaps: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const size = (o.gap * fontSize * (0.5 + random())) / length;
    const at = 0.1 + random() * Math.max(0, 0.8 - size);
    gaps.push([at, at + size]);
  }
  gaps.sort((a, b) => a[0] - b[0]);
  const pieces: [number, number][] = [];
  let from = 0;
  for (const [a, b] of gaps) {
    if (a > from) pieces.push([from, a]);
    from = Math.max(from, b);
  }
  if (from < 1) pieces.push([from, 1]);
  return pieces;
}

interface Ballpoint {
  pieces: { from: number; to: number; path: StrokePath }[];
  /** A gob of ink where the ball first touches down, or none. */
  blob: StrokePath | null;
}

/**
 * A ballpoint pen: an even, thinner line that skips here and there where
 * the ball didn't roll, and now and then a gob of ink where it touched
 * down. A `paint` plugin: each stretch of ink goes to `next` as a stroke of
 * its own, timed as that part of the stroke, so the painters after it (wet
 * ink) still know when the pen passed each point.
 */
export const ballpointPlugin = createPlugin({
  name: 'ballpoint',
  label: 'Ballpoint',
  description: 'An even line that skips where the ball didn’t roll, with the odd gob of ink. paint.',
  params: {
    weight: {
      type: 'number',
      label: 'Weight',
      description: "The line's width, against the stroke's.",
      default: 0.6,
      min: 0.2,
      max: 1.5,
      step: 0.05,
    },
    even: {
      type: 'number',
      label: 'Even',
      description: 'How much the width evens out along each stroke.',
      default: 0.8,
      min: 0,
      max: 1,
      step: 0.05,
    },
    skips: { type: 'number', label: 'Skips', description: 'Gaps per em of line.', default: 1.5, min: 0, max: 4, step: 0.1 },
    gap: { type: 'number', label: 'Gap', description: 'How long a gap is, in ems.', default: 0.025, min: 0.005, max: 0.1, step: 0.005 },
    blobs: {
      type: 'number',
      label: 'Blobs',
      description: 'How often a stroke starts with a gob of ink.',
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.05,
    },
  },
  presets: {
    'New pen': { skips: 0.1, blobs: 0.1 },
    'Running dry': { skips: 3.5, gap: 0.04, blobs: 0 },
    'Cheap pen': { skips: 2, blobs: 0.6, even: 0.95 },
  },
  setup: ({ weight, even, skips, gap, blobs }) => {
    const cache = new WeakMap<StrokePath, Ballpoint>();
    const penOf = (s: TegakiStrokePaintContext): Ballpoint => {
      const path = s.stroke.path;
      let pen = cache.get(path);
      if (!pen) {
        const pts = path.points;
        const mean = pts.reduce((sum, p) => sum + p.width, 0) / Math.max(1, pts.length);
        const line = path.map((p) => ({ ...p, width: (p.width * (1 - even) + mean * even) * weight }));
        const random = s.random(`ballpoint:${s.stroke.id}`);
        const pieces =
          pts.length < 2
            ? [{ from: 0, to: 1, path: line }]
            : skipPieces(path.length, s.fontSize, { skips, gap }, random).map(([from, to]) => ({
                from,
                to,
                path: from === 0 && to === 1 ? line : line.slice(from, to),
              }));
        let blob: StrokePath | null = null;
        if (pts.length >= 2 && random() < blobs) {
          const at = line.pointAt(Math.min(1, (0.02 * s.fontSize) / Math.max(1, path.length)));
          blob = new StrokePath([{ x: at.x, y: at.y, width: at.width * (1.6 + random() * 0.8), t: 0 }]);
        }
        pen = { pieces, blob };
        cache.set(path, pen);
      }
      return pen;
    };
    return {
      paint(s, next) {
        const { stroke } = s;
        const { pieces, blob } = penOf(s);
        for (const { from, to, path } of pieces) {
          if (stroke.progress <= from) break;
          const span = to - from;
          next({
            ...s,
            stroke: {
              ...stroke,
              path,
              progress: Math.min(1, (stroke.progress - from) / span),
              start: stroke.start + stroke.duration * from,
              duration: stroke.duration * span,
              nibs: [],
            },
          });
        }
        if (blob) next({ ...s, stroke: { ...stroke, path: blob, progress: 1, nibs: [] } });
      },
    };
  },
});
