// The quality gate over the shipped bundles: one pass per glyph through both
// pipelines scores what coverage-report and stroke-order-report measure (the
// ink the geometry strokes leave unpainted, and how the strokes were
// ordered), compact enough to commit as a baseline. `compareScoreboards`
// judges a fresh run against that baseline — per glyph, so one letter
// breaking is not averaged away by a thousand that didn't — and CI fails on
// its regressions.

import type { ParsedFontInfo, PipelineOptions } from '../commands/generate.ts';
import { DEFAULT_OPTIONS, processGlyph, processGlyphGeometry } from '../commands/generate.ts';
import type { GeometryOptions } from '../geometry/types.ts';
import { DEFAULT_GEOMETRY_OPTIONS } from '../geometry/types.ts';
import { collectReferences } from '../stroke-order/providers.ts';
import type { StrokeOrderProvider } from '../stroke-order/types.ts';
import { glyphCoverage } from './coverage-report.ts';
import { glyphStrokeOrder } from './stroke-order-report.ts';

/** How a glyph's strokes were ordered, best first: 1:1 with the reference, along it, or by the heuristic. */
export type StrokeOrderKind = 'dataset' | 'guided' | 'heuristic';

export interface ScoreboardGlyph {
  /** Share (0–1) of the ink the geometry pipeline's strokes leave unpainted; null when it drew no strokes. */
  geometry: number | null;
  /** The same for the raster pipeline — for comparison only, it does not gate. */
  raster: number;
  /** Geometry strokes drawn. */
  strokes: number;
  /** Strokes in the glyph's stroke-order reference; null without one. */
  reference: number | null;
  order: StrokeOrderKind;
}

export interface Scoreboard {
  family: string;
  /** By character, in the order swept. */
  glyphs: Record<string, ScoreboardGlyph>;
  /** Characters swept that the font has no glyph for. */
  missing: string[];
}

/** Four decimals: a hundredth of a percentage point, far finer than any threshold, and stable JSON. */
const round = (share: number) => Math.round(share * 1e4) / 1e4;

/** Sweep `chars` through both pipelines, as `generate` runs them, scoring each glyph once. */
export async function runScoreboard(
  fontInfo: ParsedFontInfo,
  family: string,
  chars: string,
  providers: StrokeOrderProvider[],
  options: {
    pipelineOptions?: PipelineOptions;
    geometryOptions?: GeometryOptions;
    onProgress?: (done: number, total: number, char: string) => void;
  } = {},
): Promise<Scoreboard> {
  const pipelineOptions = options.pipelineOptions ?? DEFAULT_OPTIONS;
  const geometryOptions = options.geometryOptions ?? DEFAULT_GEOMETRY_OPTIONS;
  const uniqueChars = [...new Set([...chars])].filter((c) => c.trim().length > 0);
  const board: Scoreboard = { family, glyphs: {}, missing: [] };

  for (let i = 0; i < uniqueChars.length; i++) {
    const char = uniqueChars[i]!;
    options.onProgress?.(i, uniqueChars.length, char);
    const raster = processGlyph(fontInfo, char, pipelineOptions);
    if (!raster) {
      board.missing.push(char);
      continue;
    }
    const references = geometryOptions.strokeOrder === 'heuristic' ? [] : await collectReferences(char, providers);
    const geo = processGlyphGeometry(fontInfo, char, geometryOptions, pipelineOptions.bezierTolerance, references);
    const coverage = glyphCoverage(char, raster, geo);
    const order = geo ? glyphStrokeOrder(char, geo) : null;
    board.glyphs[char] = {
      geometry: coverage.geometry === null ? null : round(coverage.geometry),
      raster: round(coverage.raster),
      strokes: order?.extracted ?? 0,
      reference: order?.reference ?? null,
      order: order?.applied ? 'dataset' : order?.guided ? 'guided' : 'heuristic',
    };
  }
  options.onProgress?.(uniqueChars.length, uniqueChars.length, '');
  return board;
}

export interface ScoreboardSummary {
  glyphs: number;
  /** Glyphs the geometry pipeline drew no strokes for. */
  geometryFailed: number;
  /** Mean unpainted share over the glyphs geometry drew. */
  geometryMean: number;
  /** Glyphs geometry leaves more than 2% / 5% of the ink unpainted. */
  geometryOver2: number;
  geometryOver5: number;
  rasterMean: number;
  /** Glyphs with a stroke-order reference; of those, stroke counts equal, ordered 1:1, and guided by it (ordered along it, or oriented by it). */
  withReference: number;
  countsAgree: number;
  dataset: number;
  guided: number;
}

