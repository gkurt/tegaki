import { describe, expect, test } from 'bun:test';
import { DEFAULT_OPTIONS } from './commands/generate.ts';
import { buildHanziPipelineResult, type HanziWriterCharData, isHanziCharacter } from './hanzi-stroke-data.ts';

describe('hanzi stroke data', () => {
  test('detects Hanzi code points', () => {
    expect(isHanziCharacter('马')).toBe(true);
    expect(isHanziCharacter('A')).toBe(false);
  });

  test('builds ordered strokes from Hanzi Writer medians', () => {
    const data: HanziWriterCharData = {
      strokes: ['M 100 700 L 200 700', 'M 300 500 L 300 300'],
      medians: [
        [
          [100, 700],
          [200, 700],
        ],
        [
          [300, 500],
          [300, 300],
        ],
      ],
    };

    const result = buildHanziPipelineResult(
      {
        ascender: 900,
        descender: -124,
        lineCap: 'round',
        unitsPerEm: 1024,
      },
      '马',
      1024,
      DEFAULT_OPTIONS,
      data,
    );

    expect(result.dataSource).toBe('hanzi-strokes');
    expect(result.advanceWidth).toBe(1024);
    expect(result.strokes).toHaveLength(2);
    expect(result.strokesFontUnits).toHaveLength(2);
    expect(result.strokes.map((stroke) => stroke.order)).toEqual([0, 1]);
    expect(result.strokesFontUnits[0]?.points[0]).toMatchObject({ x: 100, y: 700 });
    expect(result.strokesFontUnits[1]?.points[0]).toMatchObject({ x: 300, y: 500 });
    expect(result.strokesFontUnits[0]?.delay).toBe(0);
    expect((result.strokesFontUnits[1]?.delay ?? 0) > 0).toBe(true);
  });
});
