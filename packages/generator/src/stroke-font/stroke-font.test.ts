import { describe, expect, test } from 'bun:test';
import * as opentype from 'opentype.js';
import { createDrawnDataset } from '../stroke-order/drawn.ts';
import { parseStrokeFont, strokeFontBundle, strokeFontGlyphData, synthesizeStrokeFontFile } from './bundle.ts';
import { drawnStrokeFont, parseJhfFont, parseStrokeFontFile, parseSvgFont } from './parse.ts';

const SVG_FONT = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg"><metadata>Test font, OFL</metadata><defs>
<font id="Test" horiz-adv-x="400">
<font-face font-family="Test Single" units-per-em="1000" ascent="800" descent="-200" />
<glyph unicode=" " glyph-name="space" horiz-adv-x="300" />
<glyph unicode="l" glyph-name="l" horiz-adv-x="200" d="M 100 700 L 100 0" />
<glyph unicode="&#x22;" glyph-name="quotedbl" d="M 100 700 L 100 600 M 200 700 L 200 600" />
<glyph unicode="fi" glyph-name="f_i" d="M 0 0 L 10 10" />
</font></defs></svg>`;

describe('parseSvgFont', () => {
  test("a glyph's subpaths are its strokes in order, y turned down from the baseline", () => {
    const font = parseSvgFont(SVG_FONT);
    expect(font.family).toBe('Test Single');
    expect(font.glyphs.l).toEqual({
      advance: 200,
      strokes: [
        [
          { x: 100, y: -700 },
          { x: 100, y: -0 },
        ],
      ],
    });
    expect(font.glyphs['"']?.strokes).toHaveLength(2);
  });

  test('a glyph takes the font default advance; ligature glyphs are left out; the metadata is the license', () => {
    const font = parseSvgFont(SVG_FONT);
    expect(font.glyphs['"']?.advance).toBe(400);
    expect(Object.keys(font.glyphs)).not.toContain('fi');
    expect(font.license).toBe('Test font, OFL');
    expect([font.unitsPerEm, font.ascender, font.descender]).toEqual([1000, 800, -200]);
  });

  test('a file with no <font> is refused', () => {
    expect(() => parseSvgFont('<svg></svg>')).toThrow('not an SVG font');
  });
});

describe('parseJhfFont', () => {
  // The space, then a vertical bar from the cap line (-12) to the baseline (9), bearings -4..4.
  const JHF = ['12345  1JZ', '12346  3NVRFR['].join('\n');

  test("Hershey's frame becomes a 1000-unit em on the baseline, each glyph from its left bearing", () => {
    const font = parseJhfFont(JHF, 'Bar');
    expect(font.glyphs[' ']?.advance).toBe(500);
    expect(font.glyphs['!']).toEqual({
      advance: 250,
      strokes: [
        [
          { x: 125, y: -656.25 },
          { x: 125, y: 0 },
        ],
      ],
    });
  });

  test('its glyphs can be given the characters they draw', () => {
    expect(Object.keys(parseJhfFont(JHF, 'Bar', ' |').glyphs)).toEqual([' ', '|']);
  });
});

describe('drawnStrokeFont', () => {
  test('a drawing advances a little past its rightmost stroke', () => {
    const font = drawnStrokeFont({
      ...createDrawnDataset('Mine'),
      glyphs: {
        t: [
          [
            [100, -700],
            [100, 0],
          ],
          [
            [0, -450],
            [300, -450],
          ],
        ],
      },
    });
    expect(font.family).toBe('Mine');
    expect(font.glyphs.t?.advance).toBe(380);
  });
});

describe('parseStrokeFontFile', () => {
  test('reads each format by its content', () => {
    expect(parseStrokeFontFile(SVG_FONT, 'test.svg').family).toBe('Test Single');
    expect(parseStrokeFontFile('12345  1JZ', 'futural.jhf').family).toBe('futural');
    expect(parseStrokeFontFile(JSON.stringify(createDrawnDataset('Mine')), 'mine.strokes.json').family).toBe('Mine');
    expect(() => parseStrokeFontFile('hello', 'notes.txt')).toThrow('not an SVG font');
  });
});

describe('strokeFontGlyphData', () => {
  test('strokes are timed at the drawing speed with a pause between, drawn at the pen width', () => {
    const font = parseSvgFont(SVG_FONT);
    const data = strokeFontGlyphData(font, { penWidth: 0.05, drawingSpeed: 1000, strokePause: 0.2 });
    expect(data['"']).toEqual({
      w: 400,
      t: 0.4,
      s: [
        {
          p: [
            [100, -700, 50],
            [100, -600, 50],
          ],
          d: 0,
          a: 0.1,
        },
        {
          p: [
            [200, -700, 50],
            [200, -600, 50],
          ],
          d: 0.3,
          a: 0.1,
        },
      ],
    });
    expect(Object.keys(data)).not.toContain(' ');
  });
});

describe('synthesizeStrokeFontFile', () => {
  test("each glyph's outline is its strokes drawn with the pen, at the stroke font's advance", () => {
    const font = opentype.parse(synthesizeStrokeFontFile(parseSvgFont(SVG_FONT), 0.06));
    const l = font.charToGlyph('l');
    expect(l.advanceWidth).toBe(200);
    const box = l.getBoundingBox();
    expect([box.x1, box.y1, box.x2, box.y2].map(Math.round)).toEqual([70, -30, 130, 730]);
    expect(font.charToGlyph(' ').advanceWidth).toBe(300);
  });

  test('parsed, a stroke font carries its glyph data, and draws with round caps', async () => {
    const { info } = await parseStrokeFont(parseSvgFont(SVG_FONT));
    expect(info.family).toBe('Test Single');
    expect(info.lineCap).toBe('round');
    expect(Object.keys(info.stroke!.glyphData).sort()).toEqual(['"', 'l']);
  });
});

describe('strokeFontBundle', () => {
  test('a bundle is the synthesized font, the glyph data, bundle.ts and the license', () => {
    const { files, family, glyphCount } = strokeFontBundle(parseSvgFont(SVG_FONT), {}, 'l');
    expect(files.map((f) => f.path)).toEqual(['test-single.otf', 'glyphData.json', 'bundle.ts', 'LICENSE.txt']);
    expect(glyphCount).toBe(1);
    expect(family).toStartWith('Test Single Tegaki ');
    expect(files[2]!.content).toContain(`family: '${family}'`);
  });
});
