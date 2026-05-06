import { TegakiEngine } from '../core/engine.ts';
import type { TegakiEngineOptions, TimeControlProp } from '../core/types.ts';
import type { TegakiBundle } from '../types.ts';

/**
 * Observed attribute names.
 * - `text`: the text to render (also settable via textContent)
 * - `font`: registered bundle name (see {@link TegakiEngine.registerBundle})
 * - `time`: time control — a number for controlled mode, `"css"` for CSS mode, omit for uncontrolled
 * - `speed`: playback speed multiplier (uncontrolled mode, default `1`). Mutually exclusive with `duration`.
 * - `duration`: stretch/compress one iteration to this many seconds (uncontrolled mode). Mutually exclusive with `speed`; takes precedence when both are present.
 * - `playing`: whether animation is playing (uncontrolled mode, default `true`)
 * - `loop`: loop animation (uncontrolled mode, default `false`)
 * - `delay`: delay before animation starts (seconds, uncontrolled mode, default `0`)
 * - `loop-gap`: pause between loop iterations (seconds, uncontrolled mode, default `0`)
 * - `pixel-ratio`: supersampling factor on top of devicePixelRatio (quality knob, default `1`)
 * - `segment-size`: segment size for rendering (quality knob)
 * - `smoothing`: smooth strokes with a centripetal Catmull-Rom spline (quality knob)
 * - `show-overlay`: show debug overlay
 * - `direction`: text direction (`"ltr"` or `"rtl"`)
 * - `no-shaper`: disable text shaping for this instance (use the char-keyed grapheme path)
 *
 * The `easing` option is not exposed as an attribute (it takes a function);
 * set it via the `time` JS property for full uncontrolled-mode configuration.
 */
const OBSERVED_ATTRS = [
  'text',
  'font',
  'time',
  'speed',
  'duration',
  'playing',
  'loop',
  'delay',
  'loop-gap',
  'pixel-ratio',
  'segment-size',
  'smoothing',
  'show-overlay',
  'direction',
  'no-shaper',
] as const;

export class TegakiElement extends HTMLElement {
  static observedAttributes = [...OBSERVED_ATTRS];

