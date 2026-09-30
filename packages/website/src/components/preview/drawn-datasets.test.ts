import { describe, expect, test } from 'bun:test';
import { parseDrawnDataset } from 'tegaki-generator';
import { drawnDatasets, drawnProviders, drawnSetKey, getDrawnDatasets } from './drawn-datasets.ts';

// Outside a browser the store keeps its datasets in memory only.
const entry = (id: string) => getDrawnDatasets().entries.find((e) => e.id === id)!;

describe('drawn datasets store', () => {
  test('a new dataset is switched on, selected, and named apart from the others', () => {
    const a = drawnDatasets.create('Hand');
    const b = drawnDatasets.create('Hand');
    expect(getDrawnDatasets().selectedId).toBe(b);
    expect(entry(a).dataset.name).toBe('Hand');
    expect(entry(b).dataset.name).toBe('Hand 2');
    expect(entry(b).enabled).toBe(true);
    drawnDatasets.remove(a);
    drawnDatasets.remove(b);
  });

  test('strokes go on in pen order, the last comes off with undo, and an empty glyph is dropped', () => {
    const id = drawnDatasets.create('Order');
    drawnDatasets.addStroke(id, 't', [
      [0, -700],
      [0, 0],
    ]);
    drawnDatasets.addStroke(id, 't', [
      [-150, -450],
      [150, -450],
    ]);
    expect(entry(id).dataset.glyphs.t).toHaveLength(2);
    drawnDatasets.undoStroke(id, 't');
    expect(entry(id).dataset.glyphs.t).toEqual([
      [
        [0, -700],
        [0, 0],
      ],
    ]);
    drawnDatasets.clearGlyph(id, 't');
    expect(entry(id).dataset.glyphs).toEqual({});
    drawnDatasets.remove(id);
  });

  test('a downloaded file uploads back as the same dataset, beside the original', () => {
    const id = drawnDatasets.create('Round trip');
    drawnDatasets.addStroke(id, 'o', [
      [0, -500],
      [-200, -250],
      [0, 0],
    ]);
    const file = drawnDatasets.serialize(id);
    expect(parseDrawnDataset(file)).toEqual(entry(id).dataset);
    const copy = drawnDatasets.upload(file);
    expect(entry(copy).dataset.name).toBe('Round trip 2');
    expect(entry(copy).dataset.glyphs).toEqual(entry(id).dataset.glyphs);
    drawnDatasets.remove(id);
    drawnDatasets.remove(copy);
  });

  test('only the datasets switched on are consulted, and their providers follow the edits', async () => {
    const id = drawnDatasets.create('Live');
    const [provider] = drawnProviders();
    expect(await provider!.get('x')).toBeNull();
    drawnDatasets.addStroke(id, 'x', [
      [-200, -500],
      [200, 0],
    ]);
    expect((await provider!.get('x'))?.strokes).toHaveLength(1);
    drawnDatasets.setEnabled(id, false);
    expect(drawnProviders()).toEqual([]);
    expect(drawnSetKey()).toBe('');
    drawnDatasets.remove(id);
  });

  test('removing the selected dataset selects the next one left', () => {
    const a = drawnDatasets.create('A');
    const b = drawnDatasets.create('B');
    drawnDatasets.remove(b);
    expect(getDrawnDatasets().selectedId).toBe(a);
    drawnDatasets.remove(a);
    expect(getDrawnDatasets().selectedId).toBeNull();
  });
});
