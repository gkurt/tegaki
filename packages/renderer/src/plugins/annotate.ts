import { createPlugin, lengthToPx, type TegakiLength } from '../core/createPlugin.ts';
import { paintStroke } from '../lib/paintStroke.ts';
import { seededRandom } from '../lib/random.ts';
import { type Box, type PathPoint, StrokePath, unionBoxes } from '../lib/strokePath.ts';
import type { PlacedStroke, StrokeFrame, StrokeTime } from '../lib/strokeTimeline.ts';
import { groupStrokes, type StrokeGroup, type StrokeGroupBy } from './groups.ts';

/** What the pen marks the text with. */
export type AnnotateMark = 'underline' | 'double' | 'highlight' | 'strike' | 'circle' | 'box' | 'cross';

/** When the marks are drawn: all once the text is written, or each as soon as what it marks is. */
export type AnnotateWhen = 'after' | 'each';

export interface AnnotateOptions {
  mark: AnnotateMark;
  /** What each mark goes round or under: the whole text, each line, or each word. */
  target: StrokeGroupBy;
  /** Which one to mark, from 1; `0` marks every one. */
  pick: number;
  when: AnnotateWhen;
  color: string;
  /** The pen's width: in em, or px as `'3px'`. */
  width: TegakiLength;
  /** How far the marks sit off the ink: in em, or px as `'10px'`. */
  padding: TegakiLength;
  /** How loosely the hand draws them: 0 ruler-straight, 1 dashed off. */
  roughness: number;
  /** Seconds each mark takes to draw. */
  duration: number;
  /** Seconds before a mark starts, after what it follows. */
  delay: number;
}

/** One pen stroke of a mark, drawn over a share (`from`–`to`) of the mark's time. */
export interface AnnotationStroke {
  path: StrokePath;
  from: number;
  to: number;
}

/** A mark on the text: its strokes and when it's drawn. */
export interface Annotation {
  start: number;
  duration: number;
  strokes: AnnotationStroke[];
  /** Laid under the ink (a highlighter) rather than over it. */
  under: boolean;
}

/** The strokes marks are placed and timed from. */
export type AnnotatedStroke = Pick<PlacedStroke, 'entryIndex' | 'entry' | 'place' | 'glyph' | 'path' | 'seed' | 'start' | 'duration'>;

/** The marks that run along a line of text rather than round what they mark: a mark per line, even for the whole text. */
const ALONG: ReadonlySet<AnnotateMark> = new Set(['underline', 'double', 'highlight', 'strike']);
/** Seconds between one mark and the next, when they're drawn one after another. */
const GAP = 0.08;
/** How strongly a highlighter's ink shows. */
export const HIGHLIGHT_ALPHA = 0.42;

/** The groups the marks go on: which of the text's words, lines, or the text itself, with `pick` applied. */
export function annotatedGroups(
  strokes: readonly AnnotatedStroke[],
  o: Pick<AnnotateOptions, 'mark' | 'target' | 'pick'>,
  fontSize: number,
) {
  const by = o.target === 'text' && ALONG.has(o.mark) ? 'lines' : o.target;
  const groups = groupStrokes(strokes, by, fontSize);
  if (o.pick <= 0) return groups;
  const one = groups[Math.round(o.pick) - 1];
  return one ? [one] : [];
}

const endOf = (s: StrokeTime) => s.start + s.duration;

/**
 * When each mark is drawn, from the strokes' times: `'after'` one after
 * another once the last stroke is written, `'each'` as soon as the last of
 * its group's strokes is — for strokes already retimed to make room for them
 * (see {@link annotateTiming}).
 */
export function annotationStarts(
  strokes: readonly StrokeTime[],
  groups: readonly StrokeGroup[],
  o: Pick<AnnotateOptions, 'when' | 'delay' | 'duration'>,
): number[] {
  if (o.when === 'each') return groups.map((g) => Math.max(...g.members.map((i) => endOf(strokes[i]!))) + o.delay);
  const end = strokes.reduce((m, s) => Math.max(m, endOf(s)), 0);
  return groups.map((_, k) => end + o.delay + k * (o.duration + GAP));
}

/**
 * The strokes' times with room made for the marks, and how long the
 * timeline then runs (its pause at the end kept). `'after'` leaves the
 * strokes be and runs the timeline on past the marks; `'each'` holds the
 * writing back after each marked group while its mark is drawn.
 */
