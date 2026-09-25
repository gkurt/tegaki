// Geometry pipeline orchestrator.
//
// Runs the full geometry-based stroke extraction for one glyph and returns all
// intermediates so the Studio can visualize each stage:
//
//   flatten → contours → corners → cuts → planar partition (faces) →
//   classify → per-segment medial axes → junction nodes → continuation
//   matching → stroke assembly → order + timing.

import type { BBox, Point } from 'tegaki';
import { DRAWING_SPEED, STROKE_PAUSE } from '../constants.ts';
import type { RawGlyphData } from '../font/parse.ts';
import { computePathBBox, flattenPath } from '../processing/bezier.ts';
import { matchStrokes, type StrokeMatchResult } from '../stroke-order/match.ts';
import { registerReference } from '../stroke-order/register.ts';
import type { ReferenceGlyph } from '../stroke-order/types.ts';
import { buildContours, findContourOverlaps } from './contours.ts';
import { detectCorners } from './corners.ts';
import { generateCuts } from './cuts.ts';
import { type InkDisk, polylineInkDisks } from './face-medial.ts';
import { mergeSegmentFaces } from './face-merge.ts';
import { straightSkeletonFaceAxes, straightSkeletonStrokeAxis } from './face-straight-skeleton.ts';
import { extractInkRegion, regionScale, simplifyKeepingNibs } from './ink/extract.ts';
import { carryNibs } from './ink/nib.ts';
import { SegmentIndex } from './ink/spatial.ts';
import { extendUnpairedEnds, routeJunctionPaths } from './junction-routing.ts';
import { clampWidthsToBoundary, computeSegmentAxes } from './medial.ts';
import { type OrderPlan, orderAndTimeStrokes } from './ordering.ts';
import { classifyFaces, dissolvePartitionDebris, partitionFaces } from './partition.ts';
import { dist, pointInPolygon, sub } from './primitives.ts';
import { partitionRegions, splitComponents } from './regions.ts';
import { LIFT_RANK_PENALTY, PRUNE_COST_WEIGHT, regroupStrokesByReference } from './regroup.ts';
import { assembleStrokes, buildJunctions, type JunctionNode, matchContinuations, simplifyStroke, type TrialJoinScorer } from './strokes.ts';
import { trialJoinAlignment } from './trial-join.ts';
import {
  type Contour,
  DEFAULT_GEOMETRY_OPTIONS,
  type Face,
  type GeometryOptions,
  type GeometryPipelineResult,
  type GeoStroke,
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
  /** Draw a headline after the letter it caps (see `isHeadlineScriptChar`); heuristic order only. */
  headlineLast?: boolean;
  /**
   * Stroke-order reference for this character (raw dataset frame), fetched by
   * the caller — providers are async, the pipeline is not. The pipeline
   * registers it onto the glyph ink and, per `GeometryOptions.strokeOrder`,
   * lets it decide draw order and pen direction. An array supplies VARIANTS
   * of the same character from different datasets (KanjiVG's print-style
   * Latin vs Hershey's cursive) — each is evaluated against the extracted
   * ink and the best-matching one is adopted.
   */
  reference?: ReferenceGlyph | ReferenceGlyph[];
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

/**
 * Rebuild each junction-touching stroke's axis from the straight skeleton of
 * its fully merged region: the member faces of its segments plus the faces of
 * every junction it is incident to. Junction faces are SHARED territory —
 * each crossing stroke merges them into its own region and re-skeletonizes;
 * limbs whose ink the other strokes already sweep are suppressed inside
 * `straightSkeletonStrokeAxis`. Stroke identity (count, grouping, endpoints)
 * is fixed by assembly; only the geometry between the endpoints improves.
 * Any failure (loop chains, holed junction faces, wasm rejection, anchor
 * mismatch) keeps the assembled axis.
 */
function refineStrokesThroughJunctions(
  geoStrokes: GeometryPipelineResult['geoStrokes'],
  junctions: GeometryPipelineResult['junctions'],
  segmentMemberFaces: Map<number, number[]>,
  faceById: Map<number, Face>,
  resolved: ReturnType<typeof resolveGeometryOptions>,
): void {
  // Suppression refs come from the ORIGINAL assembled axes — symmetric and
  // order-independent, unlike comparing against already-refined neighbours.
  const originals = geoStrokes.map((gs) => gs.points);
  const strokeOfSegment = new Map<number, number>();
  geoStrokes.forEach((gs, k) => {
    for (const si of gs.segmentIndices) strokeOfSegment.set(si, k);
  });

  geoStrokes.forEach((gs, k) => {
    if (gs.isLoop || gs.points.length < 2) return;
    const faceIds = new Set<number>();
    for (const si of gs.segmentIndices) for (const fid of segmentMemberFaces.get(si) ?? []) faceIds.add(fid);
    let touchesJunction = false;
    for (const junction of junctions) {
      if (junction.faceIds.length === 0) continue; // bare-cut node — no area of its own
      if (!junction.incident.some((inc) => strokeOfSegment.get(inc.segmentIndex) === k)) continue;
      touchesJunction = true;
      for (const fid of junction.faceIds) faceIds.add(fid);
    }
    if (!touchesJunction || faceIds.size < 2) return;
    const merged = mergeSegmentFaces([...faceIds].map((id) => faceById.get(id)!));
    if (!merged) return;
    // Other strokes' pen sweep as disks, densified along each segment so
    // coverage does not depend on vertex spacing — see polylineInkDisks.
    const otherInk: InkDisk[] = [];
    originals.forEach((pts, o) => {
      if (o === k) return;
      otherInk.push(...polylineInkDisks(pts, resolved.resampleSpacing / 2));
    });
    const axis = straightSkeletonStrokeAxis(merged, resolved, gs.points[0]!, gs.points[gs.points.length - 1]!, otherInk);
    if (axis) gs.points = axis;
  });
}

/**
 * Straighten each stroke's passage through junction kernels: project runs of
 * axis points lying INSIDE a junction face onto the run's entry→exit chord.
 * The straight skeleton of two strokes crossing at a shallow angle has no
 * straight-through edge — a path across the kernel must jog along the
 * kernel's bisector diagonals (Caveat &'s crossings read as zig-zags). The
 * pen truth is straight: kernel ink is shared, so deviating from the
 * skeleton there loses nothing. Guard: every projected point must stay
 * within half its own width of where it was — a genuinely CURVED corridor
 * junction (R's bowl band, 家's hook) fails immediately and keeps its curve.
 * Positions move; widths stay (the fused-mass width through a kernel is
 * real ink — the width-aware simplify preserves it downstream).
 */
function straightenJunctionRuns(geoStrokes: GeometryPipelineResult['geoStrokes'], faces: Face[]): void {
  const kernels = faces.filter((f) => f.kind === 'junction');
  if (kernels.length === 0) return;
  for (const gs of geoStrokes) {
    const pts = gs.points;
    for (const kernel of kernels) {
      let i = 1;
      while (i < pts.length - 1) {
        if (!pointInPolygon(pts[i]!, kernel.polygon)) {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < pts.length - 1 && pointInPolygon(pts[j + 1]!, kernel.polygon)) j++;
        // Interior run pts[i..j]; anchors A/B are the neighbours outside.
        const a = pts[i - 1]!;
        const b = pts[j + 1]!;
        const ab = sub(b, a);
        const abLen2 = ab.x * ab.x + ab.y * ab.y;
        if (abLen2 > 1e-12) {
          const projected: { x: number; y: number }[] = [];
          let ok = true;
          for (let k = i; k <= j; k++) {
            const p = pts[k]!;
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / abLen2));
            const q = { x: a.x + ab.x * t, y: a.y + ab.y * t };
            if (dist(p, q) > p.width / 2) {
              ok = false;
              break;
            }
            projected.push(q);
          }
          if (ok) {
            for (let k = i; k <= j; k++) {
              pts[k]!.x = projected[k - i]!.x;
              pts[k]!.y = projected[k - i]!.y;
            }
          }
        }
        i = j + 1;
      }
    }
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
  debrisAreaFloor: number,
): RegionResult {
  const warnings: string[] = [];

  const corners = detectCorners(contours, resolved);
  const cuts = generateCuts(contours, corners, resolved);

  const { faces: rawFaces, warnings: partWarnings } = partitionFaces(contours, cuts, weldEps);
  warnings.push(...partWarnings);
  const { faces, warnings: debrisWarnings } = dissolvePartitionDebris(rawFaces, debrisAreaFloor);
  warnings.push(...debrisWarnings);
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
  // Which faces each segment's axis came from (merged chains span several) —
  // the final-stroke refinement below rebuilds a stroke's skeleton from the
  // union of its segments' faces plus its junction faces.
  const segmentMemberFaces = new Map<number, number[]>();

  // Straight-skeleton method: merge chains of segment faces connected by
  // bare cuts and skeletonize the stroke's REAL shape. A bare cut always
  // becomes a degree-2 merge in assembly anyway, but per-face processing
  // stitches axes at those mouths — the one place the exact skeleton still
  // picked up artifacts (off-center wall-cut bisector vertices, port-tangent
  // wiggle). Merged faces keep only their junction cuts as ports; the
  // internal bare cuts stop existing, so no bare-cut node is built for them.
  // Loop chains close into an annulus — a merged face WITH holes — whose
  // cycle spine the loop walk in straightSkeletonFaceAxes extracts as one
  // closed (or tail-exiting) stroke. Any group the merge or the skeleton
  // can't handle (pinched unions, wasm rejection, holed faces that still
  // carry junction ports) falls back to per-face processing.
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
      for (let k = 0; k < infos.length; k++) segmentMemberFaces.set(segments.length + k, [...groupIds]);
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
    for (let k = 0; k < infos.length; k++) segmentMemberFaces.set(segments.length + k, [face.id]);
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
  // Conflicting continuation candidates are additionally judged on the MERGED
  // shape: pretend the join happened (segments' member faces + junction
  // faces), straight-skeletonize the union, and VETO joins whose spine turns
  // back on itself (see trial-join.ts and the reversal-veto note in
  // matchContinuations). Exact-skeleton method only — the trial needs the
  // same wasm build the axes use.
  const trialJoin: TrialJoinScorer | undefined =
    resolved.medialMethod === 'straight-skeleton'
      ? (a, b, junction) => trialJoinAlignment(segments, a, b, junction, faceById, segmentMemberFaces, resolved)
      : undefined;
  for (const junction of junctions) matchContinuations(junction, segments, resolved, trialJoin);
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
    for (let k = 0; k < infos.length; k++) segmentMemberFaces.set(segments.length + k, [face.id]);
    segments.push(...infos);
  }
  const geoStrokes = assembleStrokes(segments, junctions);
  // Final-stroke refinement: rebuild each junction-touching stroke's axis
  // from the straight skeleton of its FULLY merged region (segment faces +
  // junction faces), so the pen gets one coherent centerline instead of
  // per-face axes stitched to junction routes at the kernel mouths (a T's
  // bar jogged across the kernel, its stem started with a Z-kink).
  if (resolved.medialMethod === 'straight-skeleton') {
    refineStrokesThroughJunctions(geoStrokes, junctions, segmentMemberFaces, faceById, resolved);
  }
  straightenJunctionRuns(geoStrokes, faces);
  for (const gs of geoStrokes) gs.points = simplifyStroke(gs.points, simplifyEps);

  return { cuts, faces, segments, junctions, corners, geoStrokes, warnings };
}

