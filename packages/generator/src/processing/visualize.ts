import type { LineCap } from 'tegaki';
import type { Point } from 'tegaki/internal';
import type { PipelineResult } from '../commands/generate.ts';
import { bitmapToPNG, rgbaToPNG } from './png.ts';

export const STROKE_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990'];

/** Stages that can be rendered as static images (PNG or SVG). */
export type VisualizationStage =
  | 'outline'
  | 'flattened'
  | 'bitmap'
  | 'skeleton'
  | 'overlay'
  | 'distance'
  | 'traced'
  | 'curvature'
  | 'strokes';

/** Render any static stage. Returns PNG bytes or SVG string. */
export function renderStage(result: PipelineResult, stage: VisualizationStage): Uint8Array | string {
  switch (stage) {
    case 'outline':
      return renderOutline(result);
    case 'flattened':
      return renderFlattened(result);
    case 'bitmap':
      return renderBitmap(result);
    case 'skeleton':
      return renderSkeleton(result);
    case 'overlay':
      return renderOverlay(result);
    case 'distance':
      return renderDistance(result);
    case 'traced':
      return renderTraced(result);
    case 'curvature':
      return renderCurvature(result);
    case 'strokes':
      return renderStrokes(result);
  }
}

// ── PNG renderers ──────────────────────────────────────────────────────────

export function renderBitmap(result: PipelineResult): Uint8Array {
  return bitmapToPNG(result.bitmap, result.bitmapWidth, result.bitmapHeight);
}

export function renderSkeleton(result: PipelineResult): Uint8Array {
  const { skeleton, bitmapWidth: w, bitmapHeight: h } = result;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < skeleton.length; i++) {
    const base = i * 4;
    if (skeleton[i]) {
      rgba[base] = 230;
      rgba[base + 1] = 25;
      rgba[base + 2] = 75;
      rgba[base + 3] = 255;
    } else {
      rgba[base] = 255;
      rgba[base + 1] = 255;
      rgba[base + 2] = 255;
      rgba[base + 3] = 255;
    }
  }
  return rgbaToPNG(rgba, w, h);
}

export function renderOverlay(result: PipelineResult): Uint8Array {
  const { bitmap, skeleton, bitmapWidth: w, bitmapHeight: h } = result;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < bitmap.length; i++) {
    const base = i * 4;
    if (skeleton[i]) {
      rgba[base] = 230;
      rgba[base + 1] = 25;
      rgba[base + 2] = 75;
      rgba[base + 3] = 255;
    } else if (bitmap[i]) {
      rgba[base] = 220;
      rgba[base + 1] = 220;
      rgba[base + 2] = 220;
      rgba[base + 3] = 255;
    } else {
      rgba[base] = 255;
      rgba[base + 1] = 255;
      rgba[base + 2] = 255;
      rgba[base + 3] = 255;
    }
  }
  return rgbaToPNG(rgba, w, h);
}

export function renderDistance(result: PipelineResult): Uint8Array {
  const { inverseDT, bitmap, bitmapWidth: w, bitmapHeight: h } = result;
  const rgba = new Uint8Array(w * h * 4);

  let maxDT = 0;
  for (let i = 0; i < inverseDT.length; i++) {
    if (bitmap[i] && inverseDT[i]! > maxDT) maxDT = inverseDT[i]!;
  }

  for (let i = 0; i < inverseDT.length; i++) {
    const base = i * 4;
    if (bitmap[i] && maxDT > 0) {
      const t = inverseDT[i]! / maxDT;
      const [r, g, b] = heatmapColor(t);
      rgba[base] = r;
      rgba[base + 1] = g;
      rgba[base + 2] = b;
      rgba[base + 3] = 255;
    } else {
      rgba[base] = 255;
      rgba[base + 1] = 255;
      rgba[base + 2] = 255;
      rgba[base + 3] = 255;
    }
  }
  return rgbaToPNG(rgba, w, h);
}

// ── SVG renderers ──────────────────────────────────────────────────────────

