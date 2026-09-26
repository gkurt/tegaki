import type { Box } from 'tegaki/core';

/** A stretch of the canvas in device pixels. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The device-pixel stretch of the canvas an `ink` hook needs to work on: the
 * ink's `bounds` (text-box px, mapped by `ctx`'s transform), grown by `reach`
 * device pixels and kept on the canvas. `null` when there's no ink yet.
 */
export function inkRegion(
  ctx: CanvasRenderingContext2D,
  canvas: { width: number; height: number },
  bounds: Box | null,
  reach: number,
): Region | null {
  if (!bounds) return null;
  const m = ctx.getTransform();
  const x0 = Math.max(0, Math.floor(m.a * bounds.minX + m.e - reach));
  const y0 = Math.max(0, Math.floor(m.d * bounds.minY + m.f - reach));
  const x1 = Math.min(canvas.width, Math.ceil(m.a * bounds.maxX + m.e + reach));
  const y1 = Math.min(canvas.height, Math.ceil(m.d * bounds.maxY + m.f + reach));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** A canvas at least `w` × `h`, made once and grown as needed. */
export function scratchCanvas(): (w: number, h: number) => HTMLCanvasElement {
  let canvas: HTMLCanvasElement | null = null;
  return (w, h) => {
    canvas ??= document.createElement('canvas');
    if (canvas.width < w || canvas.height < h) {
      canvas.width = Math.max(canvas.width, w);
      canvas.height = Math.max(canvas.height, h);
    }
    return canvas;
  };
}

/**
 * The ink's silhouette in one `color`, moved by (`dx`, `dy`) and blurred by
 * `blur` (all device px), drawn into `into` at the region's size. A canvas
 * shadow does the blurring — the ink is drawn off the canvas and only its
 * shadow lands — which every browser supports, unlike `ctx.filter`.
 */
export function silhouette(
  into: HTMLCanvasElement,
  ink: CanvasImageSource,
  r: Region,
  o: { color: string; blur: number; dx: number; dy: number },
): HTMLCanvasElement {
  const c = into.getContext('2d')!;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, r.w, r.h);
  const offstage = r.w + 3 * o.blur + 100;
  c.shadowColor = o.color;
  c.shadowBlur = o.blur;
  c.shadowOffsetX = o.dx + offstage;
  c.shadowOffsetY = o.dy;
  c.drawImage(ink, r.x, r.y, r.w, r.h, -offstage, 0, r.w, r.h);
  c.restore();
  return into;
}
