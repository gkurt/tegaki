// Stage 6 of the pipeline — see commands/generate.ts.
// Converts bitmap-space ordered strokes into the final font-unit representation
// and computes per-stroke animation timing (length, duration, delay) from the
// configured drawing speed and inter-stroke pause.

import type { Stroke } from 'tegaki/internal';
import type { RasterResult } from './rasterize.ts';

export type TimedStroke = Stroke & {
  length: number;
  animationDuration: number;
  delay: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function toFontUnits(
  strokes: Stroke[],
  transform: RasterResult['transform'],
  drawingSpeed: number,
  strokePause: number,
): TimedStroke[] {
  const scale = transform.scaleX;
  let timeOffset = 0;
  return strokes.map((s, i) => {
    const length = round2(s.length / scale);
    const animationDuration = Math.max(round3(length / drawingSpeed), 0.001);
    const delay = round3(timeOffset);
    timeOffset += animationDuration + (i < strokes.length - 1 ? strokePause : 0);
    return {
      ...s,
      length,
      animationDuration,
      delay,
      points: s.points.map((p) => ({
        x: round2(p.x / transform.scaleX + transform.offsetX),
        y: round2(p.y / transform.scaleY + transform.offsetY),
        t: round3(p.t),
        width: round2(p.width / scale),
      })),
    };
  });
}