/**
 * Scripts whose stroke order is standardized, so a font's glyphs follow the
 * reference dataset rather than the other way round (KanjiVG's coverage).
 */
const CANONICAL_STROKE_ORDER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function hasCanonicalStrokeOrder(char: string): boolean {
  return CANONICAL_STROKE_ORDER.test(char);
}

/**
 * A region's ink as the pieces to extract, each at its resolution (see
 * `regionScale`): the letter-sized components together at the default step,
 * and each component too small for it (a dot, a comma, an accent) on its own
 * at a finer one.
 */
function inkPieces(region: Contour[], step: number): { contours: Contour[]; scale: number }[] {
  const pieces: { contours: Contour[]; scale: number }[] = [];
  const letterSized: Contour[] = [];
  for (const component of splitComponents(region)) {
    const scale = regionScale(component, step);
    if (scale < 1) pieces.push({ contours: component, scale });
    else letterSized.push(...component);
  }
  if (letterSized.length > 0) pieces.unshift({ contours: letterSized, scale: 1 });
  return pieces;
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
  // Cut-less faces below this area (1% of the em, squared) are partition
  // debris, not ink — see dissolvePartitionDebris. Real cut-less micro-ink
  // (island dots) sits orders of magnitude above it.
  const debrisAreaFloor = (input.unitsPerEm * 0.01) ** 2;

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

  if (resolved.extraction === 'ink-graph') {
    // The coverage audit, summed over the pieces: a dot's sliver is a share
    // of the glyph's ink, not of the dot's.
    let uncoveredArea = 0;
    let totalArea = 0;
    for (const region of regions) {
      allContours.push(...region);
      for (const { contours: piece, scale } of inkPieces(region, resolved.inkSampleSpacing)) {
        const r = extractInkRegion(
          piece,
          {
            sampleSpacing: resolved.inkSampleSpacing * scale,
            spurTolerance: resolved.inkSpurTolerance,
            junctionReach: resolved.inkJunctionReach,
            continuationMinCos: resolved.continuationMinCos,
            simplifyEpsilon: simplifyEps * scale,
            absorbSerifs: resolved.inkSerifs,
          },
          faces.length,
        );
        warnings.push(...r.warnings);
        uncoveredArea += r.uncoveredArea;
        totalArea += r.totalArea;
        faces.push(...r.faces);
        const segOffset = segments.length;
        segments.push(...r.segments);
        for (const gs of r.strokes) geoStrokes.push({ ...gs, segmentIndices: gs.segmentIndices.map((s) => s + segOffset) });
      }
    }
    if (totalArea > 0 && uncoveredArea / totalArea > 0.005) {
      warnings.push(`ink graph: ${((100 * uncoveredArea) / totalArea).toFixed(1)}% of the ink is not painted by any stroke`);
    }
  }

  for (const region of resolved.extraction === 'ink-graph' ? [] : regions) {
    const cutOffset = cuts.length;
    const faceOffset = faces.length;
    const segOffset = segments.length;
    allContours.push(...region);

    const r = processRegion(region, resolved, weldEps, simplifyEps, debrisAreaFloor);
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

  // Stage 7: order + timing across all regions at once. When a stroke-order
  // reference is present (and not disabled), a clean match REPLACES the
  // heuristic order/orientation. When the match is UNCLEAN, the reference can
  // still guide a re-grouping of the same ink (split at reference seams,
  // chain along one reference stroke — see regroup.ts), adopted only when the
  // re-grouped strokes re-match clean; anything else degrades per mode so
  // dataset ordering is never worse than the heuristic baseline.
  let reference: GeometryPipelineResult['reference'];
  let plan: OrderPlan | undefined;
  let strokeOrderSource: GeometryPipelineResult['strokeOrderSource'] = 'heuristic';
  let strokeOrderRegrouped = false;
  let outStrokes = geoStrokes;
  const referenceVariants = input.reference ? (Array.isArray(input.reference) ? input.reference : [input.reference]) : [];
  if (referenceVariants.length > 0) {
    reference = registerReference(referenceVariants[0]!, pathBBox);
    if (geometryOptions.strokeOrder !== 'heuristic' && geoStrokes.length > 0) {
      const glyphDiag = Math.hypot(pathBBox.x2 - pathBBox.x1, pathBBox.y2 - pathBBox.y1);
      // Matched pairs (0.01–0.06 measured on Klee One) sit far below
      // wrong-stroke assignments (≥ ~0.15); between them a generous margin.
      const AUTO_MAX_MEAN_COST = 0.15;
      const isClean = (m: StrokeMatchResult) => m.extractedCount === m.referenceCount && m.meanCost <= AUTO_MAX_MEAN_COST;
      // Regrouped strokes are resampled, so they are simplified again — by
      // the rule that built them. Partition strokes take simplifyStroke;
      // ink-graph strokes take the extraction's width- and spill-aware RDP,
      // because simplifyStroke's covered-jog prune treats a wide pen's gentle
      // curvature as a jog and flattens it (Caveat d's bowl drew as a polygon
      // that stopped short of the stem).
      let outlineIndex: SegmentIndex | undefined;
      const simplifyRegrouped = (points: GeoStroke['points']) => {
        if (resolved.extraction !== 'ink-graph') return simplifyStroke(points, simplifyEps);
        if (points.length <= 2) return points;
        outlineIndex ??= new SegmentIndex(
          allContours.flatMap((c) => c.points.map((p, i): [Point, Point] => [p, c.points[(i + 1) % c.points.length]!])),
          resolved.inkSampleSpacing * 4,
        );
        const index = outlineIndex;
        return simplifyKeepingNibs(points, simplifyEps, (p) => index.nearest(p));
      };
      const totalInk = geoStrokes.reduce(
        (sum, g) => sum + g.points.reduce((len, p, i) => (i > 0 ? len + dist(g.points[i - 1]!, p) : len), 0),
        0,
      );
      // Evaluate every reference variant independently — register, match,
      // and (when unclean) attempt a re-grouping — then adopt whichever
      // fits the extracted ink best: clean beats unclean, then count
      // agreement, then mean cost. Variants let handwriting STYLES coexist:
      // KanjiVG's print-style m (three strokes) loses to Hershey's cursive
      // m (one trajectory) on a cursive font, and the reverse on a print
      // font. Only the winner's warnings surface.
      const evals = referenceVariants.map((variant) => {
        const registered = registerReference(variant, pathBBox);
        const refPolylines = registered.strokes.map((s) => s.points);
        let match = matchStrokes(
          geoStrokes.map((g) => g.points),
          refPolylines,
          glyphDiag,
        );
        let clean = isClean(match);
        let variantStrokes = geoStrokes;
        let regrouped = false;
        let rankCost = match.meanCost;
        const variantWarnings: string[] = [];
        if (!clean) {
          const proposal = regroupStrokesByReference(geoStrokes, refPolylines, {
            spacing: resolved.resampleSpacing,
            minRunLength: resolved.resampleSpacing * 3,
            glyphDiag,
            maxMeanCost: AUTO_MAX_MEAN_COST,
          });
          if (proposal) {
            const candidate = carryNibs(
              geoStrokes,
              proposal.strokes.map((gs) => ({ ...gs, points: simplifyRegrouped(gs.points) })),
            );
            // Lifted extras sit at the END of the proposal and have no
            // reference stroke by design — only the chains face the match;
            // the plan appends unmatched strokes after the prescribed order.
            const chains = candidate.slice(0, candidate.length - proposal.extras);
            const rematch = matchStrokes(
              chains.map((g) => g.points),
              refPolylines,
              glyphDiag,
            );
            // Pruned ink and lifted extras count against the proposal,
            // mirroring the regroup portfolio's own gate — a proposal must
            // not clear it by deleting or shedding the ink that didn't match.
            const rematchCost =
              rematch.meanCost +
              (totalInk > 0 ? PRUNE_COST_WEIGHT * (proposal.pruned / totalInk) : 0) +
              (proposal.extras > 0 ? LIFT_RANK_PENALTY : 0);
            // Retraces exist to MERGE: several extracted pieces joined into
            // one reference stroke that walks a fused corridor twice (れ, a
            // cursive P's stem). A proposal that ends with MORE strokes than
            // were extracted and still needs retraces is cutting the font's
            // own trajectory. Where stroke order is canonical (kanji, kana:
            // 月, 町, 曜 all split this way) the font follows the reference
            // and the cut recovers its strokes; elsewhere the reference is one
            // style among several, and the cut lands where the font's pen
            // never lifted — Caveat's one-stroke W re-cut into KanjiVG's four
            // print strokes, its last stroke left with just the tip; A's leg
            // cut at the crossbar.
            const retracedSplit = chains.length > geoStrokes.length && proposal.retraces > 0 && !hasCanonicalStrokeOrder(input.char);
            if (retracedSplit) {
              variantWarnings.push(
                `stroke order: dataset re-grouping rejected (${geoStrokes.length} extracted strokes split into ${chains.length} by retracing)`,
              );
            } else if (rematch.extractedCount === rematch.referenceCount && rematchCost <= AUTO_MAX_MEAN_COST) {
              variantWarnings.push(
                `stroke order: re-grouped ${geoStrokes.length} extracted strokes into ${chains.length} matching the dataset (${proposal.splits} split, ${proposal.merges} merged${proposal.retraces > 0 ? `, ${proposal.retraces} retraced` : ''}${proposal.pruned > 0 ? `, ${Math.round(proposal.pruned)} units of duplicated ink pruned` : ''}${proposal.extras > 0 ? `; ${proposal.extras} leftover stroke${proposal.extras === 1 ? '' : 's'} appended after the dataset order` : ''})`,
              );
              variantStrokes = candidate;
              match = rematch;
              clean = true;
              regrouped = true;
              rankCost = rematchCost;
            } else {
              variantWarnings.push(
                `stroke order: dataset re-grouping rejected (${rematch.extractedCount} strokes vs ${rematch.referenceCount} reference, cost ${rematch.meanCost.toFixed(3)})`,
              );
            }
          }
        }
        return { registered, match, clean, strokes: variantStrokes, regrouped, rankCost, warnings: variantWarnings };
      });
      evals.sort(
        (a, b) =>
          Number(b.clean) - Number(a.clean) ||
          Number(b.match.extractedCount === b.match.referenceCount) - Number(a.match.extractedCount === a.match.referenceCount) ||
          a.rankCost - b.rankCost,
      );
      const bestEval = evals[0]!;
      reference = bestEval.registered;
      outStrokes = bestEval.strokes;
      strokeOrderRegrouped = bestEval.regrouped;
      const match = bestEval.match;
      const clean = bestEval.clean;
      warnings.push(...bestEval.warnings);
      if (referenceVariants.length > 1) {
        warnings.push(`stroke order: adopted '${bestEval.registered.source}' among ${referenceVariants.length} reference variants`);
      }
      const countsAgree = match.extractedCount === match.referenceCount;
      if (clean || geometryOptions.strokeOrder === 'dataset') {
        const sequence = [...match.pairs].sort((a, b) => a.reference - b.reference).map((p) => p.extracted);
        // Forced partial match: unmatched extras draw after the prescribed strokes.
        for (let i = 0; i < outStrokes.length; i++) if (!sequence.includes(i)) sequence.push(i);
        const reverse = outStrokes.map(() => false);
        for (const pair of match.pairs) reverse[pair.extracted] = pair.reversed;
        plan = { sequence, reverse };
        strokeOrderSource = 'dataset';
        if (!countsAgree) {
          warnings.push(
            `stroke order: forced dataset match with ${match.referenceCount} reference vs ${match.extractedCount} extracted strokes`,
          );
        }
      } else if (!countsAgree) {
        warnings.push(
          `stroke order: ${match.referenceCount} reference vs ${match.extractedCount} extracted strokes — heuristic order kept`,
        );
      } else {
        warnings.push(`stroke order: match cost ${match.meanCost.toFixed(3)} above ${AUTO_MAX_MEAN_COST} — heuristic order kept`);
      }
    }
  }

  const strokesFontUnits = orderAndTimeStrokes(
    outStrokes,
    {
      drawingSpeed: DRAWING_SPEED,
      strokePause: STROKE_PAUSE,
      rtl: input.rtl ?? false,
      headlineLast: input.headlineLast ?? false,
      yTolerance: input.unitsPerEm * 0.02,
    },
    plan,
  );

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
    geoStrokes: outStrokes,
    strokesFontUnits,
    warnings,
    ...(reference ? { reference } : {}),
    strokeOrderSource,
    ...(strokeOrderRegrouped ? { strokeOrderRegrouped } : {}),
  };
}
