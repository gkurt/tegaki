import { findEffect, findEffects, globalGradientGeometry, type ResolvedEffect } from '../lib/effects.ts';
import { paintStroke } from '../lib/paintStroke.ts';
import { type GlowPass, glowPasses, type StrokeEffects, strokeEffects } from '../lib/strokeEffects.ts';
import { type Box, expandBox, type StrokePath, unionBoxes } from '../lib/strokePath.ts';
import { type GlyphPlacement, type StrokeNib, strokeInkBounds } from '../lib/strokeTimeline.ts';
import type { TegakiInkContext, TegakiPlugin, TegakiStrokePaintContext } from './types.ts';

// The built-in effects, as plugins. The declarative `effects` option resolves
// to these, and the engine runs them ahead of the user's plugins:
//
// - pressureWidth, taper — `geometry`: the ink's width along each stroke
// - wobble — `geometry` (and `outline`, so clip-to-text's letters wobble too)
// - globalGradient, strokeGradient — `paint`: what the ink is painted with
// - glow — `paint`: a blurred copy under each stroke; with clip-to-text, `ink`:
//   the clipped ink recolored and blurred underneath it
//
// The per-stroke math lives in `strokeEffects.ts`, which the SVG export reads too.

/** How the renderer draws: with clip-to-text, glow lights the clipped ink instead of each stroke. */
export interface EffectPluginOptions {
  clipText?: boolean;
}

/** The plugins that draw `effects`, in the order they run. */
export function effectPlugins(effects: readonly ResolvedEffect[], options: EffectPluginOptions = {}): TegakiPlugin[] {
  const list = effects as ResolvedEffect[];
  const out: TegakiPlugin[] = [pressureWidthPlugin(list)];
  if (findEffect(list, 'taper')) out.push(taperPlugin(list));
  if (findEffect(list, 'wobble')) out.push(wobblePlugin(list));
  const gg = findEffect(list, 'globalGradient');
  if (Array.isArray(gg?.config.colors) && gg.config.colors.length > 0)
    out.push(globalGradientPlugin(gg.config.colors, gg.config.angle ?? 0));
  // After globalGradient, so a per-stroke gradient wins over the layout-wide one.
  if (findEffect(list, 'strokeGradient')) out.push(strokeGradientPlugin(list));
  if (findEffects(list, 'glow').length > 0) out.push(glowPlugin(list, options.clipText === true));
  return out;
}

/**
 * The ink's width: the stroke's mean width blended toward the width the
 * bundle gives each point, by `strength` (0 without the effect: one width
 * along the whole stroke). Never thinner than half a font unit.
 */
function pressureWidthPlugin(effects: ResolvedEffect[]): TegakiPlugin {
  const pressure = findEffect(effects, 'pressureWidth');
  const strength = pressure ? Math.max(0, Math.min(pressure.config.strength ?? 1, 1)) : 0;
  return {
    name: 'pressureWidth',
    geometry(path, g) {
      const min = 0.5 * g.widthScale;
      // A dot's width doesn't vary within it.
      if (path.points.length === 1) return path.map((p) => ({ ...p, width: Math.max(p.width, min) }));
      const pts = g.stroke.stroke.p;
      let sum = 0;
      for (const q of pts) sum += q[2]!;
      const mean = Math.max(sum / pts.length, 0.5) * g.widthScale;
      if (strength === 0) return path.map((p) => ({ ...p, width: mean }));
      return path.map((p) => ({ ...p, width: Math.max(mean + (p.width - mean) * strength, min) }));
    },
  };
}

/** Thin the ink toward the stroke's ends. A dot takes the taper of a stroke's middle. */
function taperPlugin(effects: ResolvedEffect[]): TegakiPlugin {
  const { taper } = strokeEffects(effects, 0, '');
  return {
    name: 'taper',
    geometry(path) {
      if (path.points.length === 1) {
        const m = taper(0.5);
        return path.map((p) => ({ ...p, width: p.width * m }));
      }
      return path.map((p) => ({ ...p, width: p.width * taper(p.t) }));
    },
  };
}

