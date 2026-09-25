import * as opentype from 'opentype.js';
import { type BBox, BUNDLE_VERSION, type FontOutput, type LineCap, type Nib, type Point, type Stroke } from 'tegaki';
import * as z from 'zod/v4';
import {
  BEZIER_TOLERANCE,
  charsHash,
  DEFAULT_FONT_FAMILY,
  DEFAULT_RESOLUTION,
  DISTANCE_TRANSFORM_METHOD,
  DRAWING_SPEED,
  JUNCTION_CLEANUP_MAX_ITERATIONS,
  MERGE_THRESHOLD_RATIO,
  RDP_TOLERANCE,
  SKELETON_METHOD,
  SPUR_LENGTH_RATIO,
  STROKE_PAUSE,
  THIN_MAX_ITERATIONS,
  TRACE_CURVATURE_BIAS,
  TRACE_LOOKBACK,
  VORONOI_SAMPLING_INTERVAL,
} from '../constants.ts';
import { enumerateVariantGlyphIds } from '../font/enumerate-variants.ts';
import { getGsubFeatures } from '../font/hb-shaper.ts';
import { extractGlyph, extractGlyphById, inferLineCap } from '../font/parse.ts';
import { claimedCodepoints, fontCodepoints, toUnicodeRange } from '../font/unicode-range.ts';
import { initStraightSkeleton } from '../geometry/face-straight-skeleton.ts';
import { isHeadlineScriptChar } from '../geometry/ordering.ts';
import { runGeometryPipeline } from '../geometry/pipeline.ts';
import { DEFAULT_GEOMETRY_OPTIONS, type GeometryOptions, type GeometryPipelineResult } from '../geometry/types.ts';
import { computePathBBox, flattenPath } from '../processing/bezier.ts';
import { toFontUnits } from '../processing/font-units.ts';
import { rasterize } from '../processing/rasterize.ts';
import { isRtlChar } from '../processing/rtl.ts';
import { skeletonize } from '../processing/skeletonize/index.ts';
import { orderStrokes } from '../processing/stroke-order.ts';
import { computeInverseDistanceTransform } from '../processing/width.ts';
import { collectReferences } from '../stroke-order/providers.ts';
import type { ReferenceGlyph, StrokeOrderProvider } from '../stroke-order/types.ts';

// ── Pipeline option schema ─────────────────────────────────────────────────
// `PipelineOptions` and `DEFAULT_OPTIONS` are derived from this schema so the
// runtime defaults, the static type, and the CLI flag parsing all stay in sync.

const pipelineOptionsSchema = z.object({
  resolution: z.number().default(DEFAULT_RESOLUTION).describe('Bitmap resolution for skeletonization').meta({ flags: 'r' }),
  skeletonMethod: z
    .enum(['zhang-suen', 'guo-hall', 'medial-axis', 'lee', 'thin', 'voronoi'])
    .default(SKELETON_METHOD)
    .describe('Skeletonization algorithm'),
  lineCap: z
    .enum(['auto', 'round', 'butt', 'square'])
    .default('auto')
    .describe('Stroke line cap style (auto infers from font properties)')
    .meta({ flags: 'l' }),
  bezierTolerance: z.number().default(BEZIER_TOLERANCE).describe('Bezier curve flattening tolerance'),
  rdpTolerance: z.number().default(RDP_TOLERANCE).describe('Ramer-Douglas-Peucker simplification tolerance'),
  spurLengthRatio: z.number().default(SPUR_LENGTH_RATIO).describe('Minimum spur length as fraction of bitmap size'),
  mergeThresholdRatio: z.number().default(MERGE_THRESHOLD_RATIO).describe('Merge threshold as fraction of bitmap size'),
  traceLookback: z.number().default(TRACE_LOOKBACK).describe('Lookback window for junction direction estimation'),
  curvatureBias: z.number().default(TRACE_CURVATURE_BIAS).describe('Curvature extrapolation weight at junctions'),
  thinMaxIterations: z.number().default(THIN_MAX_ITERATIONS).describe('Max iterations for morphological thinning'),
  junctionCleanupIterations: z.number().default(JUNCTION_CLEANUP_MAX_ITERATIONS).describe('Max iterations for junction cluster cleanup'),
  dtMethod: z.enum(['euclidean', 'chamfer']).default(DISTANCE_TRANSFORM_METHOD).describe('Distance transform algorithm'),
  voronoiSamplingInterval: z.number().default(VORONOI_SAMPLING_INTERVAL).describe('Voronoi boundary sampling interval'),
  drawingSpeed: z.number().default(DRAWING_SPEED).describe('Drawing speed in font units per second'),
  strokePause: z.number().default(STROKE_PAUSE).describe('Pause duration in seconds between strokes'),
  disabledFeatures: z
    .array(z.string())
    .default([])
    .describe('OpenType GSUB feature tags to exclude from the generated bundle (default: include every feature the font declares)'),
});

export type PipelineOptions = z.infer<typeof pipelineOptionsSchema>;
export const DEFAULT_OPTIONS: PipelineOptions = pipelineOptionsSchema.parse({});

