// Batch stroke-order harness — the regression scoreboard for dataset-driven
// ordering. Sweeps a character set through the geometry pipeline with a
// StrokeOrderProvider and reports, per glyph and in aggregate, how well the
// extracted strokes line up with the dataset: count agreement, match cost,
// whether dataset order was applied, and the worst offenders to look at in
// the Studio. Run it before and after matcher/pipeline changes; the summary
// numbers are the metric.

import type { ParsedFontInfo } from '../commands/generate.ts';
import { processGlyphGeometry } from '../commands/generate.ts';
import type { GeometryOptions } from '../geometry/types.ts';
import { DEFAULT_GEOMETRY_OPTIONS } from '../geometry/types.ts';
import { matchStrokes } from '../stroke-order/match.ts';
import { collectReferences } from '../stroke-order/providers.ts';
import type { StrokeOrderProvider } from '../stroke-order/types.ts';

export interface GlyphStrokeOrderReport {
  char: string;
  /** Extracted stroke count (geometry pipeline). */
  extracted: number;
  /** Reference stroke count, or null when the dataset has no entry. */
  reference: number | null;
  /** Mean match cost (fraction of glyph diagonal), null without a reference. */
  meanCost: number | null;
  /** True when the pipeline applied dataset order for this glyph. */
  applied: boolean;
  /** True when applying required re-grouping the strokes (split/merge to the dataset segmentation). */
  regrouped: boolean;
  /** True when no 1:1 match held but the strokes were ordered along the reference instead. */
  guided: boolean;
  warnings: string[];
}

export interface StrokeOrderSummary {
  totalGlyphs: number;
  /** Chars the font has no glyph for (skipped, not counted elsewhere). */
  missingGlyph: number;
  /** Glyphs the dataset covers. */
  withReference: number;
  /** Of withReference: stroke counts agree exactly. */
  countsAgree: number;
  /** Of withReference: dataset order was applied. */
  applied: number;
  /** Of applied: needed stroke re-grouping (split/merge) to match the dataset. */
  regrouped: number;
  /** Of withReference: not applied, but ordered along the reference. */
  guided: number;
  /** Mean cost over applied glyphs (0 when none). */
  meanCostApplied: number;
  /** Worst count mismatches, largest |extracted - reference| first. */
  worstCountMismatches: GlyphStrokeOrderReport[];
  /** Applied glyphs with the highest residual cost (registration/matcher watchlist). */
  highestCostApplied: GlyphStrokeOrderReport[];
}

/** Pure aggregation over per-glyph reports (kept separate for testability). */
export function summarizeStrokeOrderReports(glyphs: GlyphStrokeOrderReport[], missingGlyph: number, worstN = 10): StrokeOrderSummary {
  const withRef = glyphs.filter((g) => g.reference !== null);
  const agree = withRef.filter((g) => g.extracted === g.reference);
  const applied = withRef.filter((g) => g.applied);
  const meanCostApplied = applied.length > 0 ? applied.reduce((s, g) => s + (g.meanCost ?? 0), 0) / applied.length : 0;

  const worstCountMismatches = withRef
    .filter((g) => g.extracted !== g.reference)
    .sort((a, b) => Math.abs(b.extracted - (b.reference ?? 0)) - Math.abs(a.extracted - (a.reference ?? 0)))
    .slice(0, worstN);
  const highestCostApplied = [...applied].sort((a, b) => (b.meanCost ?? 0) - (a.meanCost ?? 0)).slice(0, worstN);

  return {
    totalGlyphs: glyphs.length,
    missingGlyph,
    withReference: withRef.length,
    countsAgree: agree.length,
    applied: applied.length,
    regrouped: applied.filter((g) => g.regrouped).length,
    guided: withRef.filter((g) => g.guided).length,
    meanCostApplied,
    worstCountMismatches,
    highestCostApplied,
  };
}

export interface StrokeOrderReportResult {
  summary: StrokeOrderSummary;
  glyphs: GlyphStrokeOrderReport[];
}

/**
 * Run the sweep: every character through the geometry pipeline (strokeOrder
 * 'auto' unless overridden) with its dataset reference. Characters without a
 * font glyph are counted but not reported per-glyph.
 */
export async function runStrokeOrderReport(
  fontInfo: ParsedFontInfo,
  chars: string,
  provider: StrokeOrderProvider | StrokeOrderProvider[],
  options: { geometryOptions?: GeometryOptions; onProgress?: (done: number, total: number, char: string) => void } = {},
): Promise<StrokeOrderReportResult> {
  const providers = Array.isArray(provider) ? provider : [provider];
  const geometryOptions = options.geometryOptions ?? DEFAULT_GEOMETRY_OPTIONS;
  const uniqueChars = [...new Set([...chars])].filter((c) => c.trim().length > 0);
  const glyphs: GlyphStrokeOrderReport[] = [];
  let missingGlyph = 0;

  for (let i = 0; i < uniqueChars.length; i++) {
    const char = uniqueChars[i]!;
    options.onProgress?.(i, uniqueChars.length, char);
    const references = await collectReferences(char, providers);
    const result = processGlyphGeometry(fontInfo, char, geometryOptions, undefined, references);
    if (!result) {
      missingGlyph++;
      continue;
    }
    let meanCost: number | null = null;
    if (result.reference) {
      const bb = result.pathBBox;
      const diag = Math.hypot(bb.x2 - bb.x1, bb.y2 - bb.y1);
      meanCost = matchStrokes(
        result.geoStrokes.map((g) => g.points),
        result.reference.strokes.map((s) => s.points),
        diag,
      ).meanCost;
    }
    glyphs.push({
      char,
      extracted: result.strokesFontUnits.length,
      reference: result.reference ? result.reference.strokes.length : null,
      meanCost,
      applied: result.strokeOrderSource === 'dataset',
      regrouped: result.strokeOrderRegrouped === true,
      guided: result.strokeOrderSource === 'guided',
      warnings: result.warnings,
    });
  }
  options.onProgress?.(uniqueChars.length, uniqueChars.length, '');

  return { summary: summarizeStrokeOrderReports(glyphs, missingGlyph), glyphs };
}

const pct = (part: number, whole: number) => (whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : 'n/a');

/** Human-readable console summary. */
export function formatStrokeOrderSummary(s: StrokeOrderSummary): string {
  const lines = [
    `glyphs processed:   ${s.totalGlyphs} (${s.missingGlyph} not in font)`,
    `dataset coverage:   ${s.withReference}/${s.totalGlyphs} (${pct(s.withReference, s.totalGlyphs)})`,
    `count agreement:    ${s.countsAgree}/${s.withReference} (${pct(s.countsAgree, s.withReference)})`,
    `dataset applied:    ${s.applied}/${s.withReference} (${pct(s.applied, s.withReference)})`,
    `  via re-grouping:  ${s.regrouped}/${s.applied} (${pct(s.regrouped, s.applied)})`,
    `reference-guided:   ${s.guided}/${s.withReference} (${pct(s.guided, s.withReference)})`,
    `mean cost (applied): ${s.meanCostApplied.toFixed(4)}`,
  ];
  if (s.worstCountMismatches.length > 0) {
    lines.push('', 'worst count mismatches (extracted/reference):');
    for (const g of s.worstCountMismatches) lines.push(`  ${g.char}  ${g.extracted}/${g.reference}`);
  }
  if (s.highestCostApplied.length > 0) {
    lines.push('', 'highest-cost applied matches:');
    for (const g of s.highestCostApplied) lines.push(`  ${g.char}  cost ${(g.meanCost ?? 0).toFixed(4)}`);
  }
  return lines.join('\n');
}