export function summarizeScoreboard(board: Scoreboard): ScoreboardSummary {
  const glyphs = Object.values(board.glyphs);
  const drawn = glyphs.map((g) => g.geometry).filter((v): v is number => v !== null);
  const withRef = glyphs.filter((g) => g.reference !== null);
  const mean = (values: number[]) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  return {
    glyphs: glyphs.length,
    geometryFailed: glyphs.length - drawn.length,
    geometryMean: mean(drawn),
    geometryOver2: drawn.filter((v) => v > 0.02).length,
    geometryOver5: drawn.filter((v) => v > 0.05).length,
    rasterMean: mean(glyphs.map((g) => g.raster)),
    withReference: withRef.length,
    countsAgree: withRef.filter((g) => g.strokes === g.reference).length,
    dataset: withRef.filter((g) => g.order === 'dataset').length,
    guided: withRef.filter((g) => g.order === 'guided').length,
  };
}

export interface ScoreboardThresholds {
  /** A glyph regresses when geometry leaves more than this share (of its ink) more unpainted. */
  glyphCoverage: number;
  /** The font regresses when the mean unpainted share rises by more than this. */
  meanCoverage: number;
}

/** One percentage point per glyph; a tenth of one on the mean, which catches many glyphs slipping a little. */
export const DEFAULT_SCOREBOARD_THRESHOLDS: ScoreboardThresholds = { glyphCoverage: 0.01, meanCoverage: 0.001 };

export interface ScoreboardChange {
  char: string;
  /** What changed, e.g. `unpainted 0.40% → 2.10%` or `order dataset → guided`. */
  what: string;
}

export interface ScoreboardComparison {
  baseline: ScoreboardSummary;
  current: ScoreboardSummary;
  /** Changes that fail the gate. */
  regressions: ScoreboardChange[];
  /** Changes for the better — the baseline is stale until updated to hold them. */
  improvements: ScoreboardChange[];
  /** Characters in only one of the two runs: the swept set changed, so the baseline needs updating. */
  added: string[];
  removed: string[];
}

const ORDER_RANK: Record<StrokeOrderKind, number> = { heuristic: 0, guided: 1, dataset: 2 };

/** Did the stroke count grow from `from` to `to` by at least half again, and at least 3 strokes? */
const fragmented = (from: number, to: number) => to - from >= 3 && to >= from * 1.5;
const pct = (share: number) => `${(100 * share).toFixed(2)}%`;

/** Judge `current` against `baseline`, glyph by glyph and on the mean. */
export function compareScoreboards(
  baseline: Scoreboard,
  current: Scoreboard,
  thresholds: ScoreboardThresholds = DEFAULT_SCOREBOARD_THRESHOLDS,
): ScoreboardComparison {
  const regressions: ScoreboardChange[] = [];
  const improvements: ScoreboardChange[] = [];

  for (const [char, cur] of Object.entries(current.glyphs)) {
    const base = baseline.glyphs[char];
    if (!base) continue;

    if (base.geometry !== null && cur.geometry === null) regressions.push({ char, what: 'geometry draws no strokes' });
    else if (base.geometry === null && cur.geometry !== null) improvements.push({ char, what: 'geometry draws strokes again' });
    else if (base.geometry !== null && cur.geometry !== null) {
      const what = `unpainted ${pct(base.geometry)} → ${pct(cur.geometry)}`;
      if (cur.geometry - base.geometry > thresholds.glyphCoverage) regressions.push({ char, what });
      else if (base.geometry - cur.geometry > thresholds.glyphCoverage) improvements.push({ char, what });
    }

    if (base.reference !== null && cur.reference !== null) {
      const what = `order ${base.order} → ${cur.order}`;
      if (ORDER_RANK[cur.order] < ORDER_RANK[base.order]) regressions.push({ char, what });
      else if (ORDER_RANK[cur.order] > ORDER_RANK[base.order]) improvements.push({ char, what });

      const agreed = base.strokes === base.reference;
      const agrees = cur.strokes === cur.reference;
      const counts = `strokes ${base.strokes}/${base.reference} → ${cur.strokes}/${cur.reference}`;
      if (agreed && !agrees) regressions.push({ char, what: counts });
      else if (!agreed && agrees) improvements.push({ char, what: counts });
      if (agreed !== agrees) continue;
    }

    // A glyph shattering into fragments (or healing), with or without a reference to count against.
    const counts = `strokes ${base.strokes} → ${cur.strokes}`;
    if (fragmented(base.strokes, cur.strokes)) regressions.push({ char, what: counts });
    else if (fragmented(cur.strokes, base.strokes)) improvements.push({ char, what: counts });
  }

  // The mean over the glyphs both runs drew, so a changed character set doesn't move it.
  const shared = Object.keys(current.glyphs).filter((c) => baseline.glyphs[c]?.geometry != null && current.glyphs[c]!.geometry !== null);
  const meanOf = (b: Scoreboard) => (shared.length > 0 ? shared.reduce((sum, c) => sum + b.glyphs[c]!.geometry!, 0) / shared.length : 0);
  const [meanBase, meanCur] = [meanOf(baseline), meanOf(current)];
  const meanWhat = `mean unpainted ${pct(meanBase)} → ${pct(meanCur)}`;
  if (meanCur - meanBase > thresholds.meanCoverage) regressions.push({ char: '(all)', what: meanWhat });
  else if (meanBase - meanCur > thresholds.meanCoverage) improvements.push({ char: '(all)', what: meanWhat });

  return {
    baseline: summarizeScoreboard(baseline),
    current: summarizeScoreboard(current),
    regressions,
    improvements,
    added: Object.keys(current.glyphs).filter((c) => !(c in baseline.glyphs)),
    removed: Object.keys(baseline.glyphs).filter((c) => !(c in current.glyphs)),
  };
}

