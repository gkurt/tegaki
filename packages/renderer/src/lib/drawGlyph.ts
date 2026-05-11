import type { LineCap, TegakiGlyphData } from '../types.ts';
import { findEffect, findEffects, type ResolvedEffect } from './effects.ts';
import { type SubdividedStroke, subdivideStroke } from './strokeCache.ts';
import { resolveCSSLength } from './utils.ts';

type Stroke = TegakiGlyphData['s'][number];

interface GlyphPosition {
  /** X offset in CSS pixels */
  x: number;
  /** Y offset in CSS pixels (top of em square) */
  y: number;
  /** Font size in CSS pixels */
  fontSize: number;
  /** Units per em from the font */
  unitsPerEm: number;
  /** Font ascender in font units */
  ascender: number;
  /** Font descender in font units (negative) */
  descender: number;
}

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

/** Default stroke easing: ease-out exponential. */
function defaultStrokeEasing(t: number): number {
  return 1 - (1 - t) * (1 - t); // Ease out quad
}

/**
 * Draw a single glyph's strokes onto a canvas context, animated up to `localTime`.
 * `localTime` is seconds relative to this glyph's start (0 = glyph begins).
 *
 * `getSubdivided` returns a shared, cached subdivision of each stroke (in font
 * units, pre-wobble). The engine owns the cache and invalidates it when the
 * font, fontSize, or segment size changes; if omitted here, strokes are
 * subdivided inline each call (useful for testing).
 *
 * `strokeDelays` is a sparse per-stroke override of the bundled `d` field. When
 * `strokeDelays[i]` is a number, it replaces `glyph.s[i].d` as the stroke's
 * delay relative to `localTime = 0`. Used by the timeline scheduler to defer
 * priority-tagged strokes (disconnected marks / i-dots / Arabic nuqṭa) to
 * after every body stroke in the word has drawn.
 *
 * `strokeTimeScale` multiplies both bundled `d` and `a` so a glyph's strokes
 * fit a stretched/compressed time slot (used by stagger mode with a static
 * `duration`). Defaults to `1` (no scaling). `strokeDelays` are already
 * scheduler-relative seconds and are not affected by this scale.
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: TegakiGlyphData,
  pos: GlyphPosition,
  localTime: number,
  lineCap: LineCap,
  color: string,
  effects: ResolvedEffect[] = [],
  seed = 0,
  getSubdivided?: (stroke: Stroke) => SubdividedStroke,
  strokeEasing: ((t: number) => number) | undefined = defaultStrokeEasing,
  strokeScale = 1,
  strokeStyleOverride?: string | CanvasGradient | CanvasPattern,
  strokeDelays?: (number | undefined)[],
  strokeTimeScale = 1,
) {
  // Default stroke paint. When a layout-spanning effect (e.g. `globalGradient`)
  // provides a CanvasGradient/Pattern via `strokeStyleOverride`, use it as the
  // default paint for main strokes and dots. `color` (always a string) is still
  // the source of truth for `shadowColor` — Canvas shadows don't accept
  // gradients. A per-stroke `strokeGradient` still overrides this per segment.
  const defaultStrokePaint: string | CanvasGradient | CanvasPattern = strokeStyleOverride ?? color;
  const scale = pos.fontSize / pos.unitsPerEm;
  const ox = pos.x;
  const oy = pos.y;

  const glowEffects = findEffects(effects, 'glow');
  const wobbleEffect = findEffect(effects, 'wobble');
  const pressureEffect = findEffect(effects, 'pressureWidth');
  const taperEffect = findEffect(effects, 'taper');
  const strokeGradientEffect = findEffect(effects, 'strokeGradient');

  // Pressure params (0 = uniform avg width, 1 = fully per-point width)
  const pressureAmount = pressureEffect ? Math.max(0, Math.min(pressureEffect.config.strength ?? 1, 1)) : 0;

  // Wobble params
  const wobbleAmplitude = wobbleEffect ? (wobbleEffect.config.amplitude ?? 1.5) : 0;
  const wobbleFrequency = wobbleEffect ? (wobbleEffect.config.frequency ?? 8) : 0;
  const wobbleMode = wobbleEffect?.config.mode ?? 'sine';
  const hasWobble = !!wobbleEffect;

  // Taper params
  const taperStart = taperEffect ? Math.max(0, Math.min(taperEffect.config.startLength ?? 0.15, 1)) : 0;
  const taperEnd = taperEffect ? Math.max(0, Math.min(taperEffect.config.endLength ?? 0.15, 1)) : 0;

  // Gradient params
  const gradientColors = strokeGradientEffect?.config.colors;
  const isRainbow = gradientColors === 'rainbow';
  const gradientColorStops = Array.isArray(gradientColors) ? gradientColors : undefined;
  const gradientSaturation = strokeGradientEffect?.config.saturation ?? 80;
  const gradientLightness = strokeGradientEffect?.config.lightness ?? 55;
  const hasStrokeGradient = !!strokeGradientEffect;

  // Effects that vary per-segment require splitting the polyline into
  // individual stroke() calls. Gradient also varies per-segment but via
  // strokeStyle, not lineWidth.
  const needsPerSegment = pressureAmount > 0 || !!taperEffect;

  // Fallback subdivider for callers that don't thread the engine's cache
  // (tests, standalone use). Engine always provides a cached version.
  const subdivide = getSubdivided ?? ((s: Stroke) => subdivideStroke(s, Infinity));

  // Wobble offsets (in font units). Evaluated once per rendered sub-vertex;
  // fractional `idx` keeps the wobble phase continuous across sub-segments.
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

  // Helper: convert font-unit point to pixel
  const px = (x: number) => ox + x * scale;
  const py = (y: number) => oy + (y + pos.ascender) * scale;

  // Helper: get color for a given stroke progress
  const colorAt = (progress: number): string => {
    if (isRainbow) return rainbowColor(progress, gradientSaturation, gradientLightness, seed);
    if (gradientColorStops) return gradientColor(progress, gradientColorStops, seed);
    return color;
  };

  // Helper: taper multiplier (0-1) for a given stroke progress
  const taperMultiplier = (progress: number): number => {
    let m = 1;
    if (taperStart > 0 && progress < taperStart) m = Math.min(m, progress / taperStart);
    if (taperEnd > 0 && progress > 1 - taperEnd) m = Math.min(m, (1 - progress) / taperEnd);
    return m;
  };

  for (let si = 0; si < glyph.s.length; si++) {
    const stroke = glyph.s[si]!;
    // Stagger-mode static duration scales bundled `d` and `a`; scheduler-set
    // `strokeDelays` (dot deferral) are already in entry-relative seconds and
    // bypass the scale.
    const delay = strokeDelays?.[si] ?? stroke.d * strokeTimeScale;
    if (localTime < delay) continue;
    const elapsed = localTime - delay;
    const animDuration = stroke.a * strokeTimeScale;
    const linearProgress = animDuration > 0 ? Math.min(elapsed / animDuration, 1) : 1;
    const progress = strokeEasing ? strokeEasing(linearProgress) : linearProgress;

    const rawPts = stroke.p;
    if (rawPts.length === 0) continue;

    // Degenerate polylines (all points coincident) render as dots. Older
    // bundles can emit `[[x,y,w],[x,y,w]]` for Arabic nuqta-sized blobs where
    // the pipeline's orient step collapsed two near-identical skeleton pixels
    // into the same point; without this check they'd be dropped by the
    // `totalLen <= 0` guard below.
    const isDegenerate = rawPts.length > 1 && rawPts.every((p) => p[0] === rawPts[0]![0] && p[1] === rawPts[0]![1]);

    // --- Single-point dot (bypass cache; there is nothing to subdivide) ---
    if (rawPts.length === 1 || isDegenerate) {
      if (progress <= 0) continue;
      const p = rawPts[0]!;
      const dotX = px(p[0]! + wobbleDx(p[0]!, p[1]!, 0));
      const dotY = py(p[1]! + wobbleDy(p[0]!, p[1]!, 0));
      const baseLineWidth = Math.max(p[2]!, 0.5) * scale * strokeScale;
      const perPointDot = Math.max(p[2]!, 0.5) * scale * strokeScale;
      let dotWidth = baseLineWidth + (perPointDot - baseLineWidth) * pressureAmount;
      dotWidth *= taperMultiplier(0.5);

      // Glow passes for dots
      for (const glow of glowEffects) {
        ctx.save();
        ctx.shadowBlur = resolveCSSLength(glow.config.radius ?? 8, pos.fontSize);
        ctx.shadowColor = glow.config.color ?? color;
        ctx.shadowOffsetX = (glow.config.offsetX ?? 0) * scale;
        ctx.shadowOffsetY = (glow.config.offsetY ?? 0) * scale;
        ctx.fillStyle = glow.config.color ?? color;
        ctx.beginPath();
        if (lineCap === 'round') {
          ctx.arc(dotX, dotY, dotWidth / 2, 0, Math.PI * 2);
        } else {
          ctx.rect(dotX - dotWidth / 2, dotY - dotWidth / 2, dotWidth, dotWidth);
        }
        ctx.fill();
        ctx.restore();
      }

      // Main dot. strokeGradient needs a per-point color (rainbow hue or array
      // stop 0); otherwise let the default paint apply — a CanvasGradient from
      // globalGradient samples by dot position automatically.
      ctx.fillStyle = hasStrokeGradient ? colorAt(0) : defaultStrokePaint;
      ctx.beginPath();
      if (lineCap === 'round') {
        ctx.arc(dotX, dotY, dotWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(dotX - dotWidth / 2, dotY - dotWidth / 2, dotWidth, dotWidth);
      }
      continue;
    }

    // --- Multi-point stroke: consume cached subdivision ---
    const cached = subdivide(stroke);
    const { vertices, totalLen, avgWidth } = cached;
    if (vertices.length < 2 || totalLen <= 0) continue;

    const drawLen = totalLen * progress;
    if (drawLen <= 0) continue;

    const baseLineWidth = Math.max(avgWidth, 0.5) * scale * strokeScale;

    // Binary search for the last fully-included vertex — i.e. the largest i
    // with vertices[i].cumLen <= drawLen.
    let lo = 0;
    let hi = vertices.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (vertices[mid]!.cumLen <= drawLen) lo = mid;
      else hi = mid - 1;
    }
    const lastIdx = lo;

    // Interpolate the tail of the last, partially-drawn sub-segment.
    let tailX = 0;
    let tailY = 0;
    let tailWidth = 0;
    let tailIdx = 0;
    let tailCumLen = 0;
    let hasTail = false;
    if (lastIdx + 1 < vertices.length && drawLen > vertices[lastIdx]!.cumLen) {
      const a = vertices[lastIdx]!;
      const b = vertices[lastIdx + 1]!;
      const segLen = b.cumLen - a.cumLen;
      const t = segLen > 0 ? (drawLen - a.cumLen) / segLen : 0;
      tailX = a.x + (b.x - a.x) * t;
      tailY = a.y + (b.y - a.y) * t;
      tailWidth = a.width + (b.width - a.width) * t;
      tailIdx = a.idx + (b.idx - a.idx) * t;
      tailCumLen = drawLen;
      hasTail = true;
    }

    // Pre-transform every visible vertex (raw + wobble + scale + translate)
    // exactly once — glow and main passes both iterate this array, and the
    // per-segment case needs stable endpoints across its N stroke() calls.
    const tcount = lastIdx + 1 + (hasTail ? 1 : 0);
    const txs: number[] = new Array(tcount);
    const tys: number[] = new Array(tcount);
    for (let i = 0; i <= lastIdx; i++) {
      const v = vertices[i]!;
      txs[i] = px(v.x + wobbleDx(v.x, v.y, v.idx));
      tys[i] = py(v.y + wobbleDy(v.x, v.y, v.idx));
    }
    if (hasTail) {
      txs[tcount - 1] = px(tailX + wobbleDx(tailX, tailY, tailIdx));
      tys[tcount - 1] = py(tailY + wobbleDy(tailX, tailY, tailIdx));
    }

    ctx.lineCap = lineCap;
    ctx.lineJoin = 'round';

    // Trace the full visible polyline as one Path2D primitive. Used for both
    // glow (where it's critical — shadowBlur cost is per stroke() call, so
    // coalescing into one call matters) and the no-per-segment-effect main
    // draw.
    const tracePolyline = () => {
      ctx.beginPath();
      ctx.moveTo(txs[0]!, tys[0]!);
      for (let i = 1; i < tcount; i++) ctx.lineTo(txs[i]!, tys[i]!);
    };

    // --- Glow passes (one stroke() call per glow over the full polyline) ---
    for (const glow of glowEffects) {
      ctx.save();
      ctx.shadowBlur = resolveCSSLength(glow.config.radius ?? 8, pos.fontSize);
      ctx.shadowColor = glow.config.color ?? color;
      ctx.shadowOffsetX = (glow.config.offsetX ?? 0) * scale;
      ctx.shadowOffsetY = (glow.config.offsetY ?? 0) * scale;
      ctx.strokeStyle = glow.config.color ?? color;
      ctx.lineWidth = baseLineWidth;
      tracePolyline();
      ctx.stroke();
      ctx.restore();
    }

    // --- Main stroke ---
    if (!needsPerSegment && !hasStrokeGradient) {
      // Fast path: single stroke() over the whole truncated polyline.
      ctx.strokeStyle = defaultStrokePaint;
      ctx.lineWidth = baseLineWidth;
      tracePolyline();
      ctx.stroke();
    } else {
      // Per-segment path: each sub-segment is its own mini-stroke so
      // lineWidth / strokeStyle can vary. Adjacent round-capped endpoints
      // overlap to read as a continuous line.
      const invTotalLen = 1 / totalLen;
      for (let i = 1; i < tcount; i++) {
        const aCum = i - 1 <= lastIdx ? vertices[i - 1]!.cumLen : tailCumLen;
        const bCum = i <= lastIdx ? vertices[i]!.cumLen : tailCumLen;
        const aWidth = i - 1 <= lastIdx ? vertices[i - 1]!.width : tailWidth;
        const bWidth = i <= lastIdx ? vertices[i]!.width : tailWidth;
        const midProgress = (aCum + bCum) * 0.5 * invTotalLen;

        let lw = baseLineWidth;
        if (needsPerSegment) {
          const perPoint = (aWidth + bWidth) * 0.5 * scale * strokeScale;
          const w = Math.max(baseLineWidth + (perPoint - baseLineWidth) * pressureAmount, 0.5 * scale * strokeScale);
          lw = w * taperMultiplier(midProgress);
        }
        ctx.lineWidth = lw;
        ctx.strokeStyle = hasStrokeGradient ? colorAt(midProgress) : defaultStrokePaint;
        ctx.beginPath();
        ctx.moveTo(txs[i - 1]!, tys[i - 1]!);
        ctx.lineTo(txs[i]!, tys[i]!);
        ctx.stroke();
      }
    }
  }
}
