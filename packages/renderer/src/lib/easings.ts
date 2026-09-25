/**
 * Named easing curves `(0–1) → (0–1)` for `TimelineConfig.strokeEasing` /
 * `glyphEasing` that the CLI's `--stroke-easing` / `--glyph-easing` take.
 * Mirrors the studio's `EASING_PRESETS` (packages/website/.../preview/constants.ts),
 * so a name copied from a studio URL (`se` / `ge`) means the same curve.
 */
export const EASINGS = {
  linear: (t: number) => t,
  'ease-out-quad': (t: number) => 1 - (1 - t) * (1 - t),
  'ease-out-cubic': (t: number) => 1 - (1 - t) ** 3,
  'ease-out-expo': (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  'ease-in-quad': (t: number) => t * t,
  'ease-in-cubic': (t: number) => t ** 3,
  'ease-in-out-quad': (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  'ease-in-out-cubic': (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
} satisfies Record<string, (t: number) => number>;

export type EasingName = keyof typeof EASINGS;