export function annotateTiming(
  strokes: readonly StrokeTime[],
  groups: readonly StrokeGroup[],
  duration: number,
  o: Pick<AnnotateOptions, 'when' | 'delay' | 'duration'>,
): { strokes: StrokeTime[]; duration: number } {
  const lastEnd = strokes.reduce((m, s) => Math.max(m, endOf(s)), 0);
  const tail = Math.max(0, duration - lastEnd);
  let times = strokes.map((s) => ({ start: s.start, duration: s.duration }));
  if (o.when === 'each') {
    // Each group's mark, earliest first, pushes back every stroke not yet drawn when its group is done.
    const ends = groups.map((g) => ({ g, end: Math.max(...g.members.map((i) => endOf(strokes[i]!))) })).sort((a, b) => a.end - b.end);
    const hold = o.delay + o.duration;
    times = strokes.map((s, i) => {
      let shift = 0;
      for (const { g, end } of ends) if (!g.members.includes(i) && s.start >= end - 1e-9) shift += hold;
      return { start: s.start + shift, duration: s.duration };
    });
  }
  const starts = annotationStarts(times, groups, o);
  const marksEnd = starts.reduce((m, t) => Math.max(m, t + o.duration), 0);
  const end = Math.max(
    marksEnd,
    times.reduce((m, s) => Math.max(m, endOf(s)), 0),
  );
  return { strokes: times, duration: end + tail };
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

type Random = () => number;
const signed = (random: Random) => random() * 2 - 1;

/** Points into a path, `t` by the distance along it. */
function toPath(pts: { x: number; y: number; width: number }[]): StrokePath {
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  const total = along[along.length - 1]! || 1;
  return new StrokePath(pts.map((p, i): PathPoint => ({ ...p, t: along[i]! / total })));
}

/** A pen's width along a mark, `t` 0–1: it presses in, and lifts off a little thinner. */
const pressure = (t: number) => 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.9)) ** 0.6;

/**
 * A line drawn by hand from (x0, y0) to (x1, y1): bowed a little, wavering,
 * pressed in and lifted off. `rough` (0–1) is how loosely.
 */
export function handLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  rough: number,
  random: Random,
  even = false,
): StrokePath {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const nx = len > 0 ? -(y1 - y0) / len : 0;
  const ny = len > 0 ? (x1 - x0) / len : 1;
  const bow = rough * len * 0.025 * signed(random);
  const waver = rough * width * 0.5;
  const f1 = 2 + random() * 3;
  const p1 = random() * Math.PI * 2;
  const n = Math.max(8, Math.min(48, Math.round(len / (width * 1.5))));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = bow * Math.sin(Math.PI * t) + waver * Math.sin(f1 * Math.PI * t + p1);
    pts.push({ x: x0 + (x1 - x0) * t + nx * off, y: y0 + (y1 - y0) * t + ny * off, width: even ? width : width * pressure(t) });
  }
  return toPath(pts);
}

/**
 * An ellipse drawn round `box` by hand, clockwise from its upper left: a
 * little lopsided, and running on past where it started, a touch wider, so
 * its ends don't meet.
 */
export function handEllipse(box: Box, width: number, rough: number, random: Random): StrokePath {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const rx = ((box.maxX - box.minX) / 2) * 1.12;
  const ry = ((box.maxY - box.minY) / 2) * 1.22;
  const start = -2.3 + 0.3 * signed(random);
  const sweep = Math.PI * 2 * (1.04 + rough * (0.06 + 0.1 * random()));
  const lopsided = rough * 0.06;
  const phase = random() * Math.PI * 2;
  const spiral = rough * 0.08;
  const n = 64;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + sweep * t;
    const k = (1 + lopsided * Math.sin(2 * a + phase)) * (1 - spiral / 2 + spiral * t);
    pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k, width: width * pressure(t) });
  }
  return toPath(pts);
}

