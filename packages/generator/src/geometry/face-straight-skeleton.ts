// Stage G5c — straight-skeleton medial graph for segment faces.
//
// The straight skeleton (CGAL via the `straight-skeleton` wasm package) is
// computed EXACTLY from the face polygon — no boundary sampling, so none of
// the Voronoi failure modes exist: no refinement loop, no sample-step jitter,
// no sample-free cut mouths. Every skeleton vertex carries its inset `time`
// (its distance to the boundary), so `2 × time` is the pen width for free.
//
// The skeleton necessarily includes CUT edges as boundary (rings must be
// closed), but the artifacts full-boundary Voronoi sampling suffered do not
// appear: the ribs running from every contour vertex (cut corners included)
// have a `time = 0` endpoint and are dropped, leaving only the interior
// spine. Caveats that remain:
// - The spine follows angular bisectors, not the true medial axis, so it can
//   deviate from the disk-center locus near sharp reflex corners — rare in
//   practice, since faces are split AT concave corners by construction.
// - The vertex `time` measures distance to the nearest edge INCLUDING cuts,
//   and a cut is an artificial cross-section, not a pen boundary — near a
//   lengthwise (fold) cut the time under-measures the true stroke width and
//   the drawn pen stops inking the face (れ went from 33 to 128 uncovered
//   wall samples on time-based widths). Node widths are therefore recomputed
//   as 2 × distance-to-nearest-WALL, the same semantics the wall-only
//   Voronoi build measures by construction.
// - CGAL ABORTS the wasm runtime on invalid input (bad orientation,
//   non-weakly-simple rings such as slit faces). Aborts are recoverable —
//   the next build on valid input succeeds — so build failures of any kind
//   simply return null and the caller falls back to chain pairing.
// - ~100× slower than the sampled Voronoi build (CGAL's exact arithmetic
//   under wasm; roughly quadratic in vertex count).
//
// The wasm module is inlined base64 (no fetch), but compiled with
// ENVIRONMENT=web: it only ever CHECKS for `window`/`importScripts`, so a
// minimal `window` alias makes it run under Bun/Node as well. The package is
// imported LAZILY inside initStraightSkeleton() — a ~1 MB bundle nothing
// should pay for until the method is actually selected.

import type { Point } from 'tegaki';
import {
  anchoredAxisFromMedialGraph,
  type InkDisk,
  loopAxesFromMedialGraph,
  type MedialNode,
  segmentAxesFromMedialGraph,
} from './face-medial.ts';
import { dist, distToSegment, pointInPolygon, signedArea } from './primitives.ts';
import type { AxisPoint, Face, ResolvedGeometryOptions, SegmentInfo } from './types.ts';

/** Structural mirror of the package's Skeleton/SkeletonBuilder (type-only, keeps the import lazy). */
interface Skeleton {
  vertices: [number, number, number][];
  polygons: number[][];
}
interface Builder {
  buildFromPolygon(rings: number[][][]): Skeleton | null;
}

let builder: Builder | null = null;
let initPromise: Promise<void> | null = null;

/**
 * One-time async initialization: loads the wasm package and its module. Must
 * be awaited before any glyph is processed with `medialMethod:
 * 'straight-skeleton'` — the pipeline itself is synchronous and will throw
 * otherwise.
 */
export function initStraightSkeleton(): Promise<void> {
  initPromise ??= (async () => {
    if (typeof window === 'undefined') {
      (globalThis as { window?: unknown }).window = globalThis;
    }
    const { SkeletonBuilder } = await import('straight-skeleton');
    await SkeletonBuilder.init();
    builder = SkeletonBuilder as unknown as Builder;
  })();
  return initPromise;
}

export function isStraightSkeletonReady(): boolean {
  return builder !== null;
}

/** Closed ring in the orientation CGAL requires (outer CCW, holes CW). */
function toRing(points: Point[], ccw: boolean): number[][] {
  const ring = points.map((p) => [p.x, p.y]);
  if (signedArea(points) > 0 !== ccw) ring.reverse();
  ring.push([...ring[0]!]);
  return ring;
}

/**
 * Merge skeleton vertices into MedialNodes and connect interior (time > 0)
 * neighbours. Each result polygon is the roof face of one input edge; its
 * consecutive vertex pairs are skeleton edges. Degenerate events can emit
 * distinct vertices at one coordinate — merge them like the Voronoi build
 * merges co-circular circumcenters, or degree-based pruning miscounts.
 */
