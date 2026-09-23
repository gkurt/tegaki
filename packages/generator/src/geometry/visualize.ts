// SVG visualizers for the geometry pipeline stages. All output is in font-unit
// coordinates (y-down), matching the raster pipeline's SVG stages so the Studio
// can display either interchangeably.

import type { Point } from 'tegaki';
import { STROKE_COLORS } from '../processing/visualize.ts';
import { add, scale } from './primitives.ts';
import type { GeometryPipelineResult } from './types.ts';

export type GeometryStage = 'contours' | 'corners' | 'cuts' | 'faces' | 'segments' | 'strokes' | 'order' | 'reference';

interface ViewBox {
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  /** A length unit scaled to the view (for stroke widths / marker radii). */
  u: number;
}

function viewBox(result: GeometryPipelineResult): ViewBox {
  const bb = result.pathBBox;
  const w = bb.x2 - bb.x1;
  const h = bb.y2 - bb.y1;
  const pad = Math.max(w, h) * 0.08 + 1;
  const vw = w + 2 * pad;
  const vh = h + 2 * pad;
  return { vx: bb.x1 - pad, vy: bb.y1 - pad, vw, vh, u: Math.max(vw, vh) / 400 };
}

function svgWrap(vb: ViewBox, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.vx.toFixed(2)} ${vb.vy.toFixed(2)} ${vb.vw.toFixed(2)} ${vb.vh.toFixed(2)}">
  <rect x="${vb.vx.toFixed(2)}" y="${vb.vy.toFixed(2)}" width="${vb.vw.toFixed(2)}" height="${vb.vh.toFixed(2)}" fill="white"/>
