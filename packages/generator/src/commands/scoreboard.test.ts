import { describe, expect, test } from 'bun:test';
import {
  compareScoreboards,
  formatScoreboardComparison,
  parseScoreboard,
  type Scoreboard,
  type ScoreboardGlyph,
  serializeScoreboard,
  summarizeScoreboard,
} from './scoreboard.ts';

const glyph = (over: Partial<ScoreboardGlyph> = {}): ScoreboardGlyph => ({
  geometry: 0.004,
  raster: 0.02,
  strokes: 2,
  reference: 2,
  order: 'dataset',
  ...over,
});

const board = (glyphs: Record<string, ScoreboardGlyph>): Scoreboard => ({ family: 'Test', glyphs, missing: [] });

/** The regressions and improvements of `current` against `baseline`, as `char: what` lines. */
const changes = (baseline: Scoreboard, current: Scoreboard) => {
  const c = compareScoreboards(baseline, current);
  return { regressions: c.regressions.map((r) => `${r.char}: ${r.what}`), improvements: c.improvements.map((r) => `${r.char}: ${r.what}`) };
};

describe('compareScoreboards', () => {
  test('an unchanged run has nothing to report', () => {
    const b = board({ a: glyph(), b: glyph({ reference: null, order: 'heuristic' }) });
    expect(changes(b, b)).toEqual({ regressions: [], improvements: [] });
  });

  test('a glyph losing more than a point of coverage regresses, even when the mean barely moves', () => {
    const glyphs = Object.fromEntries([...'abcdefghijklmnopqrstuvwxyz'].map((c) => [c, glyph()]));
    const worse = { ...glyphs, q: glyph({ geometry: 0.02 }) };
    expect(changes(board(glyphs), board(worse)).regressions).toEqual(['q: unpainted 0.40% → 2.00%']);
  });

  test('drift within a point is not a regression', () => {
    const glyphs = Object.fromEntries([...'abcdefghijklmnopqrst'].map((c) => [c, glyph()]));
    expect(changes(board(glyphs), board({ ...glyphs, a: glyph({ geometry: 0.009 }) })).regressions).toEqual([]);
  });

  test('many glyphs slipping a little regress on the mean', () => {
    const glyphs = (geometry: number) => Object.fromEntries([...'abcdefghij'].map((c) => [c, glyph({ geometry })]));
    expect(changes(board(glyphs(0.004)), board(glyphs(0.009))).regressions).toEqual(['(all): mean unpainted 0.40% → 0.90%']);
  });

  test('a glyph the geometry pipeline stops drawing regresses', () => {
    expect(changes(board({ a: glyph() }), board({ a: glyph({ geometry: null, strokes: 0 }) })).regressions).toContain(
      'a: geometry draws no strokes',
    );
  });

  test('falling from dataset order to the heuristic regresses; the reverse improves', () => {
    const dataset = board({ a: glyph() });
    const heuristic = board({ a: glyph({ order: 'heuristic' }) });
    expect(changes(dataset, heuristic).regressions).toEqual(['a: order dataset → heuristic']);
    expect(changes(heuristic, dataset).improvements).toEqual(['a: order heuristic → dataset']);
  });

  test('losing the reference stroke count regresses', () => {
    expect(changes(board({ a: glyph() }), board({ a: glyph({ strokes: 3, order: 'guided' }) })).regressions).toEqual([
      'a: order dataset → guided',
      'a: strokes 2/2 → 3/2',
    ]);
  });

  test('a glyph shattering into fragments regresses, with or without a reference', () => {
    const plain = (strokes: number) => glyph({ strokes, reference: null, order: 'heuristic' });
    expect(changes(board({ F: plain(3) }), board({ F: plain(85) })).regressions).toEqual(['F: strokes 3 → 85']);
    expect(changes(board({ F: plain(85) }), board({ F: plain(3) })).improvements).toEqual(['F: strokes 85 → 3']);
    // One stroke more is a different segmentation, not a shattered glyph.
    expect(changes(board({ F: plain(3) }), board({ F: plain(4) })).regressions).toEqual([]);
  });

  test('a changed character set is reported, not judged', () => {
    const c = compareScoreboards(board({ a: glyph(), b: glyph() }), board({ a: glyph(), c: glyph({ geometry: 0.5 }) }));
    expect(c.regressions).toEqual([]);
    expect(c.added).toEqual(['c']);
    expect(c.removed).toEqual(['b']);
  });
});

describe('summarizeScoreboard', () => {
  test('counts reference agreement only over glyphs with a reference', () => {
    const s = summarizeScoreboard(
      board({
        a: glyph(),
        b: glyph({ strokes: 3, order: 'guided' }),
        c: glyph({ reference: null, order: 'heuristic' }),
        d: glyph({ geometry: null, strokes: 0, reference: null, order: 'heuristic' }),
      }),
    );
    expect(s).toMatchObject({ glyphs: 4, geometryFailed: 1, withReference: 2, countsAgree: 1, dataset: 1, guided: 1 });
    expect(s.geometryMean).toBeCloseTo(0.004, 9);
  });
});

describe('serializeScoreboard', () => {
  test('round-trips through parseScoreboard, one glyph per line', () => {
    const b = board({ a: glyph(), '"': glyph({ geometry: null }) });
    const json = serializeScoreboard(b);
    expect(parseScoreboard(json)).toEqual(b);
    expect(json.split('\n').filter((line) => line.includes('"strokes"'))).toHaveLength(2);
  });
});

describe('formatScoreboardComparison', () => {
  test('a backtick glyph stays inside its code span', () => {
    const md = formatScoreboardComparison('Test', compareScoreboards(board({ '`': glyph() }), board({ '`': glyph({ geometry: 0.05 }) })));
    expect(md).toContain('- `` ` `` unpainted 0.40% → 5.00%');
  });
});
