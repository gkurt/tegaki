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

// --- Wobbled glyph outlines (clip-to-text masks) ---

const PATH_TOKEN = /[MmLlHhVvQqCcZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/**
 * SVG path data (M/L/H/V/Q/C/Z, absolute or relative) flattened into closed
 * polygons, one flat `[x0, y0, x1, y1, …]` array per contour, with vertices
 * at most `step` apart along each segment (Infinity: line ends only, 8 per
 * curve). The closing vertex is dropped when it repeats the first.
 */
export function flattenPath(d: string, step: number): number[][] {
  const tokens = d.match(PATH_TOKEN) ?? [];
  const contours: number[][] = [];
  let pts: number[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const pieces = (len: number, fallback: number) => (Number.isFinite(step) && step > 0 ? Math.max(1, Math.ceil(len / step)) : fallback);
  const close = () => {
    const n = pts.length;
    if (n >= 4 && pts[n - 2] === pts[0] && pts[n - 1] === pts[1]) pts.length = n - 2;
    if (pts.length >= 6) contours.push(pts);
    pts = [];
  };
  const lineTo = (x: number, y: number) => {
    const n = pieces(Math.hypot(x - cx, y - cy), 1);
    for (let i = 1; i <= n; i++) pts.push(cx + ((x - cx) * i) / n, cy + ((y - cy) * i) / n);
    cx = x;
    cy = y;
  };
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        close();
        cx = sx = ox + num();
        cy = sy = oy + num();
        pts.push(cx, cy);
        // Further pairs after a moveto are linetos.
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L':
        lineTo(ox + num(), oy + num());
        break;
      case 'H':
        lineTo(ox + num(), cy);
        break;
      case 'V':
        lineTo(cx, oy + num());
        break;
      case 'Q': {
        const x1 = ox + num();
        const y1 = oy + num();
        const x = ox + num();
        const y = oy + num();
        const n = pieces(Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x - x1, y - y1), 8);
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          pts.push(u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y);
        }
        cx = x;
        cy = y;
        break;
      }
      case 'C': {
        const x1 = ox + num();
        const y1 = oy + num();
        const x2 = ox + num();
        const y2 = oy + num();
        const x = ox + num();
        const y = oy + num();
        const n = pieces(Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2), 8);
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const e = t * t * t;
          pts.push(a * cx + b * x1 + c * x2 + e * x, a * cy + b * y1 + c * y2 + e * y);
        }
        cx = x;
        cy = y;
        break;
      }
      case 'Z':
        close();
        cx = sx;
        cy = sy;
        break;
      default:
        // Unknown command or a stray number: skip the token.
        i++;
    }
  }
  close();
  return contours;
}

/**
 * A glyph outline (SVG path data in font units, y up) redrawn with the wobble
 * `drawGlyph` gives its strokes: flattened as finely as the strokes are
 * subdivided (`segmentLengthFU`), every vertex displaced by `wobbleDx` /
 * `wobbleDy` at its index along the contour. Clip-to-text masks with it, so a
 * wobble moves the letter's edges rather than vanishing inside a fixed outline.
 */
export function wobbledOutline(d: string, fx: Pick<StrokeEffects, 'wobbleDx' | 'wobbleDy'>, segmentLengthFU: number): string {
  let out = '';
  for (const contour of flattenPath(d, segmentLengthFU)) {
    for (let i = 0; i < contour.length; i += 2) {
      const x = contour[i]!;
      // Strokes are y-down, outlines y-up.
      const y = -contour[i + 1]!;
      const k = i / 2;
      out += `${i === 0 ? 'M' : 'L'}${round2(x + fx.wobbleDx(x, y, k))} ${round2(-(y + fx.wobbleDy(x, y, k)))}`;
    }
    out += 'Z';
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
