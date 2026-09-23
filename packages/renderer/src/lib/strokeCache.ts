import type { TegakiGlyphData } from '../types.ts';
import { reflect, sampleCatmullRom } from './catmullRom.ts';

type Stroke = TegakiGlyphData['s'][number];

/**
 * A single vertex in a subdivided stroke polyline. Consecutive vertices form
 * a drawable sub-segment. Coordinates are in font units and pre-wobble: the
 * renderer applies wobble, scale, and translation at draw time so that one
 * cached subdivision can be reused across every instance of the same glyph.
 */
export interface SubVertex {
  /** X in font units, pre-wobble. */
  x: number;
  /** Y in font units, pre-wobble. */
  y: number;
  /** Stroke width at this vertex, in font units. */
  width: number;
  /** Accumulated length from the start of the stroke, in font units. */
  cumLen: number;
  /** Fractional original-point index (used to keep wobble phase continuous). */
  idx: number;
}

export interface SubdividedStroke {
  /** Ordered vertices; vertices[i] → vertices[i+1] is a drawable sub-segment. */
  vertices: SubVertex[];
  /** Total polyline length in font units. */
  totalLen: number;
  /** Mean width across the original points in font units. */
  avgWidth: number;
  /** `cumLen` at each ORIGINAL point (they all stay on the polyline) — when the pen reaches it. */
  pointCumLen: number[];
}

/**
 * Subdivide a stroke so that no sub-segment exceeds `maxSegLen` font units.
 * Pass `Infinity` (or any non-finite value) to skip subdivision and return
 * the raw polyline.
 *
 * When `smoothing` is true, intermediate vertices are placed on a centripetal
 * Catmull-Rom spline through the original points (see `catmullRom.ts`) —
 * hiding the polyline facets that show up at large render sizes. The original
 * points remain on the curve, so endpoints and `cumLen`/`idx` semantics are
 * preserved. Has no effect when `maxSegLen` is non-finite (no subdivision).
 *
 * Output depends only on `(stroke.p, maxSegLen, smoothing)` — not on position,
 * seed, progress, or effect config — so it can be cached and shared across
 * every instance of the same glyph at the same font size.
 */
export function subdivideStroke(stroke: Stroke, maxSegLen: number, smoothing = false): SubdividedStroke {
  const pts = stroke.p;
  const n = pts.length;
  if (n === 0) return { vertices: [], totalLen: 0, avgWidth: 0, pointCumLen: [] };

  const first = pts[0]!;
  const vertices: SubVertex[] = [{ x: first[0]!, y: first[1]!, width: first[2]!, cumLen: 0, idx: 0 }];

  let cumLen = 0;
  const pointCumLen: number[] = [0];
  for (let j = 1; j < n; j++) {
    const prev = pts[j - 1]!;
    const cur = pts[j]!;
    const dx = cur[0]! - prev[0]!;
    const dy = cur[1]! - prev[1]!;
    const chordLen = Math.sqrt(dx * dx + dy * dy);
    const count = chordLen > 0 && Number.isFinite(maxSegLen) && maxSegLen > 0 ? Math.max(1, Math.ceil(chordLen / maxSegLen)) : 1;

    if (smoothing && count > 1) {
      const p0 = j >= 2 ? pts[j - 2]! : reflect(prev, cur);
      const p3 = j + 1 < n ? pts[j + 1]! : reflect(cur, prev);
      const samples = sampleCatmullRom(p0, prev, cur, p3, count);
      let px = prev[0]!;
      let py = prev[1]!;
      let segAccum = 0;
      for (let k = 0; k < count; k++) {
        const s = samples[k]!;
        const ex = s.x - px;
        const ey = s.y - py;
        segAccum += Math.sqrt(ex * ex + ey * ey);
        vertices.push({ x: s.x, y: s.y, width: s.width, cumLen: cumLen + segAccum, idx: j - 1 + (k + 1) / count });
        px = s.x;
        py = s.y;
      }
      cumLen += segAccum;
    } else {
      const dw = cur[2]! - prev[2]!;
      for (let k = 1; k <= count; k++) {
        const t = k / count;
        vertices.push({
          x: prev[0]! + dx * t,
          y: prev[1]! + dy * t,
          width: prev[2]! + dw * t,
          cumLen: cumLen + chordLen * t,
          idx: j - 1 + t,
        });
      }
      cumLen += chordLen;
    }
    pointCumLen.push(cumLen);
  }

  let widthSum = 0;
  for (const p of pts) widthSum += p[2]!;

  return { vertices, totalLen: cumLen, avgWidth: widthSum / n, pointCumLen };
}
