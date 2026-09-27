import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Blob, Face, Font, Variation } from 'harfbuzzjs';
import type { TegakiGlyphData } from 'tegaki';
import { createHbShaper } from './hb-shaper.ts';
import { buildProgressFont, glyphOutline, glyphTuples, PROGRESS_AXIS_TAG, progressAt } from './progress-font.ts';

const caveat = JSON.parse(readFileSync(new URL('../../../renderer/fonts/caveat/glyphData.json', import.meta.url), 'utf8')) as Record<
  string,
  TegakiGlyphData
>;

const glyphData = { a: caveat.a!, d: caveat.d!, i: caveat.i!, x: caveat.x! };
const built = buildProgressFont({
  family: 'Caveat Progress',
  unitsPerEm: 1000,
  ascender: 960,
  descender: -300,
  glyphData,
  spaceAdvance: 200,
});

function openFont() {
  const face = new Face(new Blob(built.buffer), 0);
  return { face, font: new Font(face) };
}

/** Signed area of each contour harfbuzz draws (control points taken as vertices — enough to compare). */
function contourAreas(font: Font, gid: number): number[] {
  const areas: number[] = [];
  let pts: [number, number][] = [];
  const close = () => {
    if (pts.length < 3) return;
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[(i + 1) % pts.length]!;
      a += x0 * y1 - x1 * y0;
    }
    areas.push(a / 2);
  };
  for (const cmd of font.glyphToJson(gid)) {
    if (cmd.type === 'M') {
      close();
      pts = [];
    }
    for (let i = 0; i + 1 < cmd.values.length; i += 2) pts.push([cmd.values[i]!, cmd.values[i + 1]!]);
    if (cmd.type === 'Z') {
      close();
      pts = [];
    }
  }
  close();
  return areas;
}

const inkAt = (font: Font, gid: number, progress: number) => {
  font.setVariations([Variation.fromString(`${PROGRESS_AXIS_TAG}=${progress}`)!]);
  return contourAreas(font, gid).reduce((sum, a) => sum + Math.abs(a), 0);
};

describe('buildProgressFont', () => {
  test('declares the progress axis from 0 to 100, written by default', () => {
    const { face } = openFont();
    const axis = face.getAxisInfos()[PROGRESS_AXIS_TAG]!;
    expect(axis).toMatchObject({ min: 0, default: 100, max: 100 });
  });

  test('maps each character to a glyph with its advance', () => {
    const { font } = openFont();
    for (const [char, glyph] of Object.entries(glyphData)) {
      const gid = font.nominalGlyph(char.codePointAt(0)!)!;
      expect(gid).toBeGreaterThan(0);
      expect(font.glyphHAdvance(gid)).toBe(Math.round(glyph.w));
    }
    expect(font.glyphHAdvance(font.nominalGlyph(32)!)).toBe(200);
  });

  test('draws nothing at 0, grows with the axis, and is the written glyph at 100', () => {
    const { font } = openFont();
    const gid = font.nominalGlyph('a'.codePointAt(0)!)!;
    const steps = [0, 25, 50, 75, 100].map((p) => inkAt(font, gid, p));
    expect(steps[0]).toBeLessThan(1);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThan(steps[i - 1]!);
    font.setVariations([]);
    const written = contourAreas(font, gid).reduce((sum, a) => sum + Math.abs(a), 0);
    expect(steps[4]).toBeCloseTo(written, 0);
  });

  test('winds every contour the same way, so overlapping ink adds up', () => {
    const { font } = openFont();
    for (const char of Object.keys(glyphData)) {
      const areas = contourAreas(font, font.nominalGlyph(char.codePointAt(0)!)!).filter((a) => Math.abs(a) > 1);
      expect(areas.every((a) => a < 0) || areas.every((a) => a > 0)).toBe(true);
    }
  });

  test('has a glyf table even with nothing to draw (browsers reject an empty one)', () => {
    const { buffer, glyphs } = buildProgressFont({ family: 'Empty', unitsPerEm: 1000, ascender: 800, descender: -200, glyphData: {} });
    const view = new DataView(buffer.buffer);
    const entry = Array.from({ length: view.getUint16(4) }, (_, i) => 12 + i * 16).find(
      (at) => String.fromCharCode(...buffer.subarray(at, at + 4)) === 'glyf',
    )!;
    expect(view.getUint32(entry + 12)).toBeGreaterThan(0);
    expect(glyphs).toBe(0);
  });

  test('a dot appears only once its stroke’s time comes', () => {
    const glyph: TegakiGlyphData = {
      w: 300,
      t: 1,
      s: [
        {
          p: [
            [50, 0, 40],
            [50, -400, 40],
          ],
          d: 0,
          a: 0.5,
        },
        { p: [[150, -500, 60]], d: 0.8, a: 0.1 },
      ],
    };
    const { buffer } = buildProgressFont({ family: 'Dot', unitsPerEm: 1000, ascender: 800, descender: -200, glyphData: { i: glyph } });
    const font = new Font(new Face(new Blob(buffer), 0));
    const gid = font.nominalGlyph('i'.codePointAt(0)!)!;
    const lineDone = inkAt(font, gid, 50);
    expect(inkAt(font, gid, 79)).toBeCloseTo(lineDone, 0);
    expect(inkAt(font, gid, 100)).toBeGreaterThan(lineDone + 2000);
  });
});

