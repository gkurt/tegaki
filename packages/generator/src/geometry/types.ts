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

import type { BBox, Point, Stroke } from 'tegaki';

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
  /** 2-cut faces are junctions when cut-midpoint distance ≤ this × max cut length. */
  junctionCompactness: number;
  /** Max bend (degrees) for two segments to merge into one stroke across a junction. */
  continuationMaxBendDeg: number;
  /** Medial-axis sample spacing as a fraction of unitsPerEm. */
  resampleSpacingRatio: number;
}

export const DEFAULT_GEOMETRY_OPTIONS: GeometryOptions = {
  cornerAngleThresholdDeg: 45,
  cornerWindowRatio: 0.025,
  cutAlignToleranceDeg: 40,
  maxCutLengthFactor: 3,
  junctionCompactness: 1.5,
  continuationMaxBendDeg: 60,
  resampleSpacingRatio: 0.02,
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
}