// Geometry-pipeline tunables as CLI flags. Defaults come from
// DEFAULT_GEOMETRY_OPTIONS (the source of truth, shared with the Studio); the
// type check below keeps the two field sets identical.
const G = DEFAULT_GEOMETRY_OPTIONS;
export const geometryOptionsSchema = z.object({
  extraction: z
    .enum(['ink-graph', 'partition'])
    .default(G.extraction)
    .describe('Geometry: stroke extraction — `ink-graph` (triangulated ink) or `partition` (corner cuts + per-face medial axes)'),
  strokeOrder: z
    .enum(['auto', 'dataset', 'heuristic'])
    .default(G.strokeOrder)
    .describe(
      'Geometry: draw order — `auto` uses a KanjiVG/Hershey reference when it matches cleanly, `dataset` forces it, `heuristic` ignores it',
    ),
  hanLocale: z
    .enum(['ja', 'zh'])
    .default(G.hanLocale)
    .describe('Geometry: stroke-order convention for Han characters — `ja` (KanjiVG) or `zh` (Make Me a Hanzi, PRC order)'),
  inkSampleRatio: z
    .number()
    .default(G.inkSampleRatio)
    .describe('Geometry (ink-graph): outline resampling step, as a fraction of units per em'),
  inkSpurTolerance: z
    .number()
    .default(G.inkSpurTolerance)
    .describe("Geometry (ink-graph): spur prune tolerance, as a fraction of the junction's inscribed radius"),
  inkJunctionReach: z
    .number()
    .default(G.inkJunctionReach)
    .describe("Geometry (ink-graph): junction zone radius, as a multiple of the junction's inscribed radius"),
  inkSerifs: z
    .boolean()
    .default(G.inkSerifs)
    .describe('Geometry (ink-graph): fold serifs into the stroke ends they cap instead of drawing them'),
  continuationMaxBendDeg: z
    .number()
    .default(G.continuationMaxBendDeg)
    .describe('Geometry: max bend (degrees) for a stroke to run on through a junction'),
  medialMethod: z
    .enum(['straight-skeleton', 'voronoi', 'chain'])
    .default(G.medialMethod)
    .describe('Geometry (partition): segment axis computation'),
  cornerAngleThresholdDeg: z
    .number()
    .default(G.cornerAngleThresholdDeg)
    .describe('Geometry (partition): min turn (degrees) for a concave corner'),
  cornerWindowRatio: z
    .number()
    .default(G.cornerWindowRatio)
    .describe('Geometry (partition): corner tangent window, as a fraction of units per em'),
  cutAlignToleranceDeg: z
    .number()
    .default(G.cutAlignToleranceDeg)
    .describe("Geometry (partition): max deviation (degrees) between a cut and its corner's wall continuation"),
  maxCutLengthFactor: z
    .number()
    .default(G.maxCutLengthFactor)
    .describe("Geometry (partition): max cut length, as a multiple of the corner's local width"),
  junctionCompactness: z
    .number()
    .default(G.junctionCompactness)
    .describe('Geometry (partition): fold faces past this × their cut span become retraced lobes, closer ones turns'),
  resampleSpacingRatio: z
    .number()
    .default(G.resampleSpacingRatio)
    .describe('Geometry (partition): medial-axis sample spacing, as a fraction of units per em'),
});
type SameKeys<A, B> = [Exclude<keyof A, keyof B> | Exclude<keyof B, keyof A>] extends [never] ? true : never;
const _geometryFlagsCoverOptions: SameKeys<z.infer<typeof geometryOptionsSchema>, GeometryOptions> &
  (z.infer<typeof geometryOptionsSchema> extends GeometryOptions ? true : never) = true;
void _geometryFlagsCoverOptions;

/** The geometry options among parsed `generate` args (the rest are raster / bundle options). */
export function pickGeometryOptions(args: GeometryOptions): GeometryOptions {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_GEOMETRY_OPTIONS) as (keyof GeometryOptions)[]) out[key] = args[key];
  return out as unknown as GeometryOptions;
}

// ── CLI argument schema ───────────────────────────────────────────────────

export const generateArgsSchema = pipelineOptionsSchema.extend(geometryOptionsSchema.shape).extend({
  family: z.string().optional().describe(`Google Fonts family name (default: ${DEFAULT_FONT_FAMILY})`),
  fontFile: z
    .string()
    .optional()
    .describe(
      "Read the font from this TTF/OTF file instead of Google Fonts, subset to the generated characters; the bundle takes the font's own family name",
    ),
  fullFont: z
    .boolean()
    .default(false)
    .describe(
      'With --font-file: also bundle the whole file as the fallback for characters outside the generated set, as Google Fonts bundles do (CJK fonts are tens of MB whole)',
    ),
  pipeline: z
    .enum(['geometry', 'raster'])
    .default('geometry')
    .describe(
      'Stroke extraction: `geometry` traces strokes from the outline itself (ordered by KanjiVG / Hershey references where they match); `raster` rasterizes and skeletonizes, tuned by the bitmap options',
    )
    .meta({ flags: 'p' }),
  output: z.string().optional().describe('Output folder path for the font bundle').meta({ flags: 'o' }),
  chars: z
    .union([z.boolean(), z.string()])
    .default(false)
    .describe('Characters to process. `true` processes every glyph in the font, `false` uses the default character set.')
    .meta({ flags: 'c' }),
  force: z.boolean().default(false).describe('Re-download font even if cached').meta({ flags: 'f' }),
  debug: z
    .boolean()
    .default(false)
    .describe("Output each glyph's intermediate steps under <output>/debug (the pipeline's stages as SVG/PNG, an animated SVG)")
    .meta({ flags: 'd' }),
});

