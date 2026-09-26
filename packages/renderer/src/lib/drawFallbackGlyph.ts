import { findEffect, type ResolvedEffect } from './effects.ts';
import { type GlowPass, glowPasses } from './strokeEffects.ts';

/** Where and how fallback text is painted: its wobble offset, fill and glow passes. */
export interface FallbackTextStyle {
  dx: number;
  dy: number;
  fill: string;
  glows: GlowPass[];
}

/**
 * The effects that apply to fallback text (glow, strokeGradient, wobble) at
 * left edge `x` and `baseline`, both in the canvas's content space.
 */
export function fallbackTextStyle(
  x: number,
  baseline: number,
  fontSize: number,
  color: string,
  effects: ResolvedEffect[],
  seed: number,
): FallbackTextStyle {
  const wobbleEffect = findEffect(effects, 'wobble');
  const strokeGradientEffect = findEffect(effects, 'strokeGradient');

  // Wobble offsets
  let dx = 0;
  let dy = 0;
  if (wobbleEffect) {
    const amplitude = (wobbleEffect.config.amplitude ?? 1.5) * (fontSize / 100);
    const frequency = wobbleEffect.config.frequency ?? 8;
    dx = amplitude * Math.sin(frequency * (baseline * 0.01) + seed);
    dy = amplitude * Math.cos(frequency * (x * 0.01) + seed * 1.3);
  }

  // Gradient / rainbow color
  let fill = color;
  if (strokeGradientEffect) {
    const colors = strokeGradientEffect.config.colors;
    if (colors === 'rainbow') {
      const saturation = strokeGradientEffect.config.saturation ?? 80;
      const lightness = strokeGradientEffect.config.lightness ?? 55;
      const hue = (seed * 137.5) % 360;
      fill = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    } else if (Array.isArray(colors) && colors.length > 0) {
      fill = colors[Math.floor(seed) % colors.length]!;
    }
  }

  // Glow offsets are px here, not font units.
  return { dx, dy, fill, glows: glowPasses(effects, color, fontSize, 1) };
}

/**
 * Draw a fallback glyph (plain text) with applicable effects (glow, strokeGradient, wobble).
 * `text` may be a run of characters, drawn in `direction` from its left edge `x`.
 */
export function drawFallbackGlyph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  fontSize: number,
  fontFamily: string,
  color: string,
  effects: ResolvedEffect[] = [],
  seed = 0,
  direction: CanvasDirection = 'ltr',
) {
  const { dx, dy, fill, glows } = fallbackTextStyle(x, baseline, fontSize, color, effects, seed);
  const drawX = x + dx;
  const drawY = baseline + dy;

  ctx.save();
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  // `x` is the text's left edge. The default 'start' alignment would take it
  // as the right edge on a canvas inheriting an RTL paragraph's direction.
  ctx.textAlign = 'left';
  ctx.direction = direction;

  // Glow passes
  for (const glow of glows) {
    ctx.save();
    ctx.shadowBlur = glow.blur;
    ctx.shadowColor = glow.color;
    ctx.shadowOffsetX = glow.dx;
    ctx.shadowOffsetY = glow.dy;
    ctx.fillStyle = glow.color;
    ctx.fillText(text, drawX, drawY);
    ctx.restore();
  }

  // Main text
  ctx.fillStyle = fill;
  ctx.fillText(text, drawX, drawY);

  ctx.restore();
}
