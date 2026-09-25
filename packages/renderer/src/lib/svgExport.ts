import type { LineCap, TegakiGlyphData } from '../types.ts';
import type { ResolvedEffect } from './effects.ts';
import { subdivideStroke } from './strokeCache.ts';
import { defaultStrokeEasing, type GlowPass, glowPasses, type StrokeEffects, strokeEffects } from './strokeEffects.ts';

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
  /** The glyph's slot on the timeline in seconds — the window glyph easing warps. Default: the glyph's `t`. */
  duration?: number;
  /** Per-stroke delay overrides from the scheduler (deferred dots), in slot-relative seconds. See `TimelineEntry`. */
  strokeDelays?: (number | undefined)[];
  /** Multiplier on every bundled stroke delay and duration (stagger with a fixed duration). Default `1`. */
  strokeTimeScale?: number;
  /** Effect seed — wobble phase, gradient hue. The engine's is its seed + the grapheme index. Default `0`. */
  seed?: number;
}

/** How SVG `<text>` is set: the font the canvas draws fallback characters and the clip-to-text mask in. */
export interface SvgTextFont {
  /** CSS `font-family` list. */
  family: string;
  /** px */
  fontSize: number;
  /** px */
  letterSpacing?: number;
  /** CSS `font-feature-settings`, matching the bundle's shaping. */
  featureSettings?: string;
}

/** A word of the clip-to-text mask, at its left edge on the baseline (absolute px). */
export interface SvgTextRun {
  text: string;
  x: number;
  y: number;
  direction: 'ltr' | 'rtl';
}

/** A glyph outline (SVG path data in font units, y up) placed with its origin on the baseline at `x`, `y` (px). */
export interface SvgGlyphOutline {
  d: string;
  x: number;
  y: number;
  /** fontSize / unitsPerEm. */
  scale: number;
}

/** A character the bundle has no strokes for, drawn as text in the fallback font. */
export interface SvgFallbackText extends SvgTextRun {
  fill: string;
  glows: GlowPass[];
  /** Timeline seconds at which it appears. */
  at: number;
  /** Horizontal clip in px — one character cut from a run drawn whole; `null` leaves that side open. */
  clip?: [number | null, number | null];
  /** Approximate ink box `[left, top, right, bottom]` in px, for cropping. */
  box: [number, number, number, number];
}

export interface SvgExportConfig {
  /** viewBox width in px (canvas CSS width) — the box when not cropping. */
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
  /** When true, emit a self-drawing animation. */
  animated: boolean;
  /**
   * When true, emit a looping CSS-keyframe animation instead of single-play
   * SMIL: the word draws, holds, fades out, and repeats forever. Keyframes
   * animate in `<img>`-embedded SVGs (a README hero), where SMIL may not.
   * Implies `animated`.
   */
  loop?: boolean;
  /** Total timeline duration in seconds. */
  totalDuration: number;
  /** Effects to draw: glow, wobble, taper, strokeGradient. Width blending comes from `pressure`. */
  effects?: ResolvedEffect[];
  /** Font size in px, which CSS-length glow radii resolve against. Default `100`. */
  fontSize?: number;
  /** Playback speed multiplier — every time in the file is divided by it. Default `1`. */
  speed?: number;
  /** Each stroke's draw progress easing. Default: ease-out quad, as the canvas. */
  strokeEasing?: (t: number) => number;
  /** Each glyph's local time easing. Default: linear. */
  glyphEasing?: (t: number) => number;
  /** Loop mode: seconds the finished text holds before fading out. Default `1.5`. */
  loopHold?: number;
  /** Crop the viewBox to the ink (plus a small margin) rather than the full `width` × `height`. Default `true`. */
  crop?: boolean;
  /** A layout-wide `globalGradient` paint, in absolute px. */
  globalGradient?: { x1: number; y1: number; x2: number; y2: number; stops: [number, string][] };
  /**
   * Clip every stroke to the text drawn in its font (quality `clipText`):
   * the glyphs' outlines, or words set as `<text>` in `font` (which then
   * needs `fontFaces` to render the same everywhere).
   */
  clipText?: { glyphs?: SvgGlyphOutline[]; font?: SvgTextFont; words?: SvgTextRun[] };
  /** Characters drawn from the fallback font. */
  fallback?: { font: SvgTextFont; texts: SvgFallbackText[] };
  /** `@font-face` rules to embed, so the text above renders anywhere. */
  fontFaces?: { family: string; src: string }[];
}