export interface PipelineResult {
  char: string;
  unicode: number;
  advanceWidth: number;
  boundingBox: BBox;
  pathString: string;
  lineCap: LineCap;
  ascender: number;
  descender: number;

  // Stage 1: Flattened paths
  subPaths: Point[][];
  pathBBox: BBox;

  // Stage 2: Rasterized bitmap
  bitmap: Uint8Array;
  bitmapWidth: number;
  bitmapHeight: number;
  transform: { scaleX: number; scaleY: number; offsetX: number; offsetY: number };

  // Stage 3: Skeleton
  skeleton: Uint8Array;

  // Stage 4: Inverse distance transform
  inverseDT: Float32Array;

  // Stage 5: Traced polylines
  polylines: Point[][];

  // Stage 6: Ordered strokes (in bitmap space)
  strokes: Stroke[];

  // Stage 7: Font-unit strokes (final output)
  strokesFontUnits: (Stroke & { animationDuration: number; delay: number; length: number })[];
}

export interface ParsedFontInfo {
  family: string;
  style: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  lineCap: LineCap;
  font: opentype.Font;
  /** Additional subset fonts (e.g. CJK subsets from Google Fonts) */
  extraFonts?: opentype.Font[];
  /**
   * Deduplicated GSUB feature tags declared by the font (e.g. `liga`, `calt`,
   * `init`/`medi`/`fina` for Arabic). Detected once at parse time via harfbuzz
   * so downstream code — bundle builder, UI feature toggles, live preview —
   * never has to re-run detection.
   */
  features: string[];
}

// ── Bundle types ──────────────────────────────────────────────────────────

export interface BundleFile {
  /** Relative path within the bundle (e.g., "font.json", "svg/A.svg") */
  path: string;
  /** File content — string for text files, Uint8Array for binary */
  content: string | Uint8Array;
}

export interface ExtractBundleInput {
  fontBuffer: ArrayBuffer;
  fontFileName: string;
  chars: string;
  options: PipelineOptions;
  onProgress?: (message: string, progress?: number) => void;
  /** Additional font buffers for extra subsets (e.g. CJK subsets from Google Fonts) */
  extraFontBuffers?: ArrayBuffer[];
  /**
   * Family name to fall back to when the font's `name` table is missing or
   * empty (e.g. Google Fonts' subset endpoint strips name tables, so opentype
   * reports the family as undefined). Without this, the bundle's `family` is
   * set to the literal string `'Unknown'`, which collides across multiple
   * subset bundles in the same app.
   */
  requestedFamily?: string;
  /**
   * When true (default), the bundle's font family is suffixed with "Tegaki" + a
   * hash so it doesn't collide with the user's full font. The original family
   * is stored as `fullFamily` so the renderer can fall back to it for
   * characters not in the generated glyph set.
   *
   * Set to false when the bundle contains the full font (e.g. `--chars true`).
   */
  subset?: boolean;
  /** Full (non-subsetted) font buffer, bundled alongside the subset so the renderer can fall back to it. */
  fullFontBuffer?: ArrayBuffer;
  /** Filename for the full font file (e.g. `caveat.ttf`). */
  fullFontFileName?: string;
  /**
   * Stroke extraction: `'geometry'` (default — strokes traced from the
   * outline, tuned by `geometryOptions`; `options.bezierTolerance` still
   * applies) or `'raster'` (rasterize + skeletonize, tuned by `options`).
   */
  pipeline?: 'raster' | 'geometry';
  geometryOptions?: GeometryOptions;
  /**
   * Stroke-order reference sources for the geometry pipeline's `'auto'` /
   * `'dataset'` ordering. Without them it orders heuristically.
   */
  strokeOrderProviders?: StrokeOrderProvider[];
}

export interface TegakiBundleOutput {
  fontOutput: FontOutput;
  glyphResults: Record<string, PipelineResult>;
  /** Variant glyph pipeline results keyed by opentype glyph id (as string). */
  glyphResultsById: Record<string, PipelineResult>;
  /** Geometry pipeline results, by char and by variant glyph id (`pipeline: 'geometry'` only; the raster maps stay empty). */
  geometryResults?: Record<string, GeometryPipelineResult>;
  geometryResultsById?: Record<string, GeometryPipelineResult>;
  files: BundleFile[];
  stats: { processed: number; skipped: number; variants: number };
}

