import type { LineCap, TegakiGlyphData } from '../types.ts';
import type { ResolvedEffect } from './effects.ts';
import { type SubdividedStroke, subdivideStroke } from './strokeCache.ts';
import { defaultStrokeEasing, glowPasses, strokeEffects } from './strokeEffects.ts';

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

  const glows = glowPasses(effects, color, pos.fontSize, scale);
  const {
    pressure: pressureAmount,
    wobbleDx,
    wobbleDy,
    taper: taperMultiplier,
    colorAt,
    hasStrokeGradient,
    needsPerSegment,
  } = strokeEffects(effects, seed, color);

  // Fallback subdivider for callers that don't thread the engine's cache
  // (tests, standalone use). Engine always provides a cached version.
  const subdivide = getSubdivided ?? ((s: Stroke) => subdivideStroke(s, Infinity));

  // Helper: convert font-unit point to pixel
  const px = (x: number) => ox + x * scale;
  const py = (y: number) => oy + (y + pos.ascender) * scale;

  // Helper: fill the nib stamps (see `Nib`) the pen has reached. `reached`
  // is the drawn length in font units; `pointCumLen[k]` is when the pen
  // passes point k. Stamps follow the stroke's wobble, taper and scale.
  const fillNibs = (
    stroke: Stroke,
    reached: number,
    pointCumLen: number[] | undefined,
    totalLen: number,
    paint: (progress: number) => string | CanvasGradient | CanvasPattern,
  ) => {
    const nibs = stroke.n;
    if (!nibs) return;
    for (const nib of nibs) {
      const k = nib[0]!;
      const at = stroke.p[k];
      if (!at) continue;
      const passed = pointCumLen?.[k] ?? 0;
      if (passed > reached) continue;
      const progressAt = totalLen > 0 ? passed / totalLen : 0.5;
      const m = scale * strokeScale * taperMultiplier(progressAt);
      const rx = (nib[3]! / 2) * m;
      const ry = (nib[4]! / 2) * m;
      if (rx <= 0 || ry <= 0) continue;
      const angle = nib[5]!;
      const cx = px(at[0]! + nib[1]! + wobbleDx(at[0]!, at[1]!, k));
      const cy = py(at[1]! + nib[2]! + wobbleDy(at[0]!, at[1]!, k));
      ctx.fillStyle = paint(progressAt);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, angle, 0, Math.PI * 2);
      ctx.fill();
    }
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
      for (const glow of glows) {
        ctx.save();
        ctx.shadowBlur = glow.blur;
        ctx.shadowColor = glow.color;
        ctx.shadowOffsetX = glow.dx;
        ctx.shadowOffsetY = glow.dy;
        ctx.fillStyle = glow.color;
        ctx.beginPath();
        if (lineCap === 'round') {
          ctx.arc(dotX, dotY, dotWidth / 2, 0, Math.PI * 2);
        } else {
          ctx.rect(dotX - dotWidth / 2, dotY - dotWidth / 2, dotWidth, dotWidth);
        }
        ctx.fill();
        fillNibs(stroke, 0, undefined, 0, () => glow.color);
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
      fillNibs(stroke, 0, undefined, 0, () => (hasStrokeGradient ? colorAt(0) : defaultStrokePaint));
      continue;
    }

    // --- Multi-point stroke: consume cached subdivision ---
    const cached = subdivide(stroke);
    const { vertices, totalLen, avgWidth, pointCumLen } = cached;
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
    for (const glow of glows) {
      ctx.save();
      ctx.shadowBlur = glow.blur;
      ctx.shadowColor = glow.color;
      ctx.shadowOffsetX = glow.dx;
      ctx.shadowOffsetY = glow.dy;
      ctx.strokeStyle = glow.color;
      ctx.lineWidth = baseLineWidth;
      tracePolyline();
      ctx.stroke();
      fillNibs(stroke, drawLen, pointCumLen, totalLen, () => glow.color);
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
      // overlap to read as a continuous line. The stroke's cap belongs to its
      // two ends only: a flat or square cap on every sub-segment would show
      // each seam (a fringe of notches along every curve), so the end
      // segments take the cap and a round disc where they meet the rest.
      const invTotalLen = 1 / totalLen;
      const joinDisc = (x: number, y: number, lw: number) => {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(x, y, lw / 2, 0, Math.PI * 2);
        ctx.fill();
      };
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
        const first = i === 1;
        const last = i === tcount - 1;
        ctx.lineCap = lineCap === 'round' || !(first || last) ? 'round' : lineCap;
        ctx.beginPath();
        ctx.moveTo(txs[i - 1]!, tys[i - 1]!);
        ctx.lineTo(txs[i]!, tys[i]!);
        ctx.stroke();
        if (lineCap !== 'round' && first !== last) {
          if (first) joinDisc(txs[i]!, tys[i]!, lw);
          else joinDisc(txs[i - 1]!, tys[i - 1]!, lw);
        }
      }
    }

    // --- Nib stamps, over the stroke they belong to ---
    fillNibs(stroke, drawLen, pointCumLen, totalLen, (progressAt) => (hasStrokeGradient ? colorAt(progressAt) : defaultStrokePaint));
  }
}
