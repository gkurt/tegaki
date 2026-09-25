import { describe, expect, test } from 'bun:test';
import type { LineCap, TegakiGlyphData } from '../types.ts';
import { drawGlyph } from './drawGlyph.ts';
import type { ResolvedEffect } from './effects.ts';
import { placementsToSvg, type SvgExportConfig } from './svgExport.ts';

// A bent stroke of three segments whose width varies, so pressure draws it segment by segment.
const glyph: TegakiGlyphData = {
  w: 100,
  t: 1,
  s: [
    {
      p: [
        [0, 0, 10],
        [40, 0, 14],
        [60, 30, 10],
        [100, 30, 6],
      ],
      d: 0,
      a: 1,
    },
  ],
};
const pos = { x: 0, y: 0, fontSize: 100, unitsPerEm: 100, ascender: 0, descender: 0 };
const pressure: ResolvedEffect[] = [{ effect: 'pressureWidth', order: 0, config: { strength: 1 } }];
const linear = (t: number) => t;

/** A 2D context stub that records the cap of each stroke() call and the centre of each arc(). */
function recordingContext() {
  const caps: string[] = [];
  const discs: number[][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === 'stroke') return () => caps.push(target.lineCap as string);
      if (key === 'arc') return (x: number, y: number) => discs.push([x, y]);
      if (key in target) return target[key as string];
      return () => {};
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, caps, discs };
}

const draw = (lineCap: LineCap, time = 1) => {
  const rec = recordingContext();
  drawGlyph(rec.ctx, glyph, pos, time, lineCap, '#000', pressure, 0, undefined, linear);
  return rec;
};

describe('drawGlyph per-segment caps', () => {
  test('a flat cap goes on the stroke ends only; the joints between segments are round', () => {
    const { caps, discs } = draw('butt');
    expect(caps).toEqual(['butt', 'round', 'butt']);
    // The end segments meet the rest with a disc: at the second and third points.
    expect(discs).toEqual([
      [40, 0],
      [60, 30],
    ]);
  });

  test('a square cap likewise, and on the pen tip mid-stroke', () => {
    expect(draw('square').caps).toEqual(['square', 'round', 'square']);
    expect(draw('square', 0.5).caps).toEqual(['square', 'square']);
  });

  test('a round cap draws every segment round, with no extra discs', () => {
    const { caps, discs } = draw('round');
    expect(caps).toEqual(['round', 'round', 'round']);
    expect(discs).toEqual([]);
  });
});

describe('placementsToSvg per-segment caps', () => {
  const cfg: SvgExportConfig = {
    width: 200,
    height: 100,
    lineCap: 'butt',
    color: '#123',
    pressure: 1,
    segmentLengthFU: Infinity,
    smoothing: false,
    strokeScale: 1,
    animated: false,
    totalDuration: 1,
  };
  const items = [{ glyph, ox: 0, oy: 0, scale: 1, ascender: 0, offset: 0 }];

  test('a flat cap goes on the end lines only, joined to the rest by discs', () => {
    const svg = placementsToSvg(items, cfg);
    expect(svg).toContain('stroke-linecap="round" stroke-linejoin="round"');
    expect(svg.match(/<line [^>]*stroke-linecap="butt"/g)?.length).toBe(2);
    expect(svg.match(/<circle /g)?.length).toBe(2);
  });

  test('a round cap needs no discs', () => {
    const svg = placementsToSvg(items, { ...cfg, lineCap: 'round' });
    expect(svg).not.toContain('stroke-linecap="butt"');
    expect(svg).not.toContain('<circle ');
  });
});
