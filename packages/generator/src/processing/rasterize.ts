// Stage 2 of the pipeline — see commands/generate.ts.
// Rasterize flattened sub-paths into a binary bitmap using a scanline fill
// with the nonzero winding rule. Returns the bitmap plus the bitmap↔font-unit
// transform so downstream stages can map coordinates back.

import type { BBox, Point } from 'tegaki/internal';
import { BITMAP_PADDING, DEFAULT_RESOLUTION } from '../constants.ts';

export interface RasterResult {
  bitmap: Uint8Array;
  width: number;
  height: number;
  transform: {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  };
}

export function rasterize(subPaths: Point[][], boundingBox: BBox, resolution = DEFAULT_RESOLUTION): RasterResult {
  const bboxW = boundingBox.x2 - boundingBox.x1;
  const bboxH = boundingBox.y2 - boundingBox.y1;

  if (bboxW <= 0 || bboxH <= 0) {
    return {
      bitmap: new Uint8Array(resolution * resolution),
      width: resolution,
      height: resolution,
      transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
    };
  }

  const padX = bboxW * BITMAP_PADDING;
  const padY = bboxH * BITMAP_PADDING;
  const minX = boundingBox.x1 - padX;
  const minY = boundingBox.y1 - padY;
  const totalW = bboxW + 2 * padX;
  const totalH = bboxH + 2 * padY;

  // Maintain aspect ratio: fit into resolution x resolution
  const scale = Math.min(resolution / totalW, resolution / totalH);
  const w = Math.ceil(totalW * scale);
  const h = Math.ceil(totalH * scale);

  const bitmap = new Uint8Array(w * h);

  const scaleX = scale;
  const scaleY = scale;
  const offsetX = minX;
  const offsetY = minY;

  // Collect all edges from all sub-paths
  const edges: { x1: number; y1: number; x2: number; y2: number; direction: number }[] = [];
  for (const path of subPaths) {
    for (let i = 0; i < path.length - 1; i++) {
      const p1x = (path[i]!.x - offsetX) * scaleX;
      const p1y = (path[i]!.y - offsetY) * scaleY;
      const p2x = (path[i + 1]!.x - offsetX) * scaleX;
      const p2y = (path[i + 1]!.y - offsetY) * scaleY;

      if (p1y === p2y) continue; // skip horizontal edges

      // direction: +1 if going up (y decreasing), -1 if going down
      const direction = p1y > p2y ? 1 : -1;
      edges.push({ x1: p1x, y1: p1y, x2: p2x, y2: p2y, direction });
    }
  }

  // Scanline fill using nonzero winding rule
  for (let y = 0; y < h; y++) {
    const scanY = y + 0.5; // center of pixel
    const intersections: { x: number; direction: number }[] = [];

    for (const edge of edges) {
      const yMin = Math.min(edge.y1, edge.y2);
      const yMax = Math.max(edge.y1, edge.y2);

      if (scanY < yMin || scanY >= yMax) continue;

      const t = (scanY - edge.y1) / (edge.y2 - edge.y1);
      const x = edge.x1 + t * (edge.x2 - edge.x1);
      intersections.push({ x, direction: edge.direction });
    }

    intersections.sort((a, b) => a.x - b.x);

    // Nonzero winding fill
    let winding = 0;
    let nextIdx = 0;
    for (let x = 0; x < w; x++) {
      const pixelCenter = x + 0.5;
      while (nextIdx < intersections.length && intersections[nextIdx]!.x <= pixelCenter) {
        winding += intersections[nextIdx]!.direction;
        nextIdx++;
      }
      if (winding !== 0) {
        bitmap[y * w + x] = 1;
      }
    }
  }

  return { bitmap, width: w, height: h, transform: { scaleX, scaleY, offsetX, offsetY } };
}
