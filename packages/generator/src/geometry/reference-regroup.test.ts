import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { Point } from 'tegaki';
import { parseFont, processGlyphGeometry } from '../commands/generate.ts';
import { createHangulProvider } from '../stroke-order/hangul.ts';
import { createHersheyProvider } from '../stroke-order/hershey.ts';
import type { ReferenceGlyph } from '../stroke-order/types.ts';
import { hasCanonicalStrokeOrder } from './pipeline.ts';
import { DEFAULT_GEOMETRY_OPTIONS } from './types.ts';

// Caveat is a cursive font: its letters are drawn as long continuous
// trajectories, which is exactly where print-style references pull hardest.
const caveat = await parseFont(readFileSync(new URL('../../../renderer/fonts/caveat/caveat.ttf', import.meta.url)).buffer as ArrayBuffer);

function line(x1: number, y1: number, x2: number, y2: number): { points: Point[] } {
  return { points: Array.from({ length: 9 }, (_, i) => ({ x: x1 + ((x2 - x1) * i) / 8, y: y1 + ((y2 - y1) * i) / 8 })) };
}

/** A print W in four straight strokes (\ / \ /), in a 109-unit frame like KanjiVG's. */
const PRINT_W: ReferenceGlyph = {
  char: 'W',
  source: 'print',
  license: 'test',
  viewBox: { width: 109, height: 109 },
  strokes: [line(10, 15, 31, 92), line(53, 16, 32, 93), line(55, 16, 77, 93), line(99, 16, 78, 93)],
};

function distanceToPolyline(p: Point, points: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
  }
  return best;
}

describe('reference re-grouping on a cursive Latin font', () => {
  test("Caveat's one-stroke W is not cut into a print W's four strokes by retracing", () => {
    const r = processGlyphGeometry(caveat, 'W', DEFAULT_GEOMETRY_OPTIONS, undefined, [PRINT_W])!;
    expect(r.strokesFontUnits.length).toBe(1);
    expect(r.strokeOrderRegrouped).toBeFalsy();
  });

  test('re-grouped ink-graph strokes keep the curvature of the ink they were built from', async () => {
    const reference = (await createHersheyProvider().get('d'))!;
    const heuristic = processGlyphGeometry(caveat, 'd', { ...DEFAULT_GEOMETRY_OPTIONS, strokeOrder: 'heuristic' })!;
    const regrouped = processGlyphGeometry(caveat, 'd', DEFAULT_GEOMETRY_OPTIONS, undefined, [reference])!;
    expect(regrouped.strokeOrderRegrouped).toBe(true);
    // Every extracted point stays within the simplify tolerance of the
    // re-grouped strokes; the partition simplifier flattened d's bowl by 8+.
    const tolerance = caveat.unitsPerEm * 0.004;
    for (const stroke of heuristic.strokesFontUnits) {
      for (const p of stroke.points) {
        const d = Math.min(...regrouped.strokesFontUnits.map((s) => distanceToPolyline(p, s.points)));
        expect(d).toBeLessThanOrEqual(tolerance);
      }
    }
  });
});

describe('hasCanonicalStrokeOrder', () => {
  test('kanji and kana have canonical stroke order', () => {
    for (const char of ['月', '曜', 'れ', 'ア']) expect(hasCanonicalStrokeOrder(char)).toBe(true);
  });

  test('Latin letters and digits do not', () => {
    for (const char of ['W', 'a', '7']) expect(hasCanonicalStrokeOrder(char)).toBe(false);
  });
});

// Nanum Pen Script joins a jamo's strokes (the bundle's subset parses faster than the full file).
const nanum = await parseFont(
  readFileSync(new URL('../../../renderer/fonts/nanum-pen-script/nanum-pen-script-38efadb5.ttf', import.meta.url)).buffer as ArrayBuffer,
);

describe('reference re-grouping on a cursive Hangul font', () => {
  test("a retraced split gives way to a clean one: 갈's three joined strokes split into the template's six", async () => {
    const reference = (await createHangulProvider().get('갈'))!;
    const r = processGlyphGeometry(nanum, '갈', DEFAULT_GEOMETRY_OPTIONS, undefined, [reference])!;
    expect(r.strokeOrderRegrouped).toBe(true);
    expect(r.strokesFontUnits.length).toBe(reference.strokes.length);
    expect(r.warnings.join(' ')).not.toContain('retraced');
  });
});
