import type { StrokePaint } from '../lib/paintStroke.ts';
import type { Box, StrokePath } from '../lib/strokePath.ts';
import type { GlyphPlacement, PlacedStroke, StrokeGeometryContext, TegakiFrame } from '../lib/strokeTimeline.ts';
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
// Plugins
// ---------------------------------------------------------------------------

/** What every plugin hook that paints can use. */
interface TegakiPluginContext {
  /** Font size in px. */
  fontSize: number;
  /** The text's color (its CSS color). */
  color: string;
  /**
   * A random number generator (0–1) seeded by the renderer and key: the
   * same key yields the same numbers every frame, so painting doesn't flicker.
   * Key it by what should look the same across frames, e.g. a stroke's id.
   */
  random(key: string | number): () => number;
  /**
   * Which of the plugin's {@link TegakiPlugin.steps} drawings is showing,
   * from `0`; always `0` for a plugin without steps. A plugin whose steps
   * only paint — no `geometry` or `outline`, say a flicker — costs no more
   * than a redraw per step.
   */
  step: number;
}

/** What `underlay` and `overlay` paint with. */
export interface TegakiPaintContext extends TegakiPluginContext {
  /**
   * The canvas context, in CSS px with its origin at the top-left of the text
   * box — the space of every stroke's path and head. Its state is saved
   * before the call and restored after.
   */
  ctx: CanvasRenderingContext2D;
  /** The frame being drawn. */
  frame: TegakiFrame;
}

/** What a `geometry` hook knows about the stroke it reshapes. */
export interface TegakiGeometryContext extends StrokeGeometryContext {
  /** Font size in px. */
  fontSize: number;
  /** Which of the plugin's {@link TegakiPlugin.steps} drawings to make, from `0`; always `0` for a plugin without steps. */
  step: number;
  /** See {@link TegakiPluginContext.random}. */
  random(key: string | number): () => number;
}

/** A glyph outline an `outline` hook reshapes: where the glyph sits, as for its strokes. */
export interface TegakiOutlineContext {
  place: GlyphPlacement;
  /** The number fixed per glyph that its strokes get too. */
  seed: number;
  /** Font size in px. */
  fontSize: number;
  /** Which of the plugin's {@link TegakiPlugin.steps} drawings this is, as for its strokes' `geometry`. */
  step: number;
}

/**
 * A plugin's cycle of drawings: the ink redrawn `count` ways, one after
 * another, `fps` times a second, the way line boil makes hand-drawn
 * animation shimmer. See {@link TegakiPlugin.steps}.
 */
export interface TegakiPluginSteps {
  /** How many drawings the cycle has (at least 1). */
  count: number;
  /** Drawings a second (8–12 reads as hand-drawn). */
  fps: number;
  /**
   * Keep cycling once the text is written, or while it's paused, in
   * uncontrolled and CSS time — the engine redraws at `fps` for as long as
   * the renderer lives. Controlled time always takes the drawing from the
   * time it's given, so it holds still when the time does. Default `false`.
   */
  idle?: boolean;
}

/** A stroke a `paint` hook paints, and how the next hook will paint it. */
export interface TegakiStrokePaintContext extends StrokePaint, TegakiPluginContext {
  /** The box the text's lines fill, in the same px as the stroke's path. */
  textBox: Box;
  /** Timeline seconds of the frame being drawn — with the stroke's `start` and `duration`, how long ago the pen passed a point. */
  time: number;
  /** px per font unit. */
  scale: number;
}

/** What an `ink` hook post-processes. */
export interface TegakiInkContext extends TegakiPluginContext {
  /** The canvas context, in text-box px like the other hooks'. Draw with `setTransform(1, 0, 0, 1, 0, 0)` to work in device pixels. */
  ctx: CanvasRenderingContext2D;
  /** A copy of the finished ink (strokes and fallback text, clipped to the text if that's on), in device pixels, the size of the canvas. */
  ink: HTMLCanvasElement;
  /**
   * The box the ink drawn so far covers, in text-box px (`ctx.getTransform()`
   * maps it to device pixels); `null` before anything is drawn. Work inside
   * it: the rest of `ink` is empty, and a blur over the whole canvas costs
   * what the canvas measures, not what the ink does.
   */
  bounds: Box | null;
  /** px per font unit. */
  scale: number;
}

