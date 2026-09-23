// Types for the geometry-based stroke extraction pipeline.
//
// Unlike the raster pipeline (outline -> bitmap -> skeleton -> trace), this
// pipeline works directly on the flattened outline polygons in font units:
//
//   contours -> concave corners -> cross-section cuts -> planar partition
//   (segment/junction faces) -> per-segment medial axes -> continuation
//   matching at junctions -> merged strokes
//
// Coordinates are font units in screen space (y-down), exactly as produced by
// `flattenPath` on opentype's `glyph.getPath()` output. All orientation math
// is purely algebraic (positive signed area = region on the algebraic left),
// so the y-down convention never needs special-casing.

import type { BBox, Nib, Point, Stroke } from 'tegaki';
import type { RegisteredReference } from '../stroke-order/types.ts';

/** A closed outline polygon (no duplicate closing point). */
export interface Contour {
  /**
   * Vertices, oriented so the filled region lies on the algebraic left of
   * travel: outer contours have positive signed area, holes negative.
   */
  points: Point[];
  /** Signed area after orientation (positive for outer, negative for holes). */
  area: number;
  /** True when this contour is a hole (odd containment nesting). */
  isHole: boolean;
  /** Cumulative arc length at each vertex; last entry is the perimeter. */
  arcLengths: number[];
}

/** A concave (reflex) corner of the filled region. */
export interface Corner {
  /** Index into the contours array. */
  contourIndex: number;
  /** Vertex index within the contour. */
  pointIndex: number;
  point: Point;
  /**
   * Signed turn angle at the corner in radians (negative = clockwise turn =
   * reflex corner given region-on-left orientation). More negative = sharper.
   */
  turnAngle: number;
  /**
   * The two "wall continuation" unit directions, both pointing into the filled
   * region: `[0]` continues the incoming wall straight through the corner,
   * `[1]` runs backwards along the outgoing wall.
   */
  slots: [Point, Point];
  /**
   * Local stroke-width estimate: shortest ray-cast distance from the corner
   * into the region (along each slot and their bisector). Used to cap cut
   * lengths so cuts cross strokes instead of running along them.
   */
  localWidth: number;
}

/** Where a cut endpoint lands. */
export type CutEndpoint =
  | { kind: 'corner'; cornerIndex: number; point: Point }
  | { kind: 'edge'; contourIndex: number; edgeIndex: number; point: Point }
  | { kind: 'cut'; cutIndex: number; point: Point };

/** A straight cross-section line splitting the filled region. */
export interface Cut {
  a: CutEndpoint;
  b: CutEndpoint;
  /** 'pair' = connects two concave corners; 'projected' = wall continuation ray. */
  source: 'pair' | 'projected';
  length: number;
}

/** One face of the planar partition (a maximal region bounded by outline + cuts). */
export interface Face {
  id: number;
  /** Outer boundary walk, region on the algebraic left (positive area). */
  polygon: Point[];
  /** For each polygon edge i (polygon[i] -> polygon[i+1]), the cut index it belongs to, or -1 for outline edges. */
  edgeCutIds: number[];
  /** Hole cycles fully contained in this face (e.g. the counter of an O). */
  holes: Point[][];
  /** Distinct cut ids on the boundary. */
  cutIds: number[];
  area: number;
  centroid: Point;
  kind: 'segment' | 'junction';
}

/** A medial-axis sample along a segment's centerline. */
export interface AxisPoint extends Point {
  /** Local stroke width (full diameter) in font units. */
  width: number;
  /** Elliptic ink stamp left at this point (ink-graph extraction). */
  nib?: Nib;
}

/** Reference from a segment axis end to the cut it terminates on. */
export interface AxisEnd {
  /** Cut id the end sits on, or -1 for free ends (stroke tips, loops). */
  cutId: number;
  /** Midpoint of that cut (== the axis end point when cutId >= 0). */
  point: Point;
  /** Unit direction pointing out of the segment (into the junction). */
  direction: Point;
  /** Axis width at the end. */
  width: number;
}

/** A segment face with its computed medial axis. */
export interface SegmentInfo {
  faceId: number;
  axis: AxisPoint[];
  /** True when the axis is a closed loop (annulus segments like O). */
  isLoop: boolean;
  /** Ends at axis[0] and axis[axis.length-1]; empty for loops. */
  ends: AxisEnd[];
}

