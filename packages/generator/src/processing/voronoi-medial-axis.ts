// Sub-component of stage 4 (skeletonize) — see commands/generate.ts.
// Alternative to thinning+trace: builds the medial axis from the Voronoi
// diagram of sampled outline points, producing polylines + per-point widths
// in a single pass. Invoked from skeletonize.ts when `skeletonMethod=voronoi`.

import { Delaunay } from 'd3-delaunay';
import type { BBox, Point } from 'tegaki/internal';

/**
 * Voronoi-based medial axis extraction.
 *
 * 1. Sample boundary points from the flattened glyph outline
 * 2. Compute Voronoi diagram of those boundary points
 * 3. Keep only Voronoi edges whose midpoints lie inside the shape
 * 4. Build a graph from the kept edges
 * 5. Trace the graph into polylines
 *
 * Returns polylines and per-point widths (distance to nearest boundary).
 */

export interface VoronoiResult {
  /** Medial axis polylines in bitmap-space coordinates */
  polylines: Point[][];
  /** Width (diameter) at each point, indexed as widths[polylineIdx][pointIdx] */
  widths: number[][];
}

/**
 * Extract medial axis using Voronoi diagram of boundary points.
 *
 * @param subPaths - Flattened outline contours (from bezier.ts)
 * @param bbox - Glyph bounding box
 * @param resolution - Target resolution (same as rasterizer uses)
 * @param samplingInterval - Distance between sampled boundary points (in bitmap-space pixels)
 */
export function voronoiMedialAxis(
  subPaths: Point[][],
  _bbox: BBox,
  transform: { scaleX: number; scaleY: number; offsetX: number; offsetY: number },
  bitmapWidth: number,
  bitmapHeight: number,
  samplingInterval = 2,
): VoronoiResult {
  // 1. Sample boundary points in bitmap space
  const boundary = sampleBoundary(subPaths, transform, samplingInterval);
  if (boundary.length < 3) {
    return { polylines: [], widths: [] };
  }

  // 2. Build Voronoi
  const coords = boundary.flatMap((p) => [p.x, p.y]);
  const delaunay = new Delaunay(coords);
  const voronoi = delaunay.voronoi([0, 0, bitmapWidth, bitmapHeight]);

  // 3. Extract edges and filter to those inside the shape
  const edges = extractInsideEdges(voronoi, boundary, subPaths, transform);
  if (edges.length === 0) {
    return { polylines: [], widths: [] };
  }

  // 4. Build adjacency graph and trace polylines
  return traceGraph(edges, boundary, subPaths, transform);
}

/**
 * Sample evenly-spaced points along the boundary contours.
 */
function sampleBoundary(
  subPaths: Point[][],
  transform: { scaleX: number; scaleY: number; offsetX: number; offsetY: number },
  interval: number,
): Point[] {
  const points: Point[] = [];

  for (const path of subPaths) {
    if (path.length < 2) continue;
    let accumulated = 0;

    // Always add the first point
    const first = toBitmapSpace(path[0]!, transform);
    points.push(first);

    for (let i = 1; i < path.length; i++) {
      const prev = toBitmapSpace(path[i - 1]!, transform);
      const curr = toBitmapSpace(path[i]!, transform);
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);

      if (segLen === 0) continue;

      accumulated += segLen;
      while (accumulated >= interval) {
        accumulated -= interval;
        // Interpolate point along this segment
        const t = 1 - accumulated / segLen;
        points.push({
          x: prev.x + dx * t,
          y: prev.y + dy * t,
        });
      }
    }
  }

  return points;
}

function toBitmapSpace(p: Point, transform: { scaleX: number; scaleY: number; offsetX: number; offsetY: number }): Point {
  return {
    x: (p.x - transform.offsetX) * transform.scaleX,
    y: (p.y - transform.offsetY) * transform.scaleY,
  };
}

interface Edge {
  a: Point;
  b: Point;
}

/**
 * Extract Voronoi edges whose midpoints lie inside the glyph shape.
 */
function extractInsideEdges(
  voronoi: ReturnType<typeof Delaunay.prototype.voronoi>,
  _boundary: Point[],
  subPaths: Point[][],
  transform: { scaleX: number; scaleY: number; offsetX: number; offsetY: number },
): Edge[] {
  const edges: Edge[] = [];

  // Iterate over all Voronoi cells and their edges
  // d3-delaunay stores cell polygons; we extract unique edges from them
  const seen = new Set<string>();

  for (let i = 0; i < voronoi.delaunay.points.length / 2; i++) {
    const cell = voronoi.cellPolygon(i);
    if (!cell) continue;

    for (let j = 0; j < cell.length - 1; j++) {
      const [ax, ay] = cell[j]!;
      const [bx, by] = cell[j + 1]!;

      // Deduplicate edges by sorted vertex coordinates
      const key = edgeKey(ax!, ay!, bx!, by!);
      if (seen.has(key)) continue;
      seen.add(key);

      const a = { x: ax!, y: ay! };
      const b = { x: bx!, y: by! };

      // Test midpoint inside shape
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (isInsideShape(mid, subPaths, transform)) {
        // Also test both endpoints — reject edges that straddle the boundary
        if (isInsideShape(a, subPaths, transform) && isInsideShape(b, subPaths, transform)) {
          edges.push({ a, b });
        }
      }
    }
  }

  return edges;
}

