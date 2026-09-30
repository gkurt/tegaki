// SVG path data flattened into polygons: the glyph outlines clip-to-text masks
// with, reshaped by the plugins' `outline` hooks.

const PATH_TOKEN = /[MmLlHhVvQqCcZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/**
 * SVG path data (M/L/H/V/Q/C/Z, absolute or relative) flattened into closed
 * polygons, one flat `[x0, y0, x1, y1, …]` array per contour, with vertices
 * at most `step` apart along each segment (Infinity: line ends only, 8 per
 * curve). The closing vertex is dropped when it repeats the first.
 */
export function flattenPath(d: string, step: number): number[][] {
  const tokens = d.match(PATH_TOKEN) ?? [];
  const contours: number[][] = [];
  let pts: number[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const pieces = (len: number, fallback: number) => (Number.isFinite(step) && step > 0 ? Math.max(1, Math.ceil(len / step)) : fallback);
  const close = () => {
    const n = pts.length;
    if (n >= 4 && pts[n - 2] === pts[0] && pts[n - 1] === pts[1]) pts.length = n - 2;
    if (pts.length >= 6) contours.push(pts);
    pts = [];
  };
  const lineTo = (x: number, y: number) => {
    const n = pieces(Math.hypot(x - cx, y - cy), 1);
    for (let i = 1; i <= n; i++) pts.push(cx + ((x - cx) * i) / n, cy + ((y - cy) * i) / n);
    cx = x;
    cy = y;
  };
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        close();
        cx = sx = ox + num();
        cy = sy = oy + num();
        pts.push(cx, cy);
        // Further pairs after a moveto are linetos.
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L':
        lineTo(ox + num(), oy + num());
        break;
      case 'H':
        lineTo(ox + num(), cy);
        break;
      case 'V':
        lineTo(cx, oy + num());
        break;
      case 'Q': {
        const x1 = ox + num();
        const y1 = oy + num();
        const x = ox + num();
        const y = oy + num();
        const n = pieces(Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x - x1, y - y1), 8);
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          pts.push(u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y);
        }
        cx = x;
        cy = y;
        break;
      }
      case 'C': {
        const x1 = ox + num();
        const y1 = oy + num();
        const x2 = ox + num();
        const y2 = oy + num();
        const x = ox + num();
        const y = oy + num();
        const n = pieces(Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2), 8);
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const e = t * t * t;
          pts.push(a * cx + b * x1 + c * x2 + e * x, a * cy + b * y1 + c * y2 + e * y);
        }
        cx = x;
        cy = y;
        break;
      }
      case 'Z':
        close();
        cx = sx;
        cy = sy;
        break;
      default:
        // Unknown command or a stray number: skip the token.
        i++;
    }
  }
  close();
  return contours;
}