${body}
</svg>`;
}

const polyD = (pts: Point[], close = false): string =>
  pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + (close ? ' Z' : '');

function outlinePaths(result: GeometryPipelineResult, u: number, fill = 'rgba(0,0,0,0.05)'): string {
  return result.contours
    .map((c) => `  <path d="${polyD(c.points, true)}" fill="${fill}" stroke="#bbb" stroke-width="${(u * 0.6).toFixed(2)}"/>`)
    .join('\n');
}

/** Faint dashed cut lines so the partition stays legible under axes/strokes. */
function partitionEdges(result: GeometryPipelineResult, u: number): string {
  return result.cuts
    .map(
      (cut) =>
        `  <line x1="${cut.a.point.x.toFixed(2)}" y1="${cut.a.point.y.toFixed(2)}" x2="${cut.b.point.x.toFixed(2)}" y2="${cut.b.point.y.toFixed(2)}" stroke="#555" stroke-width="${(u * 0.7).toFixed(2)}" stroke-dasharray="${(u * 2.5).toFixed(2)} ${(u * 2.5).toFixed(2)}" opacity="0.35"/>`,
    )
    .join('\n');
}

export function renderGeometryStage(result: GeometryPipelineResult, stage: GeometryStage): string {
  switch (stage) {
    case 'contours':
      return renderContours(result);
    case 'corners':
      return renderCorners(result);
    case 'cuts':
      return renderCuts(result);
    case 'faces':
      return renderFaces(result);
    case 'segments':
      return renderSegments(result);
    case 'strokes':
      return renderStrokes(result);
    case 'order':
      return renderOrder(result);
    case 'reference':
      return renderReference(result);
  }
}

function renderContours(result: GeometryPipelineResult): string {
  const vb = viewBox(result);
  const els = result.contours.map((c, i) => {
    const color = c.isHole ? '#888' : STROKE_COLORS[i % STROKE_COLORS.length]!;
    const fill = c.isHole ? 'white' : 'rgba(67,99,216,0.08)';
    const arrows = directionArrows(c.points, vb.u, color, true);
    return `  <path d="${polyD(c.points, true)}" fill="${fill}" stroke="${color}" stroke-width="${(vb.u * 0.8).toFixed(2)}"/>\n${arrows}`;
  });
  return svgWrap(vb, els.join('\n'));
}

function renderCorners(result: GeometryPipelineResult): string {
  const vb = viewBox(result);
  const parts = [outlinePaths(result, vb.u)];
  for (const corner of result.corners) {
    const r = vb.u * 3;
    const slotLen = corner.localWidth > 0 ? corner.localWidth : vb.u * 20;
    for (const slot of corner.slots) {
      const tip = add(corner.point, scale(slot, slotLen));
      parts.push(
        `  <line x1="${corner.point.x.toFixed(2)}" y1="${corner.point.y.toFixed(2)}" x2="${tip.x.toFixed(2)}" y2="${tip.y.toFixed(2)}" stroke="#3cb44b" stroke-width="${(vb.u * 0.7).toFixed(2)}" stroke-dasharray="${(vb.u * 2).toFixed(2)}"/>`,
      );
    }
    parts.push(`  <circle cx="${corner.point.x.toFixed(2)}" cy="${corner.point.y.toFixed(2)}" r="${r.toFixed(2)}" fill="#e6194b"/>`);
  }
  return svgWrap(vb, parts.join('\n'));
}

function renderCuts(result: GeometryPipelineResult): string {
  const vb = viewBox(result);
  const parts = [outlinePaths(result, vb.u)];
  for (const cut of result.cuts) {
    const color = cut.source === 'pair' ? '#e6194b' : '#4363d8';
    parts.push(
      `  <line x1="${cut.a.point.x.toFixed(2)}" y1="${cut.a.point.y.toFixed(2)}" x2="${cut.b.point.x.toFixed(2)}" y2="${cut.b.point.y.toFixed(2)}" stroke="${color}" stroke-width="${(vb.u * 1.4).toFixed(2)}"/>`,
    );
    for (const ep of [cut.a, cut.b]) {
      parts.push(`  <circle cx="${ep.point.x.toFixed(2)}" cy="${ep.point.y.toFixed(2)}" r="${(vb.u * 2).toFixed(2)}" fill="${color}"/>`);
    }
  }
  return svgWrap(vb, parts.join('\n'));
}

function renderFaces(result: GeometryPipelineResult): string {
  const vb = viewBox(result);
  const parts: string[] = [];
  // The ink-graph extraction reports its mesh triangles as faces: hundreds of
  // them, so drop the per-face labels and thin the edges.
  const dense = result.faces.length > 60;
  result.faces.forEach((face, i) => {
    const isJunction = face.kind === 'junction';
    const fill = isJunction ? 'rgba(230,25,75,0.35)' : `${STROKE_COLORS[i % STROKE_COLORS.length]}55`;
    const stroke = isJunction ? '#e6194b' : STROKE_COLORS[i % STROKE_COLORS.length]!;
    // Even-odd fill so holes are punched out.
    const d = [polyD(face.polygon, true), ...face.holes.map((h) => polyD(h, true))].join(' ');
    parts.push(
      `  <path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${(vb.u * (dense ? 0.2 : 0.6)).toFixed(2)}"/>`,
    );
    if (dense) return;
    parts.push(
      `  <text x="${face.centroid.x.toFixed(2)}" y="${face.centroid.y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-size="${(vb.u * 14).toFixed(2)}" fill="#333" font-family="sans-serif">${isJunction ? 'J' : 'S'}</text>`,
    );
  });
  return svgWrap(vb, parts.join('\n'));
}