// ── Pipeline functions ─────────────────────────────────────────────────────

/** Parse a font from an ArrayBuffer (browser-compatible) */
export async function parseFont(buffer: ArrayBuffer, extraBuffers?: ArrayBuffer[], requestedFamily?: string): Promise<ParsedFontInfo> {
  const font = opentype.parse(buffer);
  const extraFonts = extraBuffers?.map((b) => opentype.parse(b));
  // Google Fonts serves non-Latin scripts (Arabic, Hebrew, CJK, ...) as
  // separate subset TTFs, and each subset declares the GSUB features its
  // script needs — Arabic's `init`/`medi`/`fina`/`rlig` live only in the
  // Arabic subset, not in the Latin primary. Union across every buffer so the
  // bundle surfaces every feature the user might exercise.
  const featureLists = await Promise.all([buffer, ...(extraBuffers ?? [])].map(getGsubFeatures));
  const seen = new Set<string>();
  const features: string[] = [];
  for (const list of featureLists) {
    for (const tag of list) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      features.push(tag);
    }
  }
  return {
    family: font.names.fontFamily?.en ?? requestedFamily ?? 'Unknown',
    style: font.names.fontSubfamily?.en ?? 'Regular',
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    lineCap: inferLineCap(font),
    font,
    extraFonts: extraFonts?.length ? extraFonts : undefined,
    features,
  };
}

/**
 * Run the full processing pipeline for a single glyph.
 *
 * Each stage is one function call producing the input to the next; intermediate
 * outputs are also returned in PipelineResult so the website preview and debug
 * visualizers can render them. Stage definitions live in packages/generator/src/processing/.
 */
export function processGlyph(fontInfo: ParsedFontInfo, char: string, options: PipelineOptions): PipelineResult | null {
  const rawGlyph = extractGlyph(fontInfo.font, char, fontInfo.extraFonts);
  if (!rawGlyph) return null;
  return runPipeline(fontInfo, rawGlyph.char, rawGlyph, options, isRtlChar(char));
}

/**
 * Run the experimental geometry-based stroke extraction pipeline for one glyph.
 *
 * Independent of {@link processGlyph} (which drives the rasterize/skeletonize
 * pipeline). Both consume the same extracted outline; this one works directly
 * on the flattened polygons instead of a bitmap. Intended for the Studio's
 * alternative-pipeline visualization while the approach is developed.
 */
export function processGlyphGeometry(
  fontInfo: ParsedFontInfo,
  char: string,
  geometryOptions?: GeometryOptions,
  bezierTolerance?: number,
  reference?: ReferenceGlyph | ReferenceGlyph[] | null,
): GeometryPipelineResult | null {
  const rawGlyph = extractGlyph(fontInfo.font, char, fontInfo.extraFonts);
  if (!rawGlyph) return null;
  const hasReference = Array.isArray(reference) ? reference.length > 0 : reference != null;
  return runGeometryPipeline(
    {
      char: rawGlyph.char,
      unicode: rawGlyph.unicode,
      advanceWidth: rawGlyph.advanceWidth,
      boundingBox: rawGlyph.boundingBox,
      pathString: rawGlyph.pathString,
      ascender: fontInfo.ascender,
      descender: fontInfo.descender,
      unitsPerEm: fontInfo.unitsPerEm,
      rtl: isRtlChar(char),
      headlineLast: isHeadlineScriptChar(char),
      ...(hasReference && reference ? { reference } : {}),
    },
    rawGlyph,
    geometryOptions,
    bezierTolerance,
  );
}

/** The one character a variant glyph draws, with its stroke-order references (see `VariantGlyph.letter`). */
export interface VariantLetter {
  char: string;
  reference?: ReferenceGlyph | ReferenceGlyph[] | null;
}

/** One component of a ligature variant: its glyph, and the letter it draws with that letter's references. */
export interface VariantComponent {
  /** The component's glyph id, in the same font as the ligature. */
  gid: number;
  char?: string;
  reference?: ReferenceGlyph | ReferenceGlyph[] | null;
}

/**
 * Run the geometry pipeline for a variant glyph identified by its opentype
 * index — the geometry counterpart of {@link processGlyphById} (same
 * `subsetIndex` / `rtl` semantics). `headlineLast`, like `rtl`, comes from
 * the cluster that produced the variant (see `isHeadlineScriptChar`). A
 * variant that draws one character — its nominal glyph as the shaper emits
 * it, or a contextual form of it — passes that `letter`: its references
 * order the strokes as they do the char-keyed glyph, and its script picks
 * the ordering rules. Without one, ordering is heuristic — for a ligature,
 * pass its `components` (in text order) and it is drawn letter by letter,
 * each letter ordered by its own references.
 */
