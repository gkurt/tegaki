import type { TegakiEffects, TimelineStaggerConfig } from 'tegaki';
import type { CustomEffect, EffectsState } from '../url-state.ts';

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

/** Compose the sparse effects object expected by TegakiRenderer from the URL-serialized state. */
export function buildEffects(effectsState: EffectsState, customEffects: CustomEffect[]): TegakiEffects<Record<string, any>> | undefined {
  const result: Record<string, any> = {};
  if (effectsState.glow.enabled) {
    const g: Record<string, any> = { radius: effectsState.glow.radius, color: effectsState.glow.color };
    if (effectsState.glow.offsetX) g.offsetX = effectsState.glow.offsetX;
    if (effectsState.glow.offsetY) g.offsetY = effectsState.glow.offsetY;
    result.glow = g;
  }
  if (effectsState.wobble.enabled) {
    result.wobble = {
      amplitude: effectsState.wobble.amplitude,
      frequency: effectsState.wobble.frequency,
      mode: effectsState.wobble.mode,
    };
  }
  if (effectsState.pressureWidth.enabled) result.pressureWidth = { strength: effectsState.pressureWidth.strength };
  if (effectsState.taper.enabled) result.taper = { startLength: effectsState.taper.startLength, endLength: effectsState.taper.endLength };
  if (effectsState.strokeGradient.enabled) {
    const g: Record<string, any> = { colors: effectsState.strokeGradient.colors };
    if (effectsState.strokeGradient.colors === 'rainbow') {
      g.saturation = effectsState.strokeGradient.saturation;
      g.lightness = effectsState.strokeGradient.lightness;
    }
    result.strokeGradient = g;
  }
  if (effectsState.globalGradient.enabled) {
    result.globalGradient = {
      colors: effectsState.globalGradient.colors,
      angle: effectsState.globalGradient.angle,
    };
  }
  for (const custom of customEffects) {
    if (custom.enabled) result[custom.key] = { effect: custom.effect, ...custom.config };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
