import { findEffect, findEffects, globalGradientGeometry, type ResolvedEffect } from '../lib/effects.ts';
import { glowPasses, type StrokeEffects, strokeEffects } from '../lib/strokeEffects.ts';
import { type Box, expandBox, unionBoxes } from '../lib/strokePath.ts';
import { type GlyphPlacement, strokeInkBounds } from '../lib/strokeTimeline.ts';
import type { TegakiPlugin } from './types.ts';

// The built-in effects, as plugins. The declarative `effects` option resolves
// to these, and the engine runs them ahead of the user's plugins:
//
// - pressureWidth, taper — `geometry`: the ink's width along each stroke
// - wobble — `geometry` (and `outline`, so clip-to-text's letters wobble too)
// - globalGradient, strokeGradient — `paint`: what the ink is painted with
// - glow — `ink`: the finished ink, recolored and blurred underneath it
//
// The per-stroke math lives in `strokeEffects.ts`, which the SVG export reads too.

/** The plugins that draw `effects`, in the order they run. */
export function effectPlugins(effects: readonly ResolvedEffect[]): TegakiPlugin[] {
  const list = effects as ResolvedEffect[];
  const out: TegakiPlugin[] = [pressureWidthPlugin(list)];
  if (findEffect(list, 'taper')) out.push(taperPlugin(list));
  if (findEffect(list, 'wobble')) out.push(wobblePlugin(list));
  const gg = findEffect(list, 'globalGradient');
  if (Array.isArray(gg?.config.colors) && gg.config.colors.length > 0)
    out.push(globalGradientPlugin(gg.config.colors, gg.config.angle ?? 0));
  // After globalGradient, so a per-stroke gradient wins over the layout-wide one.
  if (findEffect(list, 'strokeGradient')) out.push(strokeGradientPlugin(list));
  if (findEffects(list, 'glow').length > 0) out.push(glowPlugin(list));
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

/**
 * Each glow pass lays the finished ink, recolored in the glow's color, with
 * its shadow under the ink. On the ink as a whole, so strokes never glow over
 * each other and clip-to-text's clip doesn't cut the glow away.
 */
function glowPlugin(effects: ResolvedEffect[]): TegakiPlugin {
  let tint: HTMLCanvasElement | null = null;
  return {
    name: 'glow',
    bounds({ strokes, fontSize, scale }) {
      let reach = 0;
      for (const g of glowPasses(effects, '', fontSize, scale)) reach = Math.max(reach, g.blur + Math.max(Math.abs(g.dx), Math.abs(g.dy)));
      return expandBox(unionBoxes(strokes.map(strokeInkBounds)), reach);
    },
    ink({ ctx, ink, color, fontSize, scale }) {
      if (!tint) tint = document.createElement('canvas');
      if (tint.width !== ink.width || tint.height !== ink.height) {
        tint.width = ink.width;
        tint.height = ink.height;
      }
      const tctx = tint.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // Under the ink, so the last pass goes first to end up on top of the others.
      ctx.globalCompositeOperation = 'destination-over';
      const passes = glowPasses(effects, color, fontSize, scale);
      for (let i = passes.length - 1; i >= 0; i--) {
        const glow = passes[i]!;
        tctx.globalCompositeOperation = 'copy';
        tctx.drawImage(ink, 0, 0);
        tctx.globalCompositeOperation = 'source-in';
        tctx.fillStyle = glow.color;
        tctx.fillRect(0, 0, tint.width, tint.height);
        ctx.shadowBlur = glow.blur;
        ctx.shadowColor = glow.color;
        ctx.shadowOffsetX = glow.dx;
        ctx.shadowOffsetY = glow.dy;
        ctx.drawImage(tint, 0, 0);
      }
    },
  };
}