/**
 * A baseline file: one glyph per line, so a pipeline change's diff reads
 * glyph by glyph in review.
 */
export function serializeScoreboard(board: Scoreboard): string {
  const glyphs = Object.entries(board.glyphs).map(([char, g]) => `    ${JSON.stringify(char)}: ${JSON.stringify(g)}`);
  return [
    '{',
    `  "family": ${JSON.stringify(board.family)},`,
    `  "missing": ${JSON.stringify(board.missing)},`,
    `  "summary": ${JSON.stringify(summarizeScoreboard(board), (_, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v))},`,
    '  "glyphs": {',
    glyphs.join(',\n'),
    '  }',
    '}',
    '',
  ].join('\n');
}

/** Read a baseline written by {@link serializeScoreboard} (its `summary` is derived, so it is ignored). */
export function parseScoreboard(json: string): Scoreboard {
  const { family, glyphs, missing } = JSON.parse(json) as Scoreboard;
  return { family, glyphs, missing: missing ?? [] };
}

const MAX_LISTED = 40;

/** A Markdown code span that holds any character, a backtick included. */
const code = (text: string) => (text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``);

/** Markdown for a PR's job summary: the headline numbers, then every regression and improvement. */
export function formatScoreboardComparison(name: string, c: ScoreboardComparison): string {
  const b = c.baseline;
  const n = c.current;
  const signed = (d: number, format: (v: number) => string) => (d === 0 ? '' : `${d > 0 ? '+' : '−'}${format(Math.abs(d))}`);
  const count = (label: string, key: keyof ScoreboardSummary, of?: keyof ScoreboardSummary) =>
    `| ${label} | ${b[key]}${of ? `/${b[of]}` : ''} | ${n[key]}${of ? `/${n[of]}` : ''} | ${signed(n[key] - b[key], String)} |`;
  const share = (label: string, key: 'geometryMean' | 'rasterMean') =>
    `| ${label} | ${pct(b[key])} | ${pct(n[key])} | ${signed(n[key] - b[key], pct)} |`;

  const status =
    c.regressions.length > 0 ? `❌ ${c.regressions.length} regression${c.regressions.length === 1 ? '' : 's'}` : '✅ no regressions';
  const lines = [
    `### ${name} — ${status}`,
    '',
    '| | baseline | current | Δ |',
    '|---|---|---|---|',
    share('geometry mean unpainted', 'geometryMean'),
    count('geometry glyphs over 2%', 'geometryOver2', 'glyphs'),
    count('geometry glyphs over 5%', 'geometryOver5', 'glyphs'),
    count('geometry drew nothing', 'geometryFailed', 'glyphs'),
    count('stroke counts match reference', 'countsAgree', 'withReference'),
    count('ordered 1:1 by reference', 'dataset', 'withReference'),
    count('guided by reference (order or pen direction)', 'guided', 'withReference'),
    share('raster mean unpainted (not gated)', 'rasterMean'),
  ];
  const list = (title: string, changes: ScoreboardChange[]) => {
    if (changes.length === 0) return;
    lines.push('', `**${title}** (${changes.length})`, '');
    for (const ch of changes.slice(0, MAX_LISTED)) lines.push(`- ${code(ch.char)} ${ch.what}`);
    if (changes.length > MAX_LISTED) lines.push(`- … and ${changes.length - MAX_LISTED} more`);
  };
  list('Regressions', c.regressions);
  list('Improvements', c.improvements);
  if (c.added.length > 0 || c.removed.length > 0) {
    lines.push('', `**Swept set changed:** ${c.added.length} added, ${c.removed.length} removed — update the baseline.`);
  }
  return lines.join('\n');
}
