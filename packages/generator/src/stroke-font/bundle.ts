// A stroke font as a Tegaki bundle. Its strokes become the glyph data as they
// are — no extraction, in the font's own pen order — timed like the
// pipeline's strokes (length at the drawing speed, a pause between). The
// renderer still wants a font file: it lays the text out, clips to it and
// keeps it selectable through the browser's rendering of it. So one is made:
// each glyph's outline is its strokes drawn with the pen, at the stroke
// font's advance widths, and everything the renderer does with a font works
// on it unchanged.

import * as opentype from 'opentype.js';
import type { TegakiGlyphData } from 'tegaki';
import type { Point } from 'tegaki/internal';
import { type BundleFile, generateGlyphsModule, type ParsedFontInfo, parseFont } from '../commands/generate.ts';
import { DRAWING_SPEED, STROKE_PAUSE } from '../constants.ts';
import type { StrokeFont, StrokeFontOptions } from './types.ts';

/** A pen a little under a Hershey stroke's weight at text sizes. */
export const DEFAULT_STROKE_FONT_OPTIONS: StrokeFontOptions = { penWidth: 0.06, drawingSpeed: DRAWING_SPEED, strokePause: STROKE_PAUSE };

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return len;
}

/** The characters a stroke font draws, `chars` narrowed to them (every glyph but the space when unset). */
export function strokeFontChars(font: StrokeFont, chars?: string): string[] {
  const all = Object.keys(font.glyphs).filter((c) => !/\s/u.test(c));
  if (chars === undefined) return all;
  const wanted = new Set([...chars.normalize('NFC')]);
  return all.filter((c) => wanted.has(c));
}

/** The glyph data of a stroke font's characters (`chars`, default all): its strokes timed, with the pen's width at every point. */
export function strokeFontGlyphData(
  font: StrokeFont,
  options: Partial<StrokeFontOptions> = {},
  chars?: string,
): Record<string, TegakiGlyphData> {
  const { penWidth, drawingSpeed, strokePause } = { ...DEFAULT_STROKE_FONT_OPTIONS, ...options };
  const pen = round2(penWidth * font.unitsPerEm);
  const out: Record<string, TegakiGlyphData> = {};
  for (const char of strokeFontChars(font, chars)) {
    const glyph = font.glyphs[char]!;
    let time = 0;
    const s = glyph.strokes.map((points, i) => {
      const a = Math.max(round3(polylineLength(points) / drawingSpeed), 0.001);
      const d = round3(time);
      time += a + (i < glyph.strokes.length - 1 ? strokePause : 0);
      return { p: points.map((p) => [round2(p.x), round2(p.y), pen] as [number, number, number]), d, a };
    });
    out[char] = { w: round2(glyph.advance), t: round3(time), s };
  }
  return out;
}

/** Ramer–Douglas–Peucker: the outline needn't follow a stroke closer than a fraction of the pen. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const pa = points[a]!;
    const pb = points[b]!;
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    let worst = -1;
    let worstD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const p = points[i]!;
      const d = len > 0 ? Math.abs((pb.x - pa.x) * (pa.y - p.y) - (pa.x - p.x) * (pb.y - pa.y)) / len : Math.hypot(p.x - pa.x, p.y - pa.y);
      if (d > worstD) {
        worst = i;
        worstD = d;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Cubic handle length for a quarter circle, as a fraction of its radius. */
const KAPPA = 0.5523;

type Vec = { x: number; y: number };
const add = (...vs: Vec[]): Vec => ({ x: vs.reduce((s, v) => s + v.x, 0), y: vs.reduce((s, v) => s + v.y, 0) });
const mul = (v: Vec, k: number): Vec => ({ x: v.x * k, y: v.y * k });

/** A quarter circle about `c` from `c + u` to `c + v` (|u| = |v|, u ⊥ v). */
function quarter(path: opentype.Path, c: Vec, u: Vec, v: Vec) {
  const c1 = add(c, u, mul(v, KAPPA));
  const c2 = add(c, v, mul(u, KAPPA));
  const end = add(c, v);
  path.curveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
}

/**
 * The pen's mark along one segment — a capsule — or at a point, a disc; y up.
 * Every one winds the same way, so overlapping marks fill as one under the
 * nonzero rule.
 */
function penMark(path: opentype.Path, a: Vec, b: Vec, r: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const t = len > 0 ? { x: ((b.x - a.x) / len) * r, y: ((b.y - a.y) / len) * r } : { x: r, y: 0 };
  const n = { x: -t.y, y: t.x };
  const neg = (v: Vec) => mul(v, -1);
  const start = add(a, n);
  path.moveTo(start.x, start.y);
  if (len > 0) {
    const bn = add(b, n);
    path.lineTo(bn.x, bn.y);
  }
  quarter(path, b, n, t);
  quarter(path, b, t, neg(n));
  if (len > 0) {
    const an = add(a, neg(n));
    path.lineTo(an.x, an.y);
  }
  quarter(path, a, neg(n), neg(t));
  quarter(path, a, neg(t), n);
  path.close();
}

/**
 * The line metrics a stroke font is laid out with: its own, stretched to hold
 * the ink the pen lays down — an SVG font's declared descent is often shallower
 * than its script descenders. The synthesized font and the bundle both take
 * these, since the renderer places strokes by the bundle's and the text layer
 * by the font's.
 */
