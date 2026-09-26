import { createPlugin, type GlyphPlacement } from 'tegaki/core';

/** A point leant by `shear` (the tangent of the angle) about its glyph's baseline: its height above the baseline moves it right. */
export function leanAbout(p: { x: number; y: number }, place: GlyphPlacement, shear: number): { x: number; y: number } {
  const baseline = place.y + place.ascender * place.scale;
  return { x: p.x + (baseline - p.y) * shear, y: p.y };
}

/**
 * Italic, or backhand: every glyph leant over about its own baseline, so
 * the text leans while its letters stay where they sit on the line. Its
 * strokes and its outline lean alike (`geometry` + `outline`), so
 * clip-to-text leans with the ink.
 */
export const slantPlugin = createPlugin({
  name: 'slant',
  label: 'Slant',
  description: 'Every glyph leant over about its baseline — italic, or backhand. geometry + outline.',
  params: {
    angle: {
      type: 'number',
      label: 'Angle',
      description: 'Degrees right of upright (left when negative).',
      default: 12,
      min: -25,
      max: 35,
      step: 1,
    },
  },
  presets: {
    Backhand: { angle: -12 },
    Racing: { angle: 28 },
  },
  setup: ({ angle }) => {
    const shear = Math.tan((angle * Math.PI) / 180);
    return {
      geometry: (path, g) => path.map((p) => ({ ...p, ...leanAbout(p, g.place, shear) })),
      outline: (contour, o) => contour.map((p) => leanAbout(p, o.place, shear)),
    };
  },
});
