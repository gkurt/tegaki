import {
  CSS_DURATION,
  CSS_PROGRESS,
  CSS_TIME,
  MIN_LINE_HEIGHT_EM,
  MIN_PADDING_V_EM,
  PADDING_H_EM,
  registerCssProperties,
} from '../lib/css-properties.ts';
import { drawFallbackGlyph } from '../lib/drawFallbackGlyph.ts';
import { drawGlyph } from '../lib/drawGlyph.ts';
import {
  findEffect,
  getEffectDefinition,
  hasRenderHooks,
  type RenderStageContext,
  type ResolvedEffect,
  resolveEffects,
} from '../lib/effects.ts';
import { ensureFont } from '../lib/font.ts';
import type { BundleShaper } from '../lib/shaper.ts';
import { type SubdividedStroke, subdivideStroke } from '../lib/strokeCache.ts';
import type { TextLayout } from '../lib/textLayout.ts';
import { applyShaperPositions, computeLayoutBbox, computeTextLayout } from '../lib/textLayout.ts';
import type { Timeline, TimelineConfig, TimelineEntry } from '../lib/timeline.ts';
import { computeTimeline } from '../lib/timeline.ts';
import { cssFontFamily, graphemes } from '../lib/utils.ts';
import type { TegakiBundle, TegakiGlyphData } from '../types.ts';
import { getBundle, registerBundle, resolveBundle } from './bundle-registry.ts';
import { buildChildren, buildRootProps, domCreateElement } from './render-elements.ts';
import { getShaperForBundle, registerShaper } from './shaper-registry.ts';
import type { CreateElementFn, TegakiEngineOptions, TegakiQuality, TimeControlMode, TimeControlProp } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveTimeControl(prop: TimeControlProp): TimeControlMode[keyof TimeControlMode] {
  if (prop == null) return { mode: 'uncontrolled' };
  if (typeof prop === 'number') return { mode: 'controlled', value: prop };
  if (prop === 'css') return { mode: 'css' };
  return prop;
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

  // --- DOM elements ---
  private _rootEl: HTMLElement;
  private _contentEl: HTMLElement | null = null; // non-null only in non-adopt mode
  private _sentinelEl: HTMLSpanElement;
  private _canvasEl: HTMLCanvasElement;
  private _overlayEl: HTMLElement;
  private _canvasFallbackEl: HTMLSpanElement;
  private _maskCanvas: HTMLCanvasElement | null = null;

  // --- Options ---
  private _text = '';
  private _font: TegakiBundle | null = null;
  private _timeControl: TimeControlMode[keyof TimeControlMode] = { mode: 'uncontrolled' };
  private _effects: Record<string, any> | undefined;
  private _timing: TimelineConfig | undefined;
  private _quality: TegakiQuality | undefined;
  private _showOverlay = false;
  private _onComplete: (() => void) | undefined;
  private _direction: 'ltr' | 'rtl' | undefined;

  // --- Derived / cached ---
  private _resolvedEffects: ResolvedEffect[] = resolveEffects(undefined);
  private _seed: number;
  private _timeline: Timeline = { entries: [] as TimelineEntry[], totalDuration: 0 };
  private _layout: TextLayout | null = null;
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

  seek(time: number): void {
    if (this._timeControl.mode !== 'uncontrolled') return;
    this._internalTime = Math.max(0, Math.min(time, this._timeline.totalDuration));
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
      const nextText = (options.text ?? '').replace(/\r\n?/g, '\n');
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

    if ('direction' in options && options.direction !== this._direction) {
      this._direction = options.direction;
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
  }

  private _updateDom(): void {
    // Font family
    this._rootEl.style.fontFamily = this._font ? cssFontFamily(this._font) : '';

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
    if (this._showOverlay) {
      this._overlayEl.style.webkitTextFillColor = '';
      this._overlayEl.style.color = 'rgba(255, 0, 0, 0.4)';
    } else {
      this._overlayEl.style.webkitTextFillColor = 'transparent';
      this._overlayEl.style.color = '';
    }
    // When the shaper is off, the renderer iterates raw graphemes and looks
    // each char up in the bundle's char-keyed `glyphData` — i.e. nominal
    // glyphs only. The overlay (which provides layout measurement and the
    // visible text outline) must match: disable every variant-producing
    // GSUB feature so the browser doesn't form ligatures, contextual
    // alternates, or Arabic positional forms the renderer can't draw.
    this._overlayEl.style.fontFeatureSettings = this._shaperEnabled
      ? ''
      : "'liga' 0, 'calt' 0, 'clig' 0, 'rlig' 0, 'dlig' 0, 'init' 0, 'medi' 0, 'fina' 0, 'isol' 0";
  }

  private _updateSentinelTransition(): void {
    const isCss = this._timeControl.mode === 'css';
    this._sentinelEl.style.transition = isCss
      ? `font-size 0.001s, line-height 0.001s, color 0.001s, ${CSS_PROGRESS} 0.001s`
      : 'font-size 0.001s, line-height 0.001s, color 0.001s';
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

    const pending = ensureFont(font.family, font.fontUrl, font.features, font.extraFontUrls);
    if (pending === null) {
      this._fontReady = true;
    } else {
      const currentFont = font;
      pending.then(() => {
        if (this._font === currentFont && !this._destroyed) {
          this._fontReady = true;
          this._recomputeTimeline();
          this._updateDom();
          this._recomputeLayout();
          this._evaluatePlayback();
          this._render();
        }
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

    this._shaperReady = false;
    const currentFont = this._font;
    shaperPromise.then((shaper) => {
      if (this._font === currentFont && this._shaperEnabled && !this._destroyed) {
        this._shaper = shaper;
        this._shaperReady = true;
        this._recomputeTimeline();
        this._recomputeLayout();
        this._evaluatePlayback();
        this._render();
      }
    });
  }

  // =========================================================================
  // Internal: Recomputation
  // =========================================================================

  private _recomputeTimeline(): void {
    if (this._font && this._text) {
      this._timeline = computeTimeline(this._text, this._font, this._timing, this._shaper);
    } else {
      this._timeline = { entries: [] as TimelineEntry[], totalDuration: 0 };
    }
  }

  private _recomputeLayout(): void {
    if (this._fontReady && this._font?.family && this._fontSize && this._containerWidth && this._text) {
      const shaperId = this._shaper ? '1' : '0';
      const key = `${this._text}\0${this._font.family}\0${this._fontSize}\0${this._lineHeight}\0${this._containerWidth}\0${this._direction ?? ''}\0${shaperId}`;
      if (key === this._layoutKey) return;
      this._layoutKey = key;
      let layout = computeTextLayout(this._overlayEl, this._fontSize);
      if (this._shaper && this._font) {
        // Replace DOM-measured per-grapheme offsets with shaper-accumulated
        // advances so stroke positions match the glyph ids the shaper chose.
        // The DOM is still the source of truth for line breaks.
        layout = applyShaperPositions(layout, this._overlayEl, this._text, this._fontSize, this._font, this._shaper);
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

    const padH = PADDING_H_EM * fontSize;
    const lineHeight = this._lineHeight;
    const padV = Math.max(MIN_PADDING_V_EM * fontSize, (MIN_LINE_HEIGHT_EM * fontSize - lineHeight) / 2);
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
    const effectsNeedSubdivision =
      !!findEffect(this._resolvedEffects, 'wobble') ||
      !!findEffect(this._resolvedEffects, 'strokeGradient') ||
      !!findEffect(this._resolvedEffects, 'taper') ||
      (() => {
        const p = findEffect(this._resolvedEffects, 'pressureWidth');
        return !!p && Math.max(0, Math.min(p.config.strength ?? 1, 1)) > 0;
      })();
    const smoothing = this._quality?.smoothing === true;
    const userSegmentSize = this._quality?.segmentSize;
    const resolvedSegmentSize = userSegmentSize ?? (effectsNeedSubdivision || smoothing ? 2 : undefined);
    const scale = fontSize / font.unitsPerEm;
    const maxSegLenFU = resolvedSegmentSize != null ? resolvedSegmentSize / scale : Infinity;
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

    for (let ei = 0; ei < this._timeline.entries.length; ei++) {
      const entry = this._timeline.entries[ei]!;
      if (entry.char === '\n') continue;
      const charIdx = entry.graphemeIndex;
      const lineIdx = graphemeToLine[charIdx] ?? -1;
      if (lineIdx < 0) continue;
      const y = lineIdx * lineHeight;
      const x = (layout.charOffsets[charIdx] ?? 0) * fontSize;
      const glyph = (entry.glyphId !== undefined ? font.glyphDataById?.[entry.glyphId] : undefined) ?? font.glyphData[entry.char];

      if (glyph && entry.hasGlyph) {
        let localTime = Math.max(0, Math.min(currentTime - entry.offset, entry.duration));
        const glyphEasing = this._timing?.glyphEasing;
        if (glyphEasing && entry.duration > 0) {
          localTime = glyphEasing(localTime / entry.duration) * entry.duration;
        }
        const glyphY = y + halfLeading;
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
        );
      } else if (!entry.hasGlyph && currentTime >= entry.offset + entry.duration) {
        const baseline = y + halfLeading + (font.ascender / font.unitsPerEm) * fontSize;
        drawFallbackGlyph(ctx, entry.char, x, baseline, fontSize, cssFontFamily(font), color, this._resolvedEffects, this._seed + charIdx);
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
      maskCtx.font = `${fontSize}px ${cssFontFamily(font)}`;
      maskCtx.textBaseline = 'alphabetic';
      // Fill each line as a single string so the browser's shaper sees the
      // full run — per-character fillText would drop ligatures, kerning, and
      // script-specific contextual forms (Arabic init/medi/fina, Indic
      // conjuncts, etc.), producing a mask that doesn't match the shaped
      // stroke positions.
      let clipY = 0;
      for (const lineIndices of layout.lines) {
        let lineText = '';
        for (const charIdx of lineIndices) {
          const char = characters[charIdx]!;
          if (char === '\n') continue;
          lineText += char;
        }
        if (lineText) {
          const baseline = clipY + halfLeading + (font.ascender / font.unitsPerEm) * fontSize;
          maskCtx.fillText(lineText, 0, baseline);
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
