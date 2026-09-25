import { paragraphDirection } from '../lib/bidi.ts';
import {
  CSS_DURATION,
  CSS_PROGRESS,
  CSS_TIME,
  MIN_LINE_HEIGHT_EM,
  MIN_PADDING_V_EM,
  PADDING_H_EM,
  registerCssProperties,
} from '../lib/css-properties.ts';
import { drawFallbackGlyph, fallbackTextStyle } from '../lib/drawFallbackGlyph.ts';
import { drawGlyph } from '../lib/drawGlyph.ts';
import {
  effectInkMargin,
  findEffect,
  getEffectDefinition,
  globalGradientGeometry,
  hasRenderHooks,
  type RenderStageContext,
  type ResolvedEffect,
  resolveEffects,
} from '../lib/effects.ts';
import { fallbackRuns } from '../lib/fallbackRuns.ts';
import { LETTER_SPACED_OFF_FEATURES, toCssFeatureSettings } from '../lib/features.ts';
import { ensureFont, ensureFontFace, fontDataUri } from '../lib/font.ts';
import { type CanvasOverflow, glyphInkBounds, inkOverflow, NO_OVERFLOW } from '../lib/inkBounds.ts';
import type { BundleShaper, ShapeOptions } from '../lib/shaper.ts';
import { type SubdividedStroke, subdivideStroke } from '../lib/strokeCache.ts';
import {
  placementsToSvg,
  type SvgExportConfig,
  type SvgFallbackText,
  type SvgGlyphOutline,
  type SvgGlyphPlacement,
  type SvgTextRun,
} from '../lib/svgExport.ts';
import type { TextLayout } from '../lib/textLayout.ts';
import { applyShaperPositions, computeLayoutBbox, computeTextLayout, lineWords, midWordBreaks } from '../lib/textLayout.ts';
import type { Timeline, TimelineConfig, TimelineEntry } from '../lib/timeline.ts';
import { computeTimeline } from '../lib/timeline.ts';
import { cssFontFamily, drawsFallbackGlyphs, graphemes, lookupGlyphData } from '../lib/utils.ts';
import type { TegakiBundle, TegakiGlyphData } from '../types.ts';
import { getBundle, registerBundle, resolveBundle } from './bundle-registry.ts';
import { buildChildren, buildRootProps, canvasBoxStyle, domCreateElement } from './render-elements.ts';
import { getShaperForBundle, registerShaper, settledShaperForBundle } from './shaper-registry.ts';
import type { CreateElementFn, TegakiEngineOptions, TegakiQuality, TegakiSvgOptions, TimeControlMode, TimeControlProp } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a percentage string like `"50%"` into a 0–1 fraction. Returns `null`
 * for non-percentage strings or unparseable input. Whitespace around the
 * value is tolerated; the numeric part is parsed with `Number(...)`, so any
 * finite numeric form (including negatives and decimals) is accepted.
 */
function parsePercentage(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed.endsWith('%')) return null;
  const num = Number(trimmed.slice(0, -1));
  return Number.isFinite(num) ? num / 100 : null;
}

/**
 * Parse a computed CSS `letter-spacing` value into pixels. `getComputedStyle`
 * returns either `"normal"` (→ 0) or a resolved pixel length like `"2px"`.
 * Returns 0 for anything unparseable.
 */
/**
 * Where a timeline entry is drawn, in CSS px within the text box: `x` of its
 * pen origin, `y` of its line's top, `glyphY` of the glyph frame's top
 * (`drawGlyph`'s origin).
 *
 * Per-entry shaper offsets win when present (Arabic cursive attachment, mark
 * positioning, contextual kerning), anchored to the line's measured left edge
 * (`lineLefts`); the per-grapheme `charOffsets` are the fallback for the
 * unshaped char-keyed render or a shaped glyph without a matching entry. The
 * shaper's y-offset is harfbuzz's GPOS dy (negated, em y-down) — Arabic
 * cursive lift and mark placement; zero for scripts without vertical GPOS.
 */
function entryOrigin(
  entry: TimelineEntry,
  layout: TextLayout,
  lineIdx: number,
  fontSize: number,
  lineHeight: number,
  halfLeading: number,
): { x: number; y: number; glyphY: number } {
  const y = lineIdx * lineHeight;
  const lineLeftEm = layout.lineLefts?.[lineIdx];
  const x =
    entry.xOffsetEm !== undefined && lineLeftEm !== undefined
      ? (lineLeftEm + entry.xOffsetEm) * fontSize
      : (layout.charOffsets[entry.graphemeIndex] ?? 0) * fontSize;
  return { x, y, glyphY: y + halfLeading + (entry.yOffsetEm ?? 0) * fontSize };
}

