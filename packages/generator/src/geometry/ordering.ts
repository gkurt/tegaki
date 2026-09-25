// Stage G7 — order assembled strokes and assign animation timing.
//
// Geometry strokes are already in font units, so unlike the raster pipeline
// there's no bitmap→font-unit conversion here. This stage only decides draw
// order (top-to-bottom, left-to-right, a headline after the letter it
// caps, dots last), pen direction per stroke,
// and per-point time `t` plus per-stroke delay / duration from drawing speed.

import type { Stroke, TimedPoint } from 'tegaki';
import { ORIENT_X_WEIGHT } from '../constants.ts';
import { dist } from './primitives.ts';
import type { AxisPoint, GeoStroke } from './types.ts';

export type TimedGeoStroke = Stroke & { length: number; animationDuration: number; delay: number };

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function polylineLength(points: { x: number; y: number }[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1]!, points[i]!);
  return len;
}

/** Orient a stroke so the natural pen entry comes first (see raster stroke-order.ts). */
function orient(points: AxisPoint[], isLoop: boolean, rtl: boolean): AxisPoint[] {
  if (points.length < 2) return points;
  const xWeight = rtl ? -ORIENT_X_WEIGHT : ORIENT_X_WEIGHT;
  const start = points[0]!;
  const end = points[points.length - 1]!;

  if (isLoop || dist(start, end) < Math.max(1, start.width * 0.5)) {
    // Rotate a loop to begin at the script's entry extremum (leftmost LTR).
    let bestIdx = 0;
    let bestX = points[0]!.x;
    let bestY = points[0]!.y;
    for (let i = 1; i < points.length; i++) {
      const p = points[i]!;
      const better = rtl ? p.x > bestX || (p.x === bestX && p.y < bestY) : p.x < bestX || (p.x === bestX && p.y < bestY);
      if (better) {
        bestX = p.x;
        bestY = p.y;
        bestIdx = i;
      }
    }
    if (isLoop && points.length > 2 && dist(points[0]!, points[points.length - 1]!) < 1e-6) {
      // Closed loop: drop the duplicate seam vertex before rotating, re-close after.
      const open = points.slice(0, -1);
      const rot = [...open.slice(bestIdx), ...open.slice(0, bestIdx)];
      rot.push({ ...rot[0]! });
      return rot;
    }
    if (bestIdx !== 0) return [...points.slice(bestIdx), ...points.slice(0, bestIdx)];
    return points;
  }

  const startScore = start.y + start.x * xWeight;
  const endScore = end.y + end.x * xWeight;
  return endScore < startScore ? [...points].reverse() : points;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bbox(points: { x: number; y: number }[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

const bboxDiag = (b: BBox) => Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
function bboxGap(a: BBox, b: BBox): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

const DOT_DIAG_RATIO = 0.15;
const DOT_ISOLATION_RATIO = 0.04;

/** Flag small, isolated strokes as dots (priority -1) so they draw after body strokes. */
function classifyDots(oriented: AxisPoint[][], priorities: number[]): void {
  if (oriented.length < 2) return;
  const boxes = oriented.map(bbox);
  const glyph = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const b of boxes) {
    glyph.minX = Math.min(glyph.minX, b.minX);
    glyph.minY = Math.min(glyph.minY, b.minY);
    glyph.maxX = Math.max(glyph.maxX, b.maxX);
    glyph.maxY = Math.max(glyph.maxY, b.maxY);
  }
  const glyphDiag = Math.hypot(glyph.maxX - glyph.minX, glyph.maxY - glyph.minY);
  if (glyphDiag <= 0) return;
  const maxDotDiag = glyphDiag * DOT_DIAG_RATIO;
  const isolation = glyphDiag * DOT_ISOLATION_RATIO;
  for (let i = 0; i < oriented.length; i++) {
    if (bboxDiag(boxes[i]!) > maxDotDiag) continue;
    let isolated = true;
    for (let j = 0; j < oriented.length; j++) {
      if (i === j) continue;
      if (bboxGap(boxes[i]!, boxes[j]!) <= isolation) {
        isolated = false;
        break;
      }
    }
    if (isolated) priorities[i] = -1;
  }
}

/** `Stroke.priority` of a headline: a connecting tier, after the body and before the marks (-1). */
export const HEADLINE_PRIORITY = -0.5;
const HEADLINE_MAX_RISE = 0.12;
const HEADLINE_MIN_SPAN = 0.5;
const HEADLINE_MAX_DEPTH = 0.35;

/**
 * Scripts whose letters hang from a headline (Devanagari's shirorekha,
 * Bengali's matra, Gurmukhi's): the letter is written first and the
 * headline drawn over it last, where top-to-bottom order draws it first.
 */
export function isHeadlineScriptChar(char: string): boolean {
  const cp = char.codePointAt(0);
  if (cp == null) return false;
  // Devanagari, Bengali, Gurmukhi; Devanagari Extended
  return (cp >= 0x0900 && cp <= 0x0a7f) || (cp >= 0xa8e0 && cp <= 0xa8ff);
}

/**
 * Body strokes that are a headline: flat (rising at most `HEADLINE_MAX_RISE`
 * of the letter's height), spanning at least `HEADLINE_MIN_SPAN` of its width,
 * and lying in its top `HEADLINE_MAX_DEPTH`. The letter is measured without
 * the marks drawn entirely above the candidate (ि's hook, ो's curl, ं): they
 * can rise nearly a letter's height over the headline. Contact is not
 * required: handwriting fonts leave a gap under the headline (Tillana न's
 * body sits 50 units below it), and it is still written last. Only when other
 * body strokes remain to draw first: a glyph that is nothing but bars keeps
 * its order.
 */
export function findHeadlines(oriented: AxisPoint[][], priorities: number[]): boolean[] {
  const flags = oriented.map(() => false);
  const body = oriented.map((_, i) => i).filter((i) => priorities[i] === 0 && oriented[i]!.length > 0);
  if (body.length < 2) return flags;
  const boxes = oriented.map(bbox);
  for (const i of body) {
    const b = boxes[i]!;
    const midY = (b.minY + b.maxY) / 2;
    const letter = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const j of body) {
      const o = boxes[j]!;
      if (o.maxY < midY) continue; // a mark above the candidate
      letter.minX = Math.min(letter.minX, o.minX);
      letter.minY = Math.min(letter.minY, o.minY);
      letter.maxX = Math.max(letter.maxX, o.maxX);
      letter.maxY = Math.max(letter.maxY, o.maxY);
    }
    const width = letter.maxX - letter.minX;
    const height = letter.maxY - letter.minY;
    flags[i] =
      width > 0 &&
      height > 0 &&
      b.maxY - b.minY <= HEADLINE_MAX_RISE * height &&
      b.maxX - b.minX >= HEADLINE_MIN_SPAN * width &&
      midY - letter.minY <= HEADLINE_MAX_DEPTH * height;
  }
  // Every body stroke a headline means nothing hangs from them.
  if (body.every((i) => flags[i])) return oriented.map(() => false);
  return flags;
}

export interface OrderTimingParams {
  drawingSpeed: number;
  strokePause: number;
  rtl: boolean;
  /** The glyph's script writes its headline last (see `isHeadlineScriptChar`). */
  headlineLast?: boolean;
  yTolerance: number;
}

/**
 * Externally decided order + orientation (e.g. from a stroke-order dataset).
 * When present it replaces the heuristics entirely: no entry-point orient, no
 * dots-last reclassification — the plan is prescriptive.
 */
export interface OrderPlan {
  /** Draw sequence: a permutation of stroke indices. */
  sequence: number[];
  /** Per stroke index: reverse the polyline before timing. */
  reverse: boolean[];
}

/** Order + time geometry strokes into the renderer's Stroke shape (font units). */
export function orderAndTimeStrokes(strokes: GeoStroke[], params: OrderTimingParams, plan?: OrderPlan): TimedGeoStroke[] {
  if (strokes.length === 0) return [];
  const { drawingSpeed, strokePause, rtl, headlineLast = false, yTolerance } = params;

  const oriented = plan
    ? strokes.map((s, i) => (plan.reverse[i] ? [...s.points].reverse() : s.points))
    : strokes.map((s) => orient(s.points, s.isLoop, rtl));
  const priorities = oriented.map(() => 0);
  let order: number[];
  if (plan) {
    order = plan.sequence;
  } else {
    classifyDots(oriented, priorities);
    // A headline draws after its letter and before the dots — and, as its
    // own priority tier, after every letter of the word: the renderer joins
    // the word's headline pieces into one line (see `Stroke.priority`).
    if (headlineLast) {
      const headlines = findHeadlines(oriented, priorities);
      for (let i = 0; i < headlines.length; i++) if (headlines[i]) priorities[i] = HEADLINE_PRIORITY;
    }
    // Draw-order sort: dots last (priority), then top-to-bottom with a row
    // band, then left-to-right (right-to-left for RTL).
    order = oriented.map((_, i) => i);
    const boxes = oriented.map(bbox);
    order.sort((a, b) => {
      if (priorities[b]! !== priorities[a]!) return priorities[b]! - priorities[a]!;
      const ay = boxes[a]!.minY;
      const by = boxes[b]!.minY;
      if (Math.abs(ay - by) > yTolerance) return ay - by;
      const ax = boxes[a]!.minX;
      const bx = boxes[b]!.minX;
      return rtl ? bx - ax : ax - bx;
    });
  }

  const result: TimedGeoStroke[] = [];
  let timeOffset = 0;
  for (let oi = 0; oi < order.length; oi++) {
    const idx = order[oi]!;
    const pts = oriented[idx]!;
    const totalLen = polylineLength(pts);
    let cum = 0;
    const timed: TimedPoint[] = pts.map((p, i) => {
      if (i > 0) cum += dist(pts[i - 1]!, p);
      const timedPoint: TimedPoint = {
        x: round2(p.x),
        y: round2(p.y),
        t: round3(totalLen > 0 ? cum / totalLen : 0),
        width: round2(p.width),
      };
      if (p.nib) {
        const { dx, dy, major, minor, angle } = p.nib;
        timedPoint.nib = { dx: round2(dx), dy: round2(dy), major: round2(major), minor: round2(minor), angle: round3(angle) };
      }
      return timedPoint;
    });
    const length = round2(totalLen);
    const animationDuration = Math.max(round3(length / drawingSpeed), 0.001);
    const delay = round3(timeOffset);
    timeOffset += animationDuration + (oi < order.length - 1 ? strokePause : 0);
    result.push({
      points: timed,
      order: oi,
      length,
      animationDuration,
      delay,
      ...(priorities[idx]! < 0 ? { priority: priorities[idx]! } : {}),
    });
  }
  return result;
}
