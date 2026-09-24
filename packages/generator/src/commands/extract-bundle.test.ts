import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_OPTIONS, extractTegakiBundle, parseFont } from './generate.ts';

const fontPath = new URL('../../../renderer/fonts/caveat/caveat.ttf', import.meta.url);

async function extract(pipeline?: 'raster' | 'geometry') {
  const fontBuffer = readFileSync(fontPath).buffer as ArrayBuffer;
  // No variant glyphs: they would dominate the runtime and add nothing here.
  const { features } = await parseFont(fontBuffer);
  return extractTegakiBundle({
    fontBuffer,
    fontFileName: 'caveat.ttf',
    chars: 'ab',
    options: { ...DEFAULT_OPTIONS, disabledFeatures: features },
    subset: false,
    ...(pipeline ? { pipeline } : {}),
  });
}

const glyphData = (files: { path: string; content: string | Uint8Array }[]) =>
  JSON.parse(files.find((f) => f.path === 'glyphData.json')!.content as string);

describe('extractTegakiBundle', () => {
  test("pipeline 'geometry' writes the geometry pipeline's strokes into the bundle", async () => {
    const bundle = await extract('geometry');
    expect(Object.keys(bundle.glyphResults)).toEqual([]);
    const data = glyphData(bundle.files);
    for (const char of ['a', 'b']) {
      const result = bundle.geometryResults![char]!;
      expect(data[char].s.length).toBe(result.strokesFontUnits.length);
      expect(data[char].s[0].p[0]).toEqual([
        result.strokesFontUnits[0]!.points[0]!.x,
        result.strokesFontUnits[0]!.points[0]!.y,
        result.strokesFontUnits[0]!.points[0]!.width,
      ]);
    }
  });

  test('the geometry pipeline is the default', async () => {
    const bundle = await extract();
    expect(Object.keys(bundle.geometryResults ?? {}).sort()).toEqual(['a', 'b']);
  });

  test("pipeline 'raster' writes the raster pipeline's strokes", async () => {
    const bundle = await extract('raster');
    expect(Object.keys(bundle.glyphResults).sort()).toEqual(['a', 'b']);
    expect(bundle.geometryResults).toBeUndefined();
  });
});