export function renderOutline(result: PipelineResult): string {
  const { pathBBox: bb, pathString } = result;
  const pad = 20;
  const vx = bb.x1 - pad;
  const vy = bb.y1 - pad;
  const vw = bb.x2 - bb.x1 + 2 * pad;
  const vh = bb.y2 - bb.y1 + 2 * pad;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}">
  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="white"/>
  <path d="${pathString}" fill="rgba(0,0,0,0.1)" stroke="black" stroke-width="${(vw / 300).toFixed(2)}"/>
</svg>`;
}

export function renderFlattened(result: PipelineResult): string {
  const { subPaths, pathBBox: bb } = result;
  const pad = 20;
  const vx = bb.x1 - pad;
  const vy = bb.y1 - pad;
  const vw = bb.x2 - bb.x1 + 2 * pad;
  const vh = bb.y2 - bb.y1 + 2 * pad;
  const sw = vw / 400;
  const pr = vw / 500;

  const elements = subPaths
    .map((path, i) => {
      const color = STROKE_COLORS[i % STROKE_COLORS.length]!;
      const d = path.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      const circles = path.map((p) => `  <circle cx="${p.x}" cy="${p.y}" r="${pr.toFixed(2)}" fill="${color}" opacity="0.5"/>`).join('\n');
      return `  <path d="${d}" fill="none" stroke="${color}" stroke-width="${sw.toFixed(2)}"/>\n${circles}`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}">
  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="white"/>
${elements}
</svg>`;
}

export function renderTraced(result: PipelineResult): string {
  const { polylines, bitmapWidth: w, bitmapHeight: h } = result;

  const paths = polylines
    .map((pl, i) => {
      const color = STROKE_COLORS[i % STROKE_COLORS.length]!;
      if (pl.length === 1) {
        return `  <circle cx="${pl[0]!.x.toFixed(1)}" cy="${pl[0]!.y.toFixed(1)}" r="2" fill="${color}"/>`;
      }
      const d = pl.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      return `  <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('\n');

  const endpoints = polylines
    .map((pl, i) => {
      const color = STROKE_COLORS[i % STROKE_COLORS.length]!;
      const s = pl[0]!;
      return `  <circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="3" fill="${color}" opacity="0.8"/>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="white"/>
${paths}
${endpoints}
</svg>`;
}

export function renderStrokes(result: PipelineResult): string {
  const { strokes, bitmapWidth: w, bitmapHeight: h, lineCap } = result;

  const elements = strokes
    .map((stroke, i) => {
      const color = STROKE_COLORS[i % STROKE_COLORS.length]!;
      const avgWidth = stroke.points.reduce((s, p) => s + p.width, 0) / stroke.points.length;

      if (stroke.points.length === 1) {
        const p = stroke.points[0]!;
        if (lineCap === 'round') {
          return `  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${Math.max(avgWidth / 2, 1).toFixed(1)}" fill="${color}" opacity="0.7"/>`;
        }
        const half = Math.max(avgWidth / 2, 1);
        const size = Math.max(avgWidth, 2);
        return `  <rect x="${(p.x - half).toFixed(1)}" y="${(p.y - half).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" fill="${color}" opacity="0.7"/>`;
      }

      const d = stroke.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      const start = stroke.points[0]!;
      return `  <g>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="${Math.max(avgWidth, 1).toFixed(1)}" stroke-linecap="${lineCap}" stroke-linejoin="round" opacity="0.5"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1" stroke-linecap="${lineCap}" stroke-linejoin="round"/>
    <circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="6" fill="${color}"/>
    <text x="${start.x.toFixed(1)}" y="${(start.y + 3.5).toFixed(1)}" text-anchor="middle" font-size="8" fill="white" font-family="sans-serif">${i + 1}</text>
  </g>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="white"/>
${elements}
</svg>`;
}

