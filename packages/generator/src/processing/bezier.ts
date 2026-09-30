// Stage 1 of the pipeline — see commands/generate.ts.
// Flatten opentype.js path commands (M / L / Q / C / Z) into polyline sub-paths
// in font-unit coordinates, using adaptive de Casteljau subdivision.

import type { BBox, PathCommand, Point } from 'tegaki/internal';
import { BEZIER_TOLERANCE } from '../constants.ts';

/** Bounding box of all points across the flattened sub-paths. */
export function computePathBBox(subPaths: Point[][]): BBox {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const path of subPaths) {
    for (const p of path) {
      if (p.x < x1) x1 = p.x;
      if (p.y < y1) y1 = p.y;
      if (p.x > x2) x2 = p.x;
      if (p.y > y2) y2 = p.y;
    }
  }
  return { x1, y1, x2, y2 };
}

function distSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function subdivideQuadratic(p0: Point, p1: Point, p2: Point, tolerance: number, result: Point[]): void {
  const mid: Point = {
    x: 0.25 * p0.x + 0.5 * p1.x + 0.25 * p2.x,
    y: 0.25 * p0.y + 0.5 * p1.y + 0.25 * p2.y,
  };
  const linearMid = midpoint(p0, p2);

  if (distSq(mid, linearMid) < tolerance * tolerance) {
    result.push(p2);
  } else {
    const q0 = midpoint(p0, p1);
    const q1 = midpoint(p1, p2);
    subdivideQuadratic(p0, q0, mid, tolerance, result);
    subdivideQuadratic(mid, q1, p2, tolerance, result);
  }
}

function subdivideCubic(p0: Point, p1: Point, p2: Point, p3: Point, tolerance: number, result: Point[]): void {
  const mid: Point = {
    x: 0.125 * p0.x + 0.375 * p1.x + 0.375 * p2.x + 0.125 * p3.x,
    y: 0.125 * p0.y + 0.375 * p1.y + 0.375 * p2.y + 0.125 * p3.y,
  };
  const linearMid = midpoint(p0, p3);

  if (distSq(mid, linearMid) < tolerance * tolerance) {
    result.push(p3);
  } else {
    const q0 = midpoint(p0, p1);
    const q1 = midpoint(p1, p2);
    const q2 = midpoint(p2, p3);
    const r0 = midpoint(q0, q1);
    const r1 = midpoint(q1, q2);
    const s = midpoint(r0, r1);
    subdivideCubic(p0, q0, r0, s, tolerance, result);
    subdivideCubic(s, r1, q2, p3, tolerance, result);
  }
}

export function flattenPath(commands: PathCommand[], tolerance = BEZIER_TOLERANCE): Point[][] {
  const subPaths: Point[][] = [];
  let current: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let subPathStart: Point = { x: 0, y: 0 };

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (current.length > 0) subPaths.push(current);
        current = [{ x: cmd.x, y: cmd.y }];
        cursor = { x: cmd.x, y: cmd.y };
        subPathStart = { ...cursor };
        break;

      case 'L':
        current.push({ x: cmd.x, y: cmd.y });
        cursor = { x: cmd.x, y: cmd.y };
        break;

      case 'Q':
        subdivideQuadratic(cursor, { x: cmd.x1!, y: cmd.y1! }, { x: cmd.x, y: cmd.y }, tolerance, current);
        cursor = { x: cmd.x, y: cmd.y };
        break;

      case 'C':
        subdivideCubic(cursor, { x: cmd.x1!, y: cmd.y1! }, { x: cmd.x2!, y: cmd.y2! }, { x: cmd.x, y: cmd.y }, tolerance, current);
        cursor = { x: cmd.x, y: cmd.y };
        break;

      case 'Z':
        if (current.length > 0) {
          current.push({ ...subPathStart });
          subPaths.push(current);
          current = [];
        }
        cursor = { ...subPathStart };
        break;
    }
  }

  if (current.length > 0) subPaths.push(current);
  return subPaths;
}
