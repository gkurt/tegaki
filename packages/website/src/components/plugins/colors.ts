import { createPlugin, type StrokeFrame } from 'tegaki/core';

export const PALETTES = {
  rainbow: ['#e63946', '#f3722c', '#f8c630', '#43aa8b', '#277da1', '#6a4c93'],
  pastel: ['#f4a6c1', '#f7c59f', '#9ed8c6', '#a0c4ff', '#cdb4db'],
  crayon: ['#d62828', '#f77f00', '#e9b10c', '#2a9d8f', '#264653'],
  ocean: ['#03045e', '#0077b6', '#00a6c8', '#48cae4'],
  sunset: ['#ff4e50', '#fc913a', '#e6b800', '#ea4c89', '#8a2be2'],
  inks: ['#1b2a6b', '#5b1a3a', '#1f4d3a', '#3d2c8d', '#6b3a1b'],
} as const;

export type Palette = keyof typeof PALETTES;

/** Which color a stroke takes: its glyph's place in the text, or its own among the text's strokes. */
export function colorIndex(stroke: Pick<StrokeFrame, 'entryIndex' | 'strokeIndex'>, by: 'glyph' | 'stroke'): number {
  return by === 'glyph' ? stroke.entryIndex : stroke.entryIndex * 3 + stroke.strokeIndex;
}

/** The color for index `i`: the palette in turn, or — shuffled — one picked by `random`, never the same as the one before. */
export function pickColor(colors: readonly string[], i: number, random?: (i: number) => number): string {
  if (!random) return colors[i % colors.length]!;
  const n = colors.length;
  const at = (k: number) => Math.floor(random(k) * n) % n;
  // Pick from the colors other than the previous index's, so neighbours differ.
  const prev = i > 0 ? at(i - 1) : -1;
  const own = Math.floor(random(i) * (prev < 0 ? n : n - 1));
  return colors[prev >= 0 && own >= prev ? own + 1 : own]!;
}

/**
 * Each glyph, or each stroke, in its own color from a palette — in turn or
 * shuffled by the seed. A `paint` plugin: it changes the style the rest of
 * the chain paints with, so a brush or an echo paints in these colors too.
 */
export const colorsPlugin = createPlugin({
  name: 'colors',
  label: 'Colors',
  description: 'Each glyph or stroke in its own color from a palette. paint.',
  params: {
    palette: {
      type: 'select',
      label: 'Palette',
      default: 'rainbow',
      options: [
        { value: 'rainbow', label: 'Rainbow' },
        { value: 'pastel', label: 'Pastel' },
        { value: 'crayon', label: 'Crayon' },
        { value: 'ocean', label: 'Ocean' },
        { value: 'sunset', label: 'Sunset' },
        { value: 'inks', label: 'Fountain inks' },
      ],
    },
    by: {
      type: 'select',
      label: 'By',
      default: 'glyph',
      options: [
        { value: 'glyph', label: 'Glyph' },
        { value: 'stroke', label: 'Stroke' },
      ],
    },
    shuffle: { type: 'boolean', label: 'Shuffle', description: 'Pick the colors by the seed instead of in turn.', default: false },
  },
  presets: {
    Crayons: { palette: 'crayon', by: 'stroke', shuffle: true },
    Inks: { palette: 'inks', shuffle: true },
  },
  setup: ({ palette, by, shuffle }) => {
    const colors = PALETTES[palette];
    return {
      paint(s, next) {
        const random = shuffle ? (i: number) => s.random(`colors:${i}`)() : undefined;
        next({ ...s, style: pickColor(colors, colorIndex(s.stroke, by), random) });
      },
    };
  },
});
