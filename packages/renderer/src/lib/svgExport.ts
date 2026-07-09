import type { LineCap, TegakiGlyphData } from '../types.ts';
import { subdivideStroke } from './strokeCache.ts';

/**
 * One positioned glyph ready to serialize. Coordinates are the engine's ctx
 * space with the pad translation already folded into `ox`/`oy`, so an absolute
 * point is `(ox + fx*scale, oy + (fy + ascender)*scale)` — identical to
 * drawGlyph's `px`/`py` with `pos.x`/`pos.y` pre-offset by padH/padV.
 */
export interface SvgGlyphPlacement {
  glyph: TegakiGlyphData;
  /** Absolute x origin in px (padH + layout x). */
  ox: number;
  /** Absolute y origin in px (padV + line/leading offset). */
  oy: number;
  /** fontSize / unitsPerEm. */
  scale: number;
  /** Font ascender in font units. */
  ascender: number;
  /** Seconds at which this glyph's local time 0 sits on the global timeline. */
  offset: number;
}

export interface SvgExportConfig {
  /** viewBox width in px (canvas CSS width). */
  width: number;
  /** viewBox height in px (canvas CSS height). */
  height: number;
  lineCap: LineCap;
  color: string;
  /** Per-point width blend (0 = uniform mean width, 1 = full per-point). Mirrors pressureWidth. */
  pressure: number;
  /** Subdivision threshold in font units (Infinity to skip). */
  segmentLengthFU: number;
  smoothing: boolean;
  /** Multiplier on every width (mirrors quality.clipText stroke scale). */
  strokeScale: number;
  /** When true, emit a self-drawing animation (dashed-mask reveal per stroke). */
  animated: boolean;
  /**
   * When true, emit a looping CSS-keyframe animation instead of single-play
   * SMIL: each stroke is a constant-width centerline `<path>` whose
   * `stroke-dashoffset` is keyframed to draw, hold, fade out, and reset — the
   * structure the repo's README hero uses (reliable in `<img>`-embedded SVGs,
   * where animated masks are not). Implies `animated`. Constant width only.
   */
  loop?: boolean;
  /** Total timeline duration in seconds (used to terminate animated mode). */
  totalDuration: number;
}

// Loop cycle padding (seconds): hold the finished word, fade it out, then a
// blank gap before the next draw. Mirrors the cadence of the existing README.
const LOOP_HOLD = 1.5;
const LOOP_FADE = 0.3;
const LOOP_GAP = 0.7;

/**
 * Looping CSS-keyframe variant. Each stroke draws via `stroke-dashoffset` on a
 * constant-width path, holds while the rest of the word finishes, fades out
 * together, then resets — animating forever. No masks or SMIL, so it animates
 * in GitHub's `<img>`-embedded SVGs.
 */
