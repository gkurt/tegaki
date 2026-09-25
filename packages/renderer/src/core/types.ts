import type { Timeline, TimelineConfig } from '../lib/timeline.ts';
import type { TegakiBundle, TegakiEffects } from '../types.ts';

// ---------------------------------------------------------------------------
// Time control types (shared with adapters)
// ---------------------------------------------------------------------------

/** Fields shared by both speed- and duration-paced uncontrolled modes. */
interface UncontrolledShared {
  mode: 'uncontrolled';
  /** Initial time in seconds. Default: `0` */
  initialTime?: number;
  /** Whether animation is playing. Default: `true` */
  playing?: boolean;
  /** Loop animation when it reaches the end. Default: `false` */
  loop?: boolean;
  /**
   * Delay before the animation starts (seconds). Applied once on
   * initialization and again on {@link TegakiEngine.restart}. Default: `0`
   */
  delay?: number;
  /**
   * Pause between loop iterations (seconds). Only effective when
   * `loop` is `true`. Default: `0`
   */
  loopGap?: number;
  /**
   * Easing function mapping linear progress `(0–1)` to displayed progress `(0–1)`.
   * Applied at read-time so `currentTime`, `onTimeChange`, and the CSS custom
   * properties all reflect the eased value. Completion is evaluated against
   * linear progress so curves that overshoot or undershoot the endpoints do
   * not trip completion early or late.
   */
  easing?: (t: number) => number;
  /** Called on every frame with the current (eased) time. */
  onTimeChange?: (time: number) => void;
}

export type TimeControlMode = {
  controlled: {
    mode: 'controlled';
    /** Current time in seconds (default), or progress 0–1 when `unit` is `'progress'`. */
    value: number;
    /** Interpret `value` as seconds (default) or as a 0–1 progress ratio. */
    unit?: 'seconds' | 'progress';
  };
  uncontrolled:
    | (UncontrolledShared & {
        /** Playback speed multiplier. Default: `1` */
        speed?: number;
        /**
         * Catch-up strength. When positive, playback speeds up when there is a
         * large amount of remaining animation and decays back to normal gradually.
         * `0` disables catch-up (default). Higher values ramp up more aggressively.
         * Typical range: `0.2` – `2`.
         */
        catchUp?: number;
        duration?: never;
      })
    | (UncontrolledShared & {
        /**
         * Stretch or compress playback so one iteration takes exactly this many
         * seconds. Mutually exclusive with `speed` / `catchUp`.
         */
        duration?: number;
        speed?: never;
        catchUp?: never;
      });
  css: {
    mode: 'css';
  };
};

/**
 * A plain number is shorthand for `{ mode: 'controlled', value: number }`.
 * A percentage string like `'50%'` is shorthand for
 * `{ mode: 'controlled', value: 0.5, unit: 'progress' }`.
 * `'css'` is shorthand for `{ mode: 'css' }`.
 * Omit for uncontrolled mode with default settings.
 */
export type TimeControlProp = null | undefined | number | `${number}%` | 'css' | TimeControlMode[keyof TimeControlMode];

/**
 * How uncontrolled playback treats reduced motion. Under reduced motion the
 * text is drawn finished instead of written out (`onComplete` still fires).
 *
 * - `'never'` (default) — always animate. Ink appearing in place is not the
 *   kind of motion (parallax, zooming, sliding) the OS setting guards against.
 * - `'user'` — follow the user's `prefers-reduced-motion` setting.
 * - `'always'` — never animate.
 *
 * Controlled and `css` time are driven by the host, so they are unaffected.
 */
export type ReducedMotionProp = 'user' | 'always' | 'never';

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

/**
 * Render-quality knobs. These trade CPU/GPU cost for visual fidelity.
 * They do not change the style of the rendered text — see `effects` for that.
 */
