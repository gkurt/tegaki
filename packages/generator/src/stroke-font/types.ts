// Stroke fonts: fonts made of pen strokes rather than outlines — Hershey's
// plotter fonts, the single-line SVG fonts made for pen plotters and
// engravers, a stroke-order dataset drawn by hand. Their strokes need no
// extraction: they ARE the centerlines, in pen order and direction, so a
// stroke font goes straight to glyph data (see bundle.ts).

import type { Point } from 'tegaki/internal';

export interface StrokeFontGlyph {
  /** Advance width, in font units. */
  advance: number;
  /** Pen strokes in pen order, each in pen direction: font units, y down, the glyph's origin on the baseline at 0,0. */
  strokes: Point[][];
}

export interface StrokeFont {
  family: string;
  unitsPerEm: number;
  /** Above the baseline, positive. */
  ascender: number;
  /** Below the baseline, negative. */
  descender: number;
  glyphs: Record<string, StrokeFontGlyph>;
  /** The credits and license the file carries, to ship with what's made from it. */
  license?: string;
}

/** How a stroke font is drawn: its pen and its pace. */
export interface StrokeFontOptions {
  /** Pen width as a fraction of the em. */
  penWidth: number;
  /** Font units per second. */
  drawingSpeed: number;
  /** Seconds between strokes. */
  strokePause: number;
}
