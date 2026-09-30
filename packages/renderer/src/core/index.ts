export { paragraphDirection } from '../lib/bidi.ts';
export { LETTER_SPACED_OFF_FEATURES, toCssFeatureSettings, UNSHAPED_OFF_FEATURES } from '../lib/features.ts';
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
  type PointData,
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
  type StrokeTime,
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
export {
  type AnnotateMark,
  type AnnotateOptions,
  type AnnotateWhen,
  type Annotation,
  type AnnotationStroke,
  annotatePlugin,
  annotations,
} from '../plugins/annotate.ts';
export { boilPlugin } from '../plugins/boil.ts';
export { type CaptionCue, type CaptionFit, type CaptionOptions, captionPlugin, parseCues } from '../plugins/caption.ts';
export { glowPlugin } from '../plugins/glow.ts';
export {
  globalGradientPlugin,
  type StrokeGradientOptions,
  strokeGradientAt,
  strokeGradientPlugin,
} from '../plugins/gradient.ts';
export { type GroupableStroke, groupStrokes, type StrokeGroup, type StrokeGroupBy } from '../plugins/groups.ts';
export { type TaperOptions, taperAt, taperPlugin } from '../plugins/taper.ts';
export { type CurvePoint, type TextPathGlyphs, type TextPathOptions, type TextPathShape, textPathPlugin } from '../plugins/textPath.ts';
export { variationPlugin } from '../plugins/variation.ts';
export { type WobbleOptions, wobbleField, wobblePlugin } from '../plugins/wobble.ts';
export type * from '../types.ts';
export { BUNDLE_VERSION, COMPATIBLE_BUNDLE_VERSIONS } from '../types.ts';
export { getBundle, registerBundle, resolveBundle } from './bundle-registry.ts';
export { createBundle } from './createBundle.ts';
export {
  createPlugin,
  lengthToPx,
  parseLength,
  type TegakiBooleanParam,
  type TegakiColorParam,
  type TegakiColorsParam,
  type TegakiLength,
  type TegakiLengthParam,
  type TegakiLengthUnit,
  type TegakiNumberParam,
  type TegakiPluginDefinition,
  type TegakiPluginFactory,
  type TegakiPluginOptions,
  type TegakiPluginParam,
  type TegakiPluginParams,
  type TegakiSelectParam,
  type TegakiTextParam,
} from './createPlugin.ts';
export { type DrawGlyphOptions, drawGlyph, type GlyphPosition } from './drawGlyph.ts';
export { TegakiEngine } from './engine.ts';
export { getPlugin, isDeclarative, parsePluginSpecs, registerPlugin } from './plugin-registry.ts';
export { paintsDrawnOnly } from './plugins.ts';
export { buildChildren, buildRootProps, domCreateElement } from './render-elements.ts';
export type { ShaperFactory } from './shaper-registry.ts';
export type {
  CreateElementFn,
  ReducedMotionProp,
  TegakiAttachContext,
  TegakiBoundsContext,
  TegakiEngineOptions,
  TegakiGeometryContext,
  TegakiInkContext,
  TegakiOutlineContext,
  TegakiPaintContext,
  TegakiPlugin,
  TegakiPluginSpec,
  TegakiPluginSteps,
  TegakiQuality,
  TegakiStrokePaintContext,
  TegakiSvgContext,
  TegakiSvgOptions,
  TegakiTimingContext,
  TimeControlMode,
  TimeControlProp,
} from './types.ts';