/** SMIL-animated SVG for static debug viewing (auto-plays stroke drawing). */
export function renderDebugAnimation(result: PipelineResult): string {
  const { strokes, bitmapWidth: w, bitmapHeight: h, lineCap } = result;
  const drawingDuration = 2;
  const pauseBetween = 0.15;
  const totalLength = strokes.reduce((sum, s) => sum + s.length, 0);

  const elements: string[] = [];
  let timeOffset = 0;

  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i]!;
    const color = STROKE_COLORS[i % STROKE_COLORS.length]!;
    const d = stroke.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

    let len = 0;
    for (let j = 1; j < stroke.points.length; j++) {
      const dx = stroke.points[j]!.x - stroke.points[j - 1]!.x;
      const dy = stroke.points[j]!.y - stroke.points[j - 1]!.y;
      len += Math.sqrt(dx * dx + dy * dy);
    }

    const avgWidth = stroke.points.reduce((s, p) => s + p.width, 0) / stroke.points.length;
    const strokeDuration = totalLength > 0 ? Math.max((stroke.length / totalLength) * drawingDuration, 0.05) : 0.1;
    const begin = `${timeOffset.toFixed(3)}s`;

    if (len === 0) {
      const p = stroke.points[0]!;
      const size = Math.max(avgWidth, 1);
      elements.push(`  ${dotElement(p.x.toFixed(1), p.y.toFixed(1), size, color, lineCap)} opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="${strokeDuration.toFixed(3)}s" begin="${begin}" fill="freeze"/>
  </${lineCap === 'round' ? 'circle' : 'rect'}>`);
    } else {
      elements.push(`  <path d="${d}" fill="none" stroke="${color}" stroke-width="${Math.max(avgWidth, 1).toFixed(1)}" stroke-linecap="${lineCap}" stroke-linejoin="round"
    stroke-dasharray="${len.toFixed(0)}" stroke-dashoffset="${len.toFixed(0)}" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.001s" begin="${begin}" fill="freeze"/>
    <animate attributeName="stroke-dashoffset" from="${len.toFixed(0)}" to="0" dur="${strokeDuration.toFixed(3)}s" begin="${begin}" fill="freeze"/>
  </path>`);
    }

    if (stroke.points.length > 0) {
      const start = stroke.points[0]!;
      elements.push(`  <g opacity="0">
    <circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="4" fill="${color}" opacity="0.7"/>
    <text x="${(start.x + 5).toFixed(1)}" y="${(start.y - 5).toFixed(1)}" font-size="8" fill="${color}" font-family="sans-serif">${i + 1}</text>
    <animate attributeName="opacity" from="0" to="1" dur="0.1s" begin="${begin}" fill="freeze"/>
  </g>`);
    }

    timeOffset += strokeDuration + pauseBetween;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="white"/>