  private _engine: TegakiEngine | null = null;
  private _container: HTMLDivElement;
  private _font: TegakiBundle | string | undefined;
  private _effects: TegakiEngineOptions['effects'];
  private _timing: TegakiEngineOptions['timing'];
  private _quality: TegakiEngineOptions['quality'];
  private _onComplete: (() => void) | undefined;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });

    // Host styles: the element itself is just an inline-block wrapper
    const style = document.createElement('style');
    style.textContent = `:host { display: inline-block; }`;
    shadow.appendChild(style);

    this._container = document.createElement('div');
    shadow.appendChild(this._container);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  connectedCallback(): void {
    this._engine = new TegakiEngine(this._container, this._buildOptions());
  }

  disconnectedCallback(): void {
    this._engine?.destroy();
    this._engine = null;
  }

  attributeChangedCallback(_name: string, _oldValue: string | null, _newValue: string | null): void {
    this._engine?.update(this._buildOptions());
  }

  // ---------------------------------------------------------------------------
  // Property API (for JS usage)
  // ---------------------------------------------------------------------------

  /** The underlying engine instance. */
  get engine(): TegakiEngine | null {
    return this._engine;
  }

  /** Set the font bundle directly (alternative to the `font` attribute for registered names). */
  get font(): TegakiBundle | string | undefined {
    return this._font;
  }

  set font(value: TegakiBundle | string | undefined) {
    this._font = value;
    this._engine?.update(this._buildOptions());
  }

  /** Visual effects configuration. */
  get effects(): TegakiEngineOptions['effects'] {
    return this._effects;
  }

  set effects(value: TegakiEngineOptions['effects']) {
    this._effects = value;
    this._engine?.update(this._buildOptions());
  }

  /** Timeline timing configuration. */
  get timing(): TegakiEngineOptions['timing'] {
    return this._timing;
  }

  set timing(value: TegakiEngineOptions['timing']) {
    this._timing = value;
    this._engine?.update(this._buildOptions());
  }

  /** Render-quality configuration (supersampling, segment subdivision). */
  get quality(): TegakiEngineOptions['quality'] {
    return this._quality;
  }

  set quality(value: TegakiEngineOptions['quality']) {
    this._quality = value;
    this._engine?.update(this._buildOptions());
  }

  /** Callback when animation completes. */
  get onComplete(): (() => void) | undefined {
    return this._onComplete;
  }

  set onComplete(value: (() => void) | undefined) {
    this._onComplete = value;
    this._engine?.update(this._buildOptions());
  }

  // Playback controls (delegate to engine)

  play(): void {
    this._engine?.play();
  }

  pause(): void {
    this._engine?.pause();
  }

  seek(time: number): void {
    this._engine?.seek(time);
  }

  restart(): void {
    this._engine?.restart();
  }

  get currentTime(): number {
    return this._engine?.currentTime ?? 0;
  }

  get duration(): number {
    return this._engine?.duration ?? 0;
  }

  get isPlaying(): boolean {
    return this._engine?.isPlaying ?? false;
  }

  get isComplete(): boolean {
    return this._engine?.isComplete ?? false;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private _buildOptions(): TegakiEngineOptions {
    const text = this.getAttribute('text') ?? this.textContent ?? '';
    const fontAttr = this.getAttribute('font');
    const font = this._font ?? (fontAttr || undefined);
    const time = this._resolveTime();

    const directionAttr = this.getAttribute('direction');
    return {
      text,
      font,
      time,
      effects: this._effects,
      timing: this._timing,
      quality: this._resolveQuality(),
      showOverlay: this.hasAttribute('show-overlay'),
      direction: directionAttr === 'rtl' || directionAttr === 'ltr' ? directionAttr : undefined,
      shaper: this.hasAttribute('no-shaper') ? false : undefined,
      onComplete: this._onComplete,
    };
  }

  /**
   * Merge the `quality` JS property with `pixel-ratio` / `segment-size` /
   * `smoothing` attribute shortcuts. Attributes override properties on a
   * per-field basis.
   */
  private _resolveQuality(): TegakiEngineOptions['quality'] {
    const pixelRatioAttr = this._getNumberAttr('pixel-ratio');
    const segmentSizeAttr = this._getNumberAttr('segment-size');
    const smoothingAttr = this.hasAttribute('smoothing');
    if (pixelRatioAttr == null && segmentSizeAttr == null && !smoothingAttr) return this._quality;
    return {
      ...this._quality,
      ...(pixelRatioAttr != null ? { pixelRatio: pixelRatioAttr } : {}),
      ...(segmentSizeAttr != null ? { segmentSize: segmentSizeAttr } : {}),
      ...(smoothingAttr ? { smoothing: true } : {}),
    };
  }

  private _resolveTime(): TimeControlProp {
    const timeAttr = this.getAttribute('time');

    if (timeAttr === 'css') return 'css';
    if (timeAttr != null) {
      const num = Number(timeAttr);
      if (!Number.isNaN(num)) return num;
    }

    // Check for uncontrolled mode attributes
    const hasSpeed = this.hasAttribute('speed');
    const hasDuration = this.hasAttribute('duration');
    const hasPlaying = this.hasAttribute('playing');
    const hasLoop = this.hasAttribute('loop');
    const hasDelay = this.hasAttribute('delay');
    const hasLoopGap = this.hasAttribute('loop-gap');

    if (hasSpeed || hasDuration || hasPlaying || hasLoop || hasDelay || hasLoopGap) {
      const shared = {
        mode: 'uncontrolled' as const,
        playing: this.getAttribute('playing') !== 'false',
        loop: this.hasAttribute('loop'),
        delay: this._getNumberAttr('delay'),
        loopGap: this._getNumberAttr('loop-gap'),
      };
      // Duration takes precedence over speed when both are present.
      if (hasDuration) {
        return { ...shared, duration: this._getNumberAttr('duration') };
      }
      return { ...shared, speed: this._getNumberAttr('speed') ?? 1 };
    }

    return undefined;
  }

  private _getNumberAttr(name: string): number | undefined {
    const value = this.getAttribute(name);
    if (value == null) return undefined;
    const num = Number(value);
    return Number.isNaN(num) ? undefined : num;
  }
}

/**
 * Register the `<tegaki-renderer>` custom element.
 * Call this once before using the element in HTML.
 *
 * @param tagName - Custom element tag name. Default: `'tegaki-renderer'`.
 *   Note: custom element names must contain a hyphen per the HTML spec.
 */
export function registerTegakiElement(tagName = 'tegaki-renderer'): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, TegakiElement);
  }
}
