/** A color as red, green, blue (0–255) and alpha (0–1). */
export type Rgba = [number, number, number, number];

/**
 * A color the way a canvas writes it back once it's been set as a style —
 * `#rrggbb`, or `rgba(r, g, b, a)` — as numbers. `null` for anything else
 * (a gradient, a pattern).
 */
export function parseCanvasColor(color: string): Rgba | null {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  return null;
}

let probe: CanvasRenderingContext2D | null = null;
const probed = new Map<string, Rgba>();

/**
 * A color the canvas writes back as it was given — `oklch(…)`, `color(…)`,
 * Tailwind's palette — as sRGB numbers: painted on a pixel and read back.
 */
function probeColor(color: string): Rgba {
  let out = probed.get(color);
  if (out) return out;
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  probe.canvas.width = probe.canvas.height = 1;
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  out = [r!, g!, b!, a! / 255];
  if (probed.size > 256) probed.clear();
  probed.set(color, out);
  return out;
}

/** Any CSS color as numbers, read back through the canvas (which knows every CSS color). */
export function canvasColor(ctx: CanvasRenderingContext2D, color: string): Rgba | null {
  const was = ctx.fillStyle;
  ctx.fillStyle = color;
  const style = ctx.fillStyle;
  ctx.fillStyle = was;
  if (typeof style !== 'string') return null;
  return parseCanvasColor(style) ?? probeColor(style);
}

export const rgba = ([r, g, b, a]: Rgba) => `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Between `a` (at 0) and `b` (at 1). */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t].map((v, i) =>
    i < 3 ? Math.round(v) : v,
  ) as Rgba;
}