${elements.join('\n')}
</svg>`;
}

/**
 * Render polylines colored by curvature at each point.
 * Blue = straight, green = moderate turn, red = sharp turn.
 * Arrows show direction of travel along each polyline.
 */
export function renderCurvature(result: PipelineResult): string {
  const { polylines, bitmapWidth: w, bitmapHeight: h } = result;

  // Compute curvature (turning angle in radians) at each interior point
  const allCurvatures: { polyIdx: number; pointIdx: number; curvature: number }[] = [];
  for (let pi = 0; pi < polylines.length; pi++) {
    const pl = polylines[pi]!;
    for (let i = 1; i < pl.length - 1; i++) {
      const prev = pl[i - 1]!;
      const curr = pl[i]!;
      const next = pl[i + 1]!;
      const ax = curr.x - prev.x;
      const ay = curr.y - prev.y;
      const bx = next.x - curr.x;
      const by = next.y - curr.y;
      const magA = Math.sqrt(ax * ax + ay * ay);
      const magB = Math.sqrt(bx * bx + by * by);
      if (magA === 0 || magB === 0) {
        allCurvatures.push({ polyIdx: pi, pointIdx: i, curvature: 0 });
        continue;
      }
      const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (magA * magB)));
      allCurvatures.push({ polyIdx: pi, pointIdx: i, curvature: Math.acos(cos) });
    }
  }

  // Find max curvature for normalization
  let maxCurv = 0;
  for (const c of allCurvatures) {
    if (c.curvature > maxCurv) maxCurv = c.curvature;
  }
  if (maxCurv === 0) maxCurv = 1;

  // Build curvature lookup: polyIdx -> pointIdx -> normalized curvature [0,1]
  const curvMap = new Map<number, Map<number, number>>();
  for (const c of allCurvatures) {
    if (!curvMap.has(c.polyIdx)) curvMap.set(c.polyIdx, new Map());
    curvMap.get(c.polyIdx)!.set(c.pointIdx, c.curvature / maxCurv);
  }

  const elements: string[] = [];

  for (let pi = 0; pi < polylines.length; pi++) {
    const pl = polylines[pi]!;
    if (pl.length < 2) {
      const p = pl[0]!;
      elements.push(`  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" fill="#888"/>`);
      continue;
    }

    const pCurv = curvMap.get(pi);

    // Draw each segment colored by the curvature at its midpoint
    for (let i = 0; i < pl.length - 1; i++) {
      const a = pl[i]!;
      const b = pl[i + 1]!;
      // Average curvature of the two endpoints (endpoints get 0)
      const ca = pCurv?.get(i) ?? 0;
      const cb = pCurv?.get(i + 1) ?? 0;
      const t = (ca + cb) / 2;
      const [r, g, bl] = heatmapColor(t);
      elements.push(
        `  <line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="rgb(${r},${g},${bl})" stroke-width="2" stroke-linecap="round"/>`,
      );
    }

    // Draw direction arrows at ~25%, 50%, 75% along the polyline
    for (const frac of [0.25, 0.5, 0.75]) {
      const idx = Math.min(Math.floor(frac * (pl.length - 1)), pl.length - 2);
      const from = pl[idx]!;
      const to = pl[idx + 1]!;
      const arrow = renderArrow(from, to);
      if (arrow) elements.push(arrow);
    }

    // Mark start point
    const start = pl[0]!;
    elements.push(
      `  <circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="3" fill="${STROKE_COLORS[pi % STROKE_COLORS.length]}" opacity="0.8"/>`,
    );
  }

  // Legend
  const legendY = h - 8;
  const legendX = 8;
  const legendW = 80;
  for (let i = 0; i <= legendW; i++) {
    const t = i / legendW;
    const [r, g, b] = heatmapColor(t);
    elements.push(
      `  <line x1="${legendX + i}" y1="${legendY}" x2="${legendX + i}" y2="${legendY + 6}" stroke="rgb(${r},${g},${b})" stroke-width="1"/>`,
    );
  }
  elements.push(`  <text x="${legendX}" y="${legendY - 2}" font-size="6" fill="#333" font-family="sans-serif">straight</text>`);
  elements.push(
    `  <text x="${legendX + legendW}" y="${legendY - 2}" font-size="6" fill="#333" font-family="sans-serif" text-anchor="end">sharp</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="white"/>
${elements.join('\n')}
</svg>`;
}

function renderArrow(from: Point, to: Point): string | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return null;
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const nx = dx / len;
  const ny = dy / len;
  const size = 3;
  const x1 = mx - size * nx + size * 0.5 * ny;
  const y1 = my - size * ny - size * 0.5 * nx;
  const x2 = mx - size * nx - size * 0.5 * ny;
  const y2 = my - size * ny + size * 0.5 * nx;
  return `  <polygon points="${mx.toFixed(1)},${my.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="#333" opacity="0.6"/>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function dotElement(x: string, y: string, size: number, fill: string, lineCap: LineCap): string {
  if (lineCap === 'round') {
    return `<circle cx="${x}" cy="${y}" r="${(size / 2).toFixed(1)}" fill="${fill}"`;
  }
  const half = size / 2;
  return `<rect x="${(Number(x) - half).toFixed(1)}" y="${(Number(y) - half).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" fill="${fill}"`;
}

function heatmapColor(t: number): [number, number, number] {
  if (t < 0.25) {
    const s = t / 0.25;
    return [0, Math.round(s * 255), 255];
  }
  if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return [0, 255, Math.round((1 - s) * 255)];
  }
  if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return [Math.round(s * 255), 255, 0];
  }
  const s = (t - 0.75) / 0.25;
  return [255, Math.round((1 - s) * 255), 0];
}
