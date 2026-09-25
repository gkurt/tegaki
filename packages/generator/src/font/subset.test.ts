import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as opentype from 'opentype.js';
import { subsetFont } from './subset.ts';

const fontBytes = (dir: string) => new Uint8Array(readFileSync(new URL(`../../../renderer/fonts/${dir}/${dir}.ttf`, import.meta.url)));
const gsubFeatures = (font: opentype.Font) => new Set(((font.tables.gsub?.features ?? []) as { tag: string }[]).map((f) => f.tag));

describe('subsetFont', () => {
  test('keeps exactly the requested characters, and the file shrinks', async () => {
    const full = fontBytes('klee-one');
    const out = await subsetFont(full, 'あ中A');
    const font = opentype.parse(out.buffer as ArrayBuffer);
    for (const char of 'あ中A') expect(font.charToGlyphIndex(char)).toBeGreaterThan(0);
    for (const char of 'い日B') expect(font.charToGlyphIndex(char)).toBe(0);
    expect(out.byteLength).toBeLessThan(full.byteLength / 10);
  });

  test("layout features survive whether or not they are on HarfBuzz's default list", async () => {
    // Italianno on digits: frac is a HarfBuzz default, pnum/tnum are not.
    const subset = opentype.parse((await subsetFont(fontBytes('italianno'), '0123456789/')).buffer as ArrayBuffer);
    for (const tag of ['frac', 'pnum', 'tnum']) expect(gsubFeatures(subset)).toContain(tag);
  });

  test('the name table survives, so the bundle keeps the family name', async () => {
    const font = opentype.parse((await subsetFont(fontBytes('caveat'), 'a')).buffer as ArrayBuffer);
    expect(font.getEnglishName('fontFamily')).toBe('Caveat');
  });

  test('bytes that are not a font are rejected, not turned into an empty bundle font', async () => {
    await expect(subsetFont(new TextEncoder().encode('not a font'), 'a')).rejects.toThrow('hb-subset');
  });
});
