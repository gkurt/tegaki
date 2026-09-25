import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as opentype from 'opentype.js';
import { subsetFont } from '../font/subset.ts';
import { DEFAULT_GEOMETRY_OPTIONS } from '../geometry/types.ts';
import { DEFAULT_OPTIONS, extractTegakiBundle, generateArgsSchema, parseFont, pickGeometryOptions } from './generate.ts';

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

describe('extractTegakiBundle with extra font subsets', () => {
  const amiriPath = new URL('../../../renderer/fonts/amiri/amiri.ttf', import.meta.url);
  // Split like Fontsource's subsets: both have "(", only the Latin one ")".
  const split = (async () => {
    const amiri = readFileSync(amiriPath);
    const latin = (await subsetFont(amiri, 'a()')).slice().buffer as ArrayBuffer;
    const arabic = (await subsetFont(amiri, '(ل')).slice().buffer as ArrayBuffer;
    const bundle = await extractTegakiBundle({
      fontBuffer: latin,
      fontFileName: 'amiri.ttf',
      extraFontBuffers: [arabic],
      requestedFamily: 'Amiri',
      chars: 'a(ل',
      options: DEFAULT_OPTIONS,
      subset: false,
    });
    const file = (path: string) => bundle.files.find((f) => f.path === path)?.content;
    return { latin: opentype.parse(latin), arabic: opentype.parse(arabic), arabicBuffer: arabic, bundle, file };
  })();

  test('each extra subset ships as its own file beside the primary', async () => {
    const { arabicBuffer, file } = await split;
    expect(file('amiri-1.ttf')).toEqual(new Uint8Array(arabicBuffer));
  });

  test('bundle.ts registers the extra subset for only the characters it draws — not the primary\'s "("', async () => {
    const { file } = await split;
    const module = file('bundle.ts') as string;
    expect(module).toContain(`import extraFontUrl1 from './amiri-1.ttf' with { type: 'url' };`);
    expect(module).toContain('  extraFontUrls: [extraFontUrl1],');
    expect(module).toContain('  extraFontRanges: ["U+644"],');
    expect(module).toContain(`@font-face { font-family: 'Amiri'; src: url(\${extraFontUrl1}); unicode-range: U+644; }`);
  });

  test('variants of characters an extra subset draws are keyed "<subset>:<gid>", as the shaper reports them', async () => {
    const { latin, arabic, file } = await split;
    const byId = JSON.parse(file('glyphDataById.json') as string);
    expect(byId[`1:${arabic.charToGlyphIndex('ل')}`]).toBeDefined();
    expect(byId[String(latin.charToGlyphIndex('('))]).toBeDefined();
    expect(byId[`1:${arabic.charToGlyphIndex('(')}`]).toBeUndefined();
  });
});

describe('generate args', () => {
  test('the geometry flags default to DEFAULT_GEOMETRY_OPTIONS', () => {
    expect(pickGeometryOptions(generateArgsSchema.parse({}))).toEqual(DEFAULT_GEOMETRY_OPTIONS);
  });

  test('a geometry flag reaches the geometry options, and only those', () => {
    const args = generateArgsSchema.parse({ inkSpurTolerance: 2, resolution: 123 });
    expect(pickGeometryOptions(args)).toEqual({ ...DEFAULT_GEOMETRY_OPTIONS, inkSpurTolerance: 2 });
  });
});