/** Displace the ink by a wave (or noise) of the point's position in font units and its place along the bundle's points. */
function wobblePlugin(effects: ResolvedEffect[]): TegakiPlugin {
  const bySeed = new Map<number, StrokeEffects>();
  const fxFor = (seed: number) => {
    let fx = bySeed.get(seed);
    if (!fx) bySeed.set(seed, (fx = strokeEffects(effects, seed, '')));
    return fx;
  };
  const displace = <P extends { x: number; y: number }>(p: P, place: GlyphPlacement, fx: StrokeEffects, idx: number): P => {
    const x = (p.x - place.x) / place.scale;
    const y = (p.y - place.y) / place.scale - place.ascender;
    return { ...p, x: p.x + fx.wobbleDx(x, y, idx) * place.scale, y: p.y + fx.wobbleDy(x, y, idx) * place.scale };
  };
  return {
    name: 'wobble',
    geometry(path, g) {
      const fx = fxFor(g.seed);
      return path.map((p) => displace(p, g.place, fx, g.bundleIndexAt(p.t)));
    },
    outline(contour, o) {
      const fx = fxFor(o.seed);
      return contour.map((p, k) => displace(p, o.place, fx, k));
    },
  };
}

/** One linear gradient across the whole text box, for every stroke. */
function globalGradientPlugin(colors: string[], angle: number): TegakiPlugin {
  let cached: { ctx: CanvasRenderingContext2D; box: Box; gradient: CanvasGradient } | null = null;
  return {
    name: 'globalGradient',
    paint(p, next) {
      if (cached?.ctx !== p.ctx || cached.box !== p.textBox) {
        const { minX, minY, maxX, maxY } = p.textBox;
        const g = globalGradientGeometry({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, colors, angle);
        const gradient = p.ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
        for (const [offset, color] of g.stops) gradient.addColorStop(offset, color);
        cached = { ctx: p.ctx, box: p.textBox, gradient };
      }
      next({ ...p, style: cached.gradient });
    },
  };
}

/** A color at each point along the stroke: a rainbow or a run through `colors`, phased per glyph. */
function strokeGradientPlugin(effects: ResolvedEffect[]): TegakiPlugin {
  let color = '';
  const bySeed = new Map<number, (t: number) => string>();
  return {
    name: 'strokeGradient',
    paint(p, next) {
      if (p.color !== color) {
        color = p.color;
        bySeed.clear();
      }
      let colorAt = bySeed.get(p.stroke.seed);
      if (!colorAt) bySeed.set(p.stroke.seed, (colorAt = strokeEffects(effects, p.stroke.seed, color).colorAt));
      next({ ...p, style: colorAt });
    },
  };
}

/** The glow passes for a color, size and scale — the same for every stroke of a frame, so worked out once. */
function passesFor(effects: ResolvedEffect[]): (color: string, fontSize: number, scale: number) => GlowPass[] {
  let key = '';
  let passes: GlowPass[] = [];
  return (color, fontSize, scale) => {
    const k = `${color}|${fontSize}|${scale}`;
    if (k !== key) {
      key = k;
      passes = glowPasses(effects, color, fontSize, scale);
    }
    return passes;
  };
}

/**
 * A glow: a copy of the ink in the glow's color, blurred by its shadow, under
 * the ink. Per stroke normally — each stroke's copy is one line at its mean
 * width, so the blur is one shadow per stroke, never one per segment (a
 * shadow costs per draw call). With clip-to-text, the clip would cut that
 * away, so the glow lights the clipped ink as a whole instead.
 */
function glowPlugin(effects: ResolvedEffect[], clipText: boolean): TegakiPlugin {
  const passes = passesFor(effects);
  const bounds: TegakiPlugin['bounds'] = ({ strokes, fontSize, scale }) => {
    let reach = 0;
    for (const g of passes('', fontSize, scale)) reach = Math.max(reach, g.blur + Math.max(Math.abs(g.dx), Math.abs(g.dy)));
    return expandBox(unionBoxes(strokes.map(strokeInkBounds)), reach);
  };
  return clipText ? { name: 'glow', bounds, ink: inkGlow(passes) } : { name: 'glow', bounds, paint: strokeGlow(passes) };
}

/** Each stroke's glow copy: the path at the stroke's mean width, with its nib stamps kept the size they are on the ink. */
function strokeGlow(passes: ReturnType<typeof passesFor>): NonNullable<TegakiPlugin['paint']> {
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
      const width = Math.max(sum / stroke.stroke.p.length, 0.5) * s.scale;
      const nibs = stroke.nibs.map((nib) => {
        const f = stroke.path.pointAt(nib.t).width / width;
        return { ...nib, rx: nib.rx * f, ry: nib.ry * f };
      });
      copy = { path: stroke.path.map((p) => ({ ...p, width })), nibs };
    }
    copies.set(stroke.path, copy);
    return copy;
  };
  return (s, next) => {
    const glows = passes(s.color, s.fontSize, s.scale);
    if (glows.length > 0) {
      const copy = copyOf(s);
      const stroke = { ...s.stroke, ...copy };
      for (const g of glows) {
        s.ctx.save();
        s.ctx.shadowBlur = g.blur;
        s.ctx.shadowColor = g.color;
        s.ctx.shadowOffsetX = g.dx;
        s.ctx.shadowOffsetY = g.dy;
        paintStroke({ ctx: s.ctx, stroke, style: g.color, lineCap: s.lineCap });
        s.ctx.restore();
      }
    }
    next(s);
  };
}