describe('buildProgressFont with its source font', () => {
  const fontsDir = new URL('../../../renderer/fonts/', import.meta.url);
  const bundled = (dir: string, fontFile: string) => {
    const read = (file: string) => JSON.parse(readFileSync(new URL(`${dir}/${file}`, fontsDir), 'utf8')) as Record<string, TegakiGlyphData>;
    const source = new Uint8Array(readFileSync(new URL(`${dir}/${fontFile}`, fontsDir)));
    const font = buildProgressFont({
      family: `${dir} Progress`,
      unitsPerEm: 1000,
      ascender: 900,
      descender: -300,
      glyphData: read('glyphData.json'),
      glyphDataById: read('glyphDataById.json'),
      source,
    });
    return { source, font };
  };
  const shapes = async (buffer: Uint8Array, text: string) => {
    const shaper = await createHbShaper(buffer.slice().buffer, ['calt', 'liga']);
    return shaper.shape(text);
  };

  test('copies the layout tables and keeps the source glyph ids', () => {
    const { source, font } = bundled('caveat', 'caveat-3dc76002.ttf');
    expect(font.layout).toEqual(['GDEF', 'GPOS', 'GSUB']);
    const src = new Font(new Face(new Blob(source), 0));
    const out = new Font(new Face(new Blob(font.buffer), 0));
    for (const char of 'aHz') expect(out.nominalGlyph(char.codePointAt(0)!)).toBe(src.nominalGlyph(char.codePointAt(0)!)!);
    expect(font.glyphs).toBeGreaterThan(font.chars.length);
  });

  test('shapes Latin like the source: contextual alternates, ligatures, kerning', async () => {
    const { source, font } = bundled('caveat', 'caveat-3dc76002.ttf');
    const text = 'Hello difficult daddy, aaa affine';
    const shaped = await shapes(font.buffer, text);
    expect(shaped).toEqual(await shapes(source, text));
    // Caveat swaps in alternates for a repeated letter: more distinct glyphs than letters.
    const as = shaped.filter((g) => text[g.cl] === 'a').map((g) => g.g);
    expect(new Set(as).size).toBeGreaterThan(1);
  });

  test('shapes Arabic like the source: joining forms and marks', async () => {
    const { source, font } = bundled('amiri', 'amiri-7df37680.ttf');
    const text = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ';
    expect(await shapes(font.buffer, text)).toEqual(await shapes(source, text));
  });

  test('every glyph the source shapes a text into has ink', async () => {
    const { font } = bundled('caveat', 'caveat-3dc76002.ttf');
    const out = new Font(new Face(new Blob(font.buffer), 0));
    for (const g of await shapes(font.buffer, 'Hello difficult daddy')) {
      if (g.g !== out.nominalGlyph(32)) expect(inkAt(out, g.g, 100)).toBeGreaterThan(0);
    }
  });

  test('maps the joiners, which browsers put around Arabic split across styles', async () => {
    const { source } = bundled('amiri', 'amiri-7df37680.ttf');
    const amiri = JSON.parse(readFileSync(new URL('amiri/glyphData.json', fontsDir), 'utf8')) as Record<string, TegakiGlyphData>;
    const { buffer } = buildProgressFont({
      family: 'J',
      unitsPerEm: 1000,
      ascender: 900,
      descender: -300,
      glyphData: { ب: amiri.ب! },
      source,
    });
    const font = new Font(new Face(new Blob(buffer), 0));
    // The committed subset has neither: they get empty glyphs of their own.
    for (const cp of [0x200c, 0x200d]) {
      const gid = font.nominalGlyph(cp)!;
      expect(gid).toBeDefined();
      expect(font.glyphHAdvance(gid)).toBe(0);
      expect(inkAt(font, gid, 100)).toBe(0);
    }
    // And the letters either side still join: their joining forms, not the isolated one.
    const isolated = font.nominalGlyph('ب'.codePointAt(0)!)!;
    const letters = (await shapes(buffer, 'ب‍ب')).filter((g) => g.ax > 0).map((g) => g.g);
    expect(letters).toHaveLength(2);
    expect(letters).not.toContain(isolated);
  });

  test('leaves unmapped the source characters it has no strokes for, and adds ones the source lacks', () => {
    const { source } = bundled('caveat', 'caveat-3dc76002.ttf');
    const snowman: TegakiGlyphData = { w: 500, t: 0.5, s: [{ p: [[250, -250, 80]], d: 0, a: 0.5 }] };
    const { buffer, chars, layout } = buildProgressFont({
      family: 'Few',
      unitsPerEm: 1000,
      ascender: 900,
      descender: -300,
      glyphData: { a: caveat.a!, '☃': snowman },
      source,
    });
    const font = new Font(new Face(new Blob(buffer), 0));
    expect(chars).toEqual(['a', '☃']);
    expect(font.nominalGlyph('b'.codePointAt(0)!)).toBeUndefined();
    expect(font.nominalGlyph(32)).toBeDefined();
    expect(inkAt(font, font.nominalGlyph('☃'.codePointAt(0)!)!, 100)).toBeGreaterThan(0);
    expect(layout).toEqual(['GDEF', 'GPOS', 'GSUB']);
  });
});

