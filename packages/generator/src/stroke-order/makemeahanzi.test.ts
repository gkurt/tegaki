import { describe, expect, test } from 'bun:test';
import { createMakeMeAHanziProvider, makeMeAHanziUrl, parseMakeMeAHanziJson } from './makemeahanzi.ts';

// hanzi-writer-data file for 十 (2 strokes), outlines trimmed: only the
// medians feed the reference. Frame is 1024 square, y up, baseline at 900.
const SHI_JSON = JSON.stringify({
  strokes: ['M 541 450 Z', 'M 482 444 Z'],
  medians: [
    [
      [109, 442],
      [177, 422],
      [373, 456],
      [819, 505],
      [869, 499],
      [932, 476],
    ],
    [
      [456, 811],
      [484, 803],
      [522, 767],
      [512, 593],
      [507, -33],
    ],
  ],
});

describe('makeMeAHanziUrl', () => {
  test('characters are percent-encoded under the pinned package version', () => {
    expect(makeMeAHanziUrl('十')).toBe('https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/%E5%8D%81.json');
  });
});

describe('parseMakeMeAHanziJson', () => {
  test('medians become strokes in prescribed order, attributed to the dataset', () => {
    const ref = parseMakeMeAHanziJson(SHI_JSON, '十')!;
    expect(ref.strokes.length).toBe(2);
    expect(ref.viewBox).toEqual({ width: 1024, height: 1024 });
    expect(ref.source).toBe('makemeahanzi');
    expect(ref.license).toContain('Arphic');
  });

  test('y is flipped to y-down: the horizontal runs left→right, the vertical top→bottom', () => {
    const [horizontal, vertical] = parseMakeMeAHanziJson(SHI_JSON, '十')!.strokes;
    const h = horizontal!.points;
    const v = vertical!.points;
    expect(h[0]!.x).toBe(109);
    expect(h[h.length - 1]!.x).toBe(932);
    expect(v[0]!.y).toBe(900 - 811);
    expect(v[v.length - 1]!.y).toBe(900 + 33);
    expect(v[0]!.y).toBeLessThan(v[v.length - 1]!.y);
  });

  test('malformed documents return null instead of a partial reference', () => {
    expect(parseMakeMeAHanziJson('not json', '十')).toBeNull();
    expect(parseMakeMeAHanziJson('{"strokes":[]}', '十')).toBeNull();
    expect(parseMakeMeAHanziJson('{"medians":[]}', '十')).toBeNull();
    expect(parseMakeMeAHanziJson('{"medians":[[[1,2]]]}', '十')).toBeNull();
  });
});

describe('createMakeMeAHanziProvider', () => {
  test('memoizes: the loader runs once per character', async () => {
    let calls = 0;
    const provider = createMakeMeAHanziProvider(async () => {
      calls++;
      return SHI_JSON;
    });
    const a = await provider.get('十');
    expect(await provider.get('十')).toBe(a);
    expect(calls).toBe(1);
  });

  test('characters outside the dataset resolve to null', async () => {
    expect(await createMakeMeAHanziProvider(async () => null).get('あ')).toBeNull();
  });
});