function edgeKey(ax: number, ay: number, bx: number, by: number): string {
  // Round to match pointKey precision (0.1px grid)
  const rax = Math.round(ax * 10);
  const ray = Math.round(ay * 10);
  const rbx = Math.round(bx * 10);
  const rby = Math.round(by * 10);

  if (rax < rbx || (rax === rbx && ray < rby)) {
    return `${rax},${ray}-${rbx},${rby}`;
  }
  return `${rbx},${rby}-${rax},${ray}`;
}

/**
 * Point-in-polygon test using nonzero winding rule.
 * Tests a point in bitmap space against the glyph contours.
 */
function isInsideShape(
  point: Point,
  subPaths: Point[][],
  transform: { scaleX: number; scaleY: number; offsetX: number; offsetY: number },
): boolean {
  let winding = 0;
  const px = point.x;
  const py = point.y;

  for (const path of subPaths) {
    for (let i = 0; i < path.length - 1; i++) {
      const ax = (path[i]!.x - transform.offsetX) * transform.scaleX;
      const ay = (path[i]!.y - transform.offsetY) * transform.scaleY;
      const bx = (path[i + 1]!.x - transform.offsetX) * transform.scaleX;
      const by = (path[i + 1]!.y - transform.offsetY) * transform.scaleY;

      if (ay <= py) {
        if (by > py) {
          // Upward crossing
          if (cross(ax, ay, bx, by, px, py) > 0) winding++;
        }
      } else {
        if (by <= py) {
          // Downward crossing
          if (cross(ax, ay, bx, by, px, py) < 0) winding--;
        }
      }
    }
  }

  return winding !== 0;
}

/** 2D cross product for point-in-polygon winding test */
function cross(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (px - ax) * (by - ay);
}

/**
 * Snap point coordinates to a grid for graph key generation.
 * Uses 0.1px precision — fine enough to avoid false merges,
 * coarse enough to merge truly coincident Voronoi vertices.
 */