/** A merged junction region (one or more adjacent junction faces). */
export interface JunctionInfo {
  faceIds: number[];
  centroid: Point;
  /** Segment ends incident to this junction: [segmentIndex, endIndex(0|1)]. */
  incident: { segmentIndex: number; endIndex: number }[];
  /** Accepted continuation pairings between incident entries (indices into `incident`). */
  pairings: [number, number][];
  /**
   * Per-pairing polyline routed through the junction's faces, aligned with
   * `pairings` and oriented from the first end to the second. Empty when no
   * route was computed (bare cuts, degenerate axes) — assembly then falls
   * back to bridging via `centroid`.
   */
  routes: AxisPoint[][];
  /**
   * Per-incident extension for UNPAIRED ends, aligned with `incident` (null
   * when the end is paired or nothing to extend). An unpaired end must not
   * stop at its cut — the junction area beyond it is a legitimate part of
   * the glyph that no route may cover (a T's stem reaches into the bar, the
   * arms of a Y fill their crotch). Ordered from the cut midpoint inward.
   */
  extensions: (AxisPoint[] | null)[];
}

/** A final extracted stroke before ordering/timing. */
export interface GeoStroke {
  points: AxisPoint[];
  isLoop: boolean;
  /** Segment indices merged into this stroke, in draw order. */
  segmentIndices: number[];
}

/** User-tunable knobs, resolution-independent (ratios are × unitsPerEm). */
export interface GeometryOptions {
  /** Minimum turn angle (degrees) for a vertex to count as a concave corner. */
  cornerAngleThresholdDeg: number;
  /** Tangent estimation window as a fraction of unitsPerEm. */
  cornerWindowRatio: number;
  /** Max deviation (degrees) between a cut and a corner's wall continuation. */
  cutAlignToleranceDeg: number;
  /** Max cut length as a multiple of the corner's local width estimate. */
  maxCutLengthFactor: number;
  /**
   * Fold-shaped 2-cut faces (both cuts converging at a shared corner) become
   * retraced LOBES when they extend beyond this × max cut span from the
   * corner; closer ones are rounded TURNS. See computeSegmentAxis.
   */
  junctionCompactness: number;
  /** Max bend (degrees) for two segments to merge into one stroke across a junction. */
  continuationMaxBendDeg: number;
  /** Medial-axis sample spacing as a fraction of unitsPerEm. */
  resampleSpacingRatio: number;
  /**
   * Axis computation for segment faces: 'straight-skeleton' (the default)
   * computes the exact CGAL straight skeleton of the face polygon (no
   * sampling artifacts, but requires `await initStraightSkeleton()` first);
   * 'voronoi' approximates the true medial axis from the Voronoi diagram of
   * boundary samples (~100× faster, but the sampled axis wobbles and forks
   * at junction mouths); 'chain' pairs opposite walls (fastest, but stops
   * short of thin tapering parts and drops limbs on descender/loop faces —
   * kept as a debugging comparison).
   */
  medialMethod: 'chain' | 'voronoi' | 'straight-skeleton';
  /**
   * How draw order and pen direction are decided when a stroke-order
   * reference is supplied on the pipeline input:
   * - 'auto' (default): dataset order when the match is clean (counts agree,
   *   cost under threshold), heuristic otherwise — never worse than today.
   * - 'dataset': force the best dataset match, partial on count mismatch.
   *   Debugging the matcher itself.
   * - 'heuristic': the control group — reference is registered for display
   *   but never consulted for ordering.
   * Without a reference all three behave identically (heuristic).
   */
  strokeOrder: 'auto' | 'dataset' | 'heuristic';
  /**
   * How strokes are extracted from the outline:
   * - 'partition' (default): concave corners → cuts → face partition →
   *   per-face medial axes → junction continuation matching.
   * - 'ink-graph' (experimental): triangulate the ink once, read the stroke
   *   topology off the triangles (tips / sleeves / junctions), prune spurs by
   *   ink coverage, and pair branch ends per junction exactly (see ink/).
   *   Ignores the corner/cut/medial options.
   */
  extraction: 'partition' | 'ink-graph';
  /** Ink graph: outline resampling step as a fraction of unitsPerEm. */
  inkSampleRatio: number;
  /** Ink graph: spur prune tolerance, as a fraction of the junction's inscribed radius. */
  inkSpurTolerance: number;
  /** Ink graph: junction zone radius as a multiple of the junction's inscribed radius. */
  inkJunctionReach: number;
}

