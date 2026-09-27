import { describe, expect, test } from 'bun:test';
import type { TegakiBundle } from 'tegaki';
import type { TimelineEntry } from 'tegaki/core';
import { graphemeProgress } from './progress-font.ts';

const glyphData: TegakiBundle['glyphData'] = {
  a: { w: 500, t: 1, s: [{ p: [[0, 0, 10]], d: 0, a: 1 }] },
  b: { w: 500, t: 2, s: [{ p: [[0, 0, 10]], d: 0, a: 2 }] },
};
const entry = (
  char: string,
  graphemeIndex: number,
  offset: number,
  duration: number,
  extra: Partial<TimelineEntry> = {},
): TimelineEntry => ({
  char,
  graphemeIndex,
  offset,
  duration,
  hasGlyph: true,
  ...extra,
});

const round = (xs: number[]) => xs.map((x) => Math.round(x * 1000) / 1000);

describe('graphemeProgress', () => {
  test('each glyph is as far into its own drawing as the timeline has it', () => {
    const entries = [entry('a', 0, 0, 1), entry(' ', 1, 1, 0.2, { hasGlyph: false }), entry('b', 2, 1.2, 2)];
    expect(round(graphemeProgress(entries, 3, glyphData, 0.5))).toEqual([50, 100, 0]);
    expect(round(graphemeProgress(entries, 3, glyphData, 2.2))).toEqual([100, 100, 50]);
    expect(round(graphemeProgress(entries, 3, glyphData, 9))).toEqual([100, 100, 100]);
  });

  test('a staggered slot runs the glyph at its scale', () => {
    const entries = [entry('b', 0, 0, 1, { strokeTimeScale: 0.5 })];
    expect(round(graphemeProgress(entries, 1, glyphData, 0.25))).toEqual([25]);
  });

  test('glyph easing warps the slot as the renderer does', () => {
    const entries = [entry('a', 0, 0, 1)];
    expect(round(graphemeProgress(entries, 1, glyphData, 0.5, (t) => t * t))).toEqual([25]);
  });

  test('characters the font has no glyph for are drawn whole', () => {
    expect(round(graphemeProgress([entry('z', 0, 0, 1)], 1, glyphData, 0))).toEqual([100]);
  });
});
