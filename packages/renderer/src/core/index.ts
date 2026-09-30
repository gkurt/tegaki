// The renderer's public API, covered by semver. What the website and generator
// need besides lives in `tegaki/internal` (src/internal/index.ts), which isn't.
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
export type {
  ActiveStroke,
  GlyphPlacement,
  PlacedStroke,
  StrokeFrame,
  StrokeGeometryContext,
  StrokeHead,
  StrokeInstance,
  StrokeNib,
  StrokeProgress,
  StrokeState,
  StrokeTime,
  TegakiFrame,
} from '../lib/strokeTimeline.ts';
export { type TextToSvgMode, type TextToSvgOptions, textToSvg } from '../lib/textToSvg.ts';
export {
  computeTimeline,
  type Timeline,
  type TimelineConfig,
  type TimelineEntry,
  type TimelineStaggerConfig,
} from '../lib/timeline.ts';
export { type AnnotateMark, type AnnotateOptions, type AnnotateWhen, annotatePlugin } from '../plugins/annotate.ts';
export { boilPlugin } from '../plugins/boil.ts';
export { glowPlugin } from '../plugins/glow.ts';
export { globalGradientPlugin, strokeGradientPlugin } from '../plugins/gradient.ts';
export { type GroupableStroke, groupStrokes, type StrokeGroup, type StrokeGroupBy } from '../plugins/groups.ts';
export { taperPlugin } from '../plugins/taper.ts';
export { variationPlugin } from '../plugins/variation.ts';
export { BUNDLE_VERSION, type LineCap, type TegakiBundle, type TegakiGlyphData } from '../types.ts';
export { getBundle, registerBundle } from './bundle-registry.ts';
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
export { getPlugin, parsePluginSpecs, registerPlugin } from './plugin-registry.ts';
export { paintsDrawnOnly } from './plugins.ts';
export type { ShaperFactory } from './shaper-registry.ts';
export type {
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
