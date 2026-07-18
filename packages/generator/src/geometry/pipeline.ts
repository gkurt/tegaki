// Geometry pipeline orchestrator.
//
// Runs the full geometry-based stroke extraction for one glyph and returns all
// intermediates so the Studio can visualize each stage:
//
//   flatten → contours → corners → cuts → planar partition (faces) →
//   classify → per-segment medial axes → junction nodes → continuation
//   matching → stroke assembly → order + timing.

import type { BBox } from 'tegaki';
import { DRAWING_SPEED, STROKE_PAUSE } from '../constants.ts';
import type { RawGlyphData } from '../font/parse.ts';
import { computePathBBox, flattenPath } from '../processing/bezier.ts';
import { buildContours, findContourOverlaps } from './contours.ts';
import { detectCorners } from './corners.ts';
import { generateCuts } from './cuts.ts';
import { computeSegmentAxis } from './medial.ts';
import { orderAndTimeStrokes } from './ordering.ts';
import { classifyFaces, partitionFaces } from './partition.ts';
import { partitionRegions } from './regions.ts';
import { assembleStrokes, buildJunctions, type JunctionNode, matchContinuations, simplifyStroke } from './strokes.ts';
import {
  DEFAULT_GEOMETRY_OPTIONS,
  type GeometryOptions,
  type GeometryPipelineResult,
  resolveGeometryOptions,
  type SegmentInfo,
} from './types.ts';

export interface GeometryPipelineInput {
  char: string;
  unicode: number;
  advanceWidth: number;
  boundingBox: BBox;
  pathString: string;
  ascender: number;
  descender: number;
  unitsPerEm: number;
  rtl?: boolean;
}

/** Union-find helper for grouping adjacent junction faces. */
class DSU {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b);
  }
}

/** Per-region intermediates (region-local cut / face / segment indices). */
interface RegionResult {
  cuts: GeometryPipelineResult['cuts'];
  faces: GeometryPipelineResult['faces'];
  segments: SegmentInfo[];
  junctions: GeometryPipelineResult['junctions'];
  corners: GeometryPipelineResult['corners'];
  geoStrokes: GeometryPipelineResult['geoStrokes'];
  warnings: string[];
}

/** Run corners → cuts → partition → medial → junctions → assembly for one region. */
function processRegion(
  contours: GeometryPipelineResult['contours'],
  resolved: ReturnType<typeof resolveGeometryOptions>,
  weldEps: number,
  simplifyEps: number,
): RegionResult {
  const warnings: string[] = [];

  const corners = detectCorners(contours, resolved);
  const cuts = generateCuts(contours, corners, resolved);

  const { faces, warnings: partWarnings } = partitionFaces(contours, cuts, weldEps);
  warnings.push(...partWarnings);
  classifyFaces(faces);

  const segments: SegmentInfo[] = [];
  const faceToSegment = new Map<number, number>();
  for (const face of faces) {
    if (face.kind !== 'segment') continue;
    const info = computeSegmentAxis(face, resolved);
    if (!info || info.axis.length < 2) continue;
    faceToSegment.set(face.id, segments.length);
    segments.push(info);
  }

  // cut → faces bordering it.
  const cutToFaces = new Map<number, number[]>();
  for (const face of faces) {
    for (const c of face.cutIds) {
      const list = cutToFaces.get(c) ?? [];
      list.push(face.id);
      cutToFaces.set(c, list);
    }
  }

  const junctionFaces = faces.filter((f) => f.kind === 'junction');
  const faceIndexById = new Map<number, number>();
  junctionFaces.forEach((f, i) => {
    faceIndexById.set(f.id, i);
  });

  // Group adjacent junction faces (share a cut) into merged components.
  const dsu = new DSU(junctionFaces.length);
  for (const [, faceIds] of cutToFaces) {
    const jIdx = faceIds.filter((id) => faceIndexById.has(id)).map((id) => faceIndexById.get(id)!);
    for (let i = 1; i < jIdx.length; i++) dsu.union(jIdx[0]!, jIdx[i]!);
  }
  const componentFaces = new Map<number, number[]>();
  junctionFaces.forEach((f, i) => {
    const root = dsu.find(i);
    const list = componentFaces.get(root) ?? [];
    list.push(f.id);
    componentFaces.set(root, list);
  });

  const faceById = new Map(faces.map((f) => [f.id, f]));
  const nodes: JunctionNode[] = [];
  const cutInJunctionNode = new Set<number>();
  for (const faceIds of componentFaces.values()) {
    const cutIds = new Set<number>();
    let cx = 0;
    let cy = 0;
    let count = 0;
    for (const id of faceIds) {
      const face = faceById.get(id)!;
      for (const c of face.cutIds) cutIds.add(c);
      cx += face.centroid.x;
      cy += face.centroid.y;
      count++;
    }
    for (const c of cutIds) cutInJunctionNode.add(c);
    nodes.push({ faceIds, cutIds: [...cutIds], center: { x: cx / count, y: cy / count } });
  }

  // Bare cuts: a cut separating two segment faces directly (no junction face).
  for (const [cutId, faceIds] of cutToFaces) {
    if (cutInJunctionNode.has(cutId)) continue;
    const segFaces = faceIds.filter((id) => faceToSegment.has(id));
    if (segFaces.length < 2) continue;
    const cut = cuts[cutId]!;
    nodes.push({
      faceIds: [],
      cutIds: [cutId],
      center: { x: (cut.a.point.x + cut.b.point.x) / 2, y: (cut.a.point.y + cut.b.point.y) / 2 },
    });
  }

  const junctions = buildJunctions(segments, nodes);
  for (const junction of junctions) matchContinuations(junction, segments, resolved);
  const geoStrokes = assembleStrokes(segments, junctions);
  for (const gs of geoStrokes) gs.points = simplifyStroke(gs.points, simplifyEps);

  return { cuts, faces, segments, junctions, corners, geoStrokes, warnings };
}

