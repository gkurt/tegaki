import type { Box, StrokeFrame, StrokePath, TegakiStrokePaintContext } from 'tegaki/core';

/** A canvas made once and grown as needed. */
export function scratch(): (w: number, h: number) => HTMLCanvasElement {
  let canvas: HTMLCanvasElement | null = null;
  return (w, h) => {
    canvas ??= document.createElement('canvas');
    if (canvas.width < w || canvas.height < h) {
      canvas.width = Math.max(canvas.width, Math.ceil(w));
      canvas.height = Math.max(canvas.height, Math.ceil(h));
    }
    return canvas;
  };
}

/** The ink's box in device pixels, grown by `reach`, kept on the canvas. */
export function deviceBox(ctx: CanvasRenderingContext2D, bounds: Box | null, reach: number) {
  if (!bounds) return null;
  const m = ctx.getTransform();
  const { width, height } = ctx.canvas;
  const x = Math.max(0, Math.floor(m.a * bounds.minX + m.e - reach));
  const y = Math.max(0, Math.floor(m.d * bounds.minY + m.f - reach));
  const x1 = Math.min(width, Math.ceil(m.a * bounds.maxX + m.e + reach));
  const y1 = Math.min(height, Math.ceil(m.d * bounds.maxY + m.f + reach));
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y, k: m.a } : null;
}

/** When the pen reaches draw progress `t` of a stroke (the renderer's ease-out quad, inverted). */
export function penTime(stroke: Pick<StrokeFrame, 'start' | 'duration'>, t: number): number {
  return stroke.start + stroke.duration * (1 - Math.sqrt(Math.max(0, 1 - t)));
}

/** A stroke painted whole by the painters after this one: `path` drawn to its end, no nibs. */
export function whole(s: TegakiStrokePaintContext, path: StrokePath, style: TegakiStrokePaintContext['style']): TegakiStrokePaintContext {
  return { ...s, style, stroke: { ...s.stroke, path, progress: 1, state: 'done', nibs: [] } };
}

/** Evenly spaced samples along the drawn part of a path, every `step` px of arc. */
export function along(path: StrokePath, step: number): { x: number; y: number; t: number; width: number; angle: number }[] {
  const n = Math.max(1, Math.ceil(path.length / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = path.pointAt(t);
    out.push({ x: p.x, y: p.y, t, width: p.width, angle: p.angle });
  }
  return out;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** A cached value per key object (a stroke's path, which a layout keeps). */
export function memo<K extends object, V>(make: (k: K) => V): (k: K) => V {
  const cache = new WeakMap<K, V>();
  return (k) => {
    let v = cache.get(k);
    if (v === undefined) cache.set(k, (v = make(k)));
    return v;
  };
}

export type Rgb = [number, number, number];

export function hex(h: string): Rgb {
  const n = Number.parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const css = ([r, g, b]: Rgb, a = 1) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(3)})`;

const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Smooth value noise, 0–1. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** The ink box of every stroke, drawn yet or not. */
export function textBounds(strokes: readonly { path: StrokePath }[]): Box | null {
  let box: Box | null = null;
  for (const s of strokes) {
    const b = s.path.bounds();
    if (!b) continue;
    box = box
      ? {
          minX: Math.min(box.minX, b.minX),
          minY: Math.min(box.minY, b.minY),
          maxX: Math.max(box.maxX, b.maxX),
          maxY: Math.max(box.maxY, b.maxY),
        }
      : { ...b };
  }
  return box;
}

/** A stroke's path at one width throughout (so it's painted as one canvas stroke, and a see-through color doesn't stack). */
export const uniform = (path: StrokePath, width: number) => path.map((p) => ({ ...p, width }));

/** The mean width of a path's points. */
export const meanWidth = (path: StrokePath) => path.points.reduce((a, p) => a + p.width, 0) / Math.max(1, path.points.length);

/** A color along a list of stops, `t` in 0–1. */
export function ramp(stops: readonly Rgb[], t: number): Rgb {
  const x = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixRgb(stops[i]!, stops[i + 1]!, x - i);
}