function renderSegments(result: GeometryPipelineResult): string {
  const vb = viewBox(result);
  const parts = [outlinePaths(result, vb.u), partitionEdges(result, vb.u)];
  result.segments.forEach((seg, i) => {
    const color = STROKE_COLORS[i % STROKE_COLORS.length]!;
    // Width ribbon: faint thick stroke sized by mean width, plus crisp centerline.
    const meanW = seg.axis.reduce((s, p) => s + p.width, 0) / seg.axis.length;
    parts.push(
      `  <path d="${polyD(seg.axis, seg.isLoop)}" fill="none" stroke="${color}" stroke-width="${Math.max(meanW, vb.u).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.2"/>`,
    );
    parts.push(
      `  <path d="${polyD(seg.axis, seg.isLoop)}" fill="none" stroke="${color}" stroke-width="${(vb.u * 1).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    for (const end of seg.ends) {
      parts.push(
        `  <circle cx="${end.point.x.toFixed(2)}" cy="${end.point.y.toFixed(2)}" r="${(vb.u * 2.2).toFixed(2)}" fill="${color}"/>`,
      );
    }
  });
  return svgWrap(vb, parts.join('\n'));
}

function renderStrokes(result: GeometryPipelineResult): string {
  const vb = viewBox(result);
  const parts = [outlinePaths(result, vb.u, 'rgba(0,0,0,0.03)'), partitionEdges(result, vb.u)];
  result.strokesFontUnits.forEach((stroke, i) => {
    const color = STROKE_COLORS[i % STROKE_COLORS.length]!;
    const meanW = stroke.points.reduce((s, p) => s + p.width, 0) / stroke.points.length;
    if (stroke.points.length === 1) {
      const p = stroke.points[0]!;
      parts.push(`  <circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${Math.max(meanW / 2, vb.u).toFixed(2)}" fill="${color}"/>`);
      return;
    }
    const d = polyD(stroke.points);
    parts.push(
      `  <path d="${d}" fill="none" stroke="${color}" stroke-width="${Math.max(meanW, vb.u).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>`,
    );
    parts.push(
      `  <path d="${d}" fill="none" stroke="${color}" stroke-width="${(vb.u * 0.9).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    const start = stroke.points[0]!;
    parts.push(`  <circle cx="${start.x.toFixed(2)}" cy="${start.y.toFixed(2)}" r="${(vb.u * 8).toFixed(2)}" fill="${color}"/>`);
    parts.push(
      `  <text x="${start.x.toFixed(2)}" y="${(start.y + vb.u * 4).toFixed(2)}" text-anchor="middle" font-size="${(vb.u * 11).toFixed(2)}" fill="white" font-family="sans-serif">${i + 1}</text>`,
    );
  });
  return svgWrap(vb, parts.join('\n'));
}

/**
 * Draw-order ramp: first stroke is deep blue, last is warm orange-red, so the
 * pen's progress through the glyph reads at a glance without counting badges.
 * A single-stroke glyph gets the ramp start.
 */
function orderColor(index: number, count: number): string {
  const t = count > 1 ? index / (count - 1) : 0;
  const hue = 225 - t * 205; // 225 (blue) -> 20 (orange-red)
  return `hsl(${hue.toFixed(0)}, 75%, 45%)`;
}

/** A triangle arrowhead centered at `p`, pointing along unit tangent `t`. */
function arrowAt(p: Point, t: Point, size: number, color: string, opacity = 0.9): string {
  const tip = `${(p.x + t.x * size).toFixed(2)},${(p.y + t.y * size).toFixed(2)}`;
  const left = `${(p.x - t.x * size + t.y * size * 0.6).toFixed(2)},${(p.y - t.y * size - t.x * size * 0.6).toFixed(2)}`;
  const right = `${(p.x - t.x * size - t.y * size * 0.6).toFixed(2)},${(p.y - t.y * size + t.x * size * 0.6).toFixed(2)}`;
  return `  <polygon points="${tip} ${left} ${right}" fill="${color}" opacity="${opacity}"/>`;
}

/** Point and unit tangent at arc length `s` along an open polyline. */
function pointAtArcLength(pts: Point[], s: number): { point: Point; tangent: Point } | null {
  let cum = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    if (cum + len >= s) {
      const f = (s - cum) / len;
      return {
        point: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f },
        tangent: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
      };
    }
    cum += len;
  }
  return null;
}

/** Pen-direction arrowheads spaced evenly by arc length along a stroke axis. */
function penDirectionArrows(pts: Point[], u: number, color: string): string {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  if (total < u * 16) return ''; // too short for a legible arrow (dots, flicks)
  const count = Math.min(5, Math.max(1, Math.floor(total / (u * 45))));
  const arrows: string[] = [];
  for (let k = 1; k <= count; k++) {
    const at = pointAtArcLength(pts, total * (k / (count + 1)));
    if (at) arrows.push(arrowAt(at.point, at.tangent, u * 4, color));
  }
  return arrows.join('\n');
}

/**
 * Order/direction view: strokes tinted by a first→last color ramp, arc-length
 * arrowheads showing pen direction, numbered start badges, hollow end rings,
 * and dashed pen-travel connectors from each stroke's end to the next start.
 * This is the observability surface for stroke ordering — today's heuristic
 * and, later, dataset-driven order render through the same view.
 */
function renderOrder(result: GeometryPipelineResult): string {
  const vb = viewBox(result);
  const parts = [outlinePaths(result, vb.u, 'rgba(0,0,0,0.04)')];
  const strokes = result.strokesFontUnits;
  const n = strokes.length;

  // Pen travel underneath the strokes so connectors never obscure ink.
  for (let i = 1; i < n; i++) {
    const from = strokes[i - 1]!.points[strokes[i - 1]!.points.length - 1]!;
    const to = strokes[i]!.points[0]!;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if (len < 1e-6) continue;
    parts.push(
      `  <line x1="${from.x.toFixed(2)}" y1="${from.y.toFixed(2)}" x2="${to.x.toFixed(2)}" y2="${to.y.toFixed(2)}" stroke="#999" stroke-width="${(vb.u * 0.8).toFixed(2)}" stroke-dasharray="${(vb.u * 3).toFixed(2)} ${(vb.u * 3).toFixed(2)}" opacity="0.6"/>`,
    );
    const t = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    parts.push(arrowAt(mid, t, vb.u * 3, '#999', 0.6));
  }

  strokes.forEach((stroke, i) => {
    const color = orderColor(i, n);
    const pts = stroke.points;
    const meanW = pts.reduce((s, p) => s + p.width, 0) / pts.length;
    if (pts.length === 1) {
      parts.push(
        `  <circle cx="${pts[0]!.x.toFixed(2)}" cy="${pts[0]!.y.toFixed(2)}" r="${Math.max(meanW / 2, vb.u).toFixed(2)}" fill="${color}" opacity="0.5"/>`,
      );
    } else {
      const d = polyD(pts);
      parts.push(
        `  <path d="${d}" fill="none" stroke="${color}" stroke-width="${Math.max(meanW, vb.u).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.25"/>`,
      );
      parts.push(
        `  <path d="${d}" fill="none" stroke="${color}" stroke-width="${(vb.u * 1.2).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
      parts.push(penDirectionArrows(pts, vb.u, color));
      // Hollow ring marks where the pen lifts.
      const end = pts[pts.length - 1]!;
      parts.push(
        `  <circle cx="${end.x.toFixed(2)}" cy="${end.y.toFixed(2)}" r="${(vb.u * 3.5).toFixed(2)}" fill="white" stroke="${color}" stroke-width="${(vb.u * 1.2).toFixed(2)}"/>`,
      );
    }
    const start = pts[0]!;
    parts.push(`  <circle cx="${start.x.toFixed(2)}" cy="${start.y.toFixed(2)}" r="${(vb.u * 8).toFixed(2)}" fill="${color}"/>`);
    parts.push(
      `  <text x="${start.x.toFixed(2)}" y="${(start.y + vb.u * 4).toFixed(2)}" text-anchor="middle" font-size="${(vb.u * 11).toFixed(2)}" fill="white" font-family="sans-serif">${i + 1}</text>`,
    );
  });
  return svgWrap(vb, parts.join('\n'));
}

