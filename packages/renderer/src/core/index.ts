export { drawGlyph } from '../lib/drawGlyph.ts';
export {
  type EffectDefinition,
  findEffect,
  findEffects,
  getEffectDefinition,
  hasRenderHooks,
  type RenderStageContext,
  type ResolvedEffect,
  resolveEffects,
} from '../lib/effects.ts';
export { ensureFontFace } from '../lib/font.ts';
export type { BundleShaper, ShapedGlyph } from '../lib/shaper.ts';
export { computeLayoutBbox, computeTextLayout, type LayoutBBox, type TextLayout } from '../lib/textLayout.ts';
export {
  computeTimeline,
  type Timeline,
  type TimelineConfig,
  type TimelineEntry,
  type TimelineStaggerConfig,
} from '../lib/timeline.ts';
export type * from '../types.ts';
export type { TegakiEffectConfigs, TegakiEffects } from '../types.ts';
export { BUNDLE_VERSION, COMPATIBLE_BUNDLE_VERSIONS } from '../types.ts';
export {
  getAudio,
  listAudio,
  registerAudio,
  type StrokeAudioInfo,
  type TegakiAudioContext,
  type TegakiAudioDriver,
  type TegakiAudioInstance,
  type TegakiSoundProp,
  unregisterAudio,
} from './audio-registry.ts';
export { getBundle, registerBundle, resolveBundle } from './bundle-registry.ts';
export { createBundle } from './createBundle.ts';
export { TegakiEngine } from './engine.ts';
export { buildChildren, buildRootProps, domCreateElement } from './render-elements.ts';
export type { ShaperFactory } from './shaper-registry.ts';
export type { CreateElementFn, TegakiEngineOptions, TegakiQuality, TimeControlMode, TimeControlProp } from './types.ts';
