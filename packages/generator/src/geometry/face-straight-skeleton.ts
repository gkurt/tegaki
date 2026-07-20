// Stage G5c — straight-skeleton medial graph for segment faces.
//
// The straight skeleton (CGAL via the `@matthewjacobson/str8` wasm package) is
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
// - The build simply returns null on degenerate/failed input (str8 never
//   aborts the wasm runtime: bad orientation is normalized, and CGAL failures
//   surface as null rather than a memory blowup) — the caller then falls back
//   to chain pairing. Rings that touch at a shared vertex (a merged loop
//   chain's counter meeting its outer at a pinch) make str8 THROW; the
//   try/catch turns that into the same null → chain fallback.
// - ~100× slower than the sampled Voronoi build (CGAL's exact arithmetic
//   under wasm; roughly quadratic in vertex count).
//
// `@matthewjacobson/str8` is a from-scratch rebuild of the original
// `straight-skeleton` package by the person who diagnosed its degeneracy bugs
// (StrandedKitty/straight-skeleton #18/#19/#20): it ingests doubles (no
// float32 truncation), drops near-collinear vertices, normalizes winding, and
// carries an automatic EPICK→EPECK exact-kernel fallback. Font outlines live
// on a quarter-integer lattice that fed the old port EXACTLY-degenerate
// wavefront events — it ground for seconds toward gigabytes of wasm memory
// before aborting (Caveat '#' froze the browser), which the old wrapper only
// dodged with deterministic input jitter. str8 resolves those exactly, so no
// jitter is needed. `forceExact` skips the doomed fast pass up front: on the
// systematically-degenerate '#' bar tip the fast attempt burns ~490ms before
// falling back, while going straight to the exact kernel is ~70ms; simple
// faces build in ~1ms either way, so exact-first is a net win for font work.
//
// The module ships its wasm inlined base64 (no fetch) and detects Node/Bun on
// its own — no `window` alias needed. It is imported LAZILY inside
// initStraightSkeleton() so nothing pays for the ~1.8 MB bundle until the
// method is actually selected.

import type { Point } from 'tegaki';
import {
  anchoredAxisFromMedialGraph,
  type InkDisk,
  loopAxesFromMedialGraph,
  type MedialNode,
  segmentAxesFromMedialGraph,
} from './face-medial.ts';
import { dist, distToSegment, pointInPolygon } from './primitives.ts';
import type { AxisPoint, Face, ResolvedGeometryOptions, SegmentInfo } from './types.ts';

/** Structural mirror of the package's API (type-only, keeps the import lazy). */
interface Skeleton {
  /** Flat `[x, y, time, ...]` triples; `time` is the wavefront distance. */
  vertices: Float32Array;
  /** One entry per skeleton face: vertex indices into `vertices`. */
  faces: number[][];
}
interface Str8 {
  init(): Promise<void>;
  buildFromPolygon(rings: [number, number][][], options?: { forceExact?: boolean }): Skeleton | null;
}

let str8: Str8 | null = null;
let initPromise: Promise<void> | null = null;

// Let str8 try its fast inexact kernel (EPICK) first and only fall back to the
// exact kernel (EPECK) on failure. The old float32 port implied font faces
// were "systematically degenerate", but str8's double-precision fast kernel
// actually SUCCEEDS on the vast majority of them (most glyph faces build in
// 20–320ms — faster than the old package), and only genuinely-degenerate faces
// (the '#' bar tips + merged region) pay the fast-then-exact cost. Forcing
// exact up front instead made EVERY face ~2.5–3× slower for no coverage gain.
const FORCE_EXACT = false;

// Per-build timing to stderr (GEO_SS_DEBUG=1) — guarded so the check itself
// is safe in the browser, where `process` does not exist.
const SS_DEBUG = typeof process !== 'undefined' && !!process.env?.GEO_SS_DEBUG;

/**
 * One-time async initialization: loads the wasm package and its module. Must
 * be awaited before any glyph is processed with `medialMethod:
 * 'straight-skeleton'` — the pipeline itself is synchronous and will throw
 * otherwise.
 */
export function initStraightSkeleton(): Promise<void> {
  initPromise ??= (async () => {
    const mod = (await import('@matthewjacobson/str8')) as unknown as Str8;
    await mod.init();
    str8 = mod;
  })();
  return initPromise;
}

export function isStraightSkeletonReady(): boolean {
  return str8 !== null;
}

/**
 * Ring as a list of `[x, y]` points. str8 accepts either winding (it forces
 * the outer ring CCW and holes CW itself) and open-or-closed rings, so no
 * reorientation or explicit closure is required.
 */
function toRing(points: Point[]): [number, number][] {
  return points.map((p) => [p.x, p.y]);
}

/**
 * Merge skeleton vertices into MedialNodes and connect interior (time > 0)
 * neighbours. Each result face is the roof face of one input edge; its
 * consecutive vertex pairs are skeleton edges. Degenerate events can emit
 * distinct vertices at one coordinate — merge them like the Voronoi build
 * merges co-circular circumcenters, or degree-based pruning miscounts.
 */
function graphFromSkeleton(skeleton: Skeleton, face: Face): MedialNode[] {
  const { vertices, faces: skeletonFaces } = skeleton;
  const vertexCount = (vertices.length / 3) | 0;
  const nodes: MedialNode[] = [];
  const byCoord = new Map<string, number>();
  const nodeOfVertex = new Int32Array(vertexCount).fill(-1);
  for (let i = 0; i < vertexCount; i++) {
    const x = vertices[i * 3]!;
    const y = vertices[i * 3 + 1]!;
    const time = vertices[i * 3 + 2]!;
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
  for (const poly of skeletonFaces) {
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
  if (!str8) {
    throw new Error("medialMethod 'straight-skeleton' requires `await initStraightSkeleton()` before processing glyphs");
  }
  if (face.holes.length > 0 && face.cutIds.length > 0) return null;
  const rings = [toRing(face.polygon), ...face.holes.map((h) => toRing(h))];
  const t0 = SS_DEBUG ? performance.now() : 0;
  let skeleton: Skeleton | null;
  try {
    skeleton = str8.buildFromPolygon(rings, { forceExact: FORCE_EXACT });
  } catch {
    return null;
  }
  if (SS_DEBUG) {
    console.error(
      `[ss] faceAxes face${face.id} v=${face.polygon.length} holes=${face.holes.length} ${(performance.now() - t0).toFixed(0)}ms`,
    );
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
  if (!str8) {
    throw new Error("medialMethod 'straight-skeleton' requires `await initStraightSkeleton()` before processing glyphs");
  }
  const rings = [toRing(region.polygon), ...region.holes.map((h) => toRing(h))];
  const t0 = SS_DEBUG ? performance.now() : 0;
  let skeleton: Skeleton | null;
  try {
    skeleton = str8.buildFromPolygon(rings, { forceExact: FORCE_EXACT });
  } catch {
    return null;
  }
  if (SS_DEBUG) {
    console.error(
      `[ss] strokeAxis region${region.id} v=${region.polygon.length} holes=${region.holes.length} ${(performance.now() - t0).toFixed(0)}ms ok=${skeleton !== null}`,
    );
  }
  if (!skeleton) return null;
  return anchoredAxisFromMedialGraph(region, options, graphFromSkeleton(skeleton, region), [start, end], otherInk);
}
