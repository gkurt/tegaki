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
import { mergeSegmentFaces } from './face-merge.ts';
import { straightSkeletonFaceAxes } from './face-straight-skeleton.ts';
import { extendUnpairedEnds, routeJunctionPaths } from './junction-routing.ts';
import { clampWidthsToBoundary, computeSegmentAxes } from './medial.ts';
import { orderAndTimeStrokes } from './ordering.ts';
import { classifyFaces, partitionFaces } from './partition.ts';
import { partitionRegions } from './regions.ts';
import { assembleStrokes, buildJunctions, type JunctionNode, matchContinuations, simplifyStroke } from './strokes.ts';
import {
  DEFAULT_GEOMETRY_OPTIONS,
  type Face,
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

  // cut → faces bordering it.
  const cutToFaces = new Map<number, number[]>();
  for (const face of faces) {
    for (const c of face.cutIds) {
      const list = cutToFaces.get(c) ?? [];
      list.push(face.id);
      cutToFaces.set(c, list);
    }
  }
  // Cuts opening into a junction face: segment ends there enter competitive
  // continuation pairing, which reads end tangents.
  const kindById = new Map(faces.map((f) => [f.id, f.kind]));
  const junctionCuts = new Set<number>();
  for (const [cutId, faceIds] of cutToFaces) {
    if (faceIds.some((id) => kindById.get(id) === 'junction')) junctionCuts.add(cutId);
  }

  const segments: SegmentInfo[] = [];
  const faceToSegment = new Map<number, number>();

  // Straight-skeleton method: merge chains of segment faces connected by
  // bare cuts and skeletonize the stroke's REAL shape. A bare cut always
  // becomes a degree-2 merge in assembly anyway, but per-face processing
  // stitches axes at those mouths — the one place the exact skeleton still
  // picked up artifacts (off-center wall-cut bisector vertices, port-tangent
  // wiggle). Merged faces keep only their junction cuts as ports; the
  // internal bare cuts stop existing, so no bare-cut node is built for them.
  // Any group the merge or the skeleton can't handle (loop chains closing
  // into an annulus, wasm rejection) falls back to per-face processing.
  const mergedFaceIds = new Set<number>();
  const mergedCuts = new Set<number>();
  if (resolved.medialMethod === 'straight-skeleton') {
    const segFaces = faces.filter((f) => f.kind === 'segment');
    const segIndexById = new Map(segFaces.map((f, i) => [f.id, i]));
    const segDsu = new DSU(segFaces.length);
    const bareCuts: [number, number[]][] = [];
    for (const [cutId, faceIds] of cutToFaces) {
      if (junctionCuts.has(cutId)) continue;
      const members = [...new Set(faceIds)].filter((id) => segIndexById.has(id));
      if (members.length < 2) continue;
      bareCuts.push([cutId, members]);
      for (let i = 1; i < members.length; i++) segDsu.union(segIndexById.get(members[0]!)!, segIndexById.get(members[i]!)!);
    }
    const groups = new Map<number, Face[]>();
    for (const face of segFaces) {
      const root = segDsu.find(segIndexById.get(face.id)!);
      const list = groups.get(root) ?? [];
      list.push(face);
      groups.set(root, list);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const merged = mergeSegmentFaces(group);
      if (!merged) continue;
      // Accept ONLY a genuine straight-skeleton result. computeSegmentAxes
      // would silently fall back to CHAIN on the merged face, and chain on a
      // big merged ribbon resurrects exactly the failures the per-face path
      // already solved (る's hairpin tip truncates without its full-boundary
      // rescue) — per-face processing is the honest fallback.
      const infos = straightSkeletonFaceAxes(merged, resolved);
      if (!infos || infos.length === 0 || infos[0]!.axis.length < 2) continue;
      for (const info of infos) clampWidthsToBoundary(info.axis, merged);
      const primary = infos[0]!;
      if (primary.ends.length === 2) {
        primary.ends[0]!.width = primary.axis[0]!.width;
        primary.ends[1]!.width = primary.axis[primary.axis.length - 1]!.width;
      }
      const groupIds = new Set(group.map((f) => f.id));
      for (const id of groupIds) {
        mergedFaceIds.add(id);
        faceToSegment.set(id, segments.length);
      }
      for (const [cutId, members] of bareCuts) {
        if (members.every((id) => groupIds.has(id))) mergedCuts.add(cutId);
      }
      segments.push(...infos);
    }
  }

  for (const face of faces) {
    if (face.kind !== 'segment' || mergedFaceIds.has(face.id)) continue;
    // One face can yield several axes: the primary path plus a branch per
    // leftover cap (r's arm + bottom leg share one face). Drops must never
    // be silent — every face is a legitimate part of the glyph.
    // Full-boundary medial rescue is only safe when every end lands on a
    // bare cut (degree-2 merge, tangent-independent) — see computeSegmentAxes.
    const fullBoundaryRescue = face.cutIds.every((c) => !junctionCuts.has(c));
    const infos = computeSegmentAxes(face, resolved, { fullBoundaryRescue });
    if (infos.length === 0 || infos[0]!.axis.length < 2) {
      warnings.push(`segment face ${face.id} produced no axis — area dropped`);
      continue;
    }
    faceToSegment.set(face.id, segments.length);
    segments.push(...infos);
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

  // Bare cuts: a cut separating two segment faces directly (no junction
  // face). Cuts internal to a merged face no longer exist as boundaries —
  // the merged segment simply flows through them.
  for (const [cutId, faceIds] of cutToFaces) {
    if (cutInJunctionNode.has(cutId) || mergedCuts.has(cutId)) continue;
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
  routeJunctionPaths(junctions, segments, faceById, resolved);
  const unswept = extendUnpairedEnds(junctions, segments, faceById, resolved);
  // Orphan-face rescue: a node face no route or extension sweeps happens when
  // every incident end is paired but the routes bypass it (わ's corridor
  // between two crossings). Its cut runs are ports like any segment face —
  // give it its own axis and emit it as a standalone stroke rather than
  // dropping the ink.
  for (const face of unswept) {
    const infos = computeSegmentAxes(face, resolved);
    if (infos.length === 0 || infos[0]!.axis.length < 2) {
      warnings.push(`junction face ${face.id} swept by no route or extension — area dropped`);
      continue;
    }
    warnings.push(`junction face ${face.id} unreached by routes — emitted as standalone stroke`);
    segments.push(...infos);
  }
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