function graphFromSkeleton(skeleton: Skeleton, face: Face): MedialNode[] {
  const { vertices, polygons } = skeleton;
  const nodes: MedialNode[] = [];
  const byCoord = new Map<string, number>();
  const nodeOfVertex = new Int32Array(vertices.length).fill(-1);
  for (let i = 0; i < vertices.length; i++) {
    const [x, y, time] = vertices[i]!;
    if (time <= 1e-9) continue;
    const key = `${Math.round(x * 256)}:${Math.round(y * 256)}`;
    let id = byCoord.get(key);
    if (id === undefined) {
      id = nodes.length;
      byCoord.set(key, id);
      nodes.push({ x, y, width: 2 * time, adj: [], alive: true });
    }
    nodeOfVertex[i] = id;
  }
  // Pen width = 2 × distance to the nearest WALL edge. The vertex time is the
  // distance to the nearest edge INCLUDING cuts, and cuts are artificial
  // cross-sections — near a lengthwise fold cut the time under-measures the
  // stroke and the pen stops inking the face.
  const n = face.polygon.length;
  for (const node of nodes) {
    let wall = Infinity;
    for (let i = 0; i < n; i++) {
      if (face.edgeCutIds[i]! >= 0) continue;
      wall = Math.min(wall, distToSegment(node, face.polygon[i]!, face.polygon[(i + 1) % n]!));
    }
    // Hole boundaries are walls too (an annulus node's width is bounded by
    // the counter, not just the outer ring).
    for (const hole of face.holes) {
      for (let i = 0; i < hole.length; i++) {
        wall = Math.min(wall, distToSegment(node, hole[i]!, hole[(i + 1) % hole.length]!));
      }
    }
    if (Number.isFinite(wall)) node.width = 2 * wall;
  }
  // Every true skeleton edge lies INSIDE its region. Borderline inputs
  // (near-degenerate holed regions from merged loop chains) can make CGAL
  // emit garbage edges that chord straight across a hole — user-spotted on
  // Caveat 0, whose ring retraced a 380-unit chord through the counter.
  // Reject any edge whose midpoint is not inside the region.
  const insideRegion = (p: Point): boolean => {
    let odd = pointInPolygon(p, face.polygon);
    for (const hole of face.holes) if (pointInPolygon(p, hole)) odd = !odd;
    return odd;
  };
  for (const poly of polygons) {
    for (let k = 0; k < poly.length; k++) {
      const a = nodeOfVertex[poly[k]!]!;
      const b = nodeOfVertex[poly[(k + 1) % poly.length]!]!;
      if (a < 0 || b < 0 || a === b) continue;
      if (nodes[a]!.adj.includes(b)) continue;
      const na = nodes[a]!;
      const nb = nodes[b]!;
      if (dist(na, nb) > 1e-9 && !insideRegion({ x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2 })) continue;
      na.adj.push(b);
      nb.adj.push(a);
    }
  }
  return nodes;
}

/**
 * Straight-skeleton axes for a segment face. Hole-free faces walk the
 * skeleton as a tree (ports, limbs, branches); holed faces walk its CYCLE
 * (O's annulus, a merged stem+bowl) via `loopAxesFromMedialGraph` — but only
 * when the face has no cut ports, since the loop walk has no port concept
 * (holed faces WITH cuts stay on the chain lobe path). Returns null when the
 * build fails (degenerate/slit polygon, wasm abort) or the graph machinery
 * rejects the spine — callers fall back to chain pairing.
 */
export function straightSkeletonFaceAxes(face: Face, options: ResolvedGeometryOptions): SegmentInfo[] | null {
  if (!builder) {
    throw new Error("medialMethod 'straight-skeleton' requires `await initStraightSkeleton()` before processing glyphs");
  }
  if (face.holes.length > 0 && face.cutIds.length > 0) return null;
  const rings = [toRing(face.polygon, true), ...face.holes.map((h) => toRing(h, false))];
  let skeleton: Skeleton | null;
  try {
    skeleton = builder.buildFromPolygon(rings);
  } catch {
    return null;
  }
  if (!skeleton) return null;
  const nodes = graphFromSkeleton(skeleton, face);
  return face.holes.length > 0 ? loopAxesFromMedialGraph(face, options, nodes) : segmentAxesFromMedialGraph(face, options, nodes);
}

/**
 * Recompute a FINAL stroke's axis on its fully merged region — segment
 * chains plus the junction faces the stroke traverses — anchored at the
 * stroke's existing endpoints. The per-face/per-chain pipeline stitches
 * axes and routes at junction cut mouths, which is where the exact skeleton
 * still picked up zigzags (a T's bar jogged across the kernel, its stem
 * started with a Z-kink); skeletonizing the whole region gives the pen one
 * coherent centerline. `otherInk` carries the other strokes' pen disks so
 * limbs into shared junction territory are suppressed. Returns null on any
 * build failure — callers keep the assembled axis.
 */
export function straightSkeletonStrokeAxis(
  region: Face,
  options: ResolvedGeometryOptions,
  start: AxisPoint,
  end: AxisPoint,
  otherInk: InkDisk[],
): AxisPoint[] | null {
  if (!builder) {
    throw new Error("medialMethod 'straight-skeleton' requires `await initStraightSkeleton()` before processing glyphs");
  }
  const rings = [toRing(region.polygon, true), ...region.holes.map((h) => toRing(h, false))];
  let skeleton: Skeleton | null;
  try {
    skeleton = builder.buildFromPolygon(rings);
  } catch {
    return null;
  }
  if (!skeleton) return null;
  return anchoredAxisFromMedialGraph(region, options, graphFromSkeleton(skeleton, region), [start, end], otherInk);
}
