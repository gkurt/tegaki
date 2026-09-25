import { describe, expect, test } from 'bun:test';
import { type GlyphStrokeOrderReport, summarizeStrokeOrderReports } from './stroke-order-report.ts';

const glyph = (over: Partial<GlyphStrokeOrderReport>): GlyphStrokeOrderReport => ({
  char: 'x',
  extracted: 2,
  reference: 2,
  meanCost: 0.05,
  applied: true,
  regrouped: false,
  guided: false,
  warnings: [],
  ...over,
});

describe('summarizeStrokeOrderReports', () => {
  test('aggregates coverage, agreement, and applied counts', () => {
    const s = summarizeStrokeOrderReports(
      [
        glyph({ char: 'あ' }),
        glyph({ char: 'い', extracted: 3, reference: 2, applied: false, meanCost: 0.3 }),
        glyph({ char: 'A', reference: null, meanCost: null, applied: false }),
      ],
      1,
    );
    expect(s.totalGlyphs).toBe(3);
    expect(s.missingGlyph).toBe(1);
    expect(s.withReference).toBe(2);
    expect(s.countsAgree).toBe(1);
    expect(s.applied).toBe(1);
    expect(s.meanCostApplied).toBeCloseTo(0.05);
  });

  test('regrouped counts only applied glyphs that needed re-grouping', () => {
    const s = summarizeStrokeOrderReports(
      [glyph({ char: 'あ' }), glyph({ char: '口', regrouped: true }), glyph({ char: 'い', applied: false, regrouped: false })],
      0,
    );
    expect(s.applied).toBe(2);
    expect(s.regrouped).toBe(1);
  });

  test('guided counts reference-ordered glyphs outside the applied ones', () => {
    const s = summarizeStrokeOrderReports(
      [
        glyph({ char: '한', applied: false, guided: true }),
        glyph({ char: '가' }),
        glyph({ char: 'A', reference: null, applied: false, guided: false }),
      ],
      0,
    );
    expect(s.applied).toBe(1);
    expect(s.guided).toBe(1);
  });

  test('worst count mismatches sort by |difference|, largest first', () => {
    const s = summarizeStrokeOrderReports(
      [
        glyph({ char: 'a', extracted: 3, reference: 2 }),
        glyph({ char: 'b', extracted: 9, reference: 13 }),
        glyph({ char: 'c', extracted: 5, reference: 3 }),
        glyph({ char: 'd' }),
      ],
      0,
    );
    expect(s.worstCountMismatches.map((g) => g.char)).toEqual(['b', 'c', 'a']);
  });

  test('highest-cost applied list ignores unapplied glyphs', () => {
    const s = summarizeStrokeOrderReports(
      [glyph({ char: 'a', meanCost: 0.02 }), glyph({ char: 'b', meanCost: 0.09 }), glyph({ char: 'c', applied: false, meanCost: 0.5 })],
      0,
    );
    expect(s.highestCostApplied.map((g) => g.char)).toEqual(['b', 'a']);
  });

  test('empty input yields zeroes, not NaN', () => {
    const s = summarizeStrokeOrderReports([], 0);
    expect(s.meanCostApplied).toBe(0);
    expect(s.withReference).toBe(0);
  });
});
