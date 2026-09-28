import { createPlugin, groupStrokes, type PlacedStroke, type StrokeFrame, StrokePath, type StrokeTime } from 'tegaki/core';
import { num } from './svg.ts';

/** A join the pen draws from the end of one letter's stroke to the start of the next letter's first. */
export interface Join {
  /** Indices, in the strokes given, of the stroke it leaves and the one it runs into. */
  from: number;
  to: number;
  path: StrokePath;
  /** Seconds the pen takes over it, at the pace it drew the stroke it leaves. */
  duration: number;
}

export interface JoinOptions {
  /** The farthest a join reaches, in ems. */
  reach: number;
  /** Its width, against the thinner of the two strokes it joins. */
  weight: number;
  /** How low it swings between the letters, in ems. */
  swing: number;
  /** How fast the pen runs over it, against the pace it drew the stroke before. */
  pace: number;
}

/** A stroke this short, in ems, is a dot or a tick, not the stroke a letter is left from. */
const MIN_STROKE = 0.12;

const unit = (x: number, y: number) => {
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n };
};

/**
 * The join from (x0, y0), leaving at angle `out`, to (x3, y3), arriving at
 * angle `into`: a curve that sets off the way the pen was going and comes
 * in the way the next stroke starts — both leaned forward, the way a hand
 * writes — swinging `swing` px low between them, and thinning toward its
 * middle as a hairline does. `width` is its width at the ends.
 */
export function joinPath(
  x0: number,
  y0: number,
  out: number,
  x3: number,
  y3: number,
  into: number,
  width: number,
  swing: number,
): StrokePath {
  const d = Math.hypot(x3 - x0, y3 - y0);
  const e = unit(Math.cos(out) + 0.8, Math.sin(out));
  const n = unit(Math.cos(into) + 0.8, Math.sin(into));
  const x1 = x0 + e.x * d * 0.4;
  const y1 = y0 + e.y * d * 0.4 + swing;
  const x2 = x3 - n.x * d * 0.4;
  const y2 = y3 - n.y * d * 0.4 + swing;
  const pts: { x: number; y: number; width: number }[] = [];
  const count = 16;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = 1 - t;
    pts.push({
      x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      width: width * (1 - 0.4 * Math.sin(Math.PI * t)),
    });
  }
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  const total = along[along.length - 1]! || 1;
  return new StrokePath(pts.map((p, i) => ({ ...p, t: along[i]! / total })));
}

type JoinStroke = Pick<PlacedStroke, 'entryIndex' | 'entry' | 'place' | 'glyph' | 'path' | 'start' | 'duration'>;

/**
 * Where the pen joins letters within each word written left to right: from
 * the last stroke of a letter drawn before the next letter starts (not a dot)
 * to that letter's first stroke, if they're within `reach`. Nothing for
 * words written right to left, or across a space.
 */
export function planJoins(strokes: readonly JoinStroke[], o: JoinOptions, fontSize: number): Join[] {
  const joins: Join[] = [];
  for (const word of groupStrokes(strokes, 'words', fontSize)) {
    if (word.rtl) continue;
    const byGlyph = new Map<number, number[]>();
    for (const i of word.members) {
      const e = strokes[i]!.entryIndex;
      let list = byGlyph.get(e);
      if (!list) byGlyph.set(e, (list = []));
      list.push(i);
    }
    for (let g = 0; g + 1 < word.glyphs.length; g++) {
      const here = byGlyph.get(word.glyphs[g]!)!;
      const next = byGlyph.get(word.glyphs[g + 1]!)!;
      const to = next.reduce((a, b) => (strokes[b]!.start < strokes[a]!.start ? b : a));
      const into = strokes[to]!;
      let from = -1;
      for (const i of here) {
        const s = strokes[i]!;
        if (s.path.points.length < 2 || s.path.length < MIN_STROKE * fontSize) continue;
        if (s.start + s.duration > into.start + 1e-9) continue;
        if (from < 0 || s.start + s.duration > strokes[from]!.start + strokes[from]!.duration) from = i;
      }
      if (from < 0) continue;
      const leave = strokes[from]!;
      const a = leave.path.pointAt(1);
      const b = into.path.pointAt(0);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      // Too far, or back behind where the pen is: a lift, not a join.
      if (d < 1 || d > o.reach * fontSize || b.x < a.x - 0.25 * fontSize) continue;
      const width = Math.max(0.5, Math.min(a.width, into.path.pointAt(0).width) * o.weight);
      const path = joinPath(a.x, a.y, a.angle, b.x, b.y, into.path.points.length > 1 ? b.angle : 0, width, o.swing * fontSize);
      const speed = leave.duration > 0 ? leave.path.length / leave.duration : Infinity;
      const duration = Math.max(0.03, Math.min(0.35, path.length / (speed * o.pace)));
      joins.push({ from, to, path, duration });
    }
  }
  return joins;
}

/**
 * The strokes' times with room for the joins: every stroke from each
 * join's end on held back by the time the pen takes over it.
 */
export function joinTimes(strokes: readonly StrokeTime[], joins: readonly Join[]): StrokeTime[] {
  const at = joins.map((j) => ({ time: strokes[j.to]!.start, hold: j.duration }));
  return strokes.map((s) => {
    let shift = 0;
    for (const a of at) if (s.start >= a.time - 1e-9) shift += a.hold;
    return { start: s.start + shift, duration: s.duration };
  });
}

