import { describe, expect, test } from 'bun:test';
import type { TegakiBundle, TegakiGlyphData } from '../types.ts';
import { drawGlyph } from './drawGlyph.ts';
import type { ResolvedEffect } from './effects.ts';
import { subdivideStroke } from './strokeCache.ts';
import { sampleFrame, sampleStroke, strokeHead, strokeInstances } from './strokeTimeline.ts';
import { computeTimeline } from './timeline.ts';

type Pt = [number, number, number];
const linear = (t: number) => t;

// A 1s horizontal stroke then a 0.5s vertical one, 100 font units each.
const two: TegakiGlyphData = {
  w: 100,
  t: 1.5,
  s: [
    {
      p: [
        [0, 0, 10],
        [100, 0, 10],
      ] as Pt[],
      d: 0,
      a: 1,
    },
    {
      p: [
        [50, 0, 10],
        [50, 100, 10],
      ] as Pt[],
      d: 1,
      a: 0.5,
    },
  ],
};
const dot: TegakiGlyphData = { w: 20, t: 0.2, s: [{ p: [[10, 10, 8]] as Pt[], d: 0, a: 0.2 }] };

function makeBundle(glyphData: Record<string, TegakiGlyphData>): TegakiBundle {
  return { family: 'test', lineCap: 'round', fontUrl: '', fontFaceCSS: '', unitsPerEm: 100, ascender: 0, descender: 0, glyphData };
}

const bundle = makeBundle({ a: two, i: dot });
const place = { x: 0, y: 0, scale: 1, ascender: 0, seed: 0 };

describe('strokeInstances', () => {
  const timeline = computeTimeline('a a', bundle, { glyphGap: 0.1, wordGap: 0.2 });
  const strokes = strokeInstances(timeline, bundle);

  test('one instance per stroke of each drawn glyph, in drawing order', () => {
    expect(strokes.map((s) => s.id)).toEqual(['0:0', '0:1', '2:0', '2:1']);
  });

  test('a stroke starts at its glyph offset plus its bundled delay', () => {
    const second = timeline.entries[2]!.offset;
    expect(strokes.map((s) => [s.start, s.duration])).toEqual([
      [0, 1],
      [1, 0.5],
      [second, 1],
      [second + 1, 0.5],
    ]);
  });

  test('characters without strokes have no instances', () => {
    const tl = computeTimeline('a?\nb', bundle);
    expect(strokeInstances(tl, bundle).every((s) => s.entry.char === 'a')).toBe(true);
  });

  test('stagger with a fixed duration scales each stroke with its glyph', () => {
    const tl = computeTimeline('a', bundle, { stagger: { advance: 0, duration: 3 } });
    expect(strokeInstances(tl, bundle).map((s) => [s.start, s.duration])).toEqual([
      [0, 2],
      [2, 1],
    ]);
  });

  test('a deferred stroke starts where the scheduler moved it', () => {
    const marked: TegakiGlyphData = { ...two, s: [two.s[0]!, { ...two.s[1]!, r: -1 }] };
    const b = makeBundle({ a: marked });
    const tl = computeTimeline('aa', b, { glyphGap: 0.1 });
    const [, mark1, , mark2] = strokeInstances(tl, b);
    // Both bodies (1s each) draw first, 0.1s apart; the marks follow a gap later, a gap apart.
    expect(mark1!.start).toBeCloseTo(2.2, 6);
    expect(mark2!.start).toBeCloseTo(2.8, 6);
  });
});

describe('sampleStroke', () => {
  const timeline = computeTimeline('a', bundle);
  const [first, second] = strokeInstances(timeline, bundle);

  test('pending before its start, drawing inside its window, done at its end', () => {
    expect(sampleStroke(second!, 0.5).state).toBe('pending');
    expect(sampleStroke(second!, 1.25, { strokeEasing: linear })).toEqual({ state: 'drawing', linear: 0.5, progress: 0.5 });
    expect(sampleStroke(second!, 1.5).state).toBe('done');
  });

  test('a stroke with no delay is pending until its glyph starts', () => {
    const tl = computeTimeline('aa', bundle);
    const later = strokeInstances(tl, bundle)[2]!;
    expect(sampleStroke(later, later.start - 0.01).state).toBe('pending');
  });

  test('progress takes the stroke easing', () => {
    expect(sampleStroke(first!, 0.5, { strokeEasing: (t) => t * t }).progress).toBeCloseTo(0.25, 6);
    // Default: ease-out quad.
    expect(sampleStroke(first!, 0.5).progress).toBeCloseTo(0.75, 6);
  });

  test('glyph easing warps the whole slot before stroke timing reads it', () => {
    // u² over the 1.5s slot: at 0.75s the glyph is at 0.375s — a stroke 3/8 in.
    const s = sampleStroke(first!, 0.75, { strokeEasing: linear, glyphEasing: (u) => u * u });
    expect(s.progress).toBeCloseTo(0.375, 6);
  });

  test('a stroke ending a hair past its slot (float error) still finishes', () => {
    // 1.194 + 0.299 − 1.194 = 0.29899999999999993: the slot ends just short of the stroke.
    const g: TegakiGlyphData = { w: 100, t: 0.299, s: [{ ...two.s[0]!, a: 0.299 }] };
    const entry = { char: 'a', graphemeIndex: 0, hasGlyph: true, offset: 1.194, duration: 1.194 + 0.299 - 1.194 };
    const instance = strokeInstances({ entries: [entry], totalDuration: 1.493 }, makeBundle({ a: g }))[0]!;
    expect(entry.duration).toBeLessThan(0.299);
    expect(sampleStroke(instance, 99)).toEqual({ state: 'done', linear: 1, progress: 1 });
  });

  test('easings that overshoot are clamped to the stroke', () => {
    expect(sampleStroke(first!, 0.9, { strokeEasing: (t) => t * 1.5 }).progress).toBe(1);
  });
});

