/**
 * `tegaki/internal` — pieces of the renderer that the Tegaki website and
 * generator use but that aren't part of its API: the stroke timeline's
 * plumbing, text layout, shaping constants, the helpers inside the shipped
 * plugins, the framework adapters' element building, and the generator's
 * verbose glyph types.
 *
 * **Not covered by semver.** Anything here can change or disappear in a
 * minor or patch release. Build on `tegaki` / `tegaki/core` instead; if you
 * need something from here, open an issue so it can be made public.
 */

export { resolveBundle } from '../core/bundle-registry.ts';
export { isDeclarative } from '../core/plugin-registry.ts';
export { buildChildren, buildRootProps, domCreateElement } from '../core/render-elements.ts';
export type { CreateElementFn } from '../core/types.ts';
export { paragraphDirection } from '../lib/bidi.ts';
export { LETTER_SPACED_OFF_FEATURES, toCssFeatureSettings, UNSHAPED_OFF_FEATURES } from '../lib/features.ts';
export { ensureFontFace } from '../lib/font.ts';
export {
  type GlyphSlot,
  glyphLocalTime,
  type PlaceContext,
  placeStrokes,
  rawStrokePath,
  type StrokeTiming,
  sampleFrame,
  sampleStroke,
  strokeInkBounds,
  strokeInstances,
  strokeProgressAt,
  strokeWindow,
} from '../lib/strokeTimeline.ts';
export { computeLayoutBbox, computeTextLayout, type LayoutBBox, type TextLayout } from '../lib/textLayout.ts';
export { type Annotation, type AnnotationStroke, annotations } from '../plugins/annotate.ts';
export { type StrokeGradientOptions, strokeGradientAt } from '../plugins/gradient.ts';
export { type TaperOptions, taperAt } from '../plugins/taper.ts';
export {
  type BBox,
  COMPATIBLE_BUNDLE_VERSIONS,
  type FontOutput,
  type GlyphData,
  type Nib,
  type PathCommand,
  type Point,
  type Stroke,
  type TimedPoint,
} from '../types.ts';
