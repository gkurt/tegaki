import { describe, expect, test } from 'bun:test';
import { createHersheyGreekProvider, createHersheyProvider, createHersheySimplexProvider } from './hershey.ts';
import { mergeRetraces, parseJhf } from './jhf.ts';
import { collectReferences } from './providers.ts';
import type { ReferenceGlyph, StrokeOrderProvider } from './types.ts';

describe('createHersheyProvider', () => {
  test('cursive letters are single pen trajectories (m, n, h)', async () => {
    const provider = createHersheyProvider();
    for (const char of ['m', 'n', 'h', 'M', 'N']) {
      const ref = await provider.get(char);
      expect(ref).not.toBeNull();
      expect(ref!.strokes.length).toBe(1);
      expect(ref!.source).toBe('hershey-script');
    }
  });

  test('detached marks stay separate strokes (i keeps its dot)', async () => {
    const provider = createHersheyProvider();
    const ref = await provider.get('i');
    expect(ref!.strokes.length).toBe(2);
  });

  test('digits and non-Latin characters have no entry', async () => {
    const provider = createHersheyProvider();
    expect(await provider.get('7')).toBeNull();
    expect(await provider.get('あ')).toBeNull();
  });

  test('results are cached per character', async () => {
    const provider = createHersheyProvider();
    const a = await provider.get('a');
    const b = await provider.get('a');
    expect(a).toBe(b!);
  });
});

describe('createHersheySimplexProvider', () => {
  test('print letters keep their pen lifts (m is arch-by-arch, not one motion)', async () => {
    const provider = createHersheySimplexProvider();
    const m = await provider.get('m');
    expect(m!.strokes.length).toBe(2);
    expect(m!.source).toBe('hershey-simplex');
    const M = await provider.get('M');
    expect(M!.strokes.length).toBe(2);
  });

  test('digits are covered, as single print trajectories where connected', async () => {
    const provider = createHersheySimplexProvider();
    for (const char of ['0', '2', '5', '8']) {
      const ref = await provider.get(char);
      expect(ref).not.toBeNull();
      expect(ref!.strokes.length).toBe(1);
    }
    const seven = await provider.get('7');
    expect(seven!.strokes.length).toBe(2);
  });

  test('non-Latin characters have no entry', async () => {
    const provider = createHersheySimplexProvider();
    expect(await provider.get('あ')).toBeNull();
  });
});

describe('createHersheyGreekProvider', () => {
  test('Greek letters take the Greek simplex glyphs, in alphabet order (λ is the 11th)', async () => {
    const provider = createHersheyGreekProvider();
    const lambda = await provider.get('λ');
    expect(lambda!.source).toBe('hershey-greek');
    expect(lambda!.strokes.length).toBe(2);
    expect((await provider.get('Ω'))!.strokes.length).toBe(1);
  });

  test('Latin letters have no entry', async () => {
    expect(await createHersheyGreekProvider().get('a')).toBeNull();
  });
});

describe('parseJhf', () => {
  // Two glyphs: a space (bearings only), then a V drawn in one stroke and a
  // bar after a pen-up, wrapped past the first line.
  const jhf = ['12345  1JZ', '12346  7JZMRRX', 'WM RMWWW'].join('\n');

  test('reads the vertex count across wrapped lines, skipping the bearings', () => {
    expect(parseJhf(jhf)).toEqual([
      [],
      [
        [
          [-5, 0],
          [0, 6],
          [5, -5],
        ],
        [
          [-5, 5],
          [5, 5],
        ],
      ],
    ]);
  });

  test('a stroke starting on a point the last one drew through joins it; one starting mid-line does not', () => {
    const apex: [number, number] = [0, -10];
    const legs = mergeRetraces([
      [apex, [-5, 10]],
      [apex, [5, 10]],
      [
        [-2, 0],
        [2, 0],
      ],
    ]);
    expect(legs).toEqual([
      [apex, [-5, 10], apex, [5, 10]],
      [
        [-2, 0],
        [2, 0],
      ],
    ]);
  });
});

describe('collectReferences', () => {
  const glyph = (source: string): ReferenceGlyph => ({
    char: 'x',
    strokes: [
      {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ],
    viewBox: { width: 10, height: 10 },
    source,
    license: 'test',
  });
  const provider = (name: string, ref: ReferenceGlyph | null, fail = false): StrokeOrderProvider => ({
    name,
    get: async () => {
      if (fail) throw new Error('boom');
      return ref;
    },
  });

  test('gathers variants in provider order, skipping misses and failures', async () => {
    const refs = await collectReferences('x', [
      provider('a', glyph('a')),
      provider('miss', null),
      provider('fail', null, true),
      provider('b', glyph('b')),
    ]);
    expect(refs.map((r) => r.source)).toEqual(['a', 'b']);
  });
});
