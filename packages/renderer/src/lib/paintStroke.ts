import type { LineCap } from '../types.ts';
import type { StrokeFrame } from './strokeTimeline.ts';

/**
 * What ink is painted with: a CSS color, a canvas gradient or pattern (laid
 * over the canvas, in px from the top-left of the text box), or a function
 * giving the color at each draw progress (0–1) along the stroke.
 */
export type InkStyle = string | CanvasGradient | CanvasPattern | ((t: number) => string);

/** A stroke to paint at one moment, and how. */
export interface StrokePaint {
  ctx: CanvasRenderingContext2D;
  /** The stroke: its `path`, how far along it the pen is (`progress`), its nib stamps. */
  stroke: StrokeFrame;
  style: InkStyle;
  /** The bundle's line cap, for the stroke's two ends. */
  lineCap: LineCap;
}

/**
 * Paint a stroke's ink as far as the pen has drawn it: `stroke.path` up to
 * `stroke.progress`, each stretch as wide as the path is there, then the nib
 * stamps the pen has reached. A path of one point is a dot. A path of one
 * width in one flat paint is a single canvas stroke; otherwise each segment
 * is stroked on its own so its width and color can change.
 */
export function paintStroke({ ctx, stroke, style, lineCap }: StrokePaint): void {
  if (stroke.state === 'pending') return;
  const { path, progress } = stroke;
  const pts = path.points;
  const n = pts.length;
  if (n === 0 || progress <= 0) return;
  const colorAt = typeof style === 'function' ? style : null;
  const paintAt = (t: number) => (colorAt ? colorAt(t) : (style as string | CanvasGradient | CanvasPattern));

  if (n === 1) {
    const dot = pts[0]!;
    ctx.fillStyle = paintAt(0);
    ctx.beginPath();
    if (lineCap === 'round') {
      ctx.arc(dot.x, dot.y, dot.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(dot.x - dot.width / 2, dot.y - dot.width / 2, dot.width, dot.width);
    }
    paintNibs(ctx, stroke, paintAt);
    return;
  }

  // The points the pen has passed, and where it is now between the next two.
  const lastIdx = path.lastIndexAt(progress);
  const tail = lastIdx + 1 < n && progress > pts[lastIdx]!.t ? path.pointAt(progress) : null;
  const count = lastIdx + 1 + (tail ? 1 : 0);
  const xs: number[] = new Array(count);
  const ys: number[] = new Array(count);
  for (let i = 0; i <= lastIdx; i++) {
    xs[i] = pts[i]!.x;
    ys[i] = pts[i]!.y;
  }
  if (tail) {
    xs[count - 1] = tail.x;
    ys[count - 1] = tail.y;
  }
  const widthOf = (i: number) => (i <= lastIdx ? pts[i]!.width : tail!.width);
  const tOf = (i: number) => (i <= lastIdx ? pts[i]!.t : progress);

  ctx.lineCap = lineCap;
  ctx.lineJoin = 'round';

  if (!colorAt && path.uniformWidth) {
    ctx.strokeStyle = style as string | CanvasGradient | CanvasPattern;
    ctx.lineWidth = pts[0]!.width;
    ctx.beginPath();
    ctx.moveTo(xs[0]!, ys[0]!);
    for (let i = 1; i < count; i++) ctx.lineTo(xs[i]!, ys[i]!);
    ctx.stroke();
  } else {
    // Each segment is its own stroke so its width and paint can change.
    // Adjacent round-capped ends overlap to read as one line. The stroke's
    // cap belongs to its two ends only: a flat or square cap on every segment
    // would show each seam (a fringe of notches along every curve), so the
    // end segments take the cap and a round disc where they meet the rest.
    const joinDisc = (x: number, y: number, lw: number) => {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(x, y, lw / 2, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let i = 1; i < count; i++) {
      const lw = (widthOf(i - 1) + widthOf(i)) / 2;
      ctx.lineWidth = lw;
      ctx.strokeStyle = paintAt((tOf(i - 1) + tOf(i)) / 2);
      const first = i === 1;
      const last = i === count - 1;
      ctx.lineCap = lineCap === 'round' || !(first || last) ? 'round' : lineCap;
      ctx.beginPath();
      ctx.moveTo(xs[i - 1]!, ys[i - 1]!);
      ctx.lineTo(xs[i]!, ys[i]!);
      ctx.stroke();
      if (lineCap !== 'round' && first !== last) {
        if (first) joinDisc(xs[i]!, ys[i]!, lw);
        else joinDisc(xs[i - 1]!, ys[i - 1]!, lw);
      }
    }
  }

  paintNibs(ctx, stroke, paintAt);
}

/** Fill the nib stamps the pen has reached, over the stroke they belong to. */
function paintNibs(ctx: CanvasRenderingContext2D, stroke: StrokeFrame, paintAt: (t: number) => string | CanvasGradient | CanvasPattern) {
  for (const nib of stroke.nibs) {
    if (nib.t > stroke.progress) continue;
    const at = stroke.path.pointAt(nib.t);
    const rx = nib.rx * at.width;
    const ry = nib.ry * at.width;
    if (rx <= 0 || ry <= 0) continue;
    ctx.fillStyle = paintAt(nib.t);
    ctx.beginPath();
    ctx.ellipse(at.x + nib.dx, at.y + nib.dy, rx, ry, nib.angle, 0, Math.PI * 2);
    ctx.fill();
  }
}
