export const DEFAULT_RESOLUTION = 400;

export const DEFAULT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?\'"-()/\\@#$%&*+=<>~`^_|';

export const DEFAULT_FONT_FAMILY = 'Caveat';

export const EXAMPLE_FONTS = [
  'Caveat',
  'Dancing Script',
  'Great Vibes',
  'Indie Flower',
  'Italianno',
  'Kalam',
  'Nothing You Could Do',
  'Pacifico',
  'Parisienne',
  'Patrick Hand',
  'Permanent Marker',
  'Sacramento',
  'Satisfy',
  'Shadows Into Light',
  'Tangerine',
  'Noto Sans JP', // Japanese Sans
  'Shippori Mincho B1', // Japanese Serif
  'Klee One', // Japanese handwriting
  'Noto Sans SC', // Chinese Sans
  'Ma Shan Zheng', // Chinese Cursive
  'Noto Sans KR', // Korean Sans
  'Nanum Myeongjo', // Korean Serif
  'Rubik', // Arabic Sans
  'Amiri', // Arabic Cursive
  'Cardo', // Hebrew
  'Suez One', // Hebrew display
  'Tillana', // Devanagari (Hindi)
  'EB Garamond', // Greek
];

export const CACHE_DIR = '.cache/fonts';

export const BEZIER_TOLERANCE = 0.5;

export const RDP_TOLERANCE = 1.5;

export const BITMAP_PADDING = 0.05;

/** Minimum spur length as a fraction of the bitmap resolution */
export const SPUR_LENGTH_RATIO = 0.08;

/**
 * Minimum angle (in degrees, 0–180) at an internal polyline point for it to be
 * considered a junction kink artifact. Points with angle >= this are removed
 * during smoothing. 180 = perfectly straight, so higher values are stricter
 * (only nearly-straight kinks removed).
 *
 * Set to 180 to disable classic angle-based kink removal.
 */
export const SMOOTH_KINK_MIN_ANGLE = 155;

/**
 * Number of previous skeleton pixels used to estimate direction at junctions.
 * Controls both branch selection (look-ahead distance) and curvature estimation
 * (lookback window size).
 *
 * Set to 1 to effectively disable look-ahead and curvature estimation
 * (falls back to immediate 1-pixel neighbor comparison).
 */
export const TRACE_LOOKBACK = 12;

/**
 * How much to extrapolate the curve's angular trend at junctions (0–1+).
 * 0 = use the tangent direction from the lookback window (straight-line).
 * 1 = fully extrapolate the curvature trend (predicts continued turning).
 * Values > 1 over-extrapolate (tighter predicted turn).
 *
 * Set to 0 to disable curvature extrapolation (use straight-line tangent only).
 */
export const TRACE_CURVATURE_BIAS = 0.5;

/**
 * Minimum cosine difference required to remove a point during junction smoothing.
 * Higher values are more conservative (fewer points removed).
 * Used by both the curvature prediction test and the smoothness test.
 *
 * Set to 2 (or any value > 1) to disable both curvature-based and
 * smoothness-based kink removal (cosine difference can never exceed 2).
 */
export const SMOOTH_KINK_THRESHOLD = 0.15;

/**
 * Merge threshold as a fraction of bitmap size. Polyline endpoints within
 * `max(width, height) * MERGE_THRESHOLD_RATIO` are reconnected.
 *
 * Set to 0 to disable polyline merging.
 */
export const MERGE_THRESHOLD_RATIO = 0.08;

/**
 * Cosine threshold for detecting straight-line crossings at junctions.
 * Two branches are considered to form a straight line through a junction if
 * the cosine of the angle between their directions is below this value.
 * -1 = perfectly opposite, -0.7 ≈ 135° apart.
 *
 * Set to -2 to disable junction crossing detection.
 */
export const JUNCTION_CROSSING_COS = -0.7;

/**
 * Minimum cosine alignment between the incoming trace direction and a junction
 * branch for the trace to continue through a crossing. If the best alignment
 * with any branch is below this threshold, the trace stops at the junction.
 *
 * Set to -2 to never stop at crossings (always continue through).
 */
export const JUNCTION_ALIGNMENT_COS = 0.5;

/**
 * Weight of x-coordinate when scoring polyline orientation (start-point selection).
 * Higher values give more weight to left-to-right preference vs top-to-bottom.
 *
 * Set to 0 for pure top-to-bottom orientation preference.
 */
export const ORIENT_X_WEIGHT = 2;

