// Batch ink-coverage harness — the regression scoreboard for stroke
// extraction. Sweeps a character set through both pipelines and measures, per
// glyph, the share of the glyph's ink no stroke paints: the raster pipeline's
// bitmap of the outline, less every pixel within a stroke's round pen (width
// interpolated along each segment) or nib stamp, plus a tolerance in FONT
// UNITS. The bitmap is scaled per glyph (a dot is rasterized far larger than
// a letter), so a pixel tolerance would judge dots far more strictly than
// letters; a font-unit one judges them alike. Run it before and after
// pipeline changes; the summary numbers are the metric.

import type { Nib } from 'tegaki';
import type { ParsedFontInfo, PipelineOptions } from '../commands/generate.ts';
import { DEFAULT_OPTIONS, processGlyph, processGlyphGeometry } from '../commands/generate.ts';
import type { GeometryOptions } from '../geometry/types.ts';
import { DEFAULT_GEOMETRY_OPTIONS } from '../geometry/types.ts';
import { collectReferences } from '../stroke-order/providers.ts';
import type { StrokeOrderProvider } from '../stroke-order/types.ts';

/** A glyph's ink as a bitmap, with the font-unit → bitmap-pixel transform `px = (x − offset) · scale`. */
export interface InkBitmap {
  bitmap: Uint8Array;
  width: number;
  height: number;
  transform: { scaleX: number; scaleY: number; offsetX: number; offsetY: number };
}

export interface CoverageStroke {
  points: { x: number; y: number; width: number; nib?: Nib }[];
}

export interface CoverageOptions {
  /** Font units a pen may miss the ink by and still count as painting it. */
  tolerance?: number;
  /** Sample every `stride`-th pixel in both directions. */
  stride?: number;
}

const GRID_CELL = 16;

/**
 * Share (0–1) of the ink pixels (sampled at `stride`) that no stroke paints
 * within `tolerance` font units. 0 when the bitmap has no ink.
 */
export function unpaintedShare(ink: InkBitmap, strokes: CoverageStroke[], { tolerance = 2, stride = 2 }: CoverageOptions = {}): number {
  const { bitmap, width: W, height: H, transform: t } = ink;
  const s = t.scaleX;
  const tol = tolerance * s;
  const bx = (x: number) => (x - t.offsetX) * s;
  const by = (y: number) => (y - t.offsetY) * t.scaleY;

  // Pen segments [ax, ay, bx, by, ra, rb] in pixels (a lone point is a zero-length one), bucketed on a grid.
  const segs: number[][] = [];
  for (const { points: p } of strokes) {
    for (let i = p.length === 1 ? 0 : 1; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)]!;
      const b = p[i]!;
      segs.push([bx(a.x), by(a.y), bx(b.x), by(b.y), (a.width * s) / 2 + tol, (b.width * s) / 2 + tol]);
    }
  }
  const grid = new Map<number, number[]>();
  segs.forEach(([ax, ay, cx, cy, ra, rb], i) => {
    const r = Math.max(ra!, rb!);
    for (let gy = Math.floor((Math.min(ay!, cy!) - r) / GRID_CELL); gy <= Math.floor((Math.max(ay!, cy!) + r) / GRID_CELL); gy++) {
      for (let gx = Math.floor((Math.min(ax!, cx!) - r) / GRID_CELL); gx <= Math.floor((Math.max(ax!, cx!) + r) / GRID_CELL); gx++) {
        const key = gy * 1e5 + gx;
        let cell = grid.get(key);
        if (!cell) grid.set(key, (cell = []));
        cell.push(i);
      }
    }
  });
  // Nib stamps [cx, cy, semiMajor, semiMinor, cos, sin] in pixels.
  const nibs: number[][] = [];
  for (const { points } of strokes) {
    for (const p of points) {
      if (!p.nib) continue;
      const { dx, dy, major, minor, angle } = p.nib;
      nibs.push([bx(p.x + dx), by(p.y + dy), (major * s) / 2 + tol, (minor * s) / 2 + tol, Math.cos(angle), Math.sin(angle)]);
    }
  }

  const painted = (px: number, py: number): boolean => {
    for (const i of grid.get(Math.floor(py / GRID_CELL) * 1e5 + Math.floor(px / GRID_CELL)) ?? []) {
      const [ax, ay, cx, cy, ra, rb] = segs[i]!;
      const dx = cx! - ax!;
      const dy = cy! - ay!;
      const l2 = dx * dx + dy * dy;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax!) * dx + (py - ay!) * dy) / l2)) : 0;
      const r = ra! + (rb! - ra!) * u;
      const ex = ax! + dx * u - px;
      const ey = ay! + dy * u - py;
      if (ex * ex + ey * ey <= r * r) return true;
    }
    for (const [cx, cy, a, b, co, si] of nibs) {
      const u = (px - cx!) * co! + (py - cy!) * si!;
      const v = -(px - cx!) * si! + (py - cy!) * co!;
      if ((u * u) / (a! * a!) + (v * v) / (b! * b!) <= 1) return true;
    }
    return false;
  };

  let inked = 0;
  let missed = 0;
  for (let y = 0; y < H; y += stride) {
    for (let x = 0; x < W; x += stride) {
      if (!bitmap[y * W + x]) continue;
      inked++;
      if (!painted(x + 0.5, y + 0.5)) missed++;
    }
  }
  return inked > 0 ? missed / inked : 0;
}

export interface GlyphCoverageReport {
  char: string;
  /** Unpainted share of the ink (0–1) with the geometry pipeline's strokes; null when it produced none. */
  geometry: number | null;
  /** The same for the raster pipeline's strokes. */
  raster: number;
  /** The geometry pipeline's warnings for this glyph. */
  warnings: string[];
}