export function processGlyphGeometryById(
  fontInfo: ParsedFontInfo,
  glyphId: number,
  geometryOptions?: GeometryOptions,
  bezierTolerance?: number,
  subsetIndex = 0,
  rtl = false,
  headlineLast = false,
  letter?: VariantLetter,
  components?: readonly VariantComponent[],
): GeometryPipelineResult | null {
  const font = subsetIndex === 0 ? fontInfo.font : fontInfo.extraFonts?.[subsetIndex - 1];
  if (!font) return null;
  const rawGlyph = extractGlyphById(font, glyphId);
  if (!rawGlyph) return null;
  const reference = letter?.reference;
  const hasReference = Array.isArray(reference) ? reference.length > 0 : reference != null;
  const ligature =
    components && components.length > 1
      ? components.map(({ gid, ...letter }) => ({ advance: font.glyphs.get(gid)?.advanceWidth ?? 0, ...letter }))
      : undefined;
  return runGeometryPipeline(
    {
      char: letter?.char ?? rawGlyph.char,
      unicode: rawGlyph.unicode,
      advanceWidth: rawGlyph.advanceWidth,
      boundingBox: rawGlyph.boundingBox,
      pathString: rawGlyph.pathString,
      ascender: fontInfo.ascender,
      descender: fontInfo.descender,
      unitsPerEm: fontInfo.unitsPerEm,
      rtl,
      headlineLast,
      ...(hasReference && reference ? { reference } : {}),
      ...(ligature ? { components: ligature } : {}),
    },
    rawGlyph,
    geometryOptions,
    bezierTolerance,
  );
}

/**
 * Run the pipeline for a variant glyph identified by its opentype index.
 *
 * `subsetIndex` selects which font in `fontInfo` to extract from: `0` (default)
 * is the primary font; `1+` indexes into `fontInfo.extraFonts`. Needed for
 * multi-subset fonts (e.g. Google Fonts' split Arabic/Latin TTFs) where a
 * shaper run against the Arabic subset returns glyph ids meaningful only to
 * that subset.
 *
 * `rtl` hints that this variant originates from a right-to-left cluster so
 * stroke ordering follows Arabic/Hebrew handwriting direction. Variant glyphs
 * don't have reliable unicode mappings of their own, so the caller must pass
 * the hint based on the cluster char that produced the variant.
 */
export function processGlyphById(
  fontInfo: ParsedFontInfo,
  glyphId: number,
  options: PipelineOptions,
  subsetIndex = 0,
  rtl = false,
): PipelineResult | null {
  const font = subsetIndex === 0 ? fontInfo.font : fontInfo.extraFonts?.[subsetIndex - 1];
  if (!font) return null;
  const rawGlyph = extractGlyphById(font, glyphId);
  if (!rawGlyph) return null;
  return runPipeline(fontInfo, rawGlyph.char, rawGlyph, options, rtl);
}

function runPipeline(
  fontInfo: ParsedFontInfo,
  char: string,
  rawGlyph: NonNullable<ReturnType<typeof extractGlyph>>,
  options: PipelineOptions,
  rtl = false,
): PipelineResult {
  const lineCap: LineCap = options.lineCap === 'auto' ? fontInfo.lineCap : options.lineCap;

  // Stage 1: Flatten bezier outline commands into polyline sub-paths (font units).
  const subPaths = flattenPath(rawGlyph.commands, options.bezierTolerance);
  const pathBBox = computePathBBox(subPaths);

  // Stage 2: Rasterize flattened paths into a binary bitmap.
  const raster = rasterize(subPaths, pathBBox, options.resolution);

  // Stage 3: Compute inverse distance transform — per-pixel stroke radius field.
  const inverseDT = computeInverseDistanceTransform(raster.bitmap, raster.width, raster.height, options.dtMethod);

  // Stage 4: Extract skeleton + centerline polylines (voronoi or thinning+trace).
  const { skeleton, polylines, widths } = skeletonize({ subPaths, pathBBox, raster, inverseDT, options, rtl });

  // Stage 5: Order strokes (draw order + direction) and assign per-point time `t`.
  const strokes = orderStrokes(polylines, inverseDT, raster.width, 3, widths, rtl);

  // Stage 6: Convert to font units and compute animation timing.
  const strokesFontUnits = toFontUnits(strokes, raster.transform, options.drawingSpeed, options.strokePause);

  return {
    char,
    unicode: rawGlyph.unicode,
    advanceWidth: rawGlyph.advanceWidth,
    boundingBox: rawGlyph.boundingBox,
    pathString: rawGlyph.pathString,
    lineCap,
    ascender: fontInfo.ascender,
    descender: fontInfo.descender,
    subPaths,
    pathBBox,
    bitmap: raster.bitmap,
    bitmapWidth: raster.width,
    bitmapHeight: raster.height,
    transform: raster.transform,
    skeleton,
    inverseDT,
    polylines,
    strokes,
    strokesFontUnits,
  };
}

// ── Bundle extraction (pure — no file I/O) ────────────────────────────────

type CompactNib = [pointIndex: number, dx: number, dy: number, major: number, minor: number, angle: number];
type CompactStroke = { p: [number, number, number][]; d: number; a: number; r?: number; n?: CompactNib[] };
type CompactGlyph = {
  w: number;
  t: number;
  s: CompactStroke[];
};

