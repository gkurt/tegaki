// Reading stroke fonts: single-line SVG fonts (the format of Evil Mad
// Scientist's Hershey Text — the Hershey faces, the EMS fonts, Relief
// SingleLine), Hershey's own JHF files, and hand-drawn stroke-order datasets.

import type { Point } from 'tegaki/internal';
import { flattenPath } from '../processing/bezier.ts';
import { type DrawnDataset, parseDrawnDataset } from '../stroke-order/drawn.ts';
import { parseJhfGlyphs } from '../stroke-order/jhf.ts';
import { parseSvgPathData } from '../stroke-order/svg-path.ts';
import type { StrokeFont, StrokeFontGlyph } from './types.ts';

const ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(ATTRIBUTE)) out[m[1]!] = decodeEntities(m[2] ?? m[3] ?? '');
  return out;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const cp = ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
    }
    return NAMED[ref] ?? whole;
  });
}

/** Consecutive repeats of a point dropped (a pen that didn't move). */
function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
}

/**
 * A single-line SVG font (SVG 1.1 `<font>`): each `<glyph>`'s path is its pen
 * strokes, one subpath per stroke, in the order and direction they're drawn.
 * Glyphs for more than one character (ligatures) are left out; so is a glyph
 * whose path can't be read.
 */
export function parseSvgFont(svg: string): StrokeFont {
  const fontTag = /<font\b[^>]*>/.exec(svg)?.[0];
  if (!fontTag) throw new Error('No <font> element: not an SVG font');
  const font = attributes(fontTag);
  const face = attributes(/<font-face\b[^>]*>/.exec(svg)?.[0] ?? '');
  const unitsPerEm = Number(face['units-per-em']) || 1000;
  const ascent = Number(face.ascent);
  const descent = Number(face.descent);
  const defaultAdvance = Number(font['horiz-adv-x']) || unitsPerEm / 2;
  // Curves are flattened to half a unit of a 1000-unit em.
  const tolerance = unitsPerEm / 2000;

  const glyphs: Record<string, StrokeFontGlyph> = {};
  for (const m of svg.matchAll(/<glyph\b[^>]*>/g)) {
    const glyph = attributes(m[0]);
    const char = glyph.unicode;
    if (!char || [...char].length !== 1 || Object.hasOwn(glyphs, char)) continue;
    let strokes: Point[][] = [];
    try {
      strokes = glyph.d
        ? flattenPath(parseSvgPathData(glyph.d), tolerance)
            .map((path) => dedupe(path.map((p) => ({ x: p.x, y: -p.y }))))
            .filter((path) => path.length > 0)
        : [];
    } catch {
      continue;
    }
    glyphs[char] = { advance: Number(glyph['horiz-adv-x'] ?? defaultAdvance) || defaultAdvance, strokes };
  }
  if (Object.keys(glyphs).length === 0) throw new Error('The SVG font has no glyphs');

  const license = /<metadata>([\s\S]*?)<\/metadata>/.exec(svg)?.[1]?.trim();
  return {
    family: face['font-family']?.trim() || font.id || 'SVG font',
    unitsPerEm,
    ascender: Number.isFinite(ascent) && ascent > 0 ? ascent : unitsPerEm * 0.8,
    descender: Number.isFinite(descent) && descent !== 0 ? -Math.abs(descent) : -unitsPerEm * 0.2,
    glyphs,
    ...(license ? { license: decodeEntities(license) } : {}),
  };
}

/** Hershey's frame: the baseline at y = 9 and 32 units to the em, which a stroke font takes as 1000. */
const HERSHEY_BASELINE = 9;
const HERSHEY_SCALE = 1000 / 32;

/**
 * A Hershey font in JHF format. Its glyphs have no character codes: they're
 * `chars` in file order, by default ASCII from the space (as the fonts in the
 * Hershey distribution are laid out).
 */
export function parseJhfFont(text: string, family: string, chars?: string): StrokeFont {
  const order = chars ? [...chars] : null;
  const glyphs: Record<string, StrokeFontGlyph> = {};
  let bottom = 0;
  parseJhfGlyphs(text).forEach(({ left, right, strokes }, i) => {
    const char = order ? order[i] : String.fromCharCode(32 + i);
    if (char === undefined || Object.hasOwn(glyphs, char)) return;
    glyphs[char] = {
      advance: (right - left) * HERSHEY_SCALE,
      strokes: strokes.map((stroke) =>
        stroke.map(([x, y]) => {
          bottom = Math.max(bottom, y - HERSHEY_BASELINE);
          return { x: (x - left) * HERSHEY_SCALE, y: (y - HERSHEY_BASELINE) * HERSHEY_SCALE };
        }),
      ),
    };
  });
  if (Object.keys(glyphs).length === 0) throw new Error('The JHF file has no glyphs');
  return {
    family,
    unitsPerEm: 1000,
    ascender: 800,
    descender: Math.min(-200, -Math.ceil(bottom * HERSHEY_SCALE)),
    glyphs,
    license:
      'The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards. The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc.',
  };
}

/**
 * A hand-drawn stroke-order dataset as a font. Its strokes were drawn over
 * some font's glyphs, from their origins; each glyph advances to a little past
 * its rightmost stroke.
 */
export function drawnStrokeFont(dataset: DrawnDataset): StrokeFont {
  const glyphs: Record<string, StrokeFontGlyph> = {};
  for (const [char, strokes] of Object.entries(dataset.glyphs)) {
    const points = strokes.map((stroke) => stroke.map(([x, y]) => ({ x, y })));
    const right = Math.max(0, ...points.flat().map((p) => p.x));
    glyphs[char] = { advance: Math.max(250, Math.round(right + 80)), strokes: points };
  }
  return {
    family: dataset.name,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs,
    license: dataset.license ?? `${dataset.name}, drawn in Tegaki Studio`,
  };
}

/** Reads a stroke font from a file's text, by its format: an SVG font, a JHF file or a drawn dataset (JSON). */
export function parseStrokeFontFile(text: string, fileName: string): StrokeFont {
  const name = fileName.replace(/^.*[/\\]/, '').replace(/(\.strokes)?\.\w+$/, '');
  if (/^\s*[{[]/.test(text)) return drawnStrokeFont(parseDrawnDataset(text));
  if (/<font\b/.test(text)) return parseSvgFont(text);
  if (/^\s*\d+\s+\d+/.test(text)) return parseJhfFont(text, name);
  throw new Error(`${fileName}: not an SVG font, a JHF file or a drawn stroke-order dataset`);
}
