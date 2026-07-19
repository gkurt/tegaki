export { ARABIC_CHARS, BENGALI_CHARS, CHARSET_PRESETS, DEVANAGARI_CHARS, HEBREW_CHARS, JAPANESE_CHARS, KOREAN_CHARS } from './charsets.ts';
export {
  type BundleFile,
  DEFAULT_OPTIONS,
  type ExtractBundleInput,
  extractTegakiBundle,
  generateArgsSchema,
  type ParsedFontInfo,
  type PipelineOptions,
  type PipelineResult,
  parseFont,
  processGlyph,
  processGlyphById,
  processGlyphGeometry,
  type TegakiBundleOutput,
} from './commands/generate.ts';
export { DEFAULT_CHARS, EXAMPLE_FONTS, type SkeletonMethod } from './constants.ts';
export { createHbShaper, type HbShaper, type ShapedGlyph } from './font/hb-shaper.ts';
export { enumerateFontChars } from './font/parse.ts';
export { initStraightSkeleton, isStraightSkeletonReady } from './geometry/face-straight-skeleton.ts';
export type { GeometryPipelineInput } from './geometry/pipeline.ts';
export {
  type AxisEnd,
  type AxisPoint,
  type Contour,
  type Corner,
  type Cut,
  DEFAULT_GEOMETRY_OPTIONS,
  type Face,
  type GeometryOptions,
  type GeometryPipelineResult,
  type GeoStroke,
  type JunctionInfo,
  type SegmentInfo,
} from './geometry/types.ts';
export { type GeometryStage, renderGeometryStage } from './geometry/visualize.ts';
export { glyphToAnimatedSVG } from './processing/animated-svg.ts';
export { isRtlChar, isRtlCodepoint } from './processing/rtl.ts';
export { renderStage, STROKE_COLORS, type VisualizationStage } from './processing/visualize.ts';
