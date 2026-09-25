import { findEffect, findEffects, type ResolvedEffect } from './effects.ts';
import { resolveCSSLength } from './utils.ts';

// The per-stroke effect math shared by the canvas renderer (`drawGlyph`) and
// the SVG serializer (`svgExport`), so both draw the same wobble, taper,
// gradient colors and glow.

// --- Color helpers ---

function parseColor(color: string): [number, number, number, number] {
  const h = color.replace('#', '');
  if (h.length === 3) {
    return [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16), 1];
  }
  if (h.length === 4) {
    return [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16), parseInt(h[3]! + h[3]!, 16) / 255];
  }
  if (h.length === 8) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255];
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
}

function lerpColor(a: [number, number, number, number], b: [number, number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  const al = a[3] + (b[3] - a[3]) * t;
  if (al >= 1) return `rgb(${r},${g},${bl})`;
  return `rgba(${r},${g},${bl},${al.toFixed(3)})`;
}

function gradientColor(progress: number, colors: string[], seed: number): string {
  if (colors.length === 0) return '#000';
  if (colors.length === 1) return colors[0]!;
  const t = (((progress + seed * 0.1) % 1) + 1) % 1;
  const scaledT = t * (colors.length - 1);
  const i = Math.min(Math.floor(scaledT), colors.length - 2);
  const frac = scaledT - i;
  return lerpColor(parseColor(colors[i]!), parseColor(colors[i + 1]!), frac);
}

function rainbowColor(progress: number, saturation: number, lightness: number, seed: number): string {
  const hue = (progress * 360 + seed * 137.5) % 360;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// --- Noise helper for wobble ---

function hash(x: number): number {
  let h = (x * 2654435761) | 0;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = (h >>> 16) ^ h;
  return (h & 0x7fffffff) / 0x7fffffff; // 0-1
}

function noise1d(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f); // smoothstep
  return hash(i + seed * 7919) * (1 - t) + hash(i + 1 + seed * 7919) * t;
}

/** Default stroke easing: ease-out quad. */
export function defaultStrokeEasing(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** One `glow` pass, resolved to px: the canvas shadow it stands for. */
export interface GlowPass {
  /** Paint of the stroke copy and its shadow. */
  color: string;
  /** Canvas `shadowBlur`, in px (a Gaussian of σ = blur / 2). */
  blur: number;
  /** Shadow offset in px. */
  dx: number;
  dy: number;
}

/**
 * The glow passes as canvas shadows. Stroke glows take their offsets in font
 * units (`offsetScale` = fontSize / unitsPerEm); fallback text takes them in
 * px (`offsetScale` = 1).
 */
export function glowPasses(effects: ResolvedEffect[], color: string, fontSize: number, offsetScale: number): GlowPass[] {
  return findEffects(effects, 'glow').map((glow) => ({
    color: glow.config.color ?? color,
    blur: resolveCSSLength(glow.config.radius ?? 8, fontSize),
    dx: (glow.config.offsetX ?? 0) * offsetScale,
    dy: (glow.config.offsetY ?? 0) * offsetScale,
  }));
}

export interface StrokeEffects {
  /** Per-point width blend (0 = uniform mean width, 1 = fully per-point width). */
  pressure: number;
  /** Wobble offsets in font units at a sub-vertex (fractional `idx` keeps the phase continuous). */
  wobbleDx: (x: number, y: number, idx: number) => number;
  wobbleDy: (x: number, y: number, idx: number) => number;
  /** Taper multiplier (0–1) at a stroke progress. */
  taper: (progress: number) => number;
  hasTaper: boolean;
  /** Per-progress color under `strokeGradient`, else the base color. */
  colorAt: (progress: number) => string;
  hasStrokeGradient: boolean;
  /** Whether segment widths vary (pressure or taper), forcing one stroke per sub-segment. */
  needsPerSegment: boolean;
}

/** The per-stroke effects of a glyph drawn with `seed`. */
export function strokeEffects(effects: ResolvedEffect[], seed: number, color: string): StrokeEffects {
  const wobbleEffect = findEffect(effects, 'wobble');
  const pressureEffect = findEffect(effects, 'pressureWidth');
  const taperEffect = findEffect(effects, 'taper');
  const strokeGradientEffect = findEffect(effects, 'strokeGradient');

  const pressure = pressureEffect ? Math.max(0, Math.min(pressureEffect.config.strength ?? 1, 1)) : 0;

  const wobbleAmplitude = wobbleEffect ? (wobbleEffect.config.amplitude ?? 1.5) : 0;
  const wobbleFrequency = wobbleEffect ? (wobbleEffect.config.frequency ?? 8) : 0;
  const wobbleMode = wobbleEffect?.config.mode ?? 'sine';
  const hasWobble = !!wobbleEffect;

  const taperStart = taperEffect ? Math.max(0, Math.min(taperEffect.config.startLength ?? 0.15, 1)) : 0;
  const taperEnd = taperEffect ? Math.max(0, Math.min(taperEffect.config.endLength ?? 0.15, 1)) : 0;

  const gradientColors = strokeGradientEffect?.config.colors;
  const isRainbow = gradientColors === 'rainbow';
  const gradientColorStops = Array.isArray(gradientColors) ? gradientColors : undefined;
  const gradientSaturation = strokeGradientEffect?.config.saturation ?? 80;
  const gradientLightness = strokeGradientEffect?.config.lightness ?? 55;

  // dx depends on y; dy depends on x — the asymmetry keeps the perpendicular
  // wobble component out of phase with the along-stroke one.
  const wobbleDx = (_x: number, y: number, idx: number): number => {
    if (!hasWobble) return 0;
    if (wobbleMode === 'noise') return wobbleAmplitude * (noise1d(y * 0.1 + idx * 0.7, seed) * 2 - 1);
    return wobbleAmplitude * Math.sin(wobbleFrequency * (y * 0.01 + idx * 0.7) + seed);
  };
  const wobbleDy = (x: number, _y: number, idx: number): number => {
    if (!hasWobble) return 0;
    if (wobbleMode === 'noise') return wobbleAmplitude * (noise1d(x * 0.1 + idx * 0.5, seed * 1.3 + 1000) * 2 - 1);
    return wobbleAmplitude * Math.cos(wobbleFrequency * (x * 0.01 + idx * 0.5) + seed * 1.3);
  };

  const taper = (progress: number): number => {
    let m = 1;
    if (taperStart > 0 && progress < taperStart) m = Math.min(m, progress / taperStart);
    if (taperEnd > 0 && progress > 1 - taperEnd) m = Math.min(m, (1 - progress) / taperEnd);
    return m;
  };

  const colorAt = (progress: number): string => {
    if (isRainbow) return rainbowColor(progress, gradientSaturation, gradientLightness, seed);
    if (gradientColorStops) return gradientColor(progress, gradientColorStops, seed);
    return color;
  };

  return {
    pressure,
    wobbleDx,
    wobbleDy,
    taper,
    hasTaper: !!taperEffect,
    colorAt,
    hasStrokeGradient: !!strokeGradientEffect,
    needsPerSegment: pressure > 0 || !!taperEffect,
  };
}
