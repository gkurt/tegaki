export { ARABIC_CHARS, BENGALI_CHARS, CHARSET_PRESETS, DEVANAGARI_CHARS, HEBREW_CHARS, JAPANESE_CHARS, KOREAN_CHARS } from './charsets.ts';
export {
  type CoverageSummary,
  formatCoverageSummary,
  type GlyphCoverageReport,
  type InkBitmap,
  runCoverageReport,
  summarizeCoverageReports,
  unpaintedShare,
} from './commands/coverage-report.ts';
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
  processGlyphGeometryById,
  type TegakiBundleOutput,
  toCompactStroke,
} from './commands/generate.ts';
export {
  formatStrokeOrderSummary,
  type GlyphStrokeOrderReport,
  runStrokeOrderReport,
  type StrokeOrderSummary,
  summarizeStrokeOrderReports,
} from './commands/stroke-order-report.ts';
export { DEFAULT_CHARS, EXAMPLE_FONTS, type SkeletonMethod } from './constants.ts';
export { createHbShaper, type HbShaper, type ShapedGlyph } from './font/hb-shaper.ts';
export { enumerateFontChars } from './font/parse.ts';
export { initStraightSkeleton, isStraightSkeletonReady } from './geometry/face-straight-skeleton.ts';
export { findHeadlines, isHeadlineScriptChar } from './geometry/ordering.ts';
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
export { createHangulProvider, decomposeHangul, HANGUL_LICENSE } from './stroke-order/hangul.ts';
export { createHersheyProvider, createHersheySimplexProvider, HERSHEY_LICENSE } from './stroke-order/hershey.ts';
export {
  createKanjiVGProvider,
  KANJIVG_LICENSE,
  KANJIVG_RELEASE,
  kanjiVGFilename,
  kanjiVGUrl,
  parseKanjiVGSvg,
} from './stroke-order/kanjivg.ts';
export { matchStrokes, type StrokeMatchPair, type StrokeMatchResult } from './stroke-order/match.ts';
export { collectReferences } from './stroke-order/providers.ts';
export { referenceBBox, registerReference } from './stroke-order/register.ts';
export type {
  ReferenceGlyph,
  ReferenceStroke,
  ReferenceTransform,
  RegisteredReference,
  StrokeOrderProvider,
} from './stroke-order/types.ts';