export function toCompactStroke(s: {
  points: { x: number; y: number; width: number; nib?: Nib }[];
  delay: number;
  animationDuration: number;
  priority?: number;
}): CompactStroke {
  const out: CompactStroke = {
    p: s.points.map((p) => [p.x, p.y, p.width] as [number, number, number]),
    d: s.delay,
    a: s.animationDuration,
  };
  // Omit `r` for default priority so existing bundles and the common case
  // stay byte-identical to the previous schema.
  if (s.priority && s.priority < 0) out.r = s.priority;
  // Likewise `n`: only strokes that carry nib stamps (geometry ink-graph).
  const nibs: CompactNib[] = [];
  s.points.forEach((p, i) => {
    if (p.nib) nibs.push([i, p.nib.dx, p.nib.dy, p.nib.major, p.nib.minor, p.nib.angle]);
  });
  if (nibs.length > 0) out.n = nibs;
  return out;
}

function toCompactGlyph(result: Pick<PipelineResult, 'strokesFontUnits' | 'advanceWidth'>): CompactGlyph {
  const { strokesFontUnits } = result;
  const last = strokesFontUnits[strokesFontUnits.length - 1];
  const totalAnimationDuration = last ? Math.round((last.delay + last.animationDuration) * 1000) / 1000 : 0;
  return {
    w: result.advanceWidth,
    t: totalAnimationDuration,
    s: strokesFontUnits.map(toCompactStroke),
  };
}

