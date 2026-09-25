import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { Point } from 'tegaki';
import { parseFont, processGlyphGeometry, processGlyphGeometryById } from '../commands/generate.ts';
import { enumerateVariantGlyphIds } from '../font/enumerate-variants.ts';
import { createHangulProvider } from '../stroke-order/hangul.ts';
import { createHersheyProvider, createHersheySimplexProvider } from '../stroke-order/hershey.ts';
import type { ReferenceGlyph } from '../stroke-order/types.ts';
import { componentSlots, ligatureComponentEdges } from './ordering.ts';
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

/** A print L in two strokes, stem then foot, in a 109-unit frame like KanjiVG's. */
const PRINT_L: ReferenceGlyph = {
  char: 'L',
  source: 'print',
  license: 'test',
  viewBox: { width: 109, height: 109 },
  strokes: [line(25, 12, 25, 95), line(25, 95, 90, 95)],
};

describe('reference variants on a cursive Latin font', () => {
  test("a variant that fits the font's own strokes beats one that has to cut them (Caveat's one-stroke L)", async () => {
    const cursive = (await createHersheySimplexProvider().get('L'))!;
    const r = processGlyphGeometry(caveat, 'L', DEFAULT_GEOMETRY_OPTIONS, undefined, [PRINT_L, cursive])!;
    expect(r.reference?.source).toBe(cursive.source);
    expect(r.strokesFontUnits.length).toBe(1);
  });
});

describe('a ligature ordered letter by letter', () => {
  const ffi = [...enumerateVariantGlyphIds(caveat.font, ['f', 'i']).values()].find((v) => caveat.font.glyphs.get(v.gid).name === 'f_f_i')!;
  const hershey = createHersheyProvider();
  const components = async () =>
    Promise.all(ffi.components!.map(async (c) => ({ gid: c.gid, char: c.letter!, reference: (await hershey.get(c.letter!))! })));

  test("each letter's strokes draw before the next letter's, the i's last (Caveat's f_f_i)", async () => {
    const r = processGlyphGeometryById(
      caveat,
      ffi.gid,
      DEFAULT_GEOMETRY_OPTIONS,
      undefined,
      0,
      false,
      false,
      undefined,
      await components(),
    )!;
    const edges = ligatureComponentEdges(
      ffi.components!.map((c) => caveat.font.glyphs.get(c.gid).advanceWidth!),
      r.advanceWidth,
    );
    const slots = componentSlots(
      r.strokesFontUnits.map((s) => s.points),
      edges,
    );
    expect(slots).toEqual([...slots].sort((a, b) => a - b));
    expect(new Set(slots)).toEqual(new Set([0, 1, 2]));
  });

  test("each letter meets its own reference, registered onto that letter's ink", async () => {
    const r = processGlyphGeometryById(
      caveat,
      ffi.gid,
      DEFAULT_GEOMETRY_OPTIONS,
      undefined,
      0,
      false,
      false,
      undefined,
      await components(),
    )!;
    // The f's miss theirs and say so, by letter.
    expect(r.warnings.some((w) => w.startsWith('f: stroke order'))).toBe(true);
    const refXs = r.reference!.strokes.map((s) => Math.min(...s.points.map((p) => p.x)));
    // The i's reference sits over the i, right of both f's.
    expect(Math.max(...refXs)).toBeGreaterThan(caveat.font.glyphs.get(ffi.components![0]!.gid).advanceWidth! * 1.5);
  });
});
