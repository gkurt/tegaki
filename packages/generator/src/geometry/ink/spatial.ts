// Uniform-grid index over line segments for nearest-distance queries.
//
// The ink-graph extraction asks "how far is this point from the outline?"
// for every axis sample (widths), every junction center (radii), and every
// extension step — thousands of queries per glyph against hundreds of
// boundary segments. A grid keyed by segment bbox keeps each query local.

import type { Point } from 'tegaki';
import { distToSegment } from '../primitives.ts';

export class SegmentIndex {
  private readonly segs: [Point, Point][];
  private readonly cell: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: number[][];

  constructor(segments: [Point, Point][], cellSize: number) {
    this.segs = segments;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [a, b] of segments) {
      x0 = Math.min(x0, a.x, b.x);
      y0 = Math.min(y0, a.y, b.y);
      x1 = Math.max(x1, a.x, b.x);
      y1 = Math.max(y1, a.y, b.y);
    }
    if (!Number.isFinite(x0)) {
      x0 = 0;
      y0 = 0;
      x1 = 0;
      y1 = 0;
    }
    this.cell = Math.max(cellSize, 1e-6);
    this.x0 = x0;
    this.y0 = y0;
    this.cols = Math.max(1, Math.ceil((x1 - x0) / this.cell) + 1);
    this.rows = Math.max(1, Math.ceil((y1 - y0) / this.cell) + 1);
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
    segments.forEach(([a, b], i) => {
      const cx0 = this.col(Math.min(a.x, b.x));
      const cx1 = this.col(Math.max(a.x, b.x));
      const cy0 = this.row(Math.min(a.y, b.y));
      const cy1 = this.row(Math.max(a.y, b.y));
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.buckets[cy * this.cols + cx]!.push(i);
    });
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)));
  }

  /** Distance from `p` to the nearest indexed segment (Infinity when empty). */
  nearest(p: Point): number {
    if (this.segs.length === 0) return Infinity;
    const pc = Math.floor((p.x - this.x0) / this.cell);
    const pr = Math.floor((p.y - this.y0) / this.cell);
    // Distance from p to the grid's bbox, so far-away queries start at the right ring.
    const maxRing = Math.max(this.cols, this.rows) + Math.max(Math.abs(pc), Math.abs(pr)) + 1;
    let best = Infinity;
    const seen = new Set<number>();
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let r = pr - ring; r <= pr + ring; r++) {
        if (r < 0 || r >= this.rows) continue;
        const onEdgeRow = r === pr - ring || r === pr + ring;
        for (let c = pc - ring; c <= pc + ring; c++) {
          if (c < 0 || c >= this.cols) continue;
          if (!onEdgeRow && c !== pc - ring && c !== pc + ring) continue;
          for (const i of this.buckets[r * this.cols + c]!) {
            if (seen.has(i)) continue;
            seen.add(i);
            const [a, b] = this.segs[i]!;
            const d = distToSegment(p, a, b);
            if (d < best) best = d;
          }
        }
      }
      // Every unvisited cell lies at least `ring * cell` away from p.
      if (best <= ring * this.cell) break;
    }
    return best;
  }
}

/**
 * Contour edges bucketed by row for fast inside tests. The nonzero winding
 * at `p` only counts edges whose y-span straddles p.y, so each row keeps just
 * the edges crossing it — the same rule as `pointInRegion`, without walking
 * every edge. Nib fitting asks it about every outline sample of every
 * candidate ellipse.
 */
export class RegionIndex {
  private readonly y0: number;
  private readonly rowHeight: number;
  private readonly rows: [Point, Point][][];

  constructor(contours: { points: Point[] }[], rowHeight: number) {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const c of contours) {
      for (const p of c.points) {
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
    }
    if (!Number.isFinite(y0)) y0 = y1 = 0;
    this.y0 = y0;
    this.rowHeight = Math.max(rowHeight, 1e-6);
    this.rows = Array.from({ length: Math.floor((y1 - y0) / this.rowHeight) + 1 }, () => []);
    for (const c of contours) {
      const pts = c.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        const r0 = this.row(Math.min(a.y, b.y));
        const r1 = this.row(Math.max(a.y, b.y));
        for (let r = r0; r <= r1; r++) this.rows[r]!.push([a, b]);
      }
    }
  }

  private row(y: number): number {
    return Math.min(this.rows.length - 1, Math.max(0, Math.floor((y - this.y0) / this.rowHeight)));
  }

  /** True when `p` is inside the region (nonzero winding). */
  contains(p: Point): boolean {
    if (p.y < this.y0 || p.y > this.y0 + this.rows.length * this.rowHeight) return false;
    let wn = 0;
    for (const [a, b] of this.rows[this.row(p.y)]!) {
      const side = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (a.y <= p.y) {
        if (b.y > p.y && side > 0) wn++;
      } else if (b.y <= p.y && side < 0) wn--;
    }
    return wn !== 0;
  }
}