function pointKey(p: Point): string {
  return `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
}

/**
 * Build an adjacency graph from edges and trace into polylines.
 * Also computes width (distance to nearest boundary) at each point.
 */
function traceGraph(
  edges: Edge[],
  boundary: Point[],
  subPaths: Point[][],
  transform: { scaleX: number; scaleY: number; offsetX: number; offsetY: number },
): VoronoiResult {
  // Build adjacency list
  const adj = new Map<string, { point: Point; neighbors: Set<string> }>();

  function getOrCreate(p: Point): string {
    const key = pointKey(p);
    if (!adj.has(key)) {
      adj.set(key, { point: p, neighbors: new Set() });
    }
    return key;
  }

  for (const { a, b } of edges) {
    const ka = getOrCreate(a);
    const kb = getOrCreate(b);
    adj.get(ka)!.neighbors.add(kb);
    adj.get(kb)!.neighbors.add(ka);
  }

  // Contract short edges to simplify the graph
  contractShortEdges(adj, 2.0);

  // Prune degree-1 nodes that are too close to the boundary (short spurs)
  pruneShortSpurs(adj, boundary, subPaths, transform);

  // Trace polylines through the graph
  // Visit edges: trace chains of degree-2 nodes between endpoints/junctions
  const visitedEdges = new Set<string>();
  const polylines: Point[][] = [];
  const widths: number[][] = [];

  // Process endpoints first (degree 1), then junctions (degree 3+), then remaining
  const allNodes = [...adj.keys()];
  allNodes.sort((a, b) => {
    const da = adj.get(a)!.neighbors.size;
    const db = adj.get(b)!.neighbors.size;
    // Endpoints first, then junctions, then degree-2
    if (da === 1 && db !== 1) return -1;
    if (da !== 1 && db === 1) return 1;
    if (da >= 3 && db < 3) return -1;
    if (da < 3 && db >= 3) return 1;
    return 0;
  });

  for (const start of allNodes) {
    const node = adj.get(start);
    if (!node || node.neighbors.size === 0) continue;

    // For each unvisited edge from this node, trace a chain
    for (const firstNeighbor of node.neighbors) {
      const edgeKey = `${start}-${firstNeighbor}`;
      if (visitedEdges.has(edgeKey)) continue;

      const chain: Point[] = [node.point];
      let prev = start;
      let curr = firstNeighbor;

      // Mark edge as visited (both directions)
      visitedEdges.add(`${prev}-${curr}`);
      visitedEdges.add(`${curr}-${prev}`);

      while (true) {
        const currNode = adj.get(curr);
        if (!currNode) break;
        chain.push(currNode.point);

        // If degree != 2, this is an endpoint or junction — stop
        if (currNode.neighbors.size !== 2) break;

        // Continue to the next unvisited neighbor
        let next: string | null = null;
        for (const n of currNode.neighbors) {
          if (n !== prev) {
            next = n;
            break;
          }
        }
        if (!next || visitedEdges.has(`${curr}-${next}`)) break;

        visitedEdges.add(`${curr}-${next}`);
        visitedEdges.add(`${next}-${curr}`);
        prev = curr;
        curr = next;
      }

      if (chain.length >= 2) {
        // Compute chain length and skip very short fragments
        let chainLen = 0;
        for (let i = 1; i < chain.length; i++) {
          const dx = chain[i]!.x - chain[i - 1]!.x;
          const dy = chain[i]!.y - chain[i - 1]!.y;
          chainLen += Math.sqrt(dx * dx + dy * dy);
        }
        if (chainLen < 2) continue; // skip tiny fragments

        const chainWidths = chain.map((p) => nearestBoundaryDist(p, boundary) * 2);
        polylines.push(chain);
        widths.push(chainWidths);
      }
    }
  }

  return { polylines, widths };
}

/**
 * Contract edges shorter than `threshold` by merging their endpoints.
 * Keeps the endpoint with higher degree (more connections) to preserve topology.
 * Iterates until no more short edges remain.
 */
function contractShortEdges(adj: Map<string, { point: Point; neighbors: Set<string> }>, threshold: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [keyA, nodeA] of adj) {
      for (const keyB of nodeA.neighbors) {
        const nodeB = adj.get(keyB);
        if (!nodeB) continue;

        const dx = nodeA.point.x - nodeB.point.x;
        const dy = nodeA.point.y - nodeB.point.y;
        if (Math.sqrt(dx * dx + dy * dy) >= threshold) continue;

        // Merge B into A (keep A, the one with more neighbors, or either if equal)
        const keepKey = nodeA.neighbors.size >= nodeB.neighbors.size ? keyA : keyB;
        const removeKey = keepKey === keyA ? keyB : keyA;
        const keepNode = adj.get(keepKey)!;
        const removeNode = adj.get(removeKey)!;

        // Redirect all of removeNode's neighbors to point to keepNode
        for (const n of removeNode.neighbors) {
          if (n === keepKey) continue;
          const neighbor = adj.get(n);
          if (!neighbor) continue;
          neighbor.neighbors.delete(removeKey);
          if (n !== keepKey) {
            neighbor.neighbors.add(keepKey);
            keepNode.neighbors.add(n);
          }
        }

        // Remove the edge between keep and remove
        keepNode.neighbors.delete(removeKey);

        // Remove self-loops
        keepNode.neighbors.delete(keepKey);

        // Delete the merged node
        adj.delete(removeKey);
        changed = true;
        break; // restart iteration since map changed
      }
      if (changed) break;
    }
  }
}

/**
 * Remove short degree-1 branches (spurs) from the graph.
 * A spur is a chain of degree-2 nodes ending in a degree-1 node,
 * where the total length is short relative to the local stroke width.
 */
function pruneShortSpurs(
  adj: Map<string, { point: Point; neighbors: Set<string> }>,
  boundary: Point[],
  _subPaths: Point[][],
  _transform: { scaleX: number; scaleY: number; offsetX: number; offsetY: number },
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, node] of adj) {
      if (node.neighbors.size !== 1) continue;

      // Walk the chain from this endpoint
      let length = 0;
      let curr = key;
      let prev = '';
      const chain = [curr];

      while (true) {
        const cn = adj.get(curr);
        if (!cn) break;

        let next: string | null = null;
        for (const n of cn.neighbors) {
          if (n !== prev) {
            next = n;
            break;
          }
        }
        if (!next) break;

        const nextNode = adj.get(next);
        if (!nextNode) break;

        const dx = nextNode.point.x - cn.point.x;
        const dy = nextNode.point.y - cn.point.y;
        length += Math.sqrt(dx * dx + dy * dy);

        // If we hit a junction (degree >= 3), check if spur is short enough to prune
        if (nextNode.neighbors.size >= 3) {
          const localWidth = nearestBoundaryDist(nextNode.point, boundary) * 2;
          if (length < localWidth * 1.5) {
            // Remove the spur
            for (const c of chain) {
              const cNode = adj.get(c);
              if (cNode) {
                for (const n of cNode.neighbors) {
                  adj.get(n)?.neighbors.delete(c);
                }
                adj.delete(c);
              }
            }
            // Also remove the connection from the junction
            nextNode.neighbors.delete(curr);
            changed = true;
          }
          break;
        }

        // If we hit another endpoint, don't prune (it's a bridge)
        if (nextNode.neighbors.size <= 1) break;

        prev = curr;
        curr = next;
        chain.push(curr);
      }
    }
  }
}

/**
 * Find distance from a point to the nearest boundary point.
 * Uses brute-force search over boundary samples.
 */
function nearestBoundaryDist(p: Point, boundary: Point[]): number {
  let minDist = Infinity;
  for (const b of boundary) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = dx * dx + dy * dy;
    if (d < minDist) minDist = d;
  }
  return Math.sqrt(minDist);
}