export function runGeometryPipeline(
  input: GeometryPipelineInput,
  rawGlyph: Pick<RawGlyphData, 'commands'>,
  geometryOptions: GeometryOptions = DEFAULT_GEOMETRY_OPTIONS,
  bezierTolerance?: number,
): GeometryPipelineResult {
  const warnings: string[] = [];
  const resolved = resolveGeometryOptions(geometryOptions, input.unitsPerEm);
  const weldEps = input.unitsPerEm * 0.0015;
  const simplifyEps = input.unitsPerEm * 0.004;

  // Stage 1: flatten outline → contours → independent regions.
  const subPaths = flattenPath(rawGlyph.commands, bezierTolerance);
  const pathBBox = computePathBBox(subPaths);
  const contours = buildContours(subPaths);
  const overlaps = findContourOverlaps(contours);
  if (overlaps.length > 0) {
    warnings.push(`${overlaps.length} contour overlap(s) — processed as independent stroke regions`);
  }
  const regions = partitionRegions(contours, overlaps);

  // Stages 2–6 per region, merged with index offsets so cuts / faces /
  // segments stay globally unique across regions.
  const allContours: GeometryPipelineResult['contours'] = [];
  const corners: GeometryPipelineResult['corners'] = [];
  const cuts: GeometryPipelineResult['cuts'] = [];
  const faces: GeometryPipelineResult['faces'] = [];
  const segments: SegmentInfo[] = [];
  const junctions: GeometryPipelineResult['junctions'] = [];
  const geoStrokes: GeometryPipelineResult['geoStrokes'] = [];

  for (const region of regions) {
    const cutOffset = cuts.length;
    const faceOffset = faces.length;
    const segOffset = segments.length;
    allContours.push(...region);

    const r = processRegion(region, resolved, weldEps, simplifyEps);
    warnings.push(...r.warnings);
    corners.push(...r.corners);

    for (const cut of r.cuts) cuts.push(cut);
    for (const face of r.faces) {
      faces.push({
        ...face,
        id: face.id + faceOffset,
        cutIds: face.cutIds.map((c) => c + cutOffset),
        edgeCutIds: face.edgeCutIds.map((c) => (c >= 0 ? c + cutOffset : -1)),
      });
    }
    for (const seg of r.segments) {
      segments.push({ ...seg, faceId: seg.faceId + faceOffset });
    }
    for (const junction of r.junctions) {
      junctions.push({
        ...junction,
        faceIds: junction.faceIds.map((f) => f + faceOffset),
        incident: junction.incident.map((inc) => ({ ...inc, segmentIndex: inc.segmentIndex + segOffset })),
      });
    }
    for (const gs of r.geoStrokes) {
      geoStrokes.push({ ...gs, segmentIndices: gs.segmentIndices.map((s) => s + segOffset) });
    }
  }

  // Stage 7: order + timing across all regions at once.
  const strokesFontUnits = orderAndTimeStrokes(geoStrokes, {
    drawingSpeed: DRAWING_SPEED,
    strokePause: STROKE_PAUSE,
    rtl: input.rtl ?? false,
    yTolerance: input.unitsPerEm * 0.02,
  });

  return {
    char: input.char,
    unicode: input.unicode,
    advanceWidth: input.advanceWidth,
    boundingBox: input.boundingBox,
    pathString: input.pathString,
    ascender: input.ascender,
    descender: input.descender,
    pathBBox,
    contours: allContours,
    corners,
    cuts,
    faces,
    segments,
    junctions,
    geoStrokes,
    strokesFontUnits,
    warnings,
  };
}