describe('progressAt', () => {
  test('is the share of the glyph’s drawing time, clamped to the axis', () => {
    const glyph: TegakiGlyphData = { w: 100, t: 0.5, s: [{ p: [[0, 0, 10]], d: 0.6, a: 0.4 }] };
    expect(progressAt(glyph, 0.5)).toBe(50);
    expect(progressAt(glyph, -1)).toBe(0);
    expect(progressAt(glyph, 2)).toBe(100);
  });
});

describe('glyphTuples', () => {
  test('keeps every region inside the axis below the default, peaks never at 0', () => {
    for (const glyph of Object.values(glyphData)) {
      for (const t of glyphTuples(glyphOutline(glyph, 'round', (x) => x))) {
        expect(t.start).toBeLessThanOrEqual(t.peak);
        expect(t.peak).toBeLessThan(t.end === 0 ? 0 : t.end + 1e-9);
        expect(t.peak).toBeLessThan(0);
        expect(t.start).toBeGreaterThanOrEqual(-1);
        expect(t.end).toBeLessThanOrEqual(0);
      }
    }
  });

  test('lists every point of a contour it moves, zeros included', () => {
    const outline = glyphOutline(glyphData.a, 'round', (x) => x);
    const bounds: [number, number][] = [];
    let base = 0;
    for (const c of outline.contours) {
      bounds.push([base, base + c.points.length]);
      base += c.points.length;
    }
    for (const t of glyphTuples(outline)) {
      for (const [from, to] of bounds) {
        const listed = [...t.deltas.keys()].filter((k) => k >= from && k < to).length;
        expect(listed === 0 || listed === to - from).toBe(true);
      }
    }
  });
});
