import { describe, expect, test } from 'bun:test';
import { seededRandom } from '../lib/random.ts';
import {
  type AnnotateOptions,
  annotatedGroups,
  annotatePlugin,
  annotateTiming,
  annotations,
  handEllipse,
  handLine,
  markProgress,
} from './annotate.ts';
import { EM, strokesOf } from './testStrokes.ts';

const defaults: AnnotateOptions = annotatePlugin.defaults;
const endOf = (s: { start: number; duration: number }) => s.start + s.duration;

describe('annotate: what gets marked', () => {
  test('an underline of the whole text is a mark per line', () => {
    expect(annotatedGroups(strokesOf('ab\ncd'), defaults, EM)).toHaveLength(2);
  });

  test('a circle round the whole text is one, across its lines', () => {
    expect(annotatedGroups(strokesOf('ab\ncd'), { ...defaults, mark: 'circle' }, EM)).toHaveLength(1);
  });

  test('pick marks just the one asked for, and nothing past the last', () => {
    const strokes = strokesOf('ab cd ef');
    const [second] = annotatedGroups(strokes, { ...defaults, target: 'words', pick: 2 }, EM);
    expect(second!.glyphs).toEqual([3, 4]);
    expect(annotatedGroups(strokes, { ...defaults, target: 'words', pick: 9 }, EM)).toHaveLength(0);
  });
});

describe('annotate: when', () => {
  test('after the writing, the strokes keep their times and the timeline runs on for the marks, one after another', () => {
    const strokes = strokesOf('ab cd');
    const o = { ...defaults, target: 'words' as const };
    const groups = annotatedGroups(strokes, o, EM);
    const out = annotateTiming(strokes, groups, 1, o);
    expect(out.strokes).toEqual(strokes.map((s) => ({ start: s.start, duration: s.duration })));
    // Written by 0.8 (with a pause after to 1): two marks, each after the delay, a gap between.
    expect(out.duration).toBeCloseTo(0.8 + o.delay + 2 * o.duration + 0.08 + 0.2);
    const marks = annotations(strokes, o, EM);
    expect(marks[0]!.start).toBeCloseTo(0.8 + o.delay);
    expect(marks[1]!.start).toBeGreaterThan(marks[0]!.start + o.duration);
  });

  test('as each is written, the writing waits for each mark, and the mark follows its word', () => {
    const strokes = strokesOf('ab cd');
    const o = { ...defaults, target: 'words' as const, when: 'each' as const };
    const groups = annotatedGroups(strokes, o, EM);
    const out = annotateTiming(strokes, groups, 0.8, o);
    const retimed = strokes.map((s, i) => ({ ...s, ...out.strokes[i]! }));
    const marks = annotations(retimed, o, EM);
    // The first word is written, then marked; the second is written after that mark.
    expect(marks[0]!.start).toBeCloseTo(endOf(retimed[1]!) + o.delay);
    expect(retimed[2]!.start).toBeGreaterThanOrEqual(marks[0]!.start + marks[0]!.duration - 1e-9);
    expect(marks[1]!.start).toBeCloseTo(endOf(retimed[3]!) + o.delay);
    expect(out.duration).toBeCloseTo(marks[1]!.start + o.duration);
  });

  test('a mark draws from nothing to whole over its time, each of its strokes in turn', () => {
    const [mark] = annotations(strokesOf('ab'), { ...defaults, mark: 'double' }, EM);
    const [first, second] = mark!.strokes;
    expect(markProgress(mark!, first!, mark!.start - 0.1)).toBe(0);
    expect(markProgress(mark!, first!, mark!.start + mark!.duration * 0.48)).toBe(1);
    expect(markProgress(mark!, second!, mark!.start + mark!.duration * 0.48)).toBe(0);
    expect(markProgress(mark!, second!, mark!.start + mark!.duration)).toBe(1);
  });
});

describe('annotate: shapes', () => {
  test('an underline runs under the ink, past both ends of it', () => {
    const [mark] = annotations(strokesOf('abc'), defaults, EM);
    const box = mark!.strokes[0]!.path.bounds()!;
    expect(box.minY).toBeGreaterThan(80);
    expect(box.minX).toBeLessThan(2);
    expect(box.maxX).toBeGreaterThan(148);
  });

  test('a circle goes round what it marks, clear of the ink', () => {
    const [mark] = annotations(strokesOf('abc'), { ...defaults, mark: 'circle' }, EM);
    const box = mark!.strokes[0]!.path.bounds()!;
    expect(box.minX).toBeLessThan(0);
    expect(box.maxX).toBeGreaterThan(150);
    expect(box.minY).toBeLessThan(37);
    expect(box.maxY).toBeGreaterThan(83);
  });

  test('a hand-drawn ellipse runs on past where it starts, so its ends overlap rather than meet', () => {
    const path = handEllipse({ minX: 0, minY: 0, maxX: 200, maxY: 60 }, 4, 0.5, seededRandom(1, 'x'));
    const a = path.pointAt(0);
    const b = path.pointAt(1);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2);
  });

  test('a ruler-straight line is straight', () => {
    const path = handLine(0, 10, 100, 10, 4, 0, seededRandom(1, 'x'));
    for (const p of path.points) expect(p.y).toBeCloseTo(10, 9);
  });

  test('the same seed draws the same marks', () => {
    const a = annotations(strokesOf('ab'), { ...defaults, mark: 'box' }, EM);
    const b = annotations(strokesOf('ab'), { ...defaults, mark: 'box' }, EM);
    expect(a[0]!.strokes[0]!.path.points).toEqual(b[0]!.strokes[0]!.path.points);
  });

  test('a highlighter goes under the ink, the pen over it', () => {
    expect(annotations(strokesOf('ab'), { ...defaults, mark: 'highlight' }, EM)[0]!.under).toBe(true);
    expect(annotations(strokesOf('ab'), defaults, EM)[0]!.under).toBe(false);
  });
});
