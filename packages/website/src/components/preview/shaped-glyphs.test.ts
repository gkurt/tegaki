/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { TegakiBundle } from 'tegaki';
import harfbuzzShaper from 'tegaki/shaper-harfbuzz';
import { collectShapedGlyphs } from './shaped-glyphs.ts';

const caveatUrl = new URL('../../../../renderer/fonts/caveat/caveat.ttf', import.meta.url).href;

/** The renderer's shaper for Caveat with its contextual alternates on. */
async function caveatShaper() {
  const bundle = { fontUrl: caveatUrl, features: ['calt', 'liga'], glyphDataById: {} } as unknown as TegakiBundle;
  return (await harfbuzzShaper(bundle))!;
}

describe('collectShapedGlyphs', () => {
  test('collects every glyph the renderer draws, including alternates a whole-line shape would miss', async () => {
    const shaper = await caveatShaper();
    const text = 'Hello World\nThe quick brown fox';
    const collected = new Set(collectShapedGlyphs(shaper, text).map((g) => g.key));
    for (const line of text.split('\n')) {
      for (const g of shaper.shape(line)) {
        if (line[g.cl] !== ' ') expect(collected.has(g.g)).toBe(true);
      }
    }
  });

  test("Caveat's calt draws World's d as an alternate, not the base d", async () => {
    const shaper = await caveatShaper();
    const glyphs = collectShapedGlyphs(shaper, 'World');
    const d = glyphs.find((g) => g.char === 'd')!;
    expect(d.gid).not.toBe(123); // Caveat's nominal d
    expect(d).toMatchObject({ subsetIdx: 0, key: String(d.gid) });
  });

  test('each glyph is listed once', async () => {
    const shaper = await caveatShaper();
    const keys = collectShapedGlyphs(shaper, 'dd dd\ndd').map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