/**
 * Y-axis tolerance (in pixels) when sorting stroke components.
 * Components within this vertical distance are considered same-row
 * and sorted left-to-right instead.
 *
 * Set to 0 for strict top-to-bottom sorting with no row grouping.
 */
export const COMPONENT_SORT_Y_TOLERANCE = 5;

/**
 * Y-axis tolerance (in pixels) when sorting polylines within a component.
 *
 * Set to 0 for strict top-to-bottom sorting with no row grouping.
 */
export const POLYLINE_SORT_Y_TOLERANCE = 3;

/**
 * Maximum iterations for junction cluster cleanup before stopping.
 *
 * Set to 0 to disable junction cluster cleanup entirely
 * (use raw Zhang-Suen skeleton).
 */
export const JUNCTION_CLEANUP_MAX_ITERATIONS = 5;

/**
 * Distance transform algorithm to use.
 * 'euclidean' = exact Euclidean DT (Felzenszwalb & Huttenlocher) — mathematically
 *   accurate but may produce noisier junction cleanup due to sharper peaks.
 * 'chamfer' = 2-pass chamfer DT with sqrt(2) diagonal cost — faster, slightly
 *   less accurate, but produces smoother gradients that can lead to cleaner results.
 *
 * Set to 'euclidean' for mathematically exact distances,
 * or 'chamfer' for the original (pre-optimization) behavior.
 */
export const DISTANCE_TRANSFORM_METHOD: 'euclidean' | 'chamfer' = 'chamfer';

/**
 * Skeletonization method.
 * 'zhang-suen' = classic two-sub-iteration thinning (Zhang & Suen, 1984).
 *   Well-tested, widely used, produces clean 1px skeletons.
 * 'guo-hall' = alternative two-sub-iteration thinning (Guo & Hall, 1989).
 *   Uses paired-neighbor counting (min of two groupings) which can produce
 *   slightly different junction topology and thinner diagonal strokes.
 * 'medial-axis' = distance-ordered homotopic thinning. Removes pixels from
 *   boundary inward (sorted by distance transform), so the skeleton lies on
 *   the true medial axis. Produces more geometrically centered skeletons but
 *   may be noisier at thin features.
 * 'lee' = Lee's thinning algorithm (Lee, Kashyap & Chu, 1994). TypeScript
 *   implementation using a precomputed lookup table with 8 directional
 *   sub-iterations per pass. Less directional bias than Zhang-Suen.
 * 'thin' = Morphological thinning (TypeScript). Configurable iteration count
 *   (THIN_MAX_ITERATIONS) for partial thinning, producing thicker skeletons.
 * 'voronoi' = Voronoi-based medial axis. Computes Voronoi diagram of boundary
 *   points and keeps edges inside the shape. Bypasses rasterization entirely,
 *   works directly from outline geometry. Produces sub-pixel accurate medial
 *   axis but may have more edges at junctions.
 *
 * All methods preserve topology and connectivity. Differences are subtle and
 * font/glyph-dependent — try each to see which works better for your use case.
 */
export type SkeletonMethod = 'zhang-suen' | 'guo-hall' | 'medial-axis' | 'lee' | 'thin' | 'voronoi';

export const SKELETON_METHOD: SkeletonMethod = 'zhang-suen';

/**
 * Sampling interval for Voronoi medial axis (in bitmap-space pixels).
 * Controls the density of boundary points fed to the Voronoi diagram.
 * Lower = denser sampling = more accurate but slower.
 * Only used when SKELETON_METHOD = 'voronoi'.
 *
 * Set to a higher value (e.g., 4-5) for faster but coarser results.
 */
export const VORONOI_SAMPLING_INTERVAL = 2;

/**
 * Maximum iterations for morphological thinning (SKELETON_METHOD = 'thin').
 * Controls how much thinning is applied — lower values produce thicker skeletons.
 * Set to Infinity for full thinning (equivalent to skeletonization).
 *
 * Only used when SKELETON_METHOD = 'thin'.
 */
export const THIN_MAX_ITERATIONS = 25;

/**
 * Drawing speed in font units per second, used to compute animation durations.
 * Each stroke's animationDuration = length / DRAWING_SPEED.
 * Lower = slower drawing, higher = faster drawing.
 */
export const DRAWING_SPEED = 3000;

/**
 * Pause duration in seconds between consecutive strokes during animation.
 */
export const STROKE_PAUSE = 0.15;

/** FNV-1a hash → 8-char hex string. Browser-safe (no node:crypto). */
export function shortHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Hash a character set: deduplicates, sorts, then hashes. */
export function charsHash(chars: string): string {
  return shortHash([...new Set([...chars])].sort().join(''));
}