export interface TegakiQuality {
  /**
   * Internal supersampling factor applied on top of `window.devicePixelRatio`.
   * Values > 1 draw into a larger backing canvas and let the browser downsample
   * to the displayed size, producing higher-quality antialiasing at a quadratic
   * cost in pixels filled. Values < 1 save cost at the expense of sharpness.
   * Default: `1`.
   */
  pixelRatio?: number;
  /**
   * Maximum drawn segment length in CSS pixels when stroke-varying effects
   * (`pressureWidth`, `taper`, `wobble`, `strokeGradient`) are active. Smaller values
   * produce smoother transitions at the cost of more draw calls per stroke.
   * Because this is measured in pixels, subdivision count scales with rendered
   * size: a glyph drawn at 10px is cheaper to render than the same glyph at
   * 100px. Defaults to `2` when such effects are on, otherwise segments are not
   * subdivided.
   */
  segmentSize?: number;
  /**
   * Clip handwriting strokes to the filled text shape using canvas composite
   * operations (`destination-in`). Strokes that extend beyond the glyph
   * outlines are masked away, producing a "drawn inside the text" effect.
   *
   * - `false` (default) — no clipping.
   * - `true` — clip with no stroke width change.
   * - A number > 0 — clip and scale stroke widths by that factor. Values
   *   around `2`–`3` make the strokes fill more of the glyph interior,
   *   producing a result closer to the original filled text.
   */
  clipText?: boolean | number;
  /**
   * Smooth stroke polylines with a centripetal Catmull-Rom spline through the
   * original glyph points. Hides the faceted corners visible at large render
   * sizes where the baked polyline resolution shows through.
   *
   * Requires subdivision to be active — when enabled without a `segmentSize`,
   * `segmentSize` defaults to `2` CSS px. Default: `false` (unchanged behavior).
   */
  smoothing?: boolean;
}

// ---------------------------------------------------------------------------
// Engine options
// ---------------------------------------------------------------------------

export interface TegakiEngineOptions {
  text?: string;
  /** A font bundle, or a registered bundle name (see {@link TegakiEngine.registerBundle}). */
  font?: TegakiBundle | string;
  time?: TimeControlProp;
  /** Whether uncontrolled playback honours reduced motion. Default: `'never'`. See {@link ReducedMotionProp}. */
  reducedMotion?: ReducedMotionProp;
  effects?: TegakiEffects<Record<string, any>>;
  timing?: TimelineConfig;
  /** Render-quality knobs (supersampling, segment subdivision). */
  quality?: TegakiQuality;
  showOverlay?: boolean;
  onComplete?: () => void;
  /**
   * Fires after the engine recomputes its timeline — on initial load, font
   * swaps, text changes, and again once async shaper resolution finishes.
   * The argument is the same `Timeline` exposed via `engine.timeline`. Use
   * this instead of calling `computeTimeline` from the host: a manual call
   * without the engine's resolved shaper returns the pre-shaping
   * totalDuration.
   */
  onChangeTimeline?: (timeline: Timeline) => void;
  /** Text direction. When set, applies the CSS `direction` property to the container. */
  direction?: 'ltr' | 'rtl';
  /**
   * CSS font-family list for characters the bundle has no glyph for, placed
   * after the bundle's own families (e.g. `'"Noto Serif SC", serif'`). Such
   * characters appear without a handwriting animation, in the first font of
   * the stack that covers them. Bundles that ship their full font try it
   * first; the rest (CJK bundles ship only the generated subset) fall straight
   * through to this list, or to the browser's default font without it.
   */
  fallbackFont?: string;
  /**
   * Whether this engine instance uses the globally-registered shaper. When
   * `false`, the engine ignores the shaper factory and renders via the
   * char-keyed grapheme path — useful for opting one renderer out of shaping
   * (e.g. side-by-side comparisons, lightweight previews) without unregistering
   * the shaper for the whole process. Default: `true`.
   */
  shaper?: boolean;
}

// ---------------------------------------------------------------------------
// Render elements
// ---------------------------------------------------------------------------

export type CreateElementFn<T> = (tag: string, props: Record<string, any>, ...children: (T | string)[]) => T;

/** Options for `TegakiEngine.toSVG` / `exportSVG`. */
export interface TegakiSvgOptions {
  /** Self-drawing (default) or the finished artwork. */
  animated?: boolean;
  /** Loop forever with CSS keyframes: draw, hold, fade, repeat. Implies `animated`. */
  loop?: boolean;
  /** Playback speed multiplier. Default: the engine's uncontrolled `speed`, else `1`. */
  speed?: number;
  /** Loop mode: seconds the finished text holds before it fades out. Default `1.5`. */
  loopHold?: number;
  /** Crop the viewBox to the ink (plus a small margin) instead of the full canvas box. Default `true`. */
  crop?: boolean;
  /** `@font-face` rules to embed for the SVG's text (clip-to-text, fallback characters). `exportSVG` fills these in. */
  fontFaces?: { family: string; src: string }[];
}