// Loop cycle padding (seconds): hold the finished word, fade it out, then a
// blank gap before the next draw. Mirrors the cadence of the existing README.
const LOOP_HOLD = 1.5;
const LOOP_FADE = 0.3;
const LOOP_GAP = 0.7;

/** Stands in for a mask / filter region's attributes until the viewBox is known. */
const REGION = '\u0000REGION\u0000';

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function fmtFine(n: number): string {
  return (Math.round(n * 10000) / 10000).toString();
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// Timing — each stroke's draw progress over timeline time, exactly as
// `drawGlyph` computes it from the engine's current time.
// ---------------------------------------------------------------------------

interface StrokeClock {
  /** Draw progress (0–1) at timeline time `t`; -1 before the stroke starts. */
  at(t: number): number;
  /** The span over which progress can change. */
  t0: number;
  t1: number;
}

function strokeClock(item: SvgGlyphPlacement, si: number, cfg: SvgExportConfig): StrokeClock {
  const stroke = item.glyph.s[si]!;
  const scale = item.strokeTimeScale ?? 1;
  const delay = item.strokeDelays?.[si] ?? stroke.d * scale;
  const dur = stroke.a * scale;
  const slot = item.duration ?? item.glyph.t;
  const easeGlyph = cfg.glyphEasing;
  const easeStroke = cfg.strokeEasing ?? defaultStrokeEasing;
  const O = item.offset;
  const at = (t: number): number => {
    let local = Math.max(0, Math.min(t - O, slot));
    if (easeGlyph && slot > 0) local = easeGlyph(local / slot) * slot;
    if (local < delay) return -1;
    const linear = dur > 0 ? Math.min((local - delay) / dur, 1) : 1;
    return clamp01(easeStroke(linear));
  };
  // Glyph easing can move a stroke anywhere in its slot; otherwise it runs over its own window.
  if (easeGlyph && slot > 0) return { at, t0: O, t1: O + slot };
  return { at, t0: O + delay, t1: O + Math.max(delay, Math.min(delay + dur, slot)) };
}

/** A progress keyframe; `ease` is the cubic Bézier `[x1, y1, x2, y2]` of the interval ending here (linear when absent). */
interface Key {
  t: number;
  p: number;
  ease?: [number, number, number, number];
}

/**
 * Progress keyframes (timeline seconds) that follow the clock's curve — any
 * easing — as cubic Bézier segments: Hermite fits from the curve's end
 * slopes, split until each is within tolerance. Ease-out quad (the default)
 * is one exact segment. Control points stay in [0, 1], as SMIL requires.
 */
function progressKeys(clock: StrokeClock): Key[] {
  const f = (t: number) => Math.max(0, clock.at(t));
  const start = firstTime(clock, (p) => p >= 0) ?? clock.t0;
  const final = f(clock.t1);
  const end = firstTime({ ...clock, t0: start }, (p) => p >= final) ?? clock.t1;
  if (end <= start)
    return [
      { t: start, p: 0 },
      { t: start, p: final },
    ];
  const keys: Key[] = [{ t: start, p: f(start) }];
  const fit = (a: number, b: number, depth: number) => {
    const pa = f(a);
    const pb = f(b);
    const dp = pb - pa;
    const du = b - a;
    if (Math.abs(dp) < 1e-6) {
      keys.push({ t: b, p: pb });
      return;
    }
    // One-sided second-order slopes: the curve may kink at a segment's ends.
    const h = du * 1e-3;
    const ma = (-3 * pa + 4 * f(a + h) - f(a + 2 * h)) / (2 * h);
    const mb = (3 * pb - 4 * f(b - h) + f(b - 2 * h)) / (2 * h);
    const y1 = ma * (du / (3 * dp));
    const y2 = 1 - mb * (du / (3 * dp));
    let ok = y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1;
    // With x controls at 1/3 and 2/3 the curve's x is its parameter, so y(u) is direct.
    for (let i = 1; ok && i < 8; i++) {
      const u = i / 8;
      const y = 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
      if (Math.abs(pa + dp * y - f(a + du * u)) > 0.004) ok = false;
    }
    if (ok || depth >= 8) {
      keys.push({ t: b, p: pb, ease: ok ? [1 / 3, y1, 2 / 3, y2] : undefined });
      return;
    }
    const mid = (a + b) / 2;
    fit(a, mid, depth + 1);
    fit(mid, b, depth + 1);
  };
  fit(start, end, 0);
  return keys;
}

/** First timeline time at which `pred(progress)` holds, or null if it never does. */
function firstTime(clock: StrokeClock, pred: (p: number) => boolean): number | null {
  const { t0, t1 } = clock;
  if (pred(clock.at(t0))) return t0;
  if (t1 <= t0) return pred(clock.at(t0 + 1e-9)) ? t0 : null;
  const n = 128;
  let prev = t0;
  for (let i = 1; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    if (pred(clock.at(t))) {
      let lo = prev;
      let hi = t;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (pred(clock.at(mid))) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prev = t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Animation emitters — SMIL for single play, CSS keyframes for the loop.
// ---------------------------------------------------------------------------

/** Attributes for an element plus the SMIL children it carries. */
interface Anim {
  attrs: string;
  inner: string;
}

const NO_ANIM: Anim = { attrs: '', inner: '' };

class Animator {
  readonly mode: 'static' | 'once' | 'loop';
  private readonly speed: number;
  private readonly cycle: number;
  private readonly holdEndPct: number;
  private readonly fadeEndPct: number;
  readonly keyframes: string[] = [];
  private count = 0;

  constructor(cfg: SvgExportConfig) {
    this.mode = cfg.loop ? 'loop' : cfg.animated ? 'once' : 'static';
    this.speed = cfg.speed && cfg.speed > 0 ? cfg.speed : 1;
    const total = Math.max(cfg.totalDuration / this.speed, 0.001);
    const hold = Math.max(cfg.loopHold ?? LOOP_HOLD, 0);
    this.cycle = total + hold + LOOP_FADE + LOOP_GAP;
    this.holdEndPct = ((total + hold) / this.cycle) * 100;
    this.fadeEndPct = ((total + hold + LOOP_FADE) / this.cycle) * 100;
  }

  /** Output seconds for a timeline time. */
  out(t: number): number {
    return t / this.speed;
  }

  private pct(t: number): number {
    return Math.min((this.out(t) / this.cycle) * 100, this.holdEndPct);
  }

  /** Register a keyframe animation; a stop's timing function runs from it to the next stop. */
  private keyframe(prop: string, stops: [number, string, string?][]): string {
    const name = `tk-a${this.count++}`;
    // Rounded stops can collide; the later one wins, as CSS would take it.
    const merged = new Map<string, string>();
    for (const [pct, v, ease] of stops) {
      const at = `${Math.round(Math.min(Math.max(pct, 0), 100) * 1000) / 1000}`;
      merged.set(at, `${prop}:${v}${ease ? `; animation-timing-function:${ease}` : ''}`);
    }
    const body = [...merged].map(([pct, decl]) => `${pct}% { ${decl} }`).join(' ');
    this.keyframes.push(`@keyframes ${name} { ${body} } .${name} { animation: ${name} ${fmtFine(this.cycle)}s linear infinite }`);
    return name;
  }

  /**
   * Reveal a dashed path of length `plen` (dash `L` ≥ plen + its cap) along
   * the progress keys. Hidden sits a hair past `L` so no zero-length dash
   * leaves a cap dot at the start.
   */
  dash(keys: Key[], L: number, plen: number): Anim {
    const hidden = L + 0.5;
    const offset = (p: number) => (p <= 0 ? hidden : L - p * plen);
    const dashAttrs = ` stroke-dasharray="${fmt(L)} ${fmt(L)}" stroke-dashoffset="${fmt(hidden)}"`;
    const first = keys[0]!;
    const last = keys[keys.length - 1]!;
    const bezier = (e: Key['ease']) => (e ?? [0, 0, 1, 1]).map(fmtFine).join(' ');
    if (this.mode === 'once') {
      const begin = this.out(first.t);
      const dur = this.out(last.t) - begin;
      if (dur <= 0) {
        return {
          attrs: dashAttrs,
          inner: `<set attributeName="stroke-dashoffset" to="${fmt(offset(last.p))}" begin="${fmtFine(begin)}s" fill="freeze" />`,
        };
      }
      const keyTimes = keys.map((k) => fmtFine((this.out(k.t) - begin) / dur));
      keyTimes[0] = '0';
      keyTimes[keyTimes.length - 1] = '1';
      const values = keys.map((k) => fmt(offset(k.p)));
      const splines = keys.slice(1).map((k) => bezier(k.ease));
      return {
        attrs: dashAttrs,
        inner:
          `<animate attributeName="stroke-dashoffset" values="${values.join(';')}" keyTimes="${keyTimes.join(';')}" ` +
          `calcMode="spline" keySplines="${splines.join(';')}" dur="${fmtFine(dur)}s" begin="${fmtFine(begin)}s" fill="freeze" />`,
      };
    }
    const stops: [number, string, string?][] = [[0, fmt(hidden)]];
    keys.forEach((k, i) => {
      const next = keys[i + 1]?.ease;
      stops.push([this.pct(k.t), fmt(offset(k.p)), next ? `cubic-bezier(${next.map(fmtFine).join(',')})` : undefined]);
    });
    const final = fmt(offset(last.p));
    stops.push([this.holdEndPct, final], [this.fadeEndPct, final], [this.fadeEndPct + 0.001, fmt(hidden)], [100, fmt(hidden)]);
    return { attrs: ` class="${this.keyframe('stroke-dashoffset', stops)}"${dashAttrs}`, inner: '' };
  }

  /** Show an element from timeline time `t` on. */
  appear(t: number): Anim {
    if (this.mode === 'static' || this.out(t) <= 0.0005) return NO_ANIM;
    if (this.mode === 'once') {
      return { attrs: ' opacity="0"', inner: `<set attributeName="opacity" to="1" begin="${fmtFine(this.out(t))}s" fill="freeze" />` };
    }
    const on = this.pct(t);
    const stops: [number, string][] = [
      [0, '0'],
      [on, '0'],
      [on + 0.001, '1'],
      [this.fadeEndPct, '1'],
      [this.fadeEndPct + 0.001, '0'],
      [100, '0'],
    ];
    return { attrs: ` class="${this.keyframe('opacity', stops)}" opacity="0"`, inner: '' };
  }

  /** Loop mode's group fade class, or '' otherwise. */
  groupFade(): string {
    if (this.mode !== 'loop') return '';
    const stops: [number, string][] = [
      [0, '1'],
      [this.holdEndPct, '1'],
      [this.fadeEndPct, '0'],
      [100, '0'],
    ];
    return this.keyframe('opacity', stops);
  }
}

function el(tag: string, attrs: string, anim: Anim): string {
  return anim.inner ? `<${tag} ${attrs}${anim.attrs}>${anim.inner}</${tag}>` : `<${tag} ${attrs}${anim.attrs} />`;
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

type SvgStroke = TegakiGlyphData['s'][number];

interface NibStamp {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  deg: number;
  /** Stroke progress (0–1) at which the pen reaches it. */
  at: number;
  /** Drawn length (font units) that reaches it. */
  passed: number;
}

/** The stroke's nib stamps (see `Nib`), following its wobble and taper as `drawGlyph`'s `fillNibs` does. */
function nibStamps(
  stroke: SvgStroke,
  pointCumLen: number[] | undefined,
  totalLen: number,
  px: (fx: number) => number,
  py: (fy: number) => number,
  scale: number,
  strokeScale: number,
  fx: StrokeEffects,
): NibStamp[] {
  if (!stroke.n) return [];
  const out: NibStamp[] = [];
  for (const nib of stroke.n) {
    const k = nib[0]!;
    const p = stroke.p[k];
    if (!p) continue;
    const passed = pointCumLen?.[k] ?? 0;
    const at = totalLen > 0 ? passed / totalLen : 0.5;
    const m = scale * strokeScale * fx.taper(at);
    const rx = (nib[3]! / 2) * m;
    const ry = (nib[4]! / 2) * m;
    if (rx <= 0 || ry <= 0) continue;
    out.push({
      cx: px(p[0]! + nib[1]! + fx.wobbleDx(p[0]!, p[1]!, k)),
      cy: py(p[1]! + nib[2]! + fx.wobbleDy(p[0]!, p[1]!, k)),
      rx,
      ry,
      deg: (nib[5]! * 180) / Math.PI,
      at,
      passed,
    });
  }
  return out;
}

function ellipse(s: NibStamp, fill: string, extra: string, anim: Anim): string {
  return el(
    'ellipse',
    `cx="${fmt(s.cx)}" cy="${fmt(s.cy)}" rx="${fmt(s.rx)}" ry="${fmt(s.ry)}" transform="rotate(${fmt(s.deg)} ${fmt(s.cx)} ${fmt(s.cy)})" fill="${fill}"${extra}`,
    anim,
  );
}

function textEl(run: SvgTextRun, font: SvgTextFont, fill: string, extra: string, anim: Anim): string {
  const rtl = run.direction === 'rtl';
  // `x` is the left edge: in RTL the text's start is its right edge, so anchor its end.
  const style = `white-space:pre;direction:${run.direction};unicode-bidi:embed${font.featureSettings ? `;font-feature-settings:${font.featureSettings}` : ''}`;
  const attrs =
    `x="${fmt(run.x)}" y="${fmt(run.y)}" font-family="${escapeXml(font.family)}" font-size="${fmt(font.fontSize)}"` +
    `${font.letterSpacing ? ` letter-spacing="${fmt(font.letterSpacing)}"` : ''}${rtl ? ' text-anchor="end"' : ''} ` +
    `style="${escapeXml(style)}" fill="${fill}"${extra}`;
  return `<text ${attrs}${anim.attrs}>${escapeXml(run.text)}${anim.inner}</text>`;
}

/**
 * Serialize positioned glyphs to a standalone SVG string that draws what the
 * canvas renderer draws: the same timing (speed, glyph and stroke easing, the
 * scheduler's deferred and stretched strokes), widths (pressure, taper, nib
 * stamps), paint (strokeGradient, globalGradient), wobble, glow, clip-to-text
 * and fallback characters.
 *
 * A stroke with one width and one paint is a dashed `<path>` revealed along
 * its length. A stroke whose width or color varies is one `<line>` per
 * sub-segment, as `drawGlyph` draws it, revealed through a `<mask>` whose
 * centerline is dash-animated. Single play animates with SMIL; `loop` with
 * CSS keyframes.
 */
export function placementsToSvg(items: SvgGlyphPlacement[], cfg: SvgExportConfig): string {
  const anim = new Animator(cfg);
  const pressure = Math.max(0, Math.min(cfg.pressure, 1));
  const effects = cfg.effects ?? [];
  const fontSize = cfg.fontSize ?? 100;
  const paint = cfg.globalGradient ? 'url(#tk-gg)' : cfg.color;
  const endTime = cfg.totalDuration;

  const body: string[] = [];
  const defs: string[] = [];
  const filters = new Map<string, string>();
  let maskId = 0;

  // Glow passes become drop-shadow filters, one per distinct shadow.
  const filterFor = (g: GlowPass): string => {
    const key = `${g.color}|${g.blur}|${g.dx}|${g.dy}`;
    let id = filters.get(key);
    if (!id) {
      id = `tk-glow${filters.size}`;
      filters.set(key, id);
      defs.push(
        `<filter id="${id}" filterUnits="userSpaceOnUse" ${REGION}>` +
          `<feDropShadow dx="${fmt(g.dx)}" dy="${fmt(g.dy)}" stdDeviation="${fmt(g.blur / 2)}" flood-color="${g.color}" /></filter>`,
      );
    }
    return ` filter="url(#${id})"`;
  };

  // Ink bounds (px), so the viewBox can crop to what is drawn.
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
    const { glyph, ox, oy, scale, ascender } = item;
    const px = (fx: number) => ox + fx * scale;
    const py = (fy: number) => oy + (fy + ascender) * scale;
    const fx = strokeEffects(effects, item.seed ?? 0, cfg.color);
    const glows = glowPasses(effects, cfg.color, fontSize, scale);
    const needsPerSegment = pressure > 0 || fx.hasTaper;
    const segmented = needsPerSegment || fx.hasStrokeGradient;

    for (let si = 0; si < glyph.s.length; si++) {
      const stroke = glyph.s[si]!;
      const rawPts = stroke.p;
      if (rawPts.length === 0) continue;
      const clock = strokeClock(item, si, cfg);
      // A stroke the timeline never reaches is never drawn.
      if (clock.at(Math.max(clock.t1, endTime)) < 0) continue;

      const isDegenerate = rawPts.length > 1 && rawPts.every((p) => p[0] === rawPts[0]![0] && p[1] === rawPts[0]![1]);

      // --- Dot ---
      if (rawPts.length === 1 || isDegenerate) {
        const shown = firstTime(clock, (p) => p > 0);
        if (shown === null) continue;
        const reveal = anim.appear(shown);
        const p = rawPts[0]!;
        const cx = px(p[0]! + fx.wobbleDx(p[0]!, p[1]!, 0));
        const cy = py(p[1]! + fx.wobbleDy(p[0]!, p[1]!, 0));
        const w = Math.max(p[2]!, 0.5) * scale * cfg.strokeScale * fx.taper(0.5);
        const stamps = nibStamps(stroke, undefined, 0, px, py, scale, cfg.strokeScale, fx);
        const dot = (fill: string, extra: string) =>
          cfg.lineCap === 'round'
            ? el('circle', `cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(w / 2)}" fill="${fill}"${extra}`, reveal)
            : el(
                'rect',
                `x="${fmt(cx - w / 2)}" y="${fmt(cy - w / 2)}" width="${fmt(w)}" height="${fmt(w)}" fill="${fill}"${extra}`,
                reveal,
              );
        grow(cx, cy, w / 2);
        for (const g of glows) {
          const filter = filterFor(g);
          body.push(dot(g.color, filter));
          for (const s of stamps) body.push(ellipse(s, g.color, filter, reveal));
        }
        const fill = fx.hasStrokeGradient ? fx.colorAt(0) : paint;
        body.push(dot(fill, ''));
        for (const s of stamps) {
          grow(s.cx, s.cy, Math.max(s.rx, s.ry));
          body.push(ellipse(s, fill, '', reveal));
        }
        continue;
      }

      // --- Multi-point stroke ---
      const { vertices, totalLen, avgWidth, pointCumLen } = subdivideStroke(stroke, cfg.segmentLengthFU, cfg.smoothing);
      if (vertices.length < 2 || totalLen <= 0) continue;
      const xs = vertices.map((v) => px(v.x + fx.wobbleDx(v.x, v.y, v.idx)));
      const ys = vertices.map((v) => py(v.y + fx.wobbleDy(v.x, v.y, v.idx)));
      let plen = 0;
      for (let i = 1; i < xs.length; i++) plen += Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
      const d = `M ${fmt(xs[0]!)} ${fmt(ys[0]!)} ${xs
        .slice(1)
        .map((x, i) => `L ${fmt(x)} ${fmt(ys[i + 1]!)}`)
        .join(' ')}`;
      const base = Math.max(avgWidth, 0.5) * scale * cfg.strokeScale;
      const stamps = nibStamps(stroke, pointCumLen, totalLen, px, py, scale, cfg.strokeScale, fx);

      // Per-segment lines (the visible shape) when width or color varies.
      // Round caps join the segments; the stroke's own cap goes on its two
      // ends only, with a disc where each end segment meets the rest.
      const segs: string[] = [];
      let maxW = base;
      if (segmented) {
        const last = vertices.length - 1;
        for (let i = 1; i < vertices.length; i++) {
          const a = vertices[i - 1]!;
          const b = vertices[i]!;
          const mid = ((a.cumLen + b.cumLen) * 0.5) / totalLen;
          let w = base;
          if (needsPerSegment) {
            const perPoint = (a.width + b.width) * 0.5 * scale * cfg.strokeScale;
            w = Math.max(base + (perPoint - base) * pressure, 0.5 * scale * cfg.strokeScale) * fx.taper(mid);
          }
          if (w > maxW) maxW = w;
          const color = fx.hasStrokeGradient ? fx.colorAt(mid) : null;
          const end = cfg.lineCap !== 'round' && (i === 1 || i === last);
          segs.push(
            `<line x1="${fmt(xs[i - 1]!)}" y1="${fmt(ys[i - 1]!)}" x2="${fmt(xs[i]!)}" y2="${fmt(ys[i]!)}" ` +
              `stroke-width="${fmt(w)}"${color ? ` stroke="${color}"` : ''}${end ? ` stroke-linecap="${cfg.lineCap}"` : ''} />`,
          );
          if (end && last > 1) {
            const j = i === 1 ? i : i - 1;
            segs.push(`<circle cx="${fmt(xs[j]!)}" cy="${fmt(ys[j]!)}" r="${fmt(w / 2)}" fill="${color ?? paint}" stroke="none" />`);
          }
        }
      }
      for (let i = 0; i < xs.length; i++) grow(xs[i]!, ys[i]!, maxW / 2);

      // Reveal: one dash animation shared by the stroke, its glow copies and its mask.
      const coverW = maxW + 4;
      let reveal = NO_ANIM;
      if (anim.mode !== 'static') {
        const keys = progressKeys(clock);
        reveal = anim.dash(keys, plen + Math.max(coverW, base) + 1, plen);
      }
      const pathAttrs = (stroke: string, width: number, cap: string) =>
        `d="${d}" fill="none" stroke="${stroke}" stroke-width="${fmt(width)}" stroke-linecap="${cap}" stroke-linejoin="round"`;
      const stampReveal = (s: NibStamp) => {
        const t = firstTime(clock, (p) => p > 0 && p * totalLen >= s.passed);
        return t === null ? null : anim.appear(t);
      };

      for (const g of glows) {
        const filter = filterFor(g);
        body.push(el('path', `${pathAttrs(g.color, base, cfg.lineCap)}${filter}`, reveal));
        for (const s of stamps) {
          const r = stampReveal(s);
          if (r) body.push(ellipse(s, g.color, filter, r));
        }
      }

      if (!segmented) {
        body.push(el('path', pathAttrs(paint, base, cfg.lineCap), reveal));
      } else {
        const group = `fill="none" stroke="${paint}" stroke-linecap="round" stroke-linejoin="round"`;
        if (anim.mode === 'static') {
          body.push(`<g ${group}>\n${segs.join('\n')}\n</g>`);
        } else {
          const id = `tk-m${maskId++}`;
          defs.push(
            `<mask id="${id}" maskUnits="userSpaceOnUse" ${REGION}>${el('path', pathAttrs('#fff', coverW, 'round'), reveal)}</mask>`,
          );
          body.push(`<g mask="url(#${id})" ${group}>\n${segs.join('\n')}\n</g>`);
        }
      }
      for (const s of stamps) {
        const r = stampReveal(s);
        if (!r) continue;
        grow(s.cx, s.cy, Math.max(s.rx, s.ry));
        body.push(ellipse(s, fx.hasStrokeGradient ? fx.colorAt(s.at) : paint, '', r));
      }
    }
  }

  // --- Fallback characters: text in the fallback font, shown once their slot ends ---
  if (cfg.fallback) {
    const { font, texts } = cfg.fallback;
    let clipId = 0;
    for (const t of texts) {
      let clip = '';
      if (t.clip) {
        const id = `tk-fc${clipId++}`;
        const left = t.clip[0] ?? -1e5;
        const right = t.clip[1] ?? 1e5;
        defs.push(`<clipPath id="${id}"><rect x="${fmt(left)}" y="-100000" width="${fmt(right - left)}" height="200000" /></clipPath>`);
        clip = ` clip-path="url(#${id})"`;
      }
      const reveal = anim.appear(t.at);
      const [l, top, r, bottom] = t.box;
      grow(l, top, 0);
      grow(r, bottom, 0);
      const glowParts = t.glows.map((g) => textEl(t, font, g.color, filterFor(g), reveal));
      const main = textEl(t, font, t.fill, '', reveal);
      body.push(clip ? `<g${clip}>${glowParts.join('')}${main}</g>` : [...glowParts, main].join('\n'));
    }
  }

  // --- viewBox ---
  const hasInk = Number.isFinite(minX);
  let vbX = 0;
  let vbY = 0;
  let vbW = cfg.width;
  let vbH = cfg.height;
  if ((cfg.crop ?? true) && hasInk) {
    // A glow paints past its stroke by its blur and offset.
    let margin = 8;
    for (const g of glowPasses(effects, cfg.color, fontSize, items[0]?.scale ?? 1)) {
      margin = Math.max(margin, 8 + g.blur + Math.max(Math.abs(g.dx), Math.abs(g.dy)));
    }
    vbX = minX - margin;
    vbY = minY - margin;
    vbW = maxX - minX + margin * 2;
    vbH = maxY - minY + margin * 2;
  }
  const region = `x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(vbH)}"`;

  if (cfg.globalGradient) {
    const g = cfg.globalGradient;
    defs.push(
      `<linearGradient id="tk-gg" gradientUnits="userSpaceOnUse" x1="${fmt(g.x1)}" y1="${fmt(g.y1)}" x2="${fmt(g.x2)}" y2="${fmt(g.y2)}">` +
        g.stops.map(([o, c]) => `<stop offset="${fmtFine(o)}" stop-color="${c}" />`).join('') +
        '</linearGradient>',
    );
  }

  let content = body.join('\n');
  const fade = anim.groupFade();
  if (fade) content = `<g class="${fade}">\n${content}\n</g>`;
  if (cfg.clipText) {
    const { glyphs = [], font, words = [] } = cfg.clipText;
    const shapes = glyphs
      .filter((g) => g.d)
      .map((g) => `<path d="${g.d}" transform="translate(${fmt(g.x)} ${fmt(g.y)}) scale(${fmtFine(g.scale)} ${fmtFine(-g.scale)})" />`);
    if (font) shapes.push(...words.map((w) => textEl(w, font, '#fff', '', NO_ANIM)));
    defs.push(`<mask id="tk-clip" maskUnits="userSpaceOnUse" ${REGION}><g fill="#fff">${shapes.join('')}</g></mask>`);
    content = `<g mask="url(#tk-clip)">\n${content}\n</g>`;
  }

  const css: string[] = [];
  for (const face of cfg.fontFaces ?? [])
    css.push(`@font-face { font-family: '${face.family.replace(/'/g, "\\'")}'; src: url("${face.src}") }`);
  css.push(...anim.keyframes);

  const head =
    (css.length > 0 ? `<style>${escapeXml(css.join('\n')).replace(/&quot;/g, '"')}</style>\n` : '') +
    (defs.length > 0 ? `<defs>\n${defs.join('\n')}\n</defs>\n` : '');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}" width="${fmt(vbW)}" height="${fmt(vbH)}">\n` +
    `${head}${content}\n</svg>`
  ).replaceAll(REGION, region);
}