function buildLoopingSvg(items: SvgGlyphPlacement[], cfg: SvgExportConfig): string {
  const total = Math.max(cfg.totalDuration, 0.001);
  const cycle = total + LOOP_HOLD + LOOP_FADE + LOOP_GAP;
  const holdEndPct = ((total + LOOP_HOLD) / cycle) * 100;
  const fadeEndPct = ((total + LOOP_HOLD + LOOP_FADE) / cycle) * 100;

  const keyframes: string[] = [];
  const rules: string[] = [];
  const els: string[] = [];
  let si = 0;

  // Track the ink bounds (px) so the viewBox can crop tight to the drawn
  // strokes rather than the full canvas (which includes line-height leading).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number, r: number) => {
    if (x - r < minX) minX = x - r;
    if (y - r < minY) minY = y - r;
    if (x + r > maxX) maxX = x + r;
    if (y + r > maxY) maxY = y + r;
  };

  for (const item of items) {
    const { glyph, ox, oy, scale, ascender, offset } = item;
    const px = (fx: number) => ox + fx * scale;
    const py = (fy: number) => oy + (fy + ascender) * scale;

    for (const stroke of glyph.s) {
      const rawPts = stroke.p;
      if (rawPts.length === 0) continue;
      const beginPct = ((offset + stroke.d) / cycle) * 100;
      const drawEndPct = ((offset + stroke.d + stroke.a) / cycle) * 100;
      // Leading "hidden" stop. Collapse to a single `0%` when the stroke starts
      // at the cycle origin so we never emit a duplicate `0%,0%` selector.
      const lead = beginPct <= 0.005 ? '0%' : `0%,${fmt(beginPct)}%`;

      const isDegenerate = rawPts.length > 1 && rawPts.every((p) => p[0] === rawPts[0]![0] && p[1] === rawPts[0]![1]);
      if (rawPts.length === 1 || isDegenerate) {
        // Dots have no path to dash, so gate their appearance with opacity. The
        // group-level fade (tk-grp) handles the end-of-cycle fade-out.
        const p = rawPts[0]!;
        const w = Math.max(p[2]!, 0.5) * scale * cfg.strokeScale;
        grow(px(p[0]!), py(p[1]!), w / 2);
        if (beginPct <= 0.005) {
          els.push(`<circle cx="${fmt(px(p[0]!))}" cy="${fmt(py(p[1]!))}" r="${fmt(w / 2)}" fill="${cfg.color}" />`);
        } else {
          const onPct = Math.min(beginPct + 0.4, holdEndPct);
          keyframes.push(`@keyframes tk-d${si} { ${lead} { opacity:0 } ${fmt(onPct)}%,100% { opacity:1 } }`);
          rules.push(`.tk-s${si} { animation: tk-d${si} ${fmt(cycle)}s infinite }`);
          els.push(
            `<circle class="tk-s${si}" cx="${fmt(px(p[0]!))}" cy="${fmt(py(p[1]!))}" r="${fmt(w / 2)}" fill="${cfg.color}" opacity="0" />`,
          );
        }
        si++;
        continue;
      }

      const { vertices, totalLen, avgWidth } = subdivideStroke(stroke, cfg.segmentLengthFU, cfg.smoothing);
      if (vertices.length < 2 || totalLen <= 0) continue;
      const d =
        `M ${fmt(px(vertices[0]!.x))} ${fmt(py(vertices[0]!.y))} ` +
        vertices
          .slice(1)
          .map((v) => `L ${fmt(px(v.x))} ${fmt(py(v.y))}`)
          .join(' ');
      let plen = 0;
      for (let i = 1; i < vertices.length; i++) {
        const a = vertices[i - 1]!;
        const b = vertices[i]!;
        plen += Math.hypot((b.x - a.x) * scale, (b.y - a.y) * scale);
      }
      const wpx = Math.max(avgWidth, 0.5) * scale * cfg.strokeScale;
      for (const v of vertices) grow(px(v.x), py(v.y), wpx / 2);
      // Pad the dash by the stroke width so a round cap doesn't peek out when fully hidden.
      const L = plen + wpx;
      // Appearance is gated entirely by stroke-dashoffset (a fully-offset stroke
      // is invisible), so no per-stroke opacity is needed — the group fade
      // handles the loop's fade-out. Reset the offset during the fade/gap window.
      keyframes.push(
        `@keyframes tk-d${si} { ${lead} { stroke-dashoffset:${fmt(L)} } ${fmt(drawEndPct)}%,${fmt(holdEndPct)}% { stroke-dashoffset:0 } ${fmt(fadeEndPct)}%,100% { stroke-dashoffset:${fmt(L)} } }`,
      );
      rules.push(`.tk-s${si} { animation: tk-d${si} ${fmt(cycle)}s infinite }`);
      els.push(
        `<path class="tk-s${si}" d="${d}" fill="none" stroke="${cfg.color}" stroke-width="${fmt(wpx)}" stroke-linecap="${cfg.lineCap}" stroke-linejoin="round" stroke-dasharray="${fmt(L)}" stroke-dashoffset="${fmt(L)}" />`,
      );
      si++;
    }
  }

  // One shared fade keyframe + group class — fades the whole word out at the end
  // of the cycle and back in, instead of 2N per-stroke opacity tracks.
  keyframes.push(`@keyframes tk-fade { 0%,${fmt(holdEndPct)}% { opacity:1 } ${fmt(fadeEndPct)}%,100% { opacity:0 } }`);
  rules.push(`.tk-grp { animation: tk-fade ${fmt(cycle)}s infinite }`);

  // Crop tight to the ink with a small even margin; fall back to the full
  // canvas if nothing was drawn.
  const pad = 8;
  const hasInk = Number.isFinite(minX);
  const vbX = hasInk ? minX - pad : 0;
  const vbY = hasInk ? minY - pad : 0;
  const vbW = hasInk ? maxX - minX + pad * 2 : cfg.width;
  const vbH = hasInk ? maxY - minY + pad * 2 : cfg.height;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}" width="${fmt(vbW)}" height="${fmt(vbH)}">\n` +
    `<style>${keyframes.join(' ')} ${rules.join(' ')}</style>\n<g class="tk-grp">\n${els.join('\n')}\n</g>\n</svg>`
  );
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

// ease-out cubic control points — approximates the engine's default ease-out-quad
// stroke reveal closely enough for the SMIL dashoffset animation.
const EASE_OUT_SPLINE = '0.33 0 0.15 1';

/**
 * Serialize positioned glyphs to a standalone SVG string. Variable width is
 * achieved exactly as the canvas renderer does it (drawGlyph's per-segment
 * path): one `<line>` per sub-segment, each with its own `stroke-width`, round
 * caps overlapping to read continuous.
 *
 * Animated mode reveals each stroke through a `<mask>` whose centerline is
 * stroked thick and dash-animated, so the variable-width fill is uncovered in
 * pen order over the stroke's own [delay, delay+duration] window.
 *
 * Not yet modelled in SVG: glow, wobble, gradient, taper, and clip-to-text.
 * pressureWidth (variable width) is fully honoured.
 */