/** What a plugin sizes its {@link TegakiPlugin.bounds} from. */
export interface TegakiBoundsContext {
  /** Every placed stroke, drawn yet or not. */
  strokes: readonly PlacedStroke[];
  /** Font size in px. */
  fontSize: number;
  /** px per font unit. */
  scale: number;
}

/**
 * Paints alongside the handwriting, reshapes it, or reacts to it. Every hook
 * is optional. The built-in effects are plugins too, run before these, so a
 * plugin sees the ink they make. Painting is a function of the frame alone:
 * the renderer can draw any time, in any order (controlled time, scrubbing,
 * CSS time).
 */
export interface TegakiPlugin {
  /** Names the plugin in error messages. */
  name: string;
  /**
   * Reshape a stroke's ink: move its points, change its widths. Called once
   * per layout per stroke with the path the plugins before it made (the
   * first gets the stroke as the bundle has it), not per frame. Return a new
   * path; {@link StrokePath.map} keeps where the pen is exact. A dot is a
   * path of one point.
   */
  geometry?(path: StrokePath, ctx: TegakiGeometryContext): StrokePath;
  /**
   * Reshape a glyph outline contour (points in px) the way `geometry`
   * reshapes the glyph's strokes, for clip-to-text: a wobble moves the
   * letter's edges with its strokes. Called once per layout.
   */
  outline?(contour: readonly { x: number; y: number }[], ctx: TegakiOutlineContext): { x: number; y: number }[];
  /**
   * Paint a stroke, every frame it's drawn. `next` paints it the way the rest
   * of the chain does — the plugins after this one, then the default painter
   * ({@link paintStroke}). Change what it gets (`style`, the stroke's `path`),
   * call it more than once, draw around it, or don't call it at all.
   */
  paint?(stroke: TegakiStrokePaintContext, next: (stroke: TegakiStrokePaintContext) => void): void;
  /** Post-process the finished ink every frame, before `underlay` and `overlay`: a glow, a shadow, a filter. */
  ink?(ink: TegakiInkContext): void;
  /** Paint under the ink. Clip-to-text doesn't clip it. */
  underlay?(paint: TegakiPaintContext): void;
  /** Paint over the ink. Clip-to-text doesn't clip it. */
  overlay?(paint: TegakiPaintContext): void;
  /**
   * Called after every render with the frame drawn and the one drawn before
   * it (`null` the first time) — for side effects such as sound. A render can
   * repeat a time (a resize) or jump (a seek, a loop): compare the two frames.
   */
  onFrame?(frame: TegakiFrame, prev: TegakiFrame | null): void;
  /**
   * The box the plugin paints in over the whole animation, in the same
   * space as ctx — the canvas grows to hold it, as it holds the ink. Keep
   * it the same from frame to frame: the canvas is sized once, not per frame.
   */
  bounds?(ctx: TegakiBoundsContext): Box | null;
  /**
   * Redraw the ink as a cycle of drawings over time. `geometry` and
   * `outline` are called once per drawing per layout, told which one in
   * `ctx.step`; the engine keeps them all and shows one at a time — chosen
   * from the time in controlled mode (so a video renders the same every
   * time), from the clock otherwise. The canvas is sized to hold every
   * drawing. Reduced motion (see `reducedMotion`) holds the first. The
   * painting hooks are told the drawing too (`step`), so a plugin with no
   * `geometry` can use steps as a clock for painting alone (a flicker).
   */
  steps?: TegakiPluginSteps;
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
  /**
   * Plugins that reshape or paint the ink, paint under or over it, or react
   * to the frames drawn (see {@link TegakiPlugin}). Run in order, after the
   * built-in effects. Not part of `toSVG`.
   */
  plugins?: readonly TegakiPlugin[];
  /**
   * The number the renderer's random choices come from: the wobble's phase,
   * a gradient's hue, what plugins draw with `random(key)` or reshape by a
   * glyph's `seed`. The same seed draws the same every time — on every load,
   * in every tab or process rendering a video. Each character adds its index
   * to it, so repeated letters still differ. `'random'` picks one when the
   * engine is created, for text that looks a little different every time;
   * read it back from {@link TegakiEngine.seed} to keep a result you like.
   * Default: `0`.
   */
  seed?: number | 'random';
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