/** How far along a join the pen is at `time`: over its duration, up to the start of the stroke it runs into, and not before the one it leaves ends. */
export function joinProgress(join: Join, from: StrokeTime, to: StrokeTime, time: number): number {
  const end = to.start;
  const start = Math.max(from.start + from.duration, end - join.duration);
  if (time <= start) return 0;
  return end > start ? Math.min(1, (time - start) / (end - start)) : 1;
}

/**
 * Cursive: the pen stays on the paper from letter to letter, drawing a
 * join from where one letter's stroke ends to where the next one's starts,
 * swinging low between them and thinning to a hairline. `timing` makes the
 * time for each join (the writing waits while the pen runs over it), `paint`
 * draws it after the stroke it leaves — through the rest of the chain, so it
 * takes the colors and the brush — on the `unclipped` layer, since joins run
 * between the letters, where clip-to-text would cut them.
 */
export const joinsPlugin = createPlugin({
  name: 'joins',
  label: 'Cursive joins',
  description:
    'The pen stays down between letters, drawing a hairline join from each to the next. Best in a script font. timing + paint + svg.',
  params: {
    reach: { type: 'number', label: 'Reach', description: 'The farthest a join runs, in ems.', default: 0.7, min: 0.1, max: 2, step: 0.05 },
    weight: {
      type: 'number',
      label: 'Weight',
      description: 'Its width, against the strokes it joins.',
      default: 0.6,
      min: 0.1,
      max: 1.2,
      step: 0.05,
    },
    swing: {
      type: 'number',
      label: 'Swing',
      description: 'How low it dips between letters, in ems.',
      default: 0.06,
      min: 0,
      max: 0.4,
      step: 0.01,
    },
    pace: { type: 'number', label: 'Pace', description: 'How fast the pen runs over it.', default: 1.4, min: 0.3, max: 4, step: 0.1 },
  },
  presets: {
    Copperplate: { weight: 0.35, swing: 0.1, reach: 0.9 },
    Loose: { reach: 1.4, swing: 0.2, weight: 0.8 },
  },
  setup: (options) => {
    let memo: { path: StrokePath | undefined; key: string; fontSize: number; joins: Join[]; byFrom: Map<string, Join[]> } | null = null;
    const joinsFor = (strokes: readonly (JoinStroke & { id: string })[], fontSize: number) => {
      const last = strokes[strokes.length - 1];
      const key = `${strokes.length}|${last?.start}|${last?.duration}`;
      if (memo && memo.path === strokes[0]?.path && memo.key === key && memo.fontSize === fontSize) return memo;
      const joins = planJoins(strokes, options, fontSize);
      const byFrom = new Map<string, Join[]>();
      for (const j of joins) {
        const id = strokes[j.from]!.id;
        byFrom.set(id, [...(byFrom.get(id) ?? []), j]);
      }
      memo = { path: strokes[0]?.path, key, fontSize, joins, byFrom };
      return memo;
    };
    return {
      timing({ strokes, fontSize }) {
        const joins = planJoins(strokes, options, fontSize);
        return joins.length > 0 ? { strokes: joinTimes(strokes, joins) } : undefined;
      },
      paint(s, next) {
        next(s);
        if (s.stroke.state !== 'done') return;
        const { frame } = s;
        const list = joinsFor(frame.strokes, s.fontSize).byFrom.get(s.stroke.id);
        if (!list) return;
        for (const join of list) {
          const to = frame.strokes[join.to];
          if (!to) continue;
          const progress = joinProgress(join, s.stroke, to, frame.time);
          if (progress <= 0) continue;
          const stroke: StrokeFrame = { ...s.stroke, path: join.path, progress, state: progress >= 1 ? 'done' : 'drawing', nibs: [] };
          next({ ...s, ctx: s.unclipped, stroke });
        }
      },
      svg({ strokes, fontSize, color, mode, overlay, appear, seconds }) {
        const { joins } = joinsFor(strokes, fontSize);
        const out: string[] = [];
        for (const join of joins) {
          const from = strokes[join.from]!;
          const to = strokes[join.to]!;
          const end = to.start;
          const start = Math.max(from.start + from.duration, end - join.duration);
          const pts = join.path.points;
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${num(p.x)} ${num(p.y)}`).join(' ');
          const width = pts.reduce((sum, p) => sum + p.width, 0) / pts.length;
          const line = `d="${d}" fill="none" stroke="${color}" stroke-width="${num(width)}" stroke-linecap="round"`;
          if (mode === 'once') {
            out.push(
              `<path ${line} pathLength="1" stroke-dasharray="1 2" stroke-dashoffset="1" opacity="0">` +
                `<set attributeName="opacity" to="1" begin="${num(seconds(start))}s" />` +
                `<animate attributeName="stroke-dashoffset" values="1;0" begin="${num(seconds(start))}s" dur="${num(Math.max(0.01, seconds(end) - seconds(start)))}s" fill="freeze" /></path>`,
            );
          } else {
            const shown = appear(start);
            out.push(`<g${shown.attrs}><path ${line} />${shown.inner}</g>`);
          }
        }
        if (out.length > 0) overlay(`<g>${out.join('')}</g>`);
      },
    };
  },
});