export interface PipelineCoverageSummary {
  /** Mean unpainted share over the glyphs the pipeline drew. */
  mean: number;
  /** Glyphs leaving more than 2% / 5% of their ink unpainted. */
  over2: number;
  over5: number;
}

export interface CoverageSummary {
  totalGlyphs: number;
  /** Chars the font has no glyph for (skipped, not counted elsewhere). */
  missingGlyph: number;
  /** Glyphs the geometry pipeline returned no strokes for. */
  geometryFailed: number;
  geometry: PipelineCoverageSummary;
  raster: PipelineCoverageSummary;
  /** Glyphs where geometry leaves at least a point (1% of the ink) more unpainted than raster, and vice versa. */
  geometryWorse: number;
  geometryBetter: number;
  /** Highest geometry unpainted share first. */
  worstGeometry: GlyphCoverageReport[];
}

function pipelineSummary(shares: number[]): PipelineCoverageSummary {
  return {
    mean: shares.length > 0 ? shares.reduce((a, b) => a + b, 0) / shares.length : 0,
    over2: shares.filter((v) => v > 0.02).length,
    over5: shares.filter((v) => v > 0.05).length,
  };
}

/** Pure aggregation over per-glyph reports (kept separate for testability). */
export function summarizeCoverageReports(glyphs: GlyphCoverageReport[], missingGlyph: number, worstN = 10): CoverageSummary {
  const drawn = glyphs.filter((g): g is GlyphCoverageReport & { geometry: number } => g.geometry !== null);
  return {
    totalGlyphs: glyphs.length,
    missingGlyph,
    geometryFailed: glyphs.length - drawn.length,
    geometry: pipelineSummary(drawn.map((g) => g.geometry)),
    raster: pipelineSummary(glyphs.map((g) => g.raster)),
    geometryWorse: drawn.filter((g) => g.geometry > g.raster + 0.01).length,
    geometryBetter: drawn.filter((g) => g.raster > g.geometry + 0.01).length,
    worstGeometry: [...drawn].sort((a, b) => b.geometry - a.geometry).slice(0, worstN),
  };
}

export interface CoverageReportResult {
  summary: CoverageSummary;
  glyphs: GlyphCoverageReport[];
}

/**
 * Run the sweep: every character through the raster pipeline (for its
 * bitmap and strokes) and the geometry pipeline (with its stroke-order
 * references, as `generate` runs it), then measure both against the bitmap.
 */
export async function runCoverageReport(
  fontInfo: ParsedFontInfo,
  chars: string,
  providers: StrokeOrderProvider[],
  options: CoverageOptions & {
    pipelineOptions?: PipelineOptions;
    geometryOptions?: GeometryOptions;
    worstN?: number;
    onProgress?: (done: number, total: number, char: string) => void;
  } = {},
): Promise<CoverageReportResult> {
  const pipelineOptions = options.pipelineOptions ?? DEFAULT_OPTIONS;
  const geometryOptions = options.geometryOptions ?? DEFAULT_GEOMETRY_OPTIONS;
  const uniqueChars = [...new Set([...chars])].filter((c) => c.trim().length > 0);
  const glyphs: GlyphCoverageReport[] = [];
  let missingGlyph = 0;

  for (let i = 0; i < uniqueChars.length; i++) {
    const char = uniqueChars[i]!;
    options.onProgress?.(i, uniqueChars.length, char);
    const raster = processGlyph(fontInfo, char, pipelineOptions);
    if (!raster) {
      missingGlyph++;
      continue;
    }
    const ink: InkBitmap = { bitmap: raster.bitmap, width: raster.bitmapWidth, height: raster.bitmapHeight, transform: raster.transform };
    const references = geometryOptions.strokeOrder === 'heuristic' ? [] : await collectReferences(char, providers).catch(() => []);
    const geo = processGlyphGeometry(fontInfo, char, geometryOptions, pipelineOptions.bezierTolerance, references);
    glyphs.push({
      char,
      geometry: geo && geo.strokesFontUnits.length > 0 ? unpaintedShare(ink, geo.strokesFontUnits, options) : null,
      raster: unpaintedShare(ink, raster.strokesFontUnits, options),
      warnings: geo?.warnings ?? [],
    });
  }
  options.onProgress?.(uniqueChars.length, uniqueChars.length, '');

  return { summary: summarizeCoverageReports(glyphs, missingGlyph, options.worstN), glyphs };
}

const pct = (share: number) => `${(100 * share).toFixed(2)}%`;

/** Human-readable console summary. */
export function formatCoverageSummary(s: CoverageSummary): string {
  const drawn = s.totalGlyphs - s.geometryFailed;
  const lines = [
    `glyphs processed:   ${s.totalGlyphs} (${s.missingGlyph} not in font, ${s.geometryFailed} without geometry strokes)`,
    '                    geometry   raster',
    `mean unpainted:     ${pct(s.geometry.mean).padEnd(10)} ${pct(s.raster.mean)}`,
    `glyphs over 2%:     ${String(s.geometry.over2).padEnd(10)} ${s.raster.over2}`,
    `glyphs over 5%:     ${String(s.geometry.over5).padEnd(10)} ${s.raster.over5}`,
    `geometry vs raster: ${s.geometryBetter}/${drawn} better, ${s.geometryWorse}/${drawn} worse (by 1+ point)`,
  ];
  if (s.worstGeometry.length > 0) {
    lines.push('', 'most unpainted with geometry (geometry / raster):');
    for (const g of s.worstGeometry) lines.push(`  ${g.char}  ${pct(g.geometry ?? 0)} / ${pct(g.raster)}`);
  }
  return lines.join('\n');
}