/**
 * Reference overlay: the registered dataset strokes (dashed, order-ramp
 * colored, numbered, with direction arrows) over the extracted strokes
 * (neutral gray). Registration quality reads directly — dashed lines should
 * lie on the gray ink. A count line summarizes agreement; the dataset
 * attribution renders with the data (CC BY-SA requires it wherever the
 * reference strokes are shown).
 */
function renderReference(result: GeometryPipelineResult): string {
  const vb = viewBox(result);
  const parts = [outlinePaths(result, vb.u, 'rgba(0,0,0,0.04)')];

  // Extracted strokes: neutral underlay for the overlay comparison.
  for (const stroke of result.strokesFontUnits) {
    const pts = stroke.points;
    if (pts.length === 1) {
      parts.push(`  <circle cx="${pts[0]!.x.toFixed(2)}" cy="${pts[0]!.y.toFixed(2)}" r="${(vb.u * 2).toFixed(2)}" fill="#8899aa"/>`);
      continue;
    }
    parts.push(
      `  <path d="${polyD(pts)}" fill="none" stroke="#8899aa" stroke-width="${(vb.u * 2.2).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`,
    );
  }

  const ref = result.reference;
  if (!ref) {
    parts.push(
      `  <text x="${(vb.vx + vb.vw / 2).toFixed(2)}" y="${(vb.vy + vb.vh / 2).toFixed(2)}" text-anchor="middle" font-size="${(vb.u * 12).toFixed(2)}" fill="#999" font-family="sans-serif">no reference data</text>`,
    );
    return svgWrap(vb, parts.join('\n'));
  }

  const n = ref.strokes.length;
  ref.strokes.forEach((stroke, i) => {
    const color = orderColor(i, n);
    const pts = stroke.points;
    if (pts.length < 2) return;
    parts.push(
      `  <path d="${polyD(pts)}" fill="none" stroke="${color}" stroke-width="${(vb.u * 1.4).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${(vb.u * 4).toFixed(2)} ${(vb.u * 2.5).toFixed(2)}"/>`,
    );
    parts.push(penDirectionArrows(pts, vb.u, color));
    const start = pts[0]!;
    parts.push(`  <circle cx="${start.x.toFixed(2)}" cy="${start.y.toFixed(2)}" r="${(vb.u * 7).toFixed(2)}" fill="${color}"/>`);
    parts.push(
      `  <text x="${start.x.toFixed(2)}" y="${(start.y + vb.u * 3.5).toFixed(2)}" text-anchor="middle" font-size="${(vb.u * 10).toFixed(2)}" fill="white" font-family="sans-serif">${i + 1}</text>`,
    );
  });

  const applied =
    result.strokeOrderSource === 'dataset' ? ` · ${ref.source} order applied${result.strokeOrderRegrouped ? ' (re-grouped)' : ''}` : '';
  const counts = `${result.strokesFontUnits.length} extracted / ${n} reference${applied}`;
  const countColor = result.strokesFontUnits.length === n ? '#3a7d44' : '#c0392b';
  parts.push(
    `  <text x="${(vb.vx + vb.u * 4).toFixed(2)}" y="${(vb.vy + vb.u * 14).toFixed(2)}" font-size="${(vb.u * 11).toFixed(2)}" fill="${countColor}" font-family="sans-serif">${counts}</text>`,
  );
  parts.push(
    `  <text x="${(vb.vx + vb.u * 4).toFixed(2)}" y="${(vb.vy + vb.vh - vb.u * 5).toFixed(2)}" font-size="${(vb.u * 6).toFixed(2)}" fill="#999" font-family="sans-serif">${ref.license}</text>`,
  );
  return svgWrap(vb, parts.join('\n'));
}

/** Small triangular arrows along a closed contour to show orientation direction. */
function directionArrows(points: Point[], u: number, color: string, closed: boolean): string {
  const n = points.length;
  if (n < 2) return '';
  const arrows: string[] = [];
  const count = Math.min(6, Math.max(2, Math.floor(n / 6)));
  for (let k = 0; k < count; k++) {
    const i = Math.floor((k / count) * n);
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    if (!closed && i + 1 >= n) break;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = dx / len;
    const ny = dy / len;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const s = u * 4;
    const p1 = `${(mx + nx * s).toFixed(2)},${(my + ny * s).toFixed(2)}`;
    const p2 = `${(mx - nx * s + ny * s * 0.6).toFixed(2)},${(my - ny * s - nx * s * 0.6).toFixed(2)}`;
    const p3 = `${(mx - nx * s - ny * s * 0.6).toFixed(2)},${(my - ny * s + nx * s * 0.6).toFixed(2)}`;
    arrows.push(`  <polygon points="${p1} ${p2} ${p3}" fill="${color}" opacity="0.6"/>`);
  }
  return arrows.join('\n');
}
