import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseFont } from '../commands/generate.ts';
import { enumerateVariantGlyphIds } from './enumerate-variants.ts';

const load = async (dir: string) =>
  (await parseFont(readFileSync(new URL(`../../../renderer/fonts/${dir}/${dir}.ttf`, import.meta.url)).buffer as ArrayBuffer)).font;

describe('enumerateVariantGlyphIds letter', () => {
  test("a char's nominal glyph draws that char", async () => {
    const font = await load('caveat');
    const variants = enumerateVariantGlyphIds(font, ['a', 'd']);
    expect(variants.get(font.charToGlyphIndex('a'))!.letter).toBe('a');
    expect(variants.get(font.charToGlyphIndex('d'))!.letter).toBe('d');
  });

  test("a contextual alternate draws its source letter (Caveat's calt forms of d)", async () => {
    const font = await load('caveat');
    const nominal = font.charToGlyphIndex('d');
    const alternates = [...enumerateVariantGlyphIds(font, ['d']).values()].filter((v) => v.gid !== nominal);
    expect(alternates.length).toBeGreaterThan(0);
    for (const v of alternates) expect(v.letter).toBe('d');
  });

  test('a ligature draws no single letter (Amiri lam-alif)', async () => {
    const font = await load('amiri');
    const withAlif = enumerateVariantGlyphIds(font, ['ل', 'ا']);
    const lamOnly = enumerateVariantGlyphIds(font, ['ل']);
    const alifOnly = enumerateVariantGlyphIds(font, ['ا']);
    const ligatures = [...withAlif.values()].filter((v) => !lamOnly.has(v.gid) && !alifOnly.has(v.gid));
    expect(ligatures.length).toBeGreaterThan(0);
    for (const v of ligatures) expect(v.letter).toBeUndefined();
  });
});

describe('enumerateVariantGlyphIds components', () => {
  test("a ligature records its components in text order (Caveat's f_f_i: f, f, i)", async () => {
    const font = await load('caveat');
    const f = font.charToGlyphIndex('f');
    const i = font.charToGlyphIndex('i');
    const ffi = [...enumerateVariantGlyphIds(font, ['f', 'i']).values()].find((v) => font.glyphs.get(v.gid).name === 'f_f_i');
    expect(ffi?.components).toEqual([f, f, i]);
  });

  test('a letter records none', async () => {
    const font = await load('caveat');
    expect(enumerateVariantGlyphIds(font, ['a']).get(font.charToGlyphIndex('a'))!.components).toBeUndefined();
  });
});
