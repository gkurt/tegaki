import { createPlugin, lengthToPx } from '../core/createPlugin.ts';
import { paintsDrawnOnly } from '../core/plugins.ts';
import type { TegakiInkContext, TegakiStrokePaintContext } from '../core/types.ts';
import { paintStroke } from '../lib/paintStroke.ts';
import { expandBox, type StrokePath, unionBoxes } from '../lib/strokePath.ts';
import { type StrokeNib, strokeInkBounds } from '../lib/strokeTimeline.ts';

/** One glow, resolved to px: the canvas shadow it stands for. */
interface GlowPass {
  /** Paint of the ink's copy and its shadow. */
  color: string;
  /** Canvas `shadowBlur`, in px (a Gaussian of σ = blur / 2). */
  blur: number;
  /** Shadow offset in px. */
  dx: number;
  dy: number;
}

/**
 * A soft light around the ink: a copy of it in the glow's color, blurred,
 * under it. Each stroke glows on its own — one shadow per stroke, never one
 * per segment (a shadow costs per draw call). With clip-to-text the clip
 * would cut that away, so the glow lights the clipped ink as a whole
 * instead, fallback characters with it. Two glows stack: add the plugin twice.
 *
 * Its sizes are lengths in em, so the glow grows with the text: `radius: 0.1`
 * spreads a tenth of the font size. A string sets pixels instead, `'8px'`.
 *
 * ```ts
 * plugins: [glowPlugin({ radius: 0.15, color: '#0cf' })]
 * ```
 */