function parseLetterSpacing(value: string): number {
  if (!value || value === 'normal') return 0;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function resolveTimeControl(prop: TimeControlProp): TimeControlMode[keyof TimeControlMode] {
  if (prop == null) return { mode: 'uncontrolled' };
  if (typeof prop === 'number') return { mode: 'controlled', value: prop };
  if (typeof prop === 'string') {
    if (prop === 'css') return { mode: 'css' };
    const pct = parsePercentage(prop);
    if (pct != null) return { mode: 'controlled', value: pct, unit: 'progress' };
    return { mode: 'uncontrolled' };
  }
  return prop;
}

/** How a fallback character in a run is drawn — see `TegakiEngine._fallbackRunClips`. */
interface FallbackClip {
  text: string;
  /** Left edge of the run's text, in CSS px. */
  x: number;
  /** The character's box, in CSS px; an outer edge of the run is left open. */
  left: number;
  right: number;
  direction: 'ltr' | 'rtl';
  seed: number;
}

/** Far enough past any canvas edge to leave a clip rectangle's side open (canvas rects take no Infinity). */
const CLIP_REACH = 1e6;

const warnedFontFailures = new Set<string>();

/**
 * Warn (once per font URL) that a bundle's font file failed to load. The most
 * common cause is Vite's dev pre-bundler relocating the bundle module to
 * `node_modules/.vite/deps/`, which breaks its relative `.ttf` URL — the dev
 * server then answers with `index.html` and the browser rejects it as a font.
 */
export function warnFontLoadFailure(
  bundle: TegakiBundle,
  error: unknown,
  face: { family: string; url: string } = { family: bundle.family, url: bundle.fontUrl },
): void {
  if (warnedFontFailures.has(face.url)) return;
  warnedFontFailures.add(face.url);
  const viteHint = face.url.includes('/.vite/deps/')
    ? " This URL points into Vite's pre-bundle cache: add `optimizeDeps: { exclude: ['tegaki'] }` to your vite.config and restart the dev server."
    : '';
  console.warn(
    `[tegaki] Failed to load font "${face.family}" from ${face.url}. ` +
      `Rendering with the fallback font's layout, so spacing may be off.${viteHint} ` +
      'See https://gkurt.com/tegaki/guides/bundlers/',
    error,
  );
}

// ---------------------------------------------------------------------------
// TegakiEngine
// ---------------------------------------------------------------------------

export class TegakiEngine {
  // --- Bundle registry (delegates to bundle-registry module) ---

  /** Register a font bundle so it can be referenced by family name. */
  static registerBundle = registerBundle;

  /** Look up a registered bundle by family name. */
  static getBundle = getBundle;

  // --- Shaper registry (delegates to shaper-registry module) ---

  /**
   * Register a shaper factory. Shaping is opt-in — without a registered
   * factory, the renderer iterates raw graphemes and uses the bundle's
   * char-keyed `glyphData` map. Pass the `harfbuzzShaper` export from
   * `tegaki/shaper-harfbuzz` for fonts that need complex shaping.
   *
   * Re-registering replaces the previous factory and invalidates the cache.
   * Pass `null` to unregister.
   */
  static registerShaper = registerShaper;

  /**
   * Load everything a bundle needs before its first frame — its font faces and
   * (with a registered shaper) its shaper. An engine handed a preloaded bundle
   * draws it complete right away, rather than first without the font or
   * unshaped. Hosts swapping bundles can await this to keep showing the old
   * one until the new one is ready. Never rejects: a part that fails to load
   * degrades the same way it would when rendering.
   */
  static async preload(bundle: TegakiBundle): Promise<void> {
    await Promise.all([ensureFontFace(bundle), getShaperForBundle(bundle)]).catch(() => {});
  }

  // --- DOM elements ---
  private _rootEl: HTMLElement;
  private _contentEl: HTMLElement | null = null; // non-null only in non-adopt mode
  private _sentinelEl: HTMLSpanElement;
  private _canvasEl: HTMLCanvasElement;
  private _overlayEl: HTMLElement;
  private _canvasFallbackEl: HTMLSpanElement;
  private _maskCanvas: HTMLCanvasElement | null = null;
  /** Parsed glyph outlines for the clip mask, by path data, for the shaper they came from. */
  private _maskPaths: { shaper: BundleShaper | null; paths: Map<string, Path2D> } = { shaper: null, paths: new Map() };

  // --- Options ---
  private _text = '';
  private _font: TegakiBundle | null = null;
  private _timeControl: TimeControlMode[keyof TimeControlMode] = { mode: 'uncontrolled' };
  private _effects: Record<string, any> | undefined;
  private _timing: TimelineConfig | undefined;
  private _quality: TegakiQuality | undefined;
  private _showOverlay = false;
  private _onComplete: (() => void) | undefined;
  private _onChangeTimeline: ((timeline: Timeline) => void) | undefined;
  private _direction: 'ltr' | 'rtl' | undefined;
  private _fallbackFont: string | undefined;

  // --- Derived / cached ---
  private _resolvedEffects: ResolvedEffect[] = resolveEffects(undefined);
  private _seed: number;
  private _timeline: Timeline = { entries: [] as TimelineEntry[], totalDuration: 0 };
  private _layout: TextLayout | null = null;
  /** Where the layout last wrapped `text` inside a word — the timeline shapes each side on its own. */
  private _softBreaks: { text: string; offsets: number[] } | null = null;
  /** How far the canvas box currently extends past its default padding, per side. */
  private _canvasOverflow: CanvasOverflow = NO_OVERFLOW;
  private _layoutKey = '';
  private _fontReady = false;
  private _shaper: BundleShaper | null = null;
  private _shaperReady = true;
  private _shaperEnabled = true;

  // Stroke subdivision cache. Shared across every instance of the same glyph
  // at the current (font, fontSize, segmentSize, effects-need-subdivision)
  // state. Replaced wholesale when that state changes — entries in the old
  // WeakMap are orphaned and GC'd along with the map.
  private _strokeCache: WeakMap<TegakiGlyphData['s'][number], SubdividedStroke> = new WeakMap();
  private _strokeCacheKey = '';

  // --- Measured from DOM ---
  private _containerWidth = 0;
  private _fontSize = 0;
  private _lineHeight = 0;
  private _currentColor = '';
  private _letterSpacing = 0;

  // --- Playback state ---
  private _internalTime = 0;
  private _cssTime = 0;
  private _playing = true;
  private _smoothedBoost = 0;
  private _delayRemaining = 0;
  private _loopGapRemaining = 0;
  private _lastTs: number | null = null;
  private _rafId = 0;
  private _prevCompleted = false;
  private _prefersReducedMotion = false;
  private _destroyed = false;

  // --- Observers & listeners ---
  private _resizeObserver: ResizeObserver;
  private _mql: MediaQueryList | null = null;

  /**
   * Returns the props (including style) that should be applied to the container element,
   * plus the inner content tree rendered via a framework `createElement` callback.
   *
   * Each child element receives a `data-tegaki` attribute so the engine can adopt
   * pre-rendered elements later via `new TegakiEngine(container, { adopt: true })`.
   */
  static renderElements<T>(
    options: TegakiEngineOptions,
    createElement: CreateElementFn<T>,
  ): { rootProps: Record<string, any>; content: T } {
    return {
      rootProps: buildRootProps(options),
      content: buildChildren(options, createElement),
    };
  }

  constructor(container: HTMLElement, options?: TegakiEngineOptions & { adopt?: boolean }) {
    registerCssProperties();
    this._seed = Math.random() * 1000;

    // --- Resolve DOM elements ---
    // The container itself is the root element. In adopt mode, the adapter has
    // already rendered children inside it. In non-adopt mode, we create them.
    this._rootEl = container;

    if (options?.adopt) {
      // Adopt pre-rendered children (created by renderElements)
    } else {
      // Create DOM from scratch
      const content = buildChildren(options ?? {}, domCreateElement);
      container.appendChild(content);
      this._contentEl = content;
      // Apply root styles to the container
      const rootProps = buildRootProps(options ?? {});
      for (const [key, value] of Object.entries(rootProps.style as Record<string, any>)) {
        if (value !== undefined && value !== null) {
          if (key.startsWith('--')) {
            container.style.setProperty(key, String(value));
          } else {
            (container.style as any)[key] = typeof value === 'number' && key !== 'opacity' && key !== 'zIndex' ? `${value}px` : value;
          }
        }
      }
      container.dataset.tegaki = 'root';
      container.dir = options?.direction ?? 'auto';
    }

    this._sentinelEl = container.querySelector('[data-tegaki="sentinel"]') as HTMLSpanElement;
    this._canvasEl = container.querySelector('[data-tegaki="canvas"]') as HTMLCanvasElement;
    this._canvasFallbackEl = container.querySelector('[data-tegaki="canvas-fallback"]') as HTMLSpanElement;
    this._overlayEl = container.querySelector('[data-tegaki="overlay"]') as HTMLElement;

    // --- ResizeObserver ---
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(this._rootEl);

    // --- Sentinel transitions ---
    this._sentinelEl.addEventListener('transitionend', this._onSentinelTransition);

    // --- Reduced motion ---
    if (typeof window !== 'undefined') {
      this._mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      this._prefersReducedMotion = this._mql.matches;
      if (this._mql.addEventListener) this._mql.addEventListener('change', this._onReducedMotionChange);
      // Safari < 14 only exposes the deprecated addListener API.
      else this._mql.addListener(this._onReducedMotionChange);
    }

    // --- Initial measurement (must run before update so layout has valid dimensions) ---
    this._measure();

    // --- Apply initial options ---
    if (options) this.update(options);
  }

  // =========================================================================
  // Public API
  // =========================================================================

  get currentTime(): number {
    const tc = this._timeControl;
    if (tc.mode === 'css') return this._cssTime;
    if (tc.mode === 'controlled') return tc.unit === 'progress' ? tc.value * this._timeline.totalDuration : tc.value;
    const totalDur = this._timeline.totalDuration;
    if (tc.easing && totalDur > 0) {
      return tc.easing(this._internalTime / totalDur) * totalDur;
    }
    return this._internalTime;
  }

  get duration(): number {
    return this._timeline.totalDuration;
  }

  /**
   * The engine's current timeline — the same object that drives rendering.
   * Reflects the resolved shaper once the (async) shaper promise has
   * settled; use the `onChangeTimeline` option to be notified of recomputations.
   * Treat the returned object as read-only.
   */
  get timeline(): Timeline {
    return this._timeline;
  }

  /**
   * Compute a timeline for arbitrary text against this engine's currently-
   * loaded font, timing config, and resolved shaper. Useful for measuring
   * the duration of hypothetical text without changing what's rendered
   * (e.g. layout planning, fade-in scheduling).
   *
   * Returns an empty timeline when no font is loaded. The result reflects
   * shaper state at call time — call after `onChangeTimeline` has fired
   * once to be sure the shaper has resolved.
   */
  computeTimeline(text: string): Timeline {
    if (!this._font) return { entries: [], totalDuration: 0 };
    return computeTimeline(text, this._font, this._timing, this._shaper, this._shapeOptions());
  }

  get isPlaying(): boolean {
    return this._playing;
  }

  get isComplete(): boolean {
    const totalDur = this._timeline.totalDuration;
    if (totalDur === 0) return false;
    // For uncontrolled, check linear time so easing curves that overshoot/undershoot
    // the endpoints do not prematurely/belatedly trip completion.
    const tc = this._timeControl;
    if (tc.mode === 'uncontrolled') return this._internalTime >= totalDur;
    return this.currentTime >= totalDur;
  }

  get element(): HTMLElement {
    return this._rootEl;
  }

  /**
   * The backing `<canvas>` strokes are drawn onto. Exposed so export tooling
   * can snapshot the current frame (PNG) or sample it over time (WebM/GIF)
   * without reaching through the DOM. Reflects the latest `_render()`.
   */
  get canvas(): HTMLCanvasElement {
    return this._canvasEl;
  }

  /**
   * Serialize the current text to an SVG string that draws what the canvas
   * draws, reusing the engine's measured layout and timeline so glyph
   * positions and timing match exactly: speed, glyph and stroke easing,
   * deferred dots and stagger, every effect (pressure width, taper, nib
   * stamps, stroke and global gradients, wobble, glow), clip-to-text and
   * characters drawn from the fallback font.
   *
   * `animated: true` (default) emits a self-drawing SVG that plays once
   * (SMIL). `animated: false` emits the finished artwork. `loop: true` emits
   * a CSS-keyframe animation that draws, holds, fades, and repeats forever —
   * keyframes also animate in `<img>`-embedded SVGs (e.g. a README hero).
   *
   * Clip-to-text and fallback characters are SVG `<text>` in the bundle's
   * font; pass `fontFaces` to embed it (see {@link exportSVG}, which does).
   */
  toSVG(opts: TegakiSvgOptions = {}): string {
    const font = this._font;
    const layout = this._layout;
    const fontSize = this._fontSize;
    const canvas = this._canvasEl;
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;

    if (!font?.glyphData || !layout || !fontSize) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"></svg>`;
    }

    const lineHeight = this._lineHeight;
    const { padH, padV } = this._canvasPadding(fontSize, lineHeight);
    const emHeightPx = ((font.ascender - font.descender) / font.unitsPerEm) * fontSize;
    const halfLeading = (lineHeight - emHeightPx) / 2;
    const scale = fontSize / font.unitsPerEm;
    const characters = graphemes(this._text);
    const color = this._currentColor || 'black';
    const effects = this._resolvedEffects;

    const pressureEffect = findEffect(effects, 'pressureWidth');
    const pressure = pressureEffect ? Math.max(0, Math.min(pressureEffect.config.strength ?? 1, 1)) : 0;
    const { maxSegLenFU, smoothing } = this._subdivision(scale);
    const clipText = this._quality?.clipText;
    const strokeScale = typeof clipText === 'number' ? clipText : 1;

    const graphemeToLine = new Int32Array(characters.length).fill(-1);
    for (let li = 0; li < layout.lines.length; li++) {
      for (const charIdx of layout.lines[li]!) graphemeToLine[charIdx] = li;
    }

    const textFont = {
      family: cssFontFamily(font, this._fallbackFont),
      fontSize,
      letterSpacing: this._letterSpacing,
      featureSettings: toCssFeatureSettings(font.features ?? []),
    };
    const placements: SvgGlyphPlacement[] = [];
    const fallbackTexts: SvgFallbackText[] = [];
    const fallbackClips = this._fallbackRunClips(layout, characters, graphemeToLine, fontSize);
    const entries = this._timeline.entries;
    for (let ei = 0; ei < entries.length; ei++) {
      const entry = entries[ei]!;
      if (entry.char === '\n') continue;
      const charIdx = entry.graphemeIndex;
      const lineIdx = graphemeToLine[charIdx] ?? -1;
      if (lineIdx < 0) continue;
      const { x, y, glyphY } = entryOrigin(entry, layout, lineIdx, fontSize, lineHeight, halfLeading);
      const glyph = (entry.glyphId !== undefined ? font.glyphDataById?.[entry.glyphId] : undefined) ?? lookupGlyphData(font, entry.char);
      if (glyph && entry.hasGlyph) {
        placements.push({
          glyph,
          ox: padH + x,
          oy: padV + glyphY,
          scale,
          ascender: font.ascender,
          offset: entry.offset,
          duration: entry.duration,
          strokeDelays: entry.strokeDelays,
          strokeTimeScale: entry.strokeTimeScale,
          seed: this._seed + charIdx,
        });
      } else if (!entry.hasGlyph && /\S/u.test(entry.char)) {
        // Drawn from the fallback font once its slot ends, as `_render` does.
        const clip = fallbackClips.get(ei);
        if (clip === null) continue;
        const left = clip?.x ?? x;
        const baseline = y + halfLeading + (font.ascender / font.unitsPerEm) * fontSize;
        const style = fallbackTextStyle(left, baseline, fontSize, color, effects, clip?.seed ?? this._seed + charIdx);
        const boxLeft = clip && clip.left > -CLIP_REACH ? clip.left : (layout.charOffsets[charIdx] ?? 0) * fontSize;
        const boxRight = clip && clip.right < CLIP_REACH ? clip.right : boxLeft + (layout.charWidths[charIdx] ?? 0.5) * fontSize;
        fallbackTexts.push({
          text: clip?.text ?? entry.char,
          x: padH + left + style.dx,
          y: padV + baseline + style.dy,
          direction: clip?.direction ?? layout.direction ?? 'ltr',
          fill: style.fill,
          glows: style.glows,
          at: entry.offset + entry.duration,
          clip: clip ? [clip.left > -CLIP_REACH ? padH + clip.left : null, clip.right < CLIP_REACH ? padH + clip.right : null] : undefined,
          box: [padH + boxLeft, padV + y, padH + boxRight, padV + y + lineHeight],
        });
      }
    }

    // Layout-wide paint from `globalGradient`, over the same box `_render` gives it.
    const gg = findEffect(effects, 'globalGradient');
    const ggColors = gg?.config.colors;
    let globalGradient: SvgExportConfig['globalGradient'];
    if (Array.isArray(ggColors) && ggColors.length > 0) {
      const bbox = computeLayoutBbox(layout, fontSize, lineHeight);
      const g = globalGradientGeometry({ ...bbox, x: bbox.x + padH, y: bbox.y + padV }, ggColors, gg?.config.angle ?? 0);
      globalGradient = { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, stops: g.stops };
    }

    // `_render` clips to the text filled in its font: the shaped glyphs'
    // outlines, or — without them — the words set in the font, where the DOM put them.
    let clip: SvgExportConfig['clipText'];
    const outlines = clipText ? this._glyphOutlines(graphemeToLine, padH, padV) : null;
    if (outlines) {
      clip = { glyphs: outlines };
    } else if (clipText) {
      const words: SvgTextRun[] = [];
      let clipY = 0;
      for (let li = 0; li < layout.lines.length; li++) {
        const baseline = clipY + halfLeading + (font.ascender / font.unitsPerEm) * fontSize;
        for (const word of lineWords(layout, characters, li)) {
          words.push({ text: word.text, x: padH + word.leftEm * fontSize, y: padV + baseline, direction: word.direction });
        }
        clipY += lineHeight;
      }
      clip = { font: textFont, words };
    }

    const tc = this._timeControl;
    const speed = opts.speed ?? (tc.mode === 'uncontrolled' && 'speed' in tc && tc.speed ? tc.speed : 1);

    return placementsToSvg(placements, {
      width,
      height,
      lineCap: font.lineCap,
      color,
      pressure,
      segmentLengthFU: maxSegLenFU,
      smoothing,
      strokeScale,
      animated: opts.animated ?? true,
      loop: opts.loop ?? false,
      totalDuration: this._timeline.totalDuration,
      effects,
      fontSize,
      speed,
      strokeEasing: this._timing?.strokeEasing,
      glyphEasing: this._timing?.glyphEasing,
      loopHold: opts.loopHold,
      crop: opts.crop,
      globalGradient,
      clipText: clip,
      fallback: fallbackTexts.length > 0 ? { font: textFont, texts: fallbackTexts } : undefined,
      fontFaces: opts.fontFaces,
    });
  }

  /**
   * {@link toSVG}, with the fonts its text needs embedded as data URIs — the
   * bundle's faces when strokes are clipped to the text or characters fall
   * back to the font, and the bundled full font for those characters — so the
   * file renders the same anywhere. Fonts are fetched from the bundle's URLs.
   */
  async exportSVG(opts: Omit<TegakiSvgOptions, 'fontFaces'> = {}): Promise<string> {
    const font = this._font;
    const faces: { family: string; url: string }[] = [];
    if (font) {
      const fallback = drawsFallbackGlyphs(this._timeline.entries);
      if ((this._quality?.clipText && !this._glyphOutlines()) || fallback) {
        for (const url of [font.fontUrl, ...(font.extraFontUrls ?? [])]) faces.push({ family: font.family, url });
      }
      if (fallback && font.fullFontUrl && font.fullFamily) faces.push({ family: font.fullFamily, url: font.fullFontUrl });
    }
    const fontFaces = await Promise.all(faces.map(async ({ family, url }) => ({ family, src: await fontDataUri(url) })));
    return this.toSVG({ ...opts, fontFaces });
  }

  play(): void {
    if (this._timeControl.mode !== 'uncontrolled') return;
    this._playing = true;
    this._evaluatePlayback();
  }

  pause(): void {
    if (this._timeControl.mode !== 'uncontrolled') return;
    this._playing = false;
    this._evaluatePlayback();
  }

  /**
   * Seek the (uncontrolled) timeline to an absolute time. Accepts seconds
   * (number) or a percentage string like `"50%"`, which is interpreted as
   * a fraction of the timeline's total duration.
   */
  seek(time: number | `${number}%`): void {
    if (this._timeControl.mode !== 'uncontrolled') return;
    let resolved: number;
    if (typeof time === 'string') {
      const pct = parsePercentage(time);
      if (pct == null) return;
      resolved = pct * this._timeline.totalDuration;
    } else {
      resolved = time;
    }
    this._internalTime = Math.max(0, Math.min(resolved, this._timeline.totalDuration));
    this._delayRemaining = 0;
    this._loopGapRemaining = 0;
    this._checkCompletion();
    this._notifyTimeChange();
    this._render();
    this._updateCssProperties();
  }

  restart(): void {
    if (this._timeControl.mode !== 'uncontrolled') return;
    this._internalTime = 0;
    this._playing = true;
    this._prevCompleted = false;
    this._delayRemaining = this._timeControl.delay ?? 0;
    this._loopGapRemaining = 0;
    this._notifyTimeChange();
    this._evaluatePlayback();
  }

  update(options: Partial<TegakiEngineOptions>): void {
    if (this._destroyed) return;

    let dirtyTimeline = false;
    let dirtyLayout = false;
    let dirtyRender = false;
    let dirtyPlayback = false;

    if ('text' in options) {
      // NFC normalize so input form (NFC vs NFD) doesn't change which bundle
      // key resolves: bundles are built with NFC keys, and HarfBuzz / the
      // browser overlay normalize internally, so without this the canvas
      // shapes correctly but `glyphData[char]` lookups (timeline, advance
      // widths, DOM-fillText fallback) miss for NFD input — e.g. `"é"` typed
      // as `e` + U+0301 would resolve to bare `e` via the leading-codepoint
      // fallback even though the bundle has the right precomposed glyph.
      const nextText = (options.text ?? '').replace(/\r\n?/g, '\n').normalize('NFC');
      if (nextText !== this._text) {
        this._text = nextText;
        dirtyTimeline = true;
        dirtyLayout = true;
      }
    }

    if ('shaper' in options) {
      const next = options.shaper !== false;
      if (next !== this._shaperEnabled) {
        this._shaperEnabled = next;
        this._loadShaper();
        this._updateOverlayStyle();
        dirtyTimeline = true;
        dirtyLayout = true;
        dirtyPlayback = true;
        dirtyRender = true;
      }
    }

    if ('font' in options) {
      const resolved = resolveBundle(options.font) ?? null;
      if (resolved !== this._font) {
        this._loadFont(resolved);
        dirtyTimeline = true;
        dirtyLayout = true;
        dirtyPlayback = true;
      }
    }

    if ('time' in options) {
      const newTc = resolveTimeControl(options.time);
      const oldTc = this._timeControl;

      // Detect meaningful changes
      const modeChanged = newTc.mode !== oldTc.mode;
      const controlledValueChanged =
        newTc.mode === 'controlled' && oldTc.mode === 'controlled' && (newTc.value !== oldTc.value || newTc.unit !== oldTc.unit);
      const uncontrolledChanged =
        newTc.mode === 'uncontrolled' &&
        oldTc.mode === 'uncontrolled' &&
        (newTc.speed !== oldTc.speed ||
          newTc.duration !== oldTc.duration ||
          newTc.playing !== oldTc.playing ||
          newTc.loop !== oldTc.loop ||
          newTc.delay !== oldTc.delay ||
          newTc.loopGap !== oldTc.loopGap ||
          newTc.catchUp !== oldTc.catchUp ||
          newTc.easing !== oldTc.easing);

      if (modeChanged || controlledValueChanged || uncontrolledChanged) {
        this._timeControl = newTc;

        if (newTc.mode === 'uncontrolled') {
          this._playing = newTc.playing ?? true;
          const oldDelay = oldTc.mode === 'uncontrolled' ? (oldTc.delay ?? 0) : 0;
          const newDelay = newTc.delay ?? 0;
          if (modeChanged || oldDelay !== newDelay) {
            this._delayRemaining = newDelay;
            this._loopGapRemaining = 0;
          }
        }

        dirtyPlayback = true;
        dirtyRender = true;

        // Update sentinel transition for css mode
        this._updateSentinelTransition();
      }
    }

    if ('effects' in options && options.effects !== this._effects) {
      this._effects = options.effects as Record<string, any>;
      this._resolvedEffects = resolveEffects(this._effects);
      dirtyRender = true;
    }

    if ('timing' in options && options.timing !== this._timing) {
      this._timing = options.timing;
      dirtyTimeline = true;
    }

    if ('quality' in options && options.quality !== this._quality) {
      this._quality = options.quality;
      dirtyRender = true;
    }

    if ('fallbackFont' in options && options.fallbackFont !== this._fallbackFont) {
      this._fallbackFont = options.fallbackFont;
      dirtyLayout = true;
      dirtyRender = true;
    }

    if ('direction' in options && options.direction !== this._direction) {
      this._direction = options.direction;
      // Shaping follows the direction: it decides which brackets are mirrored.
      dirtyTimeline = true;
      dirtyLayout = true;
      dirtyRender = true;
    }

    if ('showOverlay' in options && options.showOverlay !== this._showOverlay) {
      this._showOverlay = options.showOverlay ?? false;
      this._updateOverlayStyle();
      dirtyRender = true;
    }

    if ('onComplete' in options) {
      this._onComplete = options.onComplete;
    }

    if ('onChangeTimeline' in options) {
      this._onChangeTimeline = options.onChangeTimeline;
    }

    // --- Recompute ---
    if (dirtyTimeline) this._recomputeTimeline();
    if (dirtyRender || dirtyTimeline || dirtyLayout) this._updateDom();
    if (dirtyLayout) this._recomputeLayout();
    if (dirtyPlayback) this._evaluatePlayback();
    if (dirtyRender || dirtyTimeline || dirtyLayout) this._render();
  }

  destroy(): void {
    this._destroyed = true;
    this._stopLoop();
    this._resizeObserver.disconnect();
    this._sentinelEl.removeEventListener('transitionend', this._onSentinelTransition);
    if (this._mql) {
      if (this._mql.removeEventListener) this._mql.removeEventListener('change', this._onReducedMotionChange);
      else this._mql.removeListener(this._onReducedMotionChange);
    }
    // Only remove content we created (non-adopt mode). The container is owned by the caller.
    this._contentEl?.remove();
    // Drop the subdivision cache so the font's strokes aren't kept keyed
    // against this (dead) engine if a caller holds a stale reference.
    this._strokeCache = new WeakMap();
    this._strokeCacheKey = '';
    this._maskCanvas = null;
  }

  // =========================================================================
  // Internal: DOM updates
  // =========================================================================

  /** Estimate line-height from font metrics when CSS returns "normal". */
  private _fallbackLineHeight(fontSize: number): number {
    if (this._font) {
      return ((this._font.ascender - this._font.descender) / this._font.unitsPerEm) * fontSize;
    }
    return fontSize * 1.2;
  }

  private _measure(): void {
    const styles = getComputedStyle(this._rootEl);
    this._containerWidth = this._rootEl.getBoundingClientRect().width;
    this._fontSize = Number.parseFloat(styles.fontSize);
    const parsedLh = Number.parseFloat(styles.lineHeight);
    this._lineHeight = Number.isNaN(parsedLh) ? this._fallbackLineHeight(this._fontSize) : parsedLh;
    this._currentColor = styles.color;
    this._letterSpacing = parseLetterSpacing(styles.letterSpacing);
    this._updateOverlayStyle();
  }

  /** How the overlay's text is laid out, for the shaper to match. */
  /**
   * How the timeline shapes the text. The layout's shaping must agree (it
   * matches glyph ids against the timeline's), so it takes the DOM's resolved
   * direction — the same one: the root is `dir="auto"` unless told otherwise.
   */
  private _shapeOptions(): ShapeOptions {
    return { letterSpaced: this._letterSpacing !== 0, direction: this._direction ?? paragraphDirection(this._text) };
  }

  /**
   * Adopt a new letter spacing. Browsers shape spaced text without ligatures
   * or contextual alternates, so when spacing crosses zero the overlay's
   * feature settings and the shaped timeline change with it. Callers
   * recompute the layout afterwards, which re-fills the timeline's offsets.
   */
  private _setLetterSpacing(next: number): void {
    const wasSpaced = this._letterSpacing !== 0;
    this._letterSpacing = next;
    if (wasSpaced === (next !== 0)) return;
    this._updateOverlayStyle();
    this._recomputeTimeline();
  }

  private _updateDom(): void {
    // Font family
    this._rootEl.style.fontFamily = this._font ? cssFontFamily(this._font, this._fallbackFont) : '';

    // Direction
    this._rootEl.style.direction = this._direction ?? '';

    // CSS custom properties
    this._updateCssProperties();

    // Overlay text (guard to preserve cursor position when contentEditable)
    if (this._overlayEl.textContent !== this._text) {
      this._overlayEl.textContent = this._text;
    }
    this._canvasFallbackEl.textContent = this._text;
  }

  private _updateCssProperties(): void {
    const time = this.currentTime;
    const dur = this._timeline.totalDuration;
    this._rootEl.style.setProperty(CSS_DURATION, String(dur));
    this._rootEl.style.setProperty(CSS_TIME, String(time));
    this._rootEl.style.setProperty(CSS_PROGRESS, String(dur > 0 ? time / dur : 0));
  }

  private _updateOverlayStyle(): void {
    // Hide the overlay glyphs with `color: transparent` (not the non-standard
    // `-webkit-text-fill-color`, which DOM rasterizers skip — see render-elements).
    this._overlayEl.style.color = this._showOverlay ? 'rgba(255, 0, 0, 0.4)' : 'transparent';
    // When the shaper is off, the renderer iterates raw graphemes and looks
    // each char up in the bundle's char-keyed `glyphData` — i.e. nominal
    // glyphs only. The overlay (which provides layout measurement and the
    // visible text outline) must match: disable every variant-producing
    // GSUB feature so the browser doesn't form ligatures, contextual
    // alternates, or Arabic positional forms the renderer can't draw.
    //
    // Letter-spaced text is shaped without the features browsers drop between
    // spaced letters (see LETTER_SPACED_OFF_FEATURES); disable them outright so
    // a browser that would keep some of them still draws what the shaper does.
    this._overlayEl.style.fontFeatureSettings = !this._shaperEnabled
      ? "'liga' 0, 'calt' 0, 'clig' 0, 'rlig' 0, 'dlig' 0, 'init' 0, 'medi' 0, 'fina' 0, 'isol' 0"
      : this._letterSpacing !== 0
        ? LETTER_SPACED_OFF_FEATURES.map((tag) => `'${tag}' 0`).join(', ')
        : '';
  }

  private _updateSentinelTransition(): void {
    const isCss = this._timeControl.mode === 'css';
    this._sentinelEl.style.transition = isCss
      ? `font-size 0.001s, line-height 0.001s, color 0.001s, letter-spacing 0.001s, ${CSS_PROGRESS} 0.001s`
      : 'font-size 0.001s, line-height 0.001s, color 0.001s, letter-spacing 0.001s';
  }

  // =========================================================================
  // Internal: Resize & sentinel observers
  // =========================================================================

  private _onResize = (entries: ResizeObserverEntry[]): void => {
    const entry = entries[0];
    if (!entry) return;
    const newWidth = entry.contentRect.width;
    const styles = getComputedStyle(this._rootEl);
    const newFontSize = Number.parseFloat(styles.fontSize);
    const parsedLh = Number.parseFloat(styles.lineHeight);
    const newLineHeight = Number.isNaN(parsedLh) ? this._fallbackLineHeight(newFontSize) : parsedLh;
    const newColor = styles.color;
    const newLetterSpacing = parseLetterSpacing(styles.letterSpacing);

    let changed = false;
    let layoutChanged = false;

    if (newWidth !== this._containerWidth) {
      this._containerWidth = newWidth;
      layoutChanged = true;
      changed = true;
    }
    if (newFontSize !== this._fontSize) {
      this._fontSize = newFontSize;
      layoutChanged = true;
      changed = true;
    }
    if (newLineHeight !== this._lineHeight) {
      this._lineHeight = newLineHeight;
      layoutChanged = true;
      changed = true;
    }
    if (newColor !== this._currentColor) {
      this._currentColor = newColor;
      changed = true;
    }
    if (newLetterSpacing !== this._letterSpacing) {
      this._setLetterSpacing(newLetterSpacing);
      layoutChanged = true;
      changed = true;
    }

    if (layoutChanged) this._recomputeLayout();
    if (changed) this._render();
  };

  private _onSentinelTransition = (e: TransitionEvent): void => {
    const styles = getComputedStyle(this._sentinelEl);
    let changed = false;

    if (e.propertyName === 'font-size' || e.propertyName === 'line-height') {
      const newFontSize = Number.parseFloat(styles.fontSize);
      const parsedLh = Number.parseFloat(styles.lineHeight);
      const newLineHeight = Number.isNaN(parsedLh) ? this._fallbackLineHeight(newFontSize) : parsedLh;
      if (newFontSize !== this._fontSize || newLineHeight !== this._lineHeight) {
        this._fontSize = newFontSize;
        this._lineHeight = newLineHeight;
        this._recomputeLayout();
        changed = true;
      }
    }

    if (e.propertyName === 'color') {
      const newColor = styles.color;
      if (newColor !== this._currentColor) {
        this._currentColor = newColor;
        changed = true;
      }
    }

    if (e.propertyName === 'letter-spacing') {
      const newLetterSpacing = parseLetterSpacing(styles.letterSpacing);
      if (newLetterSpacing !== this._letterSpacing) {
        this._setLetterSpacing(newLetterSpacing);
        this._recomputeLayout();
        changed = true;
      }
    }

    if (e.propertyName === CSS_PROGRESS) {
      const rawProgress = Number(styles.getPropertyValue(CSS_PROGRESS));
      this._cssTime = rawProgress * this._timeline.totalDuration;
      changed = true;
    }

    if (changed) this._render();
  };

  // =========================================================================
  // Internal: Reduced motion
  // =========================================================================

  private _onReducedMotionChange = (e: MediaQueryListEvent): void => {
    this._prefersReducedMotion = e.matches;
    if (this._prefersReducedMotion && this._timeControl.mode === 'uncontrolled' && this._timeline.totalDuration > 0) {
      this._internalTime = this._timeline.totalDuration;
    }
    this._evaluatePlayback();
    this._render();
  };

  // =========================================================================
  // Internal: Font loading
  // =========================================================================

  private _loadFont(font: TegakiBundle | null): void {
    this._font = font;
    this._fontReady = false;

    if (!font) {
      this._loadShaper();
      return;
    }

    const pending = ensureFont(font.family, font.fontUrl, font.features, font.extraFontUrls, font.extraFontRanges);
    if (pending === null) {
      this._fontReady = true;
    } else {
      const currentFont = font;
      const onSettled = () => {
        if (this._font === currentFont && !this._destroyed) {
          this._fontReady = true;
          this._recomputeTimeline();
          this._updateDom();
          this._recomputeLayout();
          this._evaluatePlayback();
          this._render();
        }
      };
      // A failed font load must not leave the canvas blank forever: strokes come
      // from the bundle's glyph data, so render anyway and surface the cause.
      pending.then(onSettled, (error) => {
        warnFontLoadFailure(currentFont, error);
        onSettled();
      });
    }

    this._loadShaper();
  }

  /**
   * Resolve the shaper for the current font. Called when the font changes or
   * when the `shaper` option is toggled. Drops any in-flight shaper for the
   * previous font; the `_font === currentFont` guard inside the promise
   * handler discards stale resolutions.
   */
  private _loadShaper(): void {
    this._shaper = null;
    this._shaperReady = true;
    if (!this._shaperEnabled || !this._font) return;

    const shaperPromise = getShaperForBundle(this._font);
    if (!shaperPromise) return;
    // Already built (the same font swapped for a rebuilt bundle, or one
    // `preload` warmed): take it now, so no frame is drawn unshaped meanwhile.
    const settled = settledShaperForBundle(this._font);
    if (settled !== undefined) {
      this._shaper = settled;
      return;
    }

    this._shaperReady = false;
    const currentFont = this._font;
    const onSettled = (shaper: BundleShaper | null) => {
      if (this._font === currentFont && this._shaperEnabled && !this._destroyed) {
        this._shaper = shaper;
        this._shaperReady = true;
        this._recomputeTimeline();
        this._recomputeLayout();
        this._evaluatePlayback();
        this._render();
      }
    };
    // A rejected shaper (e.g. the font fetch failed) falls back to unshaped
    // rendering instead of stalling playback on `_shaperReady`.
    shaperPromise.then(onSettled, (error) => {
      console.warn(`[tegaki] Shaper failed for "${currentFont.family}"; rendering without shaping.`, error);
      onSettled(null);
    });
  }

  /**
   * Where each fallback character (one the bundle has no glyph for) is drawn
   * from, by timeline entry. Characters are drawn in runs of consecutive ones
   * (`fallbackRuns`): the run's whole text, shaped together as the DOM shapes
   * it — alone, an Arabic letter would lose its joining form — at the run's
   * left edge, clipped to the character's own box so each still appears when
   * its time comes. The run's outer edges aren't clipped: ink reaching past
   * the advance boxes (a swash, a final tail) belongs to the end letters.
   * The run shares one effect seed, so a wobble moves it as one piece.
   * A character with several entries (a cluster of code points the font
   * lacks) is drawn by its first; the rest map to `null`.
   */
  private _fallbackRunClips(
    layout: TextLayout,
    characters: readonly string[],
    graphemeToLine: Int32Array,
    fontSize: number,
  ): Map<number, FallbackClip | null> {
    const clips = new Map<number, FallbackClip | null>();
    const entries = this._timeline.entries;
    const { runs } = fallbackRuns(entries, characters, (g) => graphemeToLine[g] ?? -1);
    for (const run of runs) {
      if (run.entries.length < 2) continue;
      const first = entries[run.entries[0]!]!;
      // One box per character, where the layout measured it.
      const boxes: { ei: number; left: number; right: number }[] = [];
      let lastGrapheme = -1;
      for (const ei of run.entries) {
        const g = entries[ei]!.graphemeIndex;
        if (g === lastGrapheme) {
          clips.set(ei, null);
          continue;
        }
        lastGrapheme = g;
        const left = (layout.charOffsets[g] ?? 0) * fontSize;
        boxes.push({ ei, left, right: left + (layout.charWidths[g] ?? 0) * fontSize });
      }
      const runLeft = Math.min(...boxes.map((b) => b.left));
      const runRight = Math.max(...boxes.map((b) => b.right));
      const direction = run.direction ?? layout.direction ?? 'ltr';
      for (const box of boxes) {
        clips.set(box.ei, {
          text: run.text,
          x: runLeft,
          left: box.left === runLeft ? -CLIP_REACH : box.left,
          right: box.right === runRight ? CLIP_REACH : box.right,
          direction,
          seed: this._seed + first.graphemeIndex,
        });
      }
    }
    return clips;
  }

  // =========================================================================
  // Internal: Recomputation
  // =========================================================================

  private _recomputeTimeline(): void {
    if (this._font && this._text) {
      const softBreaks = this._softBreaks?.text === this._text ? this._softBreaks.offsets : undefined;
      this._timeline = computeTimeline(this._text, this._font, this._timing, this._shaper, this._shapeOptions(), softBreaks);
    } else {
      this._timeline = { entries: [] as TimelineEntry[], totalDuration: 0 };
    }
    this._onChangeTimeline?.(this._timeline);
    this._loadFullFontIfNeeded();
  }

  /**
   * Load the bundle's full font once the text draws a character the bundle
   * has no glyph for, and only then: a CJK full font is megabytes, and text
   * that stays within the generated set never needs it. The overlay lays such
   * characters out in the root's font stack and the canvas draws them as
   * plain text in it, so both re-run once the face arrives.
   */
  private _loadFullFontIfNeeded(): void {
    const font = this._font;
    if (!font?.fullFamily || !font.fullFontUrl || !drawsFallbackGlyphs(this._timeline.entries)) return;
    const face = { family: font.fullFamily, url: font.fullFontUrl };
    const pending = ensureFont(face.family, face.url, font.features);
    if (pending === null) return;
    pending.then(
      () => {
        if (this._font !== font || this._destroyed) return;
        this._layoutKey = '';
        this._recomputeLayout();
        this._render();
      },
      (error) => warnFontLoadFailure(font, error, face),
    );
  }

  private _recomputeLayout(): void {
    if (this._fontReady && this._font?.family && this._fontSize && this._containerWidth && this._text) {
      const shaperId = this._shaper ? '1' : '0';
      const key = `${this._text}\0${this._font.family}\0${this._fallbackFont ?? ''}\0${this._fontSize}\0${this._lineHeight}\0${this._containerWidth}\0${this._direction ?? ''}\0${shaperId}\0${this._letterSpacing}`;
      if (key === this._layoutKey) return;
      this._layoutKey = key;
      let layout = computeTextLayout(this._overlayEl, this._fontSize);
      if (this._shaper && this._font) {
        // A word wrapped inside is shaped in two pieces, as the browser draws
        // it: a ligature across the wrap splits back into its letters. The
        // timeline was shaped without knowing the wraps, so reshape it when
        // they change.
        const breaks = midWordBreaks(layout, this._text);
        const known = this._softBreaks?.text === this._text ? this._softBreaks.offsets : [];
        if (breaks.join() !== known.join()) {
          this._softBreaks = { text: this._text, offsets: breaks };
          this._recomputeTimeline();
        }
        // Replace DOM-measured per-grapheme offsets with shaper-accumulated
        // advances so stroke positions match the glyph ids the shaper chose.
        // Also fills in per-entry GPOS x/y offsets on the (already-computed)
        // timeline — essential for Arabic cursive attachment and mark
        // positioning, where each glyph in a cluster needs its own origin.
        // The DOM is still the source of truth for line breaks.
        const letterSpacingEm = this._fontSize > 0 ? this._letterSpacing / this._fontSize : 0;
        layout = applyShaperPositions(
          layout,
          this._overlayEl,
          this._text,
          this._fontSize,
          this._font,
          this._shaper,
          this._timeline,
          letterSpacingEm,
        );
      }
      this._layout = layout;
    } else {
      this._layoutKey = '';
      this._layout = null;
    }
  }

  // =========================================================================
  // Internal: Playback loop
  // =========================================================================

  private _evaluatePlayback(): void {
    const tc = this._timeControl;
    const shouldRun =
      tc.mode === 'uncontrolled' && this._playing && !!this._font && this._fontReady && this._shaperReady && !this._prefersReducedMotion;

    if (shouldRun) {
      this._startLoop();
    } else {
      this._stopLoop();
    }
  }

  private _startLoop(): void {
    if (this._rafId) return;
    this._lastTs = null;
    this._smoothedBoost = 0;
    this._rafId = requestAnimationFrame(this._tick);
  }

  private _stopLoop(): void {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
  }

  private _tick = (ts: number): void => {
    if (this._destroyed) return;

    if (this._lastTs === null) this._lastTs = ts;
    const dtSec = (ts - this._lastTs) / 1000;
    this._lastTs = ts;

    const tc = this._timeControl;
    if (tc.mode !== 'uncontrolled') return;

    const loop = tc.loop ?? false;
    const totalDur = this._timeline.totalDuration;
    const durationOverride = tc.duration;
    const useDuration = durationOverride !== undefined && durationOverride > 0;

    if (totalDur === 0 || (!loop && this._internalTime >= totalDur)) {
      this._internalTime = totalDur;
      this._rafId = requestAnimationFrame(this._tick);
      return;
    }

    // --- Initial delay ---
    if (this._delayRemaining > 0) {
      this._delayRemaining = Math.max(0, this._delayRemaining - dtSec);
      this._rafId = requestAnimationFrame(this._tick);
      return;
    }

    // --- Loop gap (waiting between iterations) ---
    if (this._loopGapRemaining > 0) {
      this._loopGapRemaining = Math.max(0, this._loopGapRemaining - dtSec);
      if (this._loopGapRemaining <= 0) {
        this._internalTime = 0;
        this._prevCompleted = false;
        this._smoothedBoost = 0;
      }
      this._notifyTimeChange();
      this._render();
      this._updateCssProperties();
      this._rafId = requestAnimationFrame(this._tick);
      return;
    }

    // Compute effective speed. `duration` stretches the natural timeline to fit
    // a fixed wall-clock slot; otherwise use `speed` + optional `catchUp`.
    let effectiveSpeed: number;
    if (useDuration) {
      effectiveSpeed = totalDur / durationOverride;
    } else {
      const speed = tc.speed ?? 1;
      const catchUp = tc.catchUp ?? 0;
      effectiveSpeed = speed;
      if (catchUp > 0) {
        const remaining = Math.max(0, totalDur - this._internalTime);
        const excess = Math.max(0, remaining - 2);
        const targetBoost = catchUp * excess;
        const attackRate = 4;
        const releaseRate = loop ? 30 : 2;
        const rate = targetBoost > this._smoothedBoost ? attackRate : releaseRate;
        this._smoothedBoost += (targetBoost - this._smoothedBoost) * (1 - Math.exp(-rate * dtSec));
        effectiveSpeed = speed + this._smoothedBoost;
      }
    }

    let next = this._internalTime + dtSec * effectiveSpeed;
    if (next >= totalDur) {
      if (loop) {
        const loopGap = tc.loopGap ?? 0;
        if (loopGap > 0) {
          // Hold at the end and start the loop gap countdown
          next = totalDur;
          this._loopGapRemaining = loopGap;
        } else if (this._internalTime < totalDur) {
          // Render one frame at totalDur so every entry (including the
          // last fallback character) satisfies its reveal condition
          // before the animation wraps back to the start.
          next = totalDur;
        } else {
          next %= totalDur;
        }
      } else {
        next = totalDur;
      }
      this._smoothedBoost = 0;
    }
    this._internalTime = next;

    this._notifyTimeChange();
    this._checkCompletion();
    this._render();
    this._updateCssProperties();

    this._rafId = requestAnimationFrame(this._tick);
  };

  private _notifyTimeChange(): void {
    const tc = this._timeControl;
    if (tc.mode === 'uncontrolled' && tc.onTimeChange) {
      // Emit eased time so it matches what's drawn and what CSS variables expose.
      tc.onTimeChange(this.currentTime);
    }
  }

  private _checkCompletion(): void {
    const complete = this.isComplete;
    if (complete && !this._prevCompleted) {
      this._prevCompleted = true;
      this._onComplete?.();
    } else if (!complete) {
      this._prevCompleted = false;
    }
  }

  // =========================================================================
  // Internal: Canvas rendering
  // =========================================================================

  /**
   * Where the text box sits in the canvas: the default padding plus whatever
   * the canvas box was grown by on the left / top to fit the ink.
   */
  private _canvasPadding(fontSize: number, lineHeight: number): { padH: number; padV: number } {
    const padV = Math.max(MIN_PADDING_V_EM * fontSize, (MIN_LINE_HEIGHT_EM * fontSize - lineHeight) / 2);
    return { padH: PADDING_H_EM * fontSize + this._canvasOverflow.left, padV: padV + this._canvasOverflow.top };
  }

  /**
   * Grow the canvas box on whichever side the strokes reach past its default
   * padding — a stem running past its letter's advance (Caveat's d under
   * negative letter-spacing), a wide script flourish, a glow — and shrink it
   * back once they don't. Every glyph counts, drawn yet or not, so the box
   * holds still while the text animates in. Restyles only on change.
   */
  private _fitCanvasToInk(): void {
    const font = this._font;
    const layout = this._layout;
    const fontSize = this._fontSize;
    const cur = this._canvasOverflow;
    let next = NO_OVERFLOW;
    if (font?.glyphData && layout && fontSize) {
      const lineHeight = this._lineHeight;
      const scale = fontSize / font.unitsPerEm;
      const halfLeading = (lineHeight - ((font.ascender - font.descender) / font.unitsPerEm) * fontSize) / 2;
      const clipText = this._quality?.clipText;
      const strokeScale = typeof clipText === 'number' ? clipText : 1;
      // +1px for antialiasing at the ink's edge.
      const margin = effectInkMargin(this._resolvedEffects, fontSize, scale) + 1;
      const graphemeToLine = new Map<number, number>();
      layout.lines.forEach((line, li) => {
        for (const charIdx of line) graphemeToLine.set(charIdx, li);
      });
      const ink = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const entry of this._timeline.entries) {
        if (entry.char === '\n' || !entry.hasGlyph) continue;
        const lineIdx = graphemeToLine.get(entry.graphemeIndex);
        if (lineIdx === undefined) continue;
        const glyph = (entry.glyphId !== undefined ? font.glyphDataById?.[entry.glyphId] : undefined) ?? lookupGlyphData(font, entry.char);
        const bounds = glyph && glyphInkBounds(glyph);
        if (!bounds) continue;
        const { x, glyphY } = entryOrigin(entry, layout, lineIdx, fontSize, lineHeight, halfLeading);
        const reach = bounds.reach * strokeScale * scale + margin;
        ink.minX = Math.min(ink.minX, x + bounds.minX * scale - reach);
        ink.maxX = Math.max(ink.maxX, x + bounds.maxX * scale + reach);
        ink.minY = Math.min(ink.minY, glyphY + (bounds.minY + font.ascender) * scale - reach);
        ink.maxY = Math.max(ink.maxY, glyphY + (bounds.maxY + font.ascender) * scale + reach);
      }
      // Into the default canvas box's frame: offset by its padding, sized
      // as the current box less the overflow it already carries.
      const { padH, padV } = this._canvasPadding(fontSize, lineHeight);
      const dx = padH - cur.left;
      const dy = padV - cur.top;
      next = inkOverflow(
        { minX: ink.minX + dx, maxX: ink.maxX + dx, minY: ink.minY + dy, maxY: ink.maxY + dy },
        this._canvasEl.offsetWidth - cur.left - cur.right,
        this._canvasEl.offsetHeight - cur.top - cur.bottom,
      );
    }
    if (next.left === cur.left && next.top === cur.top && next.right === cur.right && next.bottom === cur.bottom) return;
    this._canvasOverflow = next;
    Object.assign(this._canvasEl.style, canvasBoxStyle(next));
  }

  /**
   * The outline of every glyph the text draws, placed as the strokes are
   * (absolute px with the canvas padding), so SVG export can clip to the text
   * without embedding the font. Null unless the shaper provides outlines and
   * every visible character is a shaped glyph of the bundle's font.
   */
  private _glyphOutlines(graphemeToLine?: Int32Array, padH = 0, padV = 0): SvgGlyphOutline[] | null {
    const font = this._font;
    const layout = this._layout;
    const fontSize = this._fontSize;
    const shaper = this._shaper;
    const entries = this._timeline.entries;
    if (!font || !layout || !fontSize || !shaper?.glyphPath || drawsFallbackGlyphs(entries)) return null;
    let lines = graphemeToLine;
    if (!lines) {
      lines = new Int32Array(graphemes(this._text).length).fill(-1);
      for (let li = 0; li < layout.lines.length; li++) for (const charIdx of layout.lines[li]!) lines[charIdx] = li;
    }
    const lineHeight = this._lineHeight;
    const scale = fontSize / font.unitsPerEm;
    const halfLeading = (lineHeight - ((font.ascender - font.descender) / font.unitsPerEm) * fontSize) / 2;
    const out: SvgGlyphOutline[] = [];
    for (const entry of entries) {
      if (!/\S/u.test(entry.char)) continue;
      if (entry.glyphId === undefined) return null;
      const lineIdx = lines[entry.graphemeIndex] ?? -1;
      if (lineIdx < 0) continue;
      const d = shaper.glyphPath(entry.glyphId);
      if (d === null) return null;
      const { x, glyphY } = entryOrigin(entry, layout, lineIdx, fontSize, lineHeight, halfLeading);
      out.push({ d, x: padH + x, y: padV + glyphY + font.ascender * scale, scale });
    }
    return out;
  }

  /** A `Path2D` per outline, parsed once per shaper. */
  private _outlinePaths(outlines: SvgGlyphOutline[]): Path2D[] {
    if (this._maskPaths.shaper !== this._shaper) this._maskPaths = { shaper: this._shaper, paths: new Map() };
    const cache = this._maskPaths.paths;
    return outlines.map((g) => {
      let path = cache.get(g.d);
      if (!path) {
        path = new Path2D(g.d);
        cache.set(g.d, path);
      }
      return path;
    });
  }

  /**
   * The stroke subdivision threshold in font units — Infinity for the raw
   * polyline. It collapses every input that matters (segmentSize in CSS px,
   * fontSize, unitsPerEm, whether any effect needs subdivision) into one value.
   */
  private _subdivision(scale: number): { maxSegLenFU: number; smoothing: boolean } {
    const effects = this._resolvedEffects;
    const pressure = findEffect(effects, 'pressureWidth');
    const effectsNeedSubdivision =
      !!findEffect(effects, 'wobble') ||
      !!findEffect(effects, 'strokeGradient') ||
      !!findEffect(effects, 'taper') ||
      (!!pressure && Math.max(0, Math.min(pressure.config.strength ?? 1, 1)) > 0);
    const smoothing = this._quality?.smoothing === true;
    const resolvedSegmentSize = this._quality?.segmentSize ?? (effectsNeedSubdivision || smoothing ? 2 : undefined);
    return { maxSegLenFU: resolvedSegmentSize != null ? resolvedSegmentSize / scale : Infinity, smoothing };
  }

  private _render(): void {
    const canvas = this._canvasEl;
    const font = this._font;
    const layout = this._layout;
    const fontSize = this._fontSize;

    const dpr = window.devicePixelRatio || 1;
    // Supersampling: draw into a backing canvas larger than the displayed CSS
    // size, then let the browser downsample. Improves antialiasing at a
    // quadratic cost in pixels filled.
    const pixelRatio = Math.max(this._quality?.pixelRatio ?? 1, 0);
    const effectiveDpr = dpr * pixelRatio;
    this._fitCanvasToInk();
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    const needsResize = canvas.width !== Math.round(w * effectiveDpr) || canvas.height !== Math.round(h * effectiveDpr);
    if (needsResize) {
      canvas.width = Math.round(w * effectiveDpr);
      canvas.height = Math.round(h * effectiveDpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Nothing to draw (e.g. empty text) — but the clear above still needs to
    // run so stale pixels from the previous render don't linger.
    if (!font?.glyphData || !layout || !fontSize) return;

    const lineHeight = this._lineHeight;
    const { padH, padV } = this._canvasPadding(fontSize, lineHeight);
    ctx.translate(padH, padV);

    const color = this._currentColor || 'black';
    const emHeight = (font.ascender - font.descender) / font.unitsPerEm;
    const emHeightPx = emHeight * fontSize;
    const halfLeading = (lineHeight - emHeightPx) / 2;
    const characters = graphemes(this._text);
    const currentTime = this.currentTime;

    // --- Subdivision cache setup ---
    // `maxSegLenFU` is the subdivision threshold in font units. It collapses
    // every input that matters (segmentSize in CSS px, fontSize, unitsPerEm,
    // whether any effect needs subdivision) into a single value, so the cache
    // key is just (font family, maxSegLenFU). When anything that affects
    // subdivision changes, the key changes and the WeakMap is swapped out.
    const scale = fontSize / font.unitsPerEm;
    const { maxSegLenFU, smoothing } = this._subdivision(scale);
    const cacheKey = `${font.family}|${maxSegLenFU}|${smoothing ? 's' : 'l'}`;
    if (cacheKey !== this._strokeCacheKey) {
      this._strokeCache = new WeakMap();
      this._strokeCacheKey = cacheKey;
    }
    const strokeCache = this._strokeCache;
    const getSubdivided = (stroke: TegakiGlyphData['s'][number]): SubdividedStroke => {
      let sub = strokeCache.get(stroke);
      if (!sub) {
        sub = subdivideStroke(stroke, maxSegLenFU, smoothing);
        strokeCache.set(stroke, sub);
      }
      return sub;
    };

    const clipText = this._quality?.clipText;
    const strokeScale = typeof clipText === 'number' ? clipText : 1;

    // --- Render-stage hooks (pre) ---
    // Effects that span the whole layout (vs. per-stroke) can hook the
    // render pipeline here. The stage context is only computed when at
    // least one resolved effect declares a hook, so the common case pays
    // nothing.
    const runHooks = hasRenderHooks(this._resolvedEffects);
    const stage: RenderStageContext | null = runHooks
      ? {
          ctx,
          layout,
          fontSize,
          lineHeight,
          unitsPerEm: font.unitsPerEm,
          ascender: font.ascender,
          descender: font.descender,
          bbox: computeLayoutBbox(layout, fontSize, lineHeight),
          baseColor: color,
          seed: this._seed,
        }
      : null;

    if (stage) {
      for (const effect of this._resolvedEffects) {
        getEffectDefinition(effect.effect)?.beforeRender?.(stage, effect.config);
      }
    }

    // Map grapheme index -> line index so timeline entries (which reference
    // graphemes) can be placed without re-walking the lines array per entry.
    const graphemeToLine = new Int32Array(characters.length).fill(-1);
    for (let li = 0; li < layout.lines.length; li++) {
      const lineIndices = layout.lines[li]!;
      for (const charIdx of lineIndices) graphemeToLine[charIdx] = li;
    }
    const fallbackClips = this._fallbackRunClips(layout, characters, graphemeToLine, fontSize);

    for (let ei = 0; ei < this._timeline.entries.length; ei++) {
      const entry = this._timeline.entries[ei]!;
      if (entry.char === '\n') continue;
      const charIdx = entry.graphemeIndex;
      const lineIdx = graphemeToLine[charIdx] ?? -1;
      if (lineIdx < 0) continue;
      const { x, y, glyphY } = entryOrigin(entry, layout, lineIdx, fontSize, lineHeight, halfLeading);
      const glyph = (entry.glyphId !== undefined ? font.glyphDataById?.[entry.glyphId] : undefined) ?? lookupGlyphData(font, entry.char);

      if (glyph && entry.hasGlyph) {
        let localTime = Math.max(0, Math.min(currentTime - entry.offset, entry.duration));
        const glyphEasing = this._timing?.glyphEasing;
        if (glyphEasing && entry.duration > 0) {
          localTime = glyphEasing(localTime / entry.duration) * entry.duration;
        }
        drawGlyph(
          ctx,
          glyph,
          {
            x,
            y: glyphY,
            fontSize,
            unitsPerEm: font.unitsPerEm,
            ascender: font.ascender,
            descender: font.descender,
          },
          localTime,
          font.lineCap,
          color,
          this._resolvedEffects,
          this._seed + charIdx,
          getSubdivided,
          this._timing?.strokeEasing,
          strokeScale,
          stage?.strokeStyle,
          entry.strokeDelays,
          entry.strokeTimeScale,
        );
      } else if (!entry.hasGlyph && currentTime >= entry.offset + entry.duration) {
        const baseline = y + halfLeading + (font.ascender / font.unitsPerEm) * fontSize;
        // A character in a run is drawn as the whole run, shaped together,
        // clipped to its own box — see `_fallbackRunClips`.
        const clip = fallbackClips.get(ei);
        if (clip === null) continue;
        if (clip) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(clip.left, -CLIP_REACH, clip.right - clip.left, 2 * CLIP_REACH);
          ctx.clip();
        }
        drawFallbackGlyph(
          ctx,
          clip?.text ?? entry.char,
          clip?.x ?? x,
          baseline,
          fontSize,
          cssFontFamily(font, this._fallbackFont),
          color,
          this._resolvedEffects,
          clip?.seed ?? this._seed + charIdx,
          clip?.direction ?? layout.direction ?? 'ltr',
        );
        if (clip) ctx.restore();
      }
    }

    // --- Render-stage hooks (post) ---
    // Reverse order so save/restore-style pairs nest correctly with their
    // `beforeRender` counterparts. Runs before the clipText mask so any
    // post-processing still gets constrained to the text shape.
    if (stage) {
      for (let i = this._resolvedEffects.length - 1; i >= 0; i--) {
        const effect = this._resolvedEffects[i]!;
        getEffectDefinition(effect.effect)?.afterRender?.(stage, effect.config);
      }
    }

    // --- Clip strokes to the filled text shape ---
    // All text characters are rendered onto a cached offscreen canvas so the
    // mask can be applied as a single destination-in drawImage call. Doing
    // fillText per-character with destination-in would erase previously-clipped
    // strokes.
    //
    // With the shaper's outlines, the mask is the glyphs the strokes draw,
    // filled where they draw them. Otherwise it's the text set in the font:
    // close, but the canvas can shape it otherwise — Chrome caches a shaped
    // `(` per canvas regardless of the script it was shaped in, so after
    // `(ا` a lone `(` next to Latin comes out as Amiri's wide Arabic paren.
    if (clipText) {
      if (!this._maskCanvas) this._maskCanvas = document.createElement('canvas');
      const maskCanvas = this._maskCanvas;
      if (maskCanvas.width !== canvas.width || maskCanvas.height !== canvas.height) {
        maskCanvas.width = canvas.width;
        maskCanvas.height = canvas.height;
      }
      const maskCtx = maskCanvas.getContext('2d')!;
      maskCtx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
      maskCtx.clearRect(0, 0, w, h);
      maskCtx.translate(padH, padV);
      const outlines = this._glyphOutlines(graphemeToLine);
      if (outlines) {
        const paths = this._outlinePaths(outlines);
        for (let i = 0; i < outlines.length; i++) {
          const g = outlines[i]!;
          maskCtx.save();
          maskCtx.translate(g.x, g.y);
          maskCtx.scale(g.scale, -g.scale);
          maskCtx.fill(paths[i]!);
          maskCtx.restore();
        }
      }
      maskCtx.font = `${fontSize}px ${cssFontFamily(font, this._fallbackFont)}`;
      maskCtx.textBaseline = 'alphabetic';
      // Draw each word where the DOM put it, as a single string so the
      // browser's shaper sees the whole word — per-character fillText would
      // drop ligatures, kerning, and script-specific contextual forms (Arabic
      // init/medi/fina, Indic conjuncts, etc.). Browsers shape each word on
      // its own anyway, so nothing crosses a word gap. Anchoring words rather
      // than lines keeps the mask aligned where the canvas shapes a word
      // differently from the DOM, and needs no bidi reordering across words:
      // the anchors carry the DOM's order (a word switching direction is
      // drawn as one piece per direction, each where bidi put it). Each
      // piece's `direction` is the one the shaper shaped it in, which places
      // neutral characters at its ends and mirrors brackets as the strokes
      // do; textAlign 'left' pins its left edge — 'start' would follow the
      // direction.
      maskCtx.textAlign = 'left';
      if ('letterSpacing' in maskCtx) maskCtx.letterSpacing = `${this._letterSpacing}px`;
      let clipY = 0;
      for (let li = 0; !outlines && li < layout.lines.length; li++) {
        const baseline = clipY + halfLeading + (font.ascender / font.unitsPerEm) * fontSize;
        for (const word of lineWords(layout, characters, li)) {
          maskCtx.direction = word.direction;
          maskCtx.fillText(word.text, word.leftEm * fontSize, baseline);
        }
        clipY += lineHeight;
      }

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(maskCanvas, 0, 0);
      ctx.restore();
    }
  }
}