export async function extractTegakiBundle(input: ExtractBundleInput): Promise<TegakiBundleOutput> {
  const {
    fontBuffer,
    fontFileName,
    chars: charsStr,
    options,
    onProgress,
    extraFontBuffers,
    requestedFamily,
    subset = true,
    fullFontBuffer,
    fullFontFileName,
    pipeline = 'geometry',
    geometryOptions = DEFAULT_GEOMETRY_OPTIONS,
    strokeOrderProviders = [],
  } = input;
  const fontInfo = await parseFont(fontBuffer, extraFontBuffers, requestedFamily);
  const geometry = pipeline === 'geometry';
  if (geometry && geometryOptions.extraction === 'partition' && geometryOptions.medialMethod === 'straight-skeleton') {
    await initStraightSkeleton();
  }
  const geometryReferences = async (char: string): Promise<ReferenceGlyph[]> =>
    geometryOptions.strokeOrder === 'heuristic' || strokeOrderProviders.length === 0
      ? []
      : await collectReferences(char, strokeOrderProviders).catch(() => []);

  const lineCap: LineCap = options.lineCap === 'auto' ? fontInfo.lineCap : options.lineCap;
  const subsetFonts = [fontInfo.font, ...(fontInfo.extraFonts ?? [])];
  // What each extra subset draws: the characters no earlier font has (see `pickSubset` in the shaper).
  const claimedBySubset = claimedCodepoints(subsetFonts.map(fontCodepoints));

  onProgress?.(`Processing ${fontInfo.family} ${fontInfo.style} (${fontInfo.unitsPerEm} units/em, ${lineCap} caps)`, 0);

  const output: FontOutput = {
    font: {
      family: fontInfo.family,
      style: fontInfo.style,
      unitsPerEm: fontInfo.unitsPerEm,
      ascender: fontInfo.ascender,
      descender: fontInfo.descender,
      lineCap,
    },
    glyphs: {},
  };

  // NFC normalize before splitting into code points so bundle keys are in a
  // canonical form. Without this, a charset typed as `"é"` (NFD: e + U+0301)
  // would split into two separate base+combining entries instead of one
  // precomposed glyph, and the renderer's char-keyed lookups (which also NFC
  // normalize incoming text) would miss the bundle even when the right glyph
  // is reachable.
  const chars = [...charsStr.normalize('NFC')];
  let processed = 0;
  let skipped = 0;
  const glyphResults: Record<string, PipelineResult> = {};
  const geometryResults: Record<string, GeometryPipelineResult> = {};

  for (const char of chars) {
    let result: PipelineResult | GeometryPipelineResult | null;
    let skeletonFontUnits: Point[][];
    if (geometry) {
      const geo = processGlyphGeometry(fontInfo, char, geometryOptions, options.bezierTolerance, await geometryReferences(char));
      result = geo;
      if (geo) geometryResults[char] = geo;
      // The geometry pipeline has no pixel skeleton: its centerlines are the strokes.
      skeletonFontUnits = geo?.strokesFontUnits.map((s) => s.points.map((p) => ({ x: p.x, y: p.y }))) ?? [];
    } else {
      const raster = processGlyph(fontInfo, char, options);
      result = raster;
      if (raster) glyphResults[char] = raster;
      skeletonFontUnits =
        raster?.polylines.map((pl) =>
          pl.map((p) => ({
            x: Math.round((p.x / raster.transform.scaleX + raster.transform.offsetX) * 100) / 100,
            y: Math.round((p.y / raster.transform.scaleY + raster.transform.offsetY) * 100) / 100,
          })),
        ) ?? [];
    }
    if (!result) {
      skipped++;
      continue;
    }

    const { strokesFontUnits } = result;

    const totalLength = Math.round(strokesFontUnits.reduce((sum, s) => sum + s.length, 0) * 100) / 100;
    const last = strokesFontUnits[strokesFontUnits.length - 1];
    const totalAnimationDuration = last ? Math.round((last.delay + last.animationDuration) * 1000) / 1000 : 0;

    output.glyphs[char] = {
      char: result.char,
      unicode: result.unicode,
      advanceWidth: result.advanceWidth,
      boundingBox: result.boundingBox,
      path: result.pathString,
      skeleton: skeletonFontUnits,
      strokes: strokesFontUnits,
      totalLength,
      totalAnimationDuration,
    };

    processed++;
    onProgress?.(`Processing glyph "${char}"`, processed / chars.length);
  }

  // Variant glyphs (ligatures / contextual alternates). Each is processed once
  // and keyed by opentype glyph id; the renderer shapes text via harfbuzz and
  // falls back to the char-keyed map for glyphs that aren't variants. That way
  // default glyphs are never duplicated across the two maps.
  const glyphResultsById: Record<string, PipelineResult> = {};
  const geometryResultsById: Record<string, GeometryPipelineResult> = {};
  const variantCompact: Record<string, CompactGlyph> = {};
  // Subtract any features the caller wants disabled from the font's declared
  // GSUB tags. The remaining set is enabled during variant enumeration and
  // stored on the bundle so the renderer (canvas shaper + DOM FontFace) can
  // apply the same set. When nothing's left the bundle has no variants —
  // behaviorally the same as the previous `ligatures: false` opt-out.
  const bundleFeatures = fontInfo.features.filter((f) => !options.disabledFeatures.includes(f));
  if (bundleFeatures.length > 0) {
    onProgress?.(`Discovering ligature/alternate glyphs...`);
    // The renderer shapes each character with the first subset that has it,
    // so an extra subset's variants grow from the characters it claims, and
    // are keyed `<subsetIndex>:<gid>` as the shaper reports them.
    const claimed = claimedBySubset.map((cps) => new Set(cps));
    const variantIds = subsetFonts.flatMap((font, subsetIndex) => {
      const own = subsetIndex === 0 ? chars : chars.filter((ch) => claimed[subsetIndex - 1]!.has(ch.codePointAt(0)!));
      return [...enumerateVariantGlyphIds(font, own).values()].map((v) => ({ ...v, subsetIndex }));
    });
    const total = variantIds.length;
    let i = 0;
    for (const { gid, clusterChar, letter, components, subsetIndex } of variantIds) {
      const key = subsetIndex === 0 ? String(gid) : `${subsetIndex}:${gid}`;
      const rtl = isRtlChar(clusterChar);
      i++;
      if (geometry) {
        // A glyph drawing one letter is ordered by that letter's references,
        // like its char-keyed copy — the renderer prefers this one when shaping.
        const result = processGlyphGeometryById(
          fontInfo,
          gid,
          geometryOptions,
          options.bezierTolerance,
          subsetIndex,
          rtl,
          isHeadlineScriptChar(clusterChar),
          letter === undefined ? undefined : { char: letter, reference: await geometryReferences(letter) },
          components &&
            (await Promise.all(
              components.map(async (c) =>
                c.letter === undefined ? { gid: c.gid } : { gid: c.gid, char: c.letter, reference: await geometryReferences(c.letter) },
              ),
            )),
        );
        if (!result) continue;
        geometryResultsById[key] = result;
        variantCompact[key] = toCompactGlyph(result);
      } else {
        const result = processGlyphById(fontInfo, gid, options, subsetIndex, rtl);
        if (!result) continue;
        glyphResultsById[key] = result;
        variantCompact[key] = toCompactGlyph(result);
      }
      onProgress?.(`Processing variant glyph #${key}`, total === 0 ? undefined : i / total);
    }
  }

  // Build bundle files
  const files: BundleFile[] = [];

  files.push({ path: fontFileName, content: new Uint8Array(fontBuffer) });
  // Extra subsets ship beside the primary: the shaper draws their characters
  // from them, and the browser only with them limited to those characters.
  const extraFonts = (extraFontBuffers ?? []).map((buffer, i) => ({
    fileName: extraFontFileName(fontFileName, i + 1),
    range: toUnicodeRange(claimedBySubset[i]!),
    buffer,
  }));
  for (const { fileName, buffer } of extraFonts) files.push({ path: fileName, content: new Uint8Array(buffer) });

  // Compact glyph data: short keys, points as [x, y, width] tuples
  const glyphDataMap: Record<string, CompactGlyph> = {};
  for (const glyph of Object.values(output.glyphs)) {
    glyphDataMap[glyph.char] = {
      w: glyph.advanceWidth,
      t: glyph.totalAnimationDuration,
      s: glyph.strokes.map(toCompactStroke),
    };
  }

  files.push({ path: 'glyphData.json', content: JSON.stringify(glyphDataMap) });

  const hasVariants = Object.keys(variantCompact).length > 0;
  if (hasVariants) {
    files.push({ path: 'glyphDataById.json', content: JSON.stringify(variantCompact) });
  }

  // When the bundle is a subset, suffix the font-family name so it doesn't
  // collide with a user-loaded full font. The full (non-subsetted) font is
  // bundled alongside so the renderer can fall back to it automatically.
  const bundleFamily = subset ? `${fontInfo.family} Tegaki ${charsHash(charsStr)}` : fontInfo.family;
  const fullFamily = subset ? fontInfo.family : undefined;

  if (subset && fullFontBuffer && fullFontFileName) {
    files.push({ path: fullFontFileName, content: new Uint8Array(fullFontBuffer) });
  }

  files.push({
    path: 'bundle.ts',
    content: generateGlyphsModule({
      fontFileName,
      fontFamily: bundleFamily,
      fullFamily,
      fullFontFileName: subset && fullFontFileName ? fullFontFileName : undefined,
      extraFonts: extraFonts.map(({ fileName, range }) => ({ fileName, range })),
      lineCap,
      unitsPerEm: fontInfo.unitsPerEm,
      ascender: fontInfo.ascender,
      descender: fontInfo.descender,
      hasVariants,
      features: hasVariants && bundleFeatures.length > 0 ? bundleFeatures : undefined,
    }),
  });

  return {
    fontOutput: output,
    glyphResults,
    glyphResultsById,
    ...(geometry ? { geometryResults, geometryResultsById } : {}),
    files,
    stats: { processed, skipped, variants: Object.keys(variantCompact).length },
  };
}