export const glowPlugin = paintsDrawnOnly(
  createPlugin({
    name: 'glow',
    label: 'Glow',
    description: 'A soft light around the ink. paint, or ink with clip-to-text; svg.',
    params: {
      radius: {
        type: 'length',
        label: 'Radius',
        description: "How far the light spreads: in em (a share of the font size), or px as '8px'.",
        default: 0.1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      color: { type: 'color', label: 'Color', description: "The light's color. Unset, the text's.", default: '' },
      offsetX: {
        type: 'length',
        label: 'Offset X',
        description: 'Moves the light right, in em or px.',
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
      offsetY: {
        type: 'length',
        label: 'Offset Y',
        description: 'Moves the light down, in em or px.',
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
    },
    setup: ({ radius, color, offsetX, offsetY }) => {
      const pass = (textColor: string, fontSize: number): GlowPass => ({
        color: color || textColor,
        blur: lengthToPx(radius, fontSize),
        dx: lengthToPx(offsetX, fontSize),
        dy: lengthToPx(offsetY, fontSize),
      });
      const reach = (fontSize: number) => {
        const g = pass('', fontSize);
        return g.blur + Math.max(Math.abs(g.dx), Math.abs(g.dy));
      };
      const strokeGlow = strokeGlowPainter();
      const inkGlow = inkGlowPainter();
      return {
        bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map(strokeInkBounds)), reach(fontSize)),
        paint(s, next) {
          if (!s.clipped && s.stroke.state !== 'pending') {
            const g = pass(s.color, s.fontSize);
            if (g.blur > 0) strokeGlow(s, g);
          }
          next(s);
        },
        ink(ink) {
          if (!ink.clipped) return;
          const g = pass(ink.color, ink.fontSize);
          if (g.blur > 0) inkGlow(ink, g);
        },
        svg(svg) {
          const g = pass(svg.color, svg.fontSize);
          if (g.blur <= 0) return;
          const id = svg.id('tk-glow');
          svg.defs(
            `<filter id="${id}" filterUnits="userSpaceOnUse" ${svg.region}>` +
              `<feFlood flood-color="${g.color}" /><feComposite in2="SourceAlpha" operator="in" result="tint" />` +
              `<feDropShadow in="tint" dx="${fmt(g.dx)}" dy="${fmt(g.dy)}" stdDeviation="${fmt(g.blur / 2)}" flood-color="${g.color}" result="glow" />` +
              '<feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge></filter>',
          );
          svg.ink(`filter="url(#${id})"`);
        },
      };
    },
  }),
);

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** Each stroke's glow copy: the path at the stroke's mean width, with its nib stamps kept the size they are on the ink. */
function strokeGlowPainter(): (s: TegakiStrokePaintContext, g: GlowPass) => void {
  const copies = new WeakMap<StrokePath, { path: StrokePath; nibs: readonly StrokeNib[] }>();
  const copyOf = (s: TegakiStrokePaintContext) => {
    const { stroke } = s;
    let copy = copies.get(stroke.path);
    if (copy) return copy;
    if (stroke.path.points.length === 1) {
      copy = { path: stroke.path, nibs: stroke.nibs };
    } else {
      let sum = 0;
      for (const q of stroke.stroke.p) sum += q[2]!;
      const width = Math.max(sum / stroke.stroke.p.length, 0.5) * stroke.place.scale;
      const nibs = stroke.nibs.map((nib) => {
        const f = stroke.path.pointAt(nib.t).width / width;
        return { ...nib, rx: nib.rx * f, ry: nib.ry * f };
      });
      copy = { path: stroke.path.map((p) => ({ ...p, width })), nibs };
    }
    copies.set(stroke.path, copy);
    return copy;
  };
  return (s, g) => {
    const stroke = { ...s.stroke, ...copyOf(s) };
    s.ctx.save();
    s.ctx.shadowBlur = g.blur;
    s.ctx.shadowColor = g.color;
    s.ctx.shadowOffsetX = g.dx;
    s.ctx.shadowOffsetY = g.dy;
    paintStroke({ ctx: s.ctx, stroke, style: g.color, lineCap: s.lineCap });
    s.ctx.restore();
  };
}

/** Where a canvas shadow draws nothing but its blur: the shape goes this far off the canvas and the shadow is offset back. */
const OFFSTAGE = 1e5;

/**
 * The glow of the clipped ink, blurred under it. Only the part of the canvas
 * the ink reaches (plus the blur) is worked on, and at reduced resolution —
 * a glow is soft, so blurring the ink at a quarter of its size and
 * stretching it back looks the same for a fraction of the pixels.
 */
function inkGlowPainter(): (ink: TegakiInkContext, g: GlowPass) => void {
  let source: HTMLCanvasElement | null = null;
  let tint: HTMLCanvasElement | null = null;
  let blur: HTMLCanvasElement | null = null;
  const fit = (c: HTMLCanvasElement, w: number, h: number) => {
    if (c.width < w || c.height < h) {
      c.width = Math.max(c.width, w);
      c.height = Math.max(c.height, h);
    }
  };
  return ({ ctx, bounds }, g) => {
    const ink = ctx.canvas;
    if (!bounds) return;
    // A shadow's blur reaches about 3σ = 1.5 × shadowBlur.
    const reach = 1.5 * g.blur + Math.max(Math.abs(g.dx), Math.abs(g.dy));
    const m = ctx.getTransform();
    const x0 = Math.max(0, Math.floor(m.a * bounds.minX + m.e - reach));
    const y0 = Math.max(0, Math.floor(m.d * bounds.minY + m.f - reach));
    const x1 = Math.min(ink.width, Math.ceil(m.a * bounds.maxX + m.e + reach));
    const y1 = Math.min(ink.height, Math.ceil(m.d * bounds.maxY + m.f + reach));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    if (!source) source = document.createElement('canvas');
    if (!tint) tint = document.createElement('canvas');
    if (!blur) blur = document.createElement('canvas');
    fit(source, w, h);
    const sctx = source.getContext('2d')!;
    sctx.globalCompositeOperation = 'copy';
    sctx.drawImage(ink, x0, y0, w, h, 0, 0, w, h);
    // Shrink by k while the blur left (σ = shadowBlur / 2k) still hides the pixels.
    const k = Math.max(1, Math.min(4, Math.floor(g.blur / 3)));
    const sw = Math.ceil(w / k);
    const sh = Math.ceil(h / k);
    fit(tint, sw, sh);
    fit(blur, sw, sh);
    const tctx = tint.getContext('2d')!;
    const bctx = blur.getContext('2d')!;
    tctx.globalCompositeOperation = 'copy';
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(source, 0, 0, w, h, 0, 0, sw, sh);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = g.color;
    tctx.fillRect(0, 0, sw, sh);
    bctx.clearRect(0, 0, sw, sh);
    bctx.shadowBlur = g.blur / k;
    bctx.shadowColor = g.color;
    bctx.shadowOffsetX = g.dx / k + OFFSTAGE;
    bctx.shadowOffsetY = g.dy / k;
    bctx.drawImage(tint, 0, 0, sw, sh, -OFFSTAGE, 0, sw, sh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.drawImage(blur, 0, 0, sw, sh, x0, y0, sw * k, sh * k);
  };
}
