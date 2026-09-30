import {
  globalGradientPlugin,
  glowPlugin,
  strokeGradientPlugin,
  type TegakiPlugin,
  type TegakiPluginFactory,
  type TimelineConfig,
  type TimelineStaggerConfig,
  taperPlugin,
  wobblePlugin,
} from 'tegaki';
import type { CustomEffect, EffectsState, UrlState } from '../url-state.ts';
import { getEasingFn } from './constants.ts';

/**
 * Convert the string-form previewer inputs into a `TimelineStaggerConfig`.
 * `advance` accepts seconds (`"0.3"`) or percentages (`"20%"`); `duration`
 * accepts `"auto"` or seconds (`"0.5"`). Invalid advance falls back to 0s.
 */
export function parseStaggerInputs(advance: string, duration: string): TimelineStaggerConfig {
  const trimmed = advance.trim();
  let advanceVal: TimelineStaggerConfig['advance'];
  if (trimmed.endsWith('%')) {
    advanceVal = trimmed as `${number}%`;
  } else {
    const n = Number(trimmed);
    advanceVal = Number.isFinite(n) ? n : 0;
  }
  const durationTrimmed = duration.trim();
  const durationVal: TimelineStaggerConfig['duration'] =
    durationTrimmed === 'auto' || durationTrimmed === '' ? 'auto' : Number(durationTrimmed);
  return { advance: advanceVal, duration: durationVal };
}

/** Scale (w, h) to fit within maxSize while preserving aspect ratio */
export function fitSize(w: number, h: number, maxSize: number): { width: number; height: number } {
  const scale = Math.min(maxSize / w, maxSize / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** The Style tab's ink, as the renderer draws it: its `pressure`, and the plugins that draw the rest. */
export interface InkStyle {
  pressure: number;
  plugins: readonly TegakiPlugin[];
}

/** Each plugin the Style tab's settings turn on, with the options it's given, in the order they run. */
function inkStylePlugins(fx: EffectsState, customEffects: readonly CustomEffect[]): [TegakiPluginFactory, Record<string, unknown>][] {
  const out: [TegakiPluginFactory, Record<string, unknown>][] = [];
  if (fx.taper.enabled) out.push([taperPlugin, { startLength: fx.taper.startLength, endLength: fx.taper.endLength }]);
  if (fx.wobble.enabled) out.push([wobblePlugin, { amplitude: fx.wobble.amplitude, frequency: fx.wobble.frequency, mode: fx.wobble.mode }]);
  if (fx.globalGradient.enabled) out.push([globalGradientPlugin, { colors: fx.globalGradient.colors, angle: fx.globalGradient.angle }]);
  // After the text gradient, so a stroke gradient wins over it.
  if (fx.strokeGradient.enabled) {
    const { colors, saturation, lightness } = fx.strokeGradient;
    out.push([strokeGradientPlugin, colors === 'rainbow' ? { saturation, lightness } : { colors }]);
  }
  if (fx.glow.enabled) out.push([glowPlugin, glowOptions(fx.glow)]);
  for (const custom of customEffects) if (custom.enabled) out.push([glowPlugin, glowOptions(custom.config)]);
  return out;
}

/** A Style tab glow as the plugin's options: its sliders are px, so its lengths say so (the plugin's bare numbers are em). */
function glowOptions({ radius, color, offsetX, offsetY }: Record<string, unknown>): Record<string, unknown> {
  const px = (v: unknown, fallback: number) => `${Number.isFinite(Number(v)) ? Number(v) : fallback}px`;
  return { radius: px(radius, 8), color, offsetX: px(offsetX, 0), offsetY: px(offsetY, 0) };
}

/** The renderer's `pressure` and plugins for the Style tab's settings (the URL's `fx` and `cx`). */
export function buildInkStyle(fx: EffectsState, customEffects: readonly CustomEffect[]): InkStyle {
  return {
    pressure: fx.pressureWidth.enabled ? fx.pressureWidth.strength : 0,
    plugins: inkStylePlugins(fx, customEffects).map(([factory, options]) => factory(factory.resolve(options))),
  };
}

/**
 * The Style tab's settings as renderer props, plugins by name (`['glow', { radius: 0.15 }]`) with just
 * the options that differ from their defaults — what Copy puts on the clipboard.
 */
export function inkStyleProps(
  fx: EffectsState,
  customEffects: readonly CustomEffect[],
): { pressure?: number; plugins?: (string | [string, Record<string, unknown>])[] } {
  const pressure = fx.pressureWidth.enabled ? fx.pressureWidth.strength : 0;
  const plugins = inkStylePlugins(fx, customEffects).map(([factory, options]): string | [string, Record<string, unknown>] => {
    const changed = factory.changed(options);
    return Object.keys(changed).length > 0 ? [factory.name, changed] : factory.name;
  });
  return { ...(pressure !== 1 ? { pressure } : {}), ...(plugins.length > 0 ? { plugins } : {}) };
}

/** Compose the renderer's `timing` prop from the URL-serialized easing / dots / stagger settings (undefined when all default). */
export function buildTimingConfig(
  s: Pick<UrlState, 'strokeEasing' | 'glyphEasing' | 'deferDots' | 'staggerEnabled' | 'staggerAdvance' | 'staggerDuration'>,
): TimelineConfig | undefined {
  const strokeFn = getEasingFn(s.strokeEasing);
  const glyphFn = getEasingFn(s.glyphEasing);
  const staggerConfig = s.staggerEnabled ? parseStaggerInputs(s.staggerAdvance, s.staggerDuration) : undefined;
  if (strokeFn === undefined && glyphFn === undefined && s.deferDots && !staggerConfig) return undefined;
  return {
    ...(strokeFn !== undefined ? { strokeEasing: strokeFn } : {}),
    ...(glyphFn !== undefined ? { glyphEasing: glyphFn } : {}),
    ...(s.deferDots ? {} : { deferDots: false }),
    ...(staggerConfig ? { stagger: staggerConfig } : {}),
  };
}
