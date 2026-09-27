import { createPlugin } from '../core/createPlugin.ts';
import type { Box } from '../lib/strokePath.ts';
import type { GlyphPlacement } from '../lib/strokeTimeline.ts';

/** The curve the text is laid on. */
export type TextPathShape = 'arc' | 'wave';

/** How each glyph follows the curve: turned to lie along it, kept upright, or bent with it. */
export type TextPathGlyphs = 'rotate' | 'upright' | 'bend';

export interface TextPathOptions {
  shape: TextPathShape;
  /** An arc's turn across the text, in degrees: positive bows it up (a rainbow), negative down (a smile); ±360 wraps it round a circle. */
  angle: number;
  /** A wave's height either way, in ems. */
  amplitude: number;
  /** A wave's length, crest to crest, in ems. */
  wavelength: number;
  /** Where the wave starts, in degrees. */
  phase: number;
  glyphs: TextPathGlyphs;
  /** Waves a second the wave travels along the text, like a flag; 0 holds it still. */
  flow: number;
}

/** A point on the curve, and the way it runs there as a unit tangent. */
export interface CurvePoint {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

/**
 * The curve the text's baseline is laid on, by distance `s` px along it
 * from the middle of the text, for text `width` px wide whose middle sits
 * at (`cx`, `cy`). The same distance along it as along the straight line,
 * so the text keeps its length. `shift` moves a wave along (0–1 of a
 * wavelength). `null` for a straight line.
 */
export function curveAt(
  o: Pick<TextPathOptions, 'shape' | 'angle' | 'amplitude' | 'wavelength' | 'phase'>,
  width: number,
  fontSize: number,
  shift = 0,
): ((s: number) => CurvePoint) | null {
  if (o.shape === 'arc') {
    const turn = (o.angle * Math.PI) / 180;
    if (Math.abs(turn) < 1e-4 || width <= 0) return null;
    // A circle through the middle of the text with the text's width as its arc. A positive turn is
    // clockwise (y runs down): the ends fall away, a rainbow, its centre under the text.
    const r = width / turn;
    return (s) => {
      const a = s / r;
      return { x: r * Math.sin(a), y: r * (1 - Math.cos(a)), tx: Math.cos(a), ty: Math.sin(a) };
    };
  }
  const amp = o.amplitude * fontSize;
  const length = o.wavelength * fontSize;
  if (Math.abs(amp) < 1e-6 || length <= 0) return null;
  const k = (Math.PI * 2) / length;
  const phase = (o.phase * Math.PI) / 180 - shift * Math.PI * 2;
  // Measured along x rather than along the wave: close enough for a gentle one, and exact where it's flat.
  return (s) => {
    const slope = -amp * k * Math.cos(k * s + phase);
    const n = Math.hypot(1, slope);
    return { x: s, y: -amp * Math.sin(k * s + phase), tx: 1 / n, ty: slope / n };
  };
}

/** Where a glyph turns about when it's moved whole: on its baseline, a quarter em in from its origin. */
const PIVOT = 0.25;

/**
 * The move that lays a text box's points on the curve. The text's middle
 * (`box`'s centre) stays put; a point's distance along the text becomes its
 * distance along the curve, and its distance off the text's middle line its
 * distance off the curve, square to it. With `glyphs` `'bend'` every point
 * is moved so, bending the glyphs; otherwise the glyph at `place` is moved
 * whole — its pivot on its baseline goes there, turned to lie along the
 * curve (`'rotate'`) or not (`'upright'`).
 */
export function textPathMove(curve: (s: number) => CurvePoint, box: Box, glyphs: TextPathGlyphs, place: GlyphPlacement, fontSize: number) {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const on = (x: number, y: number) => {
    const c = curve(x - cx);
    const off = y - cy;
    // Square to the curve, on the side the text's descenders are.
    return { x: cx + c.x - c.ty * off, y: cy + c.y + c.tx * off, c };
  };
  if (glyphs === 'bend') {
    return <P extends { x: number; y: number }>(p: P): P => {
      const moved = on(p.x, p.y);
      return { ...p, x: moved.x, y: moved.y };
    };
  }
  const px = place.x + PIVOT * fontSize;
  const py = place.y + place.ascender * place.scale;
  const pivot = on(px, py);
  const cos = glyphs === 'rotate' ? pivot.c.tx : 1;
  const sin = glyphs === 'rotate' ? pivot.c.ty : 0;
  return <P extends { x: number; y: number }>(p: P): P => {
    const dx = p.x - px;
    const dy = p.y - py;
    return { ...p, x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
  };
}

/** Drawings a wave's flow cycles through, one wavelength's travel. */
const FLOW_DRAWINGS = 24;

/**
 * Text laid on a curve: an arc — a rainbow, a smile, or right round a
 * circle, the way a badge's lettering runs — or a wave, which can flow
 * along the text like a flag in the wind. Each glyph is moved whole and
 * turned to lie along the curve, or kept upright, or bent with it. A
 * `geometry` hook moves the strokes and an `outline` hook the glyph outlines
 * the same way, so clip-to-text follows; a flowing wave redraws the text on
 * `steps`.
 *
 * ```ts
 * plugins: [textPathPlugin()]                                   // a gentle arc
 * plugins: [textPathPlugin({ angle: 320, glyphs: 'rotate' })]  // round a circle
 * plugins: [textPathPlugin({ shape: 'wave', flow: 0.5 })]      // a flag
 * ```
 */
export const textPathPlugin = createPlugin({
  name: 'text-path',
  label: 'Text on a path',
  description:
    'Lays the text on an arc, round a circle, or on a wave that can flow like a flag — glyphs turned along it, upright, or bent. geometry + outline (+ steps to flow).',
  params: {
    shape: {
      type: 'select',
      label: 'Shape',
      default: 'arc',
      options: [
        { value: 'arc', label: 'Arc' },
        { value: 'wave', label: 'Wave' },
      ],
    },
    angle: {
      type: 'number',
      label: 'Arc',
      description: 'Degrees the arc turns across the text: up for a rainbow, down for a smile, 360 round a circle.',
      default: 60,
      min: -360,
      max: 360,
      step: 5,
    },
    amplitude: { type: 'number', label: 'Wave height', description: 'In ems, either way.', default: 0.25, min: 0, max: 1.5, step: 0.01 },
    wavelength: { type: 'number', label: 'Wavelength', description: 'Crest to crest, in ems.', default: 4, min: 0.5, max: 20, step: 0.1 },
    phase: { type: 'number', label: 'Phase', description: 'Where the wave starts, in degrees.', default: 0, min: -180, max: 180, step: 5 },
    glyphs: {
      type: 'select',
      label: 'Glyphs',
      default: 'rotate',
      options: [
        { value: 'rotate', label: 'Along the curve' },
        { value: 'upright', label: 'Upright' },
        { value: 'bend', label: 'Bent with it' },
      ],
    },
    flow: {
      type: 'number',
      label: 'Flow',
      description: 'Waves a second the wave travels, like a flag.',
      default: 0,
      min: 0,
      max: 2,
      step: 0.05,
    },
  },
  presets: {
    Rainbow: { shape: 'arc', angle: 120 },
    Smile: { shape: 'arc', angle: -70 },
    Badge: { shape: 'arc', angle: 330 },
    Flag: { shape: 'wave', amplitude: 0.2, wavelength: 5, glyphs: 'bend', flow: 0.6 },
  },
  setup: (options) => {
    const flowing = options.shape === 'wave' && options.flow > 0;
    const curves = new Map<string, ((s: number) => CurvePoint) | null>();
    const curveFor = (box: Box, fontSize: number, step: number) => {
      const key = `${box.maxX - box.minX}|${fontSize}|${step}`;
      if (!curves.has(key)) {
        if (curves.size > 256) curves.clear();
        curves.set(key, curveAt(options, box.maxX - box.minX, fontSize, flowing ? step / FLOW_DRAWINGS : 0));
      }
      return curves.get(key)!;
    };
    return {
      // One wavelength's travel, at `flow` waves a second.
      steps: flowing ? { count: FLOW_DRAWINGS, fps: FLOW_DRAWINGS * options.flow, idle: true } : undefined,
      geometry(path, g) {
        const curve = curveFor(g.textBox, g.fontSize, g.step);
        return curve ? path.map(textPathMove(curve, g.textBox, options.glyphs, g.place, g.fontSize)) : path;
      },
      outline(contour, o) {
        const curve = curveFor(o.textBox, o.fontSize, o.step);
        return curve ? contour.map(textPathMove(curve, o.textBox, options.glyphs, o.place, o.fontSize)) : [...contour];
      },
    };
  },
});