describe('strokeHead', () => {
  const sub = subdivideStroke(two.s[0]!, Infinity);
  const noFx = { wobbleDx: () => 0, wobbleDy: () => 0, pressure: 0, taper: () => 1, needsPerSegment: false };

  test('sits where the ink ends, heading along the stroke', () => {
    const head = strokeHead(two.s[0]!, sub, 0.5, { x: 10, y: 20, scale: 2, ascender: 0 }, noFx)!;
    expect(head.x).toBeCloseTo(110, 6);
    expect(head.y).toBeCloseTo(20, 6);
    expect(head.angle).toBeCloseTo(0, 6);
    expect(head.width).toBeCloseTo(20, 6);
  });

  test('a downward stroke heads down (y grows downward)', () => {
    const head = strokeHead(two.s[1]!, subdivideStroke(two.s[1]!, Infinity), 1, place, noFx)!;
    expect(head.angle).toBeCloseTo(Math.PI / 2, 6);
    expect(head.y).toBeCloseTo(100, 6);
  });

  test('a finished stroke keeps the direction of its last segment', () => {
    const head = strokeHead(two.s[0]!, sub, 1, place, noFx)!;
    expect(head.x).toBeCloseTo(100, 6);
    expect(head.angle).toBeCloseTo(0, 6);
  });

  test('taper thins the pen as it nears the end', () => {
    const head = strokeHead(two.s[0]!, sub, 0.9, place, { ...noFx, needsPerSegment: true, taper: (p) => 1 - p })!;
    expect(head.width).toBeCloseTo(1, 6);
  });

  test('a dot is its own head', () => {
    const head = strokeHead(dot.s[0]!, subdivideStroke(dot.s[0]!, Infinity), 1, place, noFx)!;
    expect([head.x, head.y, head.angle, head.width]).toEqual([10, 10, 0, 8]);
  });
});

describe('sampleFrame', () => {
  const timeline = computeTimeline('ai', bundle, { glyphGap: 0 });
  const strokes = strokeInstances(timeline, bundle);

  test('pending strokes have no head; the active list holds the strokes being drawn', () => {
    const frame = sampleFrame(strokes, 1.25, { timing: { strokeEasing: linear }, placeEntry: () => place });
    expect(frame.strokes.map((s) => s.state)).toEqual(['done', 'drawing', 'pending']);
    expect(frame.strokes[2]!.head).toBeNull();
    expect(frame.active.map((s) => s.id)).toEqual(['0:1']);
    expect(frame.active[0]!.head.y).toBeCloseTo(50, 6);
  });

  test('strokes of glyphs the layout does not place are left out', () => {
    const frame = sampleFrame(strokes, 10, { placeEntry: (ei) => (ei === 0 ? place : null) });
    expect(frame.strokes.map((s) => s.entry.char)).toEqual(['a', 'a']);
  });

  test('the head is where the canvas ends the ink, wobble included', () => {
    const wobble: ResolvedEffect[] = [{ effect: 'wobble', order: 0, config: { amplitude: 4 } }];
    const at = { x: 30, y: 40, scale: 1.5, ascender: 0, seed: 7 };
    const frame = sampleFrame(strokes, 0.4, { timing: { strokeEasing: linear }, effects: wobble, placeEntry: () => at });
    const head = frame.active[0]!.head;

    // A 2D context stub that keeps the last point the ink was drawn to.
    let last: [number, number] = [NaN, NaN];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => {
        if (key === 'lineTo') return (x: number, y: number) => (last = [x, y]);
        return target[key as string] ?? (() => {});
      },
      set: (target, key, value) => {
        target[key as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const pos = { x: at.x, y: at.y, fontSize: 150, unitsPerEm: 100, ascender: 0, descender: 0 };
    drawGlyph(ctx, two, pos, 0.4, 'round', '#000', wobble, at.seed, undefined, linear);
    expect(head.x).toBeCloseTo(last[0], 6);
    expect(head.y).toBeCloseTo(last[1], 6);
  });
});
