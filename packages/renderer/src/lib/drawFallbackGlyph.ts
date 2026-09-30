/**
 * Draw a fallback glyph (plain text, for a character the bundle has no
 * strokes for) in the text's color. `text` may be a run of characters, drawn
 * in `direction` from its left edge `x`. The plugins' `ink` hooks see it as
 * ink, so a glow over the clipped ink takes it in.
 */
export function drawFallbackGlyph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  fontSize: number,
  fontFamily: string,
  color: string,
  direction: CanvasDirection = 'ltr',
) {
  ctx.save();
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  // `x` is the text's left edge. The default 'start' alignment would take it
  // as the right edge on a canvas inheriting an RTL paragraph's direction.
  ctx.textAlign = 'left';
  ctx.direction = direction;
  ctx.fillStyle = color;
  ctx.fillText(text, x, baseline);
  ctx.restore();
}