/** A box drawn round `box` in one stroke from its upper left, clockwise, its corners a little off and its last side running past the first corner. */
export function handBox(box: Box, width: number, rough: number, random: Random, fontSize: number): StrokePath {
  const off = () => rough * 0.04 * fontSize * signed(random);
  const corners = [
    { x: box.minX + off(), y: box.minY + off() },
    { x: box.maxX + off(), y: box.minY + off() },
    { x: box.maxX + off(), y: box.maxY + off() },
    { x: box.minX + off(), y: box.maxY + off() },
  ];
  // The last side overshoots the first corner.
  const over = { x: corners[0]!.x + (0.02 + rough * 0.06) * fontSize, y: corners[0]!.y - rough * 0.05 * fontSize };
  const sides = [corners[0]!, corners[1]!, corners[2]!, corners[3]!, over];
  const pts: { x: number; y: number; width: number }[] = [];
  for (let s = 0; s < 4; s++) {
    const a = sides[s]!;
    const b = sides[s + 1]!;
    const side = handLine(a.x, a.y, b.x, b.y, width, rough * 0.6, random, true).points;
    for (let i = s === 0 ? 0 : 1; i < side.length; i++) pts.push({ x: side[i]!.x, y: side[i]!.y, width: side[i]!.width });
  }
  const path = toPath(pts);
  return path.map((p) => ({ ...p, width: width * pressure(p.t) }));
}

/** Where marks along a line sit, in ems below the baseline (negative: above). */
const UNDERLINE = 0.14;
const DOUBLE_GAP = 0.09;
const STRIKE = -0.27;
const HIGHLIGHT = -0.3;

/** A mark's strokes round or along one group, in px. */
export function markStrokes(group: StrokeGroup, o: AnnotateOptions, fontSize: number, random: Random): AnnotationStroke[] {
  const width = Math.max(0.5, lengthToPx(o.width, fontSize));
  const pad = lengthToPx(o.padding, fontSize);
  const rough = o.roughness;
  const { ink, baseline } = group;
  const over = () => (0.03 + 0.08 * random()) * rough * fontSize;
  const tilt = () => rough * 0.04 * fontSize * signed(random);
  // Lines are drawn the way the text runs.
  const along = (y: number, w: number, extra = 0, even = false) => {
    let x0 = ink.minX - pad * 0.4 - over() - extra;
    let x1 = ink.maxX + pad * 0.4 + over();
    if (group.rtl) [x0, x1] = [x1, x0];
    const dy = tilt();
    return handLine(x0, y - dy / 2, x1, y + dy / 2, w, rough, random, even);
  };
  const padded: Box = { minX: ink.minX - pad, minY: ink.minY - pad, maxX: ink.maxX + pad, maxY: ink.maxY + pad };
  switch (o.mark) {
    case 'underline':
      return [{ path: along(baseline + UNDERLINE * fontSize, width), from: 0, to: 1 }];
    case 'double': {
      const y = baseline + UNDERLINE * fontSize;
      return [
        { path: along(y, width), from: 0, to: 0.48 },
        { path: along(y + DOUBLE_GAP * fontSize, width, -0.1 * fontSize), from: 0.52, to: 1 },
      ];
    }
    case 'strike':
      return [{ path: along(baseline + STRIKE * fontSize, width), from: 0, to: 1 }];
    case 'highlight': {
      const band = 0.5 * fontSize + 2 * lengthToPx(o.width, fontSize);
      return [{ path: along(baseline + HIGHLIGHT * fontSize, band, 0, true), from: 0, to: 1 }];
    }
    case 'circle':
      return [{ path: handEllipse(padded, width, rough, random), from: 0, to: 1 }];
    case 'box':
      return [{ path: handBox(padded, width, rough, random, fontSize), from: 0, to: 1 }];
    case 'cross': {
      const j = () => rough * 0.05 * fontSize * signed(random);
      return [
        {
          path: handLine(padded.minX + j(), padded.minY + j(), padded.maxX + j(), padded.maxY + j(), width, rough, random),
          from: 0,
          to: 0.46,
        },
        {
          path: handLine(padded.maxX + j(), padded.minY + j(), padded.minX + j(), padded.maxY + j(), width, rough, random),
          from: 0.54,
          to: 1,
        },
      ];
    }
  }
}

/**
 * Every mark on the text: where its strokes go and when it's drawn, from
 * the strokes as they're placed and timed. The shapes come from each
 * group's first glyph's seed, so they're the same every frame, and at every
 * seed a little different.
 */
