import { describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as opentype from 'opentype.js';
import { charsHash } from '../constants.ts';
import { loadLocalFont } from './local.ts';

const caveatPath = new URL('../../../renderer/fonts/caveat/caveat.ttf', import.meta.url).pathname;

describe('loadLocalFont', () => {
  test("a subset takes the font's own family and the Google kit naming (<family>-<chars hash>.ttf)", async () => {
    const font = await loadLocalFont(caveatPath, 'Hello');
    expect(font.family).toBe('Caveat');
    expect(font.fontFileName).toBe(`caveat-${charsHash('Hello')}.ttf`);
    expect(font.fullFontFileName).toBe('caveat.ttf');
    const parsed = opentype.parse(font.fontBuffer);
    expect(parsed.charToGlyphIndex('H')).toBeGreaterThan(0);
    expect(parsed.charToGlyphIndex('Z')).toBe(0);
  });

  test('without chars the file is used whole, under its own name', async () => {
    const font = await loadLocalFont(caveatPath);
    expect(font.fontFileName).toBe('caveat.ttf');
    expect(font.fontBuffer.byteLength).toBe(statSync(caveatPath).size);
  });

  test('a WOFF2 file is rejected with a hint to convert it', async () => {
    const path = join(tmpdir(), `tegaki-local-font-${process.pid}.woff2`);
    await Bun.write(path, new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]));
    try {
      await expect(loadLocalFont(path, 'a')).rejects.toThrow('WOFF2 web font; convert it to TTF or OTF');
    } finally {
      await Bun.file(path).delete();
    }
  });
});