/** Where a canvas shadow draws nothing but its blur: the shape goes this far off the canvas and the shadow is offset back. */
const OFFSTAGE = 1e5;

/**
 * Each glow pass's blur of the clipped ink, under it, last pass first so the
 * first ends up on top. Only the part of the canvas the ink reaches (plus the
 * blur) is worked on, and at reduced resolution — a glow is soft, so blurring
 * the ink at a quarter of its size and stretching it back looks the same for
 * a fraction of the pixels.
 */
function inkGlow(passes: ReturnType<typeof passesFor>): NonNullable<TegakiPlugin['ink']> {
  let tint: HTMLCanvasElement | null = null;
  let blur: HTMLCanvasElement | null = null;
  const fit = (c: HTMLCanvasElement, w: number, h: number) => {
    if (c.width < w || c.height < h) {
      c.width = Math.max(c.width, w);
      c.height = Math.max(c.height, h);
    }
  };
  return ({ ctx, ink, bounds, color, fontSize, scale }: TegakiInkContext) => {
    const glows = passes(color, fontSize, scale);
    if (!bounds || glows.length === 0) return;
    // A shadow's blur reaches about 3σ = 1.5 × shadowBlur.
    let reach = 0;
    for (const g of glows) reach = Math.max(reach, 1.5 * g.blur + Math.max(Math.abs(g.dx), Math.abs(g.dy)));
    const m = ctx.getTransform();
    const x0 = Math.max(0, Math.floor(m.a * bounds.minX + m.e - reach));
    const y0 = Math.max(0, Math.floor(m.d * bounds.minY + m.f - reach));
    const x1 = Math.min(ink.width, Math.ceil(m.a * bounds.maxX + m.e + reach));
    const y1 = Math.min(ink.height, Math.ceil(m.d * bounds.maxY + m.f + reach));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    if (!tint) tint = document.createElement('canvas');
    if (!blur) blur = document.createElement('canvas');
    const tctx = tint.getContext('2d')!;
    const bctx = blur.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    for (let i = glows.length - 1; i >= 0; i--) {
      const g = glows[i]!;
      // Shrink by k while the blur left (σ = shadowBlur / 2k) still hides the pixels.
      const k = Math.max(1, Math.min(4, Math.floor(g.blur / 3)));
      const sw = Math.ceil(w / k);
      const sh = Math.ceil(h / k);
      fit(tint, sw, sh);
      fit(blur, sw, sh);
      tctx.globalCompositeOperation = 'copy';
      tctx.imageSmoothingEnabled = true;
      tctx.drawImage(ink, x0, y0, w, h, 0, 0, sw, sh);
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = g.color;
      tctx.fillRect(0, 0, sw, sh);
      bctx.clearRect(0, 0, sw, sh);
      bctx.shadowBlur = g.blur / k;
      bctx.shadowColor = g.color;
      bctx.shadowOffsetX = g.dx / k + OFFSTAGE;
      bctx.shadowOffsetY = g.dy / k;
      bctx.drawImage(tint, 0, 0, sw, sh, -OFFSTAGE, 0, sw, sh);
      ctx.drawImage(blur, 0, 0, sw, sh, x0, y0, sw * k, sh * k);
    }
  };
}