export function annotations(strokes: readonly AnnotatedStroke[], o: AnnotateOptions, fontSize: number): Annotation[] {
  const groups = annotatedGroups(strokes, o, fontSize);
  const starts = annotationStarts(strokes, groups, o);
  return groups.map((g, k) => ({
    start: starts[k]!,
    duration: o.duration,
    strokes: markStrokes(g, o, fontSize, seededRandom(strokes[g.members[0]!]!.seed, `annotate:${o.mark}:${k}`)),
    under: o.mark === 'highlight',
  }));
}

/** How far a mark's stroke is drawn at `time`, 0–1. */
export function markProgress(mark: Annotation, stroke: AnnotationStroke, time: number): number {
  if (time < mark.start) return 0;
  const local = mark.duration > 0 ? (time - mark.start) / mark.duration : 1;
  const span = stroke.to - stroke.from;
  const p = span > 0 ? (local - stroke.from) / span : local >= stroke.from ? 1 : 0;
  const c = Math.max(0, Math.min(1, p));
  // Quick off the mark, easing into its end.
  return 1 - (1 - c) ** 2;
}

function paintMarks(ctx: CanvasRenderingContext2D, marks: readonly Annotation[], time: number, color: string, under: boolean) {
  for (const mark of marks) {
    if (mark.under !== under) continue;
    for (const s of mark.strokes) {
      const progress = markProgress(mark, s, time);
      if (progress <= 0) continue;
      const stroke = { path: s.path, progress, state: progress >= 1 ? 'done' : 'drawing', nibs: [] } as unknown as StrokeFrame;
      paintStroke({ ctx, stroke, style: color, lineCap: under ? 'butt' : 'round' });
    }
  }
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Marks the text the way a pen marks a page: underlines it, underlines it
 * twice, strikes it out or crosses it through, draws a circle or a box round
 * it, or runs a highlighter over it — the whole text, each line or each word,
 * or just one of them. The marks are drawn once the text is written, or
 * each as soon as what it marks is (the writing waits for it). A `timing`
 * hook makes the time for them; the highlighter is an `underlay`, the
 * pen's marks an `overlay`, and `svg` draws them into an exported file.
 *
 * ```ts
 * plugins: [annotatePlugin()]                                        // underline the text once it's written
 * plugins: [annotatePlugin({ mark: 'circle', target: 'words', pick: 2 })] // circle the second word
 * ```
 */
export const annotatePlugin = createPlugin({
  name: 'annotate',
  label: 'Annotate',
  description:
    'Underlines, circles, boxes, strikes or highlights the text, a word or a line — drawn by hand after the writing, or as it goes. timing + underlay + overlay + svg.',
  params: {
    mark: {
      type: 'select',
      label: 'Mark',
      default: 'underline',
      options: [
        { value: 'underline', label: 'Underline' },
        { value: 'double', label: 'Double underline' },
        { value: 'highlight', label: 'Highlight' },
        { value: 'strike', label: 'Strike through' },
        { value: 'circle', label: 'Circle' },
        { value: 'box', label: 'Box' },
        { value: 'cross', label: 'Cross out' },
      ],
    },
    target: {
      type: 'select',
      label: 'Marks',
      default: 'text',
      options: [
        { value: 'text', label: 'The text' },
        { value: 'lines', label: 'Each line' },
        { value: 'words', label: 'Each word' },
      ],
    },
    pick: {
      type: 'number',
      label: 'Which',
      description: '0 marks every one; 1 just the first, 2 the second…',
      default: 0,
      min: 0,
      max: 40,
      step: 1,
    },
    when: {
      type: 'select',
      label: 'When',
      default: 'after',
      options: [
        { value: 'after', label: 'After the writing' },
        { value: 'each', label: 'As each is written' },
      ],
    },
    color: { type: 'color', label: 'Color', default: '#e5484d' },
    width: {
      type: 'length',
      label: 'Width',
      description: "The pen's width: in em, or px as '3px'.",
      default: 0.045,
      min: 0.01,
      max: 0.15,
      step: 0.005,
    },
    padding: {
      type: 'length',
      label: 'Padding',
      description: "How far off the ink: in em, or px as '10px'.",
      default: 0.12,
      min: 0,
      max: 0.6,
      step: 0.01,
    },
    roughness: { type: 'number', label: 'Roughness', description: 'How loosely the hand draws.', default: 0.5, min: 0, max: 1, step: 0.05 },
    duration: { type: 'number', label: 'Duration', description: 'Seconds each mark takes.', default: 0.5, min: 0.05, max: 3, step: 0.05 },
    delay: { type: 'number', label: 'Delay', description: 'Seconds before each mark.', default: 0.25, min: 0, max: 3, step: 0.05 },
  },
  presets: {
    Highlighter: { mark: 'highlight', target: 'lines', color: '#ffd400' },
    'Circle a word': { mark: 'circle', target: 'words', pick: 1 },
    'Words, as written': { mark: 'underline', target: 'words', when: 'each', duration: 0.3, delay: 0.1 },
    'Cross out': { mark: 'cross', color: '#e5484d', roughness: 0.7 },
  },
  setup: (options) => {
    // The marks for a list of strokes, kept while they're placed and timed the same (a frame's strokes are new objects every frame).
    let memo: { path: StrokePath | undefined; key: string; fontSize: number; marks: Annotation[] } | null = null;
    const marksFor = (strokes: readonly AnnotatedStroke[], fontSize: number) => {
      const last = strokes[strokes.length - 1];
      const key = `${strokes.length}|${last?.start}|${last?.duration}|${strokes[0]?.start}`;
      if (memo && memo.path === strokes[0]?.path && memo.key === key && memo.fontSize === fontSize) return memo.marks;
      const marks = strokes.length > 0 ? annotations(strokes, options, fontSize) : [];
      memo = { path: strokes[0]?.path, key, fontSize, marks };
      return marks;
    };
    return {
      timing({ strokes, duration, fontSize }) {
        const groups = annotatedGroups(strokes, options, fontSize);
        if (groups.length === 0) return undefined;
        return annotateTiming(strokes, groups, duration, options);
      },
      bounds: ({ strokes, fontSize }) => {
        const marks = marksFor(strokes, fontSize);
        return unionBoxes(marks.flatMap((m) => m.strokes.map((s) => s.path.bounds())));
      },
      underlay({ ctx, frame, fontSize }) {
        if (options.mark !== 'highlight') return;
        ctx.globalAlpha = HIGHLIGHT_ALPHA;
        ctx.globalCompositeOperation = 'multiply';
        paintMarks(ctx, marksFor(frame.strokes, fontSize), frame.time, options.color, true);
      },
      overlay({ ctx, frame, fontSize }) {
        if (options.mark === 'highlight') return;
        paintMarks(ctx, marksFor(frame.strokes, fontSize), frame.time, options.color, false);
      },
      svg({ strokes, fontSize, mode, underlay, overlay, appear, seconds }) {
        const marks = marksFor(strokes, fontSize);
        const under = options.mark === 'highlight';
        const out: string[] = [];
        for (const mark of marks) {
          for (const s of mark.strokes) {
            const pts = s.path.points;
            if (pts.length < 2) continue;
            const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${fmt(p.x)} ${fmt(p.y)}`).join(' ');
            const w = pts.reduce((sum, p) => sum + p.width, 0) / pts.length;
            const start = mark.start + mark.duration * s.from;
            const length = mark.duration * (s.to - s.from);
            const line = `d="${d}" fill="none" stroke="${options.color}" stroke-width="${fmt(w)}" stroke-linecap="${under ? 'butt' : 'round'}" stroke-linejoin="round"`;
            if (mode === 'once') {
              // Drawn on: its dash slides in over the stroke's time, hidden until then.
              out.push(
                `<path ${line} pathLength="1" stroke-dasharray="1 2" stroke-dashoffset="1" opacity="0">` +
                  `<set attributeName="opacity" to="1" begin="${fmt(seconds(start))}s" />` +
                  `<animate attributeName="stroke-dashoffset" values="1;0" begin="${fmt(seconds(start))}s" dur="${fmt(Math.max(0.01, seconds(start + length) - seconds(start)))}s" fill="freeze" /></path>`,
              );
            } else {
              const shown = appear(start);
              out.push(`<g${shown.attrs}><path ${line} />${shown.inner}</g>`);
            }
          }
        }
        if (out.length === 0) return;
        if (under) underlay(`<g opacity="${HIGHLIGHT_ALPHA}" style="mix-blend-mode: multiply">${out.join('')}</g>`);
        else overlay(`<g>${out.join('')}</g>`);
      },
    };
  },
});
