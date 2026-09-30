import { describe, expect, test } from 'bun:test';
import { createDrawnDataset, createDrawnDatasetProvider, type DrawnDataset, parseDrawnDataset } from './drawn.ts';

const DATASET: DrawnDataset = {
  ...createDrawnDataset('My hand'),
  glyphs: {
    t: [
      [
        [300, -700],
        [300, 0],
      ],
      [
        [150, -450],
        [450, -450],
      ],
    ],
  },
};

describe('drawn datasets', () => {
  test('a downloaded dataset reads back as it was written', () => {
    expect(parseDrawnDataset(JSON.stringify(DATASET))).toEqual(DATASET);
  });

  test('a file that is not a dataset is refused with where it goes wrong', () => {
    expect(() => parseDrawnDataset('{')).toThrow('Not a JSON file');
    expect(() => parseDrawnDataset(JSON.stringify({ ...DATASET, format: 'svg' }))).toThrow('at format');
    expect(() => parseDrawnDataset(JSON.stringify({ ...DATASET, glyphs: { t: [[[1]]] } }))).toThrow('at glyphs.t.0.0');
  });

  test('the provider offers the strokes in pen order, named by the dataset, in an em frame', async () => {
    const ref = await createDrawnDatasetProvider(DATASET).get('t');
    expect(ref?.source).toBe('My hand');
    expect(ref?.viewBox).toEqual({ width: 1000, height: 1000 });
    expect(ref?.strokes.map((s) => s.points)).toEqual([
      [
        { x: 300, y: -700 },
        { x: 300, y: 0 },
      ],
      [
        { x: 150, y: -450 },
        { x: 450, y: -450 },
      ],
    ]);
  });

  test('a character with no drawing, or none left, has no reference', async () => {
    const provider = createDrawnDatasetProvider({ ...DATASET, glyphs: { ...DATASET.glyphs, x: [] } });
    expect(await provider.get('x')).toBeNull();
    expect(await provider.get('constructor')).toBeNull();
  });

  test('a live dataset answers with its current drawing, under a new revision', async () => {
    let current = DATASET;
    const provider = createDrawnDatasetProvider(() => current);
    const before = await provider.get('t');
    current = { ...DATASET, glyphs: { t: DATASET.glyphs.t!.slice(0, 1) } };
    const after = await provider.get('t');
    expect(after?.strokes).toHaveLength(1);
    expect(after?.revision).not.toBe(before?.revision);
    expect((await provider.get('t'))?.revision).toBe(after?.revision);
  });
});