export function placementsToSvg(items: SvgGlyphPlacement[], cfg: SvgExportConfig): string {
  if (cfg.loop) return buildLoopingSvg(items, cfg);
  const pressure = Math.max(0, Math.min(cfg.pressure, 1));
  const body: string[] = [];
  const defs: string[] = [];
  let maskId = 0;

  for (const item of items) {
    const { glyph, ox, oy, scale, ascender, offset } = item;
    const px = (fx: number) => ox + fx * scale;
    const py = (fy: number) => oy + (fy + ascender) * scale;

    for (const stroke of glyph.s) {
      const rawPts = stroke.p;
      if (rawPts.length === 0) continue;

      const beginAt = offset + stroke.d;
      const dur = stroke.a;

      const isDegenerate = rawPts.length > 1 && rawPts.every((p) => p[0] === rawPts[0]![0] && p[1] === rawPts[0]![1]);

      // --- Dot ---
      if (rawPts.length === 1 || isDegenerate) {
        const p = rawPts[0]!;
        const w = Math.max(p[2]!, 0.5) * scale * cfg.strokeScale;
        const reveal = cfg.animated
          ? `><animate attributeName="opacity" values="0;1" dur="0.01s" begin="${fmt(beginAt)}s" fill="freeze" /></circle>`
          : ` />`;
        body.push(
          `<circle cx="${fmt(px(p[0]!))}" cy="${fmt(py(p[1]!))}" r="${fmt(w / 2)}" fill="${cfg.color}"` +
            `${cfg.animated ? ' opacity="0"' : ''}${reveal}`,
        );
        continue;
      }

      // --- Multi-point stroke ---
      const { vertices, totalLen, avgWidth } = subdivideStroke(stroke, cfg.segmentLengthFU, cfg.smoothing);
      if (vertices.length < 2 || totalLen <= 0) continue;
      const baseWidth = Math.max(avgWidth, 0.5) * scale * cfg.strokeScale;

      // Per-segment variable-width lines (the visible shape).
      const segs: string[] = [];
      let maxW = 0;
      for (let i = 1; i < vertices.length; i++) {
        const a = vertices[i - 1]!;
        const b = vertices[i]!;
        const perPoint = (a.width + b.width) * 0.5 * scale * cfg.strokeScale;
        const w = Math.max(baseWidth + (perPoint - baseWidth) * pressure, 0.5 * scale * cfg.strokeScale);
        if (w > maxW) maxW = w;
        segs.push(
          `<line x1="${fmt(px(a.x))}" y1="${fmt(py(a.y))}" x2="${fmt(px(b.x))}" y2="${fmt(py(b.y))}" ` + `stroke-width="${fmt(w)}" />`,
        );
      }

      if (!cfg.animated) {
        body.push(
          `<g fill="none" stroke="${cfg.color}" stroke-linecap="${cfg.lineCap}" stroke-linejoin="round">\n${segs.join('\n')}\n</g>`,
        );
        continue;
      }

      // Animated: reveal the segment group through a dashed centerline mask.
      const id = `tk-m${maskId++}`;
      const d =
        `M ${fmt(px(vertices[0]!.x))} ${fmt(py(vertices[0]!.y))} ` +
        vertices
          .slice(1)
          .map((v) => `L ${fmt(px(v.x))} ${fmt(py(v.y))}`)
          .join(' ');
      // Mask centerline must fully cover the widest segment, plus a margin.
      const coverW = maxW + 4;
      const animate =
        dur > 0
          ? `<animate attributeName="stroke-dashoffset" values="1;0" keyTimes="0;1" calcMode="spline" ` +
            `keySplines="${EASE_OUT_SPLINE}" dur="${fmt(dur)}s" begin="${fmt(beginAt)}s" fill="freeze" />`
          : `<set attributeName="stroke-dashoffset" to="0" begin="${fmt(beginAt)}s" />`;
      defs.push(
        `<mask id="${id}" maskUnits="userSpaceOnUse">` +
          `<path d="${d}" fill="none" stroke="#fff" stroke-width="${fmt(coverW)}" ` +
          `stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1">${animate}</path></mask>`,
      );
      body.push(
        `<g mask="url(#${id})" fill="none" stroke="${cfg.color}" stroke-linecap="${cfg.lineCap}" stroke-linejoin="round">\n${segs.join('\n')}\n</g>`,
      );
    }
  }

  const defsBlock = defs.length > 0 ? `<defs>\n${defs.join('\n')}\n</defs>\n` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(cfg.width)} ${fmt(cfg.height)}" ` +
    `width="${fmt(cfg.width)}" height="${fmt(cfg.height)}">\n${defsBlock}${body.join('\n')}\n</svg>`
  );
}
