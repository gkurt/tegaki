export { paragraphDirection } from '../lib/bidi.ts';
export { findEffect, findEffects, type ResolvedEffect, resolveEffects } from '../lib/effects.ts';
export { ensureFontFace } from '../lib/font.ts';
export { type InkStyle, paintStroke, type StrokePaint } from '../lib/paintStroke.ts';
export { seededRandom } from '../lib/random.ts';
export type { BundleShaper, ShapedGlyph, ShapeOptions } from '../lib/shaper.ts';
export {
  type Box,
  clearance,
  expandBox,
  inkEdge,
  type OffsetDistance,
  offsetPath,
  type PathPoint,
  type PathSample,
  StrokePath,
  unionBoxes,
} from '../lib/strokePath.ts';
export {
  type ActiveStroke,
  type GlyphPlacement,
  type GlyphSlot,
  glyphLocalTime,
  type PlaceContext,
  type PlacedStroke,
  placeStrokes,
  rawStrokePath,
  type StrokeFrame,
  type StrokeGeometryContext,
  type StrokeHead,
  type StrokeInstance,
  type StrokeNib,
  type StrokeProgress,
  type StrokeState,
  type StrokeTiming,
  sampleFrame,
  sampleStroke,
  strokeInkBounds,
  strokeInstances,
  strokeProgressAt,
  strokeWindow,
  type TegakiFrame,
} from '../lib/strokeTimeline.ts';
export { computeLayoutBbox, computeTextLayout, type LayoutBBox, type TextLayout } from '../lib/textLayout.ts';
export { type TextToSvgMode, type TextToSvgOptions, textToSvg } from '../lib/textToSvg.ts';
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
export { getBundle, registerBundle, resolveBundle } from './bundle-registry.ts';
export { createBundle } from './createBundle.ts';
export { drawGlyph } from './drawGlyph.ts';
export { effectPlugins } from './effectPlugins.ts';
export { TegakiEngine } from './engine.ts';
export { buildChildren, buildRootProps, domCreateElement } from './render-elements.ts';
export type { ShaperFactory } from './shaper-registry.ts';
export type {
  CreateElementFn,
  ReducedMotionProp,
  TegakiBoundsContext,
  TegakiEngineOptions,
  TegakiGeometryContext,
  TegakiInkContext,
  TegakiOutlineContext,
  TegakiPaintContext,
  TegakiPlugin,
  TegakiQuality,
  TegakiStrokePaintContext,
  TegakiSvgOptions,
  TimeControlMode,
  TimeControlProp,
} from './types.ts';