export const DEFAULT_GEOMETRY_OPTIONS: GeometryOptions = {
  cornerAngleThresholdDeg: 45,
  cornerWindowRatio: 0.025,
  cutAlignToleranceDeg: 40,
  maxCutLengthFactor: 3,
  junctionCompactness: 1.5,
  // Cursive strokes legitimately bend 60–75° flowing through a junction (the
  // bowl→tail of q, the spine→loop of 6); crossings that must NOT merge (T,
  // E, t, f) meet at ~90°, so 75° keeps a comfortable margin both ways.
  continuationMaxBendDeg: 75,
  resampleSpacingRatio: 0.02,
  // The chain approximation loses whole limbs on descender/loop faces
  // (Caveat r, Klee One そ/ゆ/れ/わ); voronoi covers them but its sampled
  // axis wobbles and forks at junction mouths. The exact straight skeleton
  // has neither problem and is what the merged-shape trial join (strokes.ts)
  // measures against, so defaults stay consistent with the join ranking.
  medialMethod: 'straight-skeleton',
  strokeOrder: 'auto',
  extraction: 'partition',
  inkSampleRatio: 0.006,
  // A round pen pokes (√2−1)·r ≈ 0.41·r short of a square outer corner; such
  // pen-unreachable ears are what spur pruning must remove.
  inkSpurTolerance: 0.5,
  inkJunctionReach: 1.5,
};

/** Options resolved to absolute font units / radians for the core algorithms. */
export interface ResolvedGeometryOptions {
  cornerAngleThreshold: number;
  cornerWindow: number;
  cutAlignTolerance: number;
  maxCutLengthFactor: number;
  junctionCompactness: number;
  continuationMinCos: number;
  resampleSpacing: number;
  medialMethod: 'chain' | 'voronoi' | 'straight-skeleton';
  extraction: 'partition' | 'ink-graph';
  inkSampleSpacing: number;
  inkSpurTolerance: number;
  inkJunctionReach: number;
}

export function resolveGeometryOptions(options: GeometryOptions, unitsPerEm: number): ResolvedGeometryOptions {
  return {
    cornerAngleThreshold: (options.cornerAngleThresholdDeg * Math.PI) / 180,
    cornerWindow: options.cornerWindowRatio * unitsPerEm,
    cutAlignTolerance: (options.cutAlignToleranceDeg * Math.PI) / 180,
    maxCutLengthFactor: options.maxCutLengthFactor,
    junctionCompactness: options.junctionCompactness,
    continuationMinCos: Math.cos((options.continuationMaxBendDeg * Math.PI) / 180),
    resampleSpacing: options.resampleSpacingRatio * unitsPerEm,
    medialMethod: options.medialMethod,
    // Older serialized option sets predate the ink-graph knobs.
    extraction: options.extraction ?? 'partition',
    inkSampleSpacing: (options.inkSampleRatio ?? DEFAULT_GEOMETRY_OPTIONS.inkSampleRatio) * unitsPerEm,
    inkSpurTolerance: options.inkSpurTolerance ?? DEFAULT_GEOMETRY_OPTIONS.inkSpurTolerance,
    inkJunctionReach: options.inkJunctionReach ?? DEFAULT_GEOMETRY_OPTIONS.inkJunctionReach,
  };
}

/** Full result of the geometry pipeline for one glyph (all intermediates kept for visualization). */
export interface GeometryPipelineResult {
  char: string;
  unicode: number;
  advanceWidth: number;
  boundingBox: BBox;
  pathString: string;
  ascender: number;
  descender: number;

  pathBBox: BBox;
  contours: Contour[];
  corners: Corner[];
  cuts: Cut[];
  faces: Face[];
  segments: SegmentInfo[];
  junctions: JunctionInfo[];
  geoStrokes: GeoStroke[];
  /** Final ordered + timed strokes in font units (same shape as the raster pipeline output). */
  strokesFontUnits: (Stroke & { animationDuration: number; delay: number; length: number })[];
  /** Non-fatal issues encountered (e.g. overlapping contours). */
  warnings: string[];
  /**
   * Dataset stroke-order reference registered onto this glyph. The pipeline
   * registers it when a raw reference rides on the input (providers are
   * async, so fetching happens before the synchronous pipeline runs). Feeds
   * the 'reference' visualization stage and dataset-driven ordering.
   */
  reference?: RegisteredReference;
  /** Whether the final draw order/direction came from the dataset or the heuristics. */
  strokeOrderSource: 'dataset' | 'heuristic';
  /**
   * True when the strokes themselves were re-grouped (split at reference
   * seams / chained along one reference stroke) to match the dataset's
   * segmentation — see geometry/regroup.ts. Only ever set alongside
   * `strokeOrderSource: 'dataset'`.
   */
  strokeOrderRegrouped?: boolean;
}