/** `amiri.ttf` → `amiri-1.ttf`: the file an extra font subset takes in the bundle. */
export function extraFontFileName(fontFileName: string, subsetIndex: number): string {
  const dot = fontFileName.lastIndexOf('.');
  return dot > 0 ? `${fontFileName.slice(0, dot)}-${subsetIndex}${fontFileName.slice(dot)}` : `${fontFileName}-${subsetIndex}.ttf`;
}

export function generateGlyphsModule(args: {
  fontFileName: string;
  fontFamily: string;
  fullFamily: string | undefined;
  fullFontFileName: string | undefined;
  /** Extra subset files, in subset order, with the `unicode-range` each draws. */
  extraFonts: { fileName: string; range: string }[];
  lineCap: LineCap;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  hasVariants: boolean;
  features: string[] | undefined;
}): string {
  const {
    fontFileName,
    fontFamily,
    fullFamily,
    fullFontFileName,
    extraFonts,
    lineCap,
    unitsPerEm,
    ascender,
    descender,
    hasVariants,
    features,
  } = args;
  const esc = (s: string) => s.replace(/'/g, "\\'");
  const hasFull = fullFamily && fullFontFileName;

  const imports = [`import fontUrl from './${fontFileName}' with { type: 'url' };`];
  if (hasFull) imports.push(`import fullFontUrl from './${fullFontFileName}' with { type: 'url' };`);
  imports.push(...extraFonts.map(({ fileName }, i) => `import extraFontUrl${i + 1} from './${fileName}' with { type: 'url' };`));
  imports.push(`import glyphData from './glyphData.json' with { type: 'json' };`);
  if (hasVariants) imports.push(`import glyphDataById from './glyphDataById.json' with { type: 'json' };`);

  const fontFaceRules = [`@font-face { font-family: '${esc(fontFamily)}'; src: url(\${fontUrl}); }`];
  extraFonts.forEach(({ range }, i) => {
    if (range)
      fontFaceRules.push(`@font-face { font-family: '${esc(fontFamily)}'; src: url(\${extraFontUrl${i + 1}}); unicode-range: ${range}; }`);
  });
  if (hasFull) fontFaceRules.push(`@font-face { font-family: '${esc(fullFamily)}'; src: url(\${fullFontUrl}); }`);

  const props = [
    `  version: ${BUNDLE_VERSION},`,
    `  family: '${esc(fontFamily)}',`,
    ...(hasFull ? [`  fullFamily: '${esc(fullFamily)}',`] : []),
    `  lineCap: '${lineCap}',`,
    `  fontUrl,`,
    ...(hasFull ? [`  fullFontUrl,`] : []),
    ...(extraFonts.length
      ? [
          `  extraFontUrls: [${extraFonts.map((_, i) => `extraFontUrl${i + 1}`).join(', ')}],`,
          `  extraFontRanges: ${JSON.stringify(extraFonts.map((f) => f.range))},`,
        ]
      : []),
    `  fontFaceCSS: \`${fontFaceRules.join(' ')}\`,`,
    `  unitsPerEm: ${unitsPerEm},`,
    `  ascender: ${ascender},`,
    `  descender: ${descender},`,
    `  glyphData,`,
    ...(hasVariants ? [`  glyphDataById,`] : []),
    ...(features?.length ? [`  features: ${JSON.stringify(features)},`] : []),
  ];

  return `// Auto-generated by Tegaki. Do not edit manually.
${imports.join('\n')}

const bundle = {
${props.join('\n')}
} as const;

export default bundle;
`;
}