export function strokeFontMetrics(font: StrokeFont, penWidth: number): { ascender: number; descender: number } {
  const r = (penWidth * font.unitsPerEm) / 2;
  let top = font.ascender;
  let bottom = -font.descender;
  for (const glyph of Object.values(font.glyphs)) {
    for (const p of glyph.strokes.flat()) {
      top = Math.max(top, -p.y + r);
      bottom = Math.max(bottom, p.y + r);
    }
  }
  return { ascender: Math.ceil(top), descender: -Math.ceil(bottom) };
}

/**
 * A font file for a stroke font: each glyph's outline its strokes as the pen
 * draws them (`penWidth`, a fraction of the em), at the font's advances and
 * metrics. Includes the space, and every other glyph when `chars` is unset.
 */
export function synthesizeStrokeFontFile(font: StrokeFont, penWidth: number, chars?: string): ArrayBuffer {
  const r = (penWidth * font.unitsPerEm) / 2;
  const glyphs = [
    new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: Math.round(font.unitsPerEm / 2), path: new opentype.Path() }),
  ];
  const space = font.glyphs[' ']?.advance ?? font.unitsPerEm * 0.3;
  glyphs.push(new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: Math.round(space), path: new opentype.Path() }));
  for (const char of strokeFontChars(font, chars)) {
    const glyph = font.glyphs[char]!;
    const path = new opentype.Path();
    for (const stroke of glyph.strokes) {
      const pts = simplify(stroke, r * 0.2).map((p) => ({ x: p.x, y: -p.y }));
      if (pts.length === 1) penMark(path, pts[0]!, pts[0]!, r);
      for (let i = 1; i < pts.length; i++) penMark(path, pts[i - 1]!, pts[i]!, r);
    }
    const cp = char.codePointAt(0)!;
    glyphs.push(
      new opentype.Glyph({
        name: `uni${cp.toString(16).toUpperCase().padStart(4, '0')}`,
        unicode: cp,
        advanceWidth: Math.round(glyph.advance),
        path,
      }),
    );
  }
  return new opentype.Font({
    familyName: font.family,
    styleName: 'Regular',
    unitsPerEm: font.unitsPerEm,
    ...strokeFontMetrics(font, penWidth),
    glyphs,
  }).toArrayBuffer();
}

/** What a parsed stroke font carries besides its synthesized font: its strokes, drawn as `options` say. */
export interface StrokeFontInfo {
  font: StrokeFont;
  options: StrokeFontOptions;
  glyphData: Record<string, TegakiGlyphData>;
}

/**
 * A stroke font as the rest of the generator takes a font: the synthesized
 * font file parsed (so character coverage, metrics and the text layer work as
 * for any font), with `stroke` holding the glyph data to draw it with.
 */
export async function parseStrokeFont(
  font: StrokeFont,
  options: Partial<StrokeFontOptions> = {},
): Promise<{ info: ParsedFontInfo; buffer: ArrayBuffer }> {
  const resolved = { ...DEFAULT_STROKE_FONT_OPTIONS, ...options };
  const buffer = synthesizeStrokeFontFile(font, resolved.penWidth);
  const info = await parseFont(buffer, undefined, font.family);
  return {
    info: {
      ...info,
      family: font.family,
      lineCap: 'round',
      stroke: { font, options: resolved, glyphData: strokeFontGlyphData(font, resolved) },
    },
    buffer,
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'stroke-font';

/** A short hash, so bundles of one stroke font drawn differently don't share a family name. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36).slice(0, 6);
}

/**
 * The files of a stroke font's bundle (`chars`, default every glyph): the
 * synthesized font, the glyph data, `bundle.ts` like any generated bundle,
 * and the font's credits and license as `LICENSE.txt` when it has them.
 */
export function strokeFontBundle(
  font: StrokeFont,
  options: Partial<StrokeFontOptions> = {},
  chars?: string,
): { files: BundleFile[]; family: string; glyphCount: number } {
  const resolved = { ...DEFAULT_STROKE_FONT_OPTIONS, ...options };
  const glyphData = strokeFontGlyphData(font, resolved, chars);
  const fontFileName = `${slug(font.family)}.otf`;
  const family = `${font.family} Tegaki ${hash(`${Object.keys(glyphData).join('')}:${resolved.penWidth}`)}`;
  const files: BundleFile[] = [
    { path: fontFileName, content: new Uint8Array(synthesizeStrokeFontFile(font, resolved.penWidth, chars)) },
    { path: 'glyphData.json', content: JSON.stringify(glyphData) },
    {
      path: 'bundle.ts',
      content: generateGlyphsModule({
        fontFileName,
        fontFamily: family,
        fullFamily: undefined,
        fullFontFileName: undefined,
        extraFonts: [],
        lineCap: 'round',
        unitsPerEm: font.unitsPerEm,
        ...strokeFontMetrics(font, resolved.penWidth),
        hasVariants: false,
        features: undefined,
      }),
    },
  ];
  if (font.license) files.push({ path: 'LICENSE.txt', content: `${font.family}\n\n${font.license}\n` });
  return { files, family, glyphCount: Object.keys(glyphData).length };
}
