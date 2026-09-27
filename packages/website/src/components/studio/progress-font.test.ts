import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { TegakiBundle, TegakiGlyphData } from 'tegaki';
import type { TimelineEntry } from 'tegaki/core';
import { type ProgressSpan, progressFeatureSettings, progressFontDownload, progressSpans, studioProgressFonts } from './progress-font.ts';

const glyphData: TegakiBundle['glyphData'] = {
  a: { w: 500, t: 1, s: [{ p: [[0, 0, 10]], d: 0, a: 1 }] },
  b: { w: 500, t: 2, s: [{ p: [[0, 0, 10]], d: 0, a: 2 }] },
};
const glyphDataById: TegakiBundle['glyphDataById'] = {
  '7': { w: 800, t: 4, s: [{ p: [[0, 0, 10]], d: 0, a: 4 }] },
};
const bundle = { glyphData, glyphDataById };
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

const round = (spans: ProgressSpan[]) => spans.map((s) => [s.start, s.end, Math.round(s.progress * 1000) / 1000]);

describe('progressSpans', () => {
  test('each glyph is as far into its own drawing as the timeline has it', () => {
    const entries = [entry('a', 0, 0, 1), entry(' ', 1, 1, 0.2, { hasGlyph: false }), entry('b', 2, 1.2, 2)];
    const at = (time: number) => round(progressSpans(entries, 3, bundle, time)).map(([, , p]) => p);
    expect(at(0.5)).toEqual([50, 100, 0]);
    expect(at(2.2)).toEqual([100, 100, 50]);
    expect(at(9)).toEqual([100, 100, 100]);
  });

  test('a ligature is one span, timed as the glyph the shaper drew', () => {
    // "fab": "fa" shaped into glyph 7, whose entry sits on its first grapheme.
    const entries = [entry('f', 0, 0, 4, { glyphId: '7' }), entry('b', 2, 4, 2)];
    expect(round(progressSpans(entries, 3, bundle, 1))).toEqual([
      [0, 2, 25],
      [2, 3, 0],
    ]);
  });

  test('glyphs sharing a cluster write together over its time', () => {
    const entries = [entry('a', 0, 0, 1), entry('a', 0, 1, 2)];
    expect(round(progressSpans(entries, 1, bundle, 1.5))).toEqual([[0, 1, 50]]);
  });

  test('text before the first drawn glyph is a written span of its own', () => {
    expect(round(progressSpans([entry('a', 1, 0, 1)], 2, bundle, 0.5))).toEqual([
      [0, 1, 100],
      [1, 2, 50],
    ]);
  });

  test('a staggered slot runs the glyph at its scale', () => {
    const entries = [entry('b', 0, 0, 1, { strokeTimeScale: 0.5 })];
    expect(round(progressSpans(entries, 1, bundle, 0.25))).toEqual([[0, 1, 25]]);
  });

  test('glyph easing warps the slot as the renderer does', () => {
    expect(round(progressSpans([entry('a', 0, 0, 1)], 1, bundle, 0.5, (t) => t * t))).toEqual([[0, 1, 25]]);
  });

  test('characters the font has no glyph for, and text with no time, are drawn whole', () => {
    expect(round(progressSpans([entry('z', 0, 0, 1)], 1, bundle, 0))).toEqual([[0, 1, 100]]);
    expect(round(progressSpans([entry('a', 0, 0, 1)], 1, bundle, null))).toEqual([[0, 1, 100]]);
  });
});

describe('studioProgressFonts', () => {
  const fonts = new URL('../../../../renderer/fonts/', import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, fonts));
  const bytes = (path: string) => new Uint8Array(read(path)).buffer;
  const json = (path: string) => JSON.parse(read(path).toString('utf8')) as Record<string, TegakiGlyphData>;
  const caveat = json('caveat/glyphData.json');
  const amiri = json('amiri/glyphData.json');
  const amiriById = json('amiri/glyphDataById.json');
  // A bundle split like the studio's Fontsource subsets: Latin first, Arabic in an extra file.
  const split = {
    family: 'Split',
    unitsPerEm: 1000,
    ascender: 900,
    descender: -300,
    glyphData: { a: caveat.a!, ب: amiri.ب! },
    glyphDataById: Object.fromEntries(Object.entries(amiriById).map(([gid, g]) => [`1:${gid}`, g])),
    extraFontUrls: ['arabic.ttf'],
    extraFontRanges: ['U+0600-06FF'],
  } as unknown as TegakiBundle;

  test('makes a file per font file, each character in the first that maps it', () => {
    const files = studioProgressFonts(split, null, undefined, [bytes('caveat/caveat-3dc76002.ttf'), bytes('amiri/amiri-7df37680.ttf')]);
    expect(files.map((f) => [f.subset, f.unicodeRange])).toEqual([
      [0, undefined],
      [1, 'U+0600-06FF'],
    ]);
    expect(files[0]!.font.chars).toEqual(['a']);
    expect(files[1]!.font.chars).toContain('ب');
    // The Arabic file keeps its positional forms, from its own `1:` glyph ids.
    expect(files[1]!.font.glyphs).toBeGreaterThan(files[1]!.font.chars.length);
    expect(files[1]!.font.layout).toContain('GSUB');
  });

  test('an unreadable subset leaves its characters to the primary file, unshaped', () => {
    const files = studioProgressFonts(split, null, undefined, [bytes('caveat/caveat-3dc76002.ttf'), undefined]);
    expect(files.map((f) => [f.subset, f.font.chars])).toEqual([[0, ['a', 'ب']]]);
  });

  test('downloads one font as a .ttf, several as a .zip', () => {
    const one = studioProgressFonts(split, null, undefined, [bytes('caveat/caveat-3dc76002.ttf'), undefined]);
    expect(progressFontDownload(split, one).name).toBe('split-progress.ttf');
    const two = studioProgressFonts(split, null, undefined, [bytes('caveat/caveat-3dc76002.ttf'), bytes('amiri/amiri-7df37680.ttf')]);
    expect(progressFontDownload(split, two).name).toBe('split-progress.zip');
  });
});

describe('progressFeatureSettings', () => {
  test('keeps the bundle’s features, leaving the positional ones to the browser', () => {
    expect(progressFeatureSettings(['calt', 'liga', 'fina'], true, false)).toBe("'calt' 1, 'liga' 1");
    expect(progressFeatureSettings(['init', 'fina'], true, false)).toBe('normal');
  });

  test('switches off what the renderer does: variants unshaped, ligatures and alternates when spaced', () => {
    expect(progressFeatureSettings(['calt'], false, false)).toContain("'fina' 0");
    expect(progressFeatureSettings(['calt'], true, true)).toBe("'calt' 1, 'liga' 0, 'clig' 0, 'dlig' 0, 'hlig' 0, 'calt' 0");
  });
});
