import { describe, expect, test } from 'bun:test';
import type { TegakiGlyphData } from '../types.ts';
import { subdivideStroke } from './strokeCache.ts';
import { StrokePath } from './strokePath.ts';
import { rawStrokePath } from './strokeTimeline.ts';
import { placementsToSvg, type SvgDecoration, type SvgExportConfig, type SvgGlyphPlacement } from './svgExport.ts';

// A 1s horizontal line, then a dot at 1s.
const glyph: TegakiGlyphData = {
  w: 100,
  t: 1.1,
  s: [
    {
      p: [
        [0, 0, 10],
        [100, 0, 10],
      ],
      d: 0,
      a: 1,
    },
    { p: [[50, -50, 10]], d: 1, a: 0.1 },
  ],
};

const cfg: SvgExportConfig = {
  width: 200,
  height: 100,
  lineCap: 'round',
  color: '#123',
  strokeScale: 1,
  animated: true,
  totalDuration: 1.1,
};

// Each stroke's ink as the bundle has it, placed at (0, 50).
const inks = glyph.s.map((s) => ({
  path: rawStrokePath(s, subdivideStroke(s, Infinity), { x: 0, y: 50, scale: 1, ascender: 0 })!,
  nibs: [],
}));
const item: SvgGlyphPlacement = { glyph, ox: 0, oy: 50, scale: 1, ascender: 0, offset: 0, duration: 1.1, inks };

const svgOf = (over: Partial<SvgExportConfig> = {}, it: Partial<SvgGlyphPlacement> = {}) =>
  placementsToSvg([{ ...item, ...it }], { ...cfg, ...over });

const lineDur = (svg: string) => Number(/<animate attributeName="stroke-dashoffset"[^>]* dur="([\d.]+)s"/.exec(svg)?.[1]);
const dotBegin = (svg: string) => Number(/<circle [^>]*><set attributeName="opacity" to="1" begin="([\d.]+)s"/.exec(svg)?.[1]);
const splines = (svg: string) => /keySplines="([^"]+)"/.exec(svg)?.[1] ?? '';

describe('placementsToSvg timing', () => {
  test('the default ease-out quad reveal is one exact spline segment', () => {
    const svg = svgOf();
    expect(splines(svg)).toBe('0.3333 0.6667 0.6667 1');
    expect(lineDur(svg)).toBeCloseTo(1, 3);
    expect(dotBegin(svg)).toBeCloseTo(1, 3);
  });

  test('speed divides every time in the file', () => {
    const svg = svgOf({ speed: 2 });
    expect(lineDur(svg)).toBeCloseTo(0.5, 3);
    expect(dotBegin(svg)).toBeCloseTo(0.5, 3);
  });

  test("the scheduler's stroke delay moves a deferred dot", () => {
    const svg = svgOf({}, { strokeDelays: [undefined, 1.05] });
    expect(dotBegin(svg)).toBeCloseTo(1.05, 3);
  });

  test("stagger's time scale stretches both delay and duration", () => {
    const svg = svgOf({ totalDuration: 2.2 }, { strokeTimeScale: 2, duration: 2.2 });
    expect(lineDur(svg)).toBeCloseTo(2, 3);
    expect(dotBegin(svg)).toBeCloseTo(2, 3);
  });

  test('a linear stroke easing reveals at constant speed', () => {
    expect(splines(svgOf({ strokeEasing: (t) => t }))).toBe('0.3333 0.3333 0.6667 0.6667');
  });

  test('an easing one segment cannot follow is split, keeping SMIL-legal control points', () => {
    const svg = svgOf({ strokeEasing: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)) });
    const segs = splines(svg).split(';');
    expect(segs.length).toBeGreaterThan(1);
    for (const seg of segs) for (const v of seg.trim().split(' ').map(Number)) expect(v >= 0 && v <= 1).toBe(true);
  });

  test('glyph easing warps when a stroke starts inside its slot', () => {
    // local = (t / 2)² · 2 reaches the dot's 1s delay at t = √2.
    const svg = svgOf({ glyphEasing: (u) => u * u, totalDuration: 2 }, { duration: 2 });
    expect(dotBegin(svg)).toBeCloseTo(Math.SQRT2, 3);
  });

  test('a stroke the timeline never reaches is left out', () => {
    const svg = svgOf({}, { strokeDelays: [undefined, 5] });
    expect(svg).not.toContain('<circle');
  });

  test('loop mode lengthens its cycle by the hold', () => {
    const cycle = (svg: string) => Number(/animation: tk-a\d+ ([\d.]+)s linear infinite/.exec(svg)?.[1]);
    const base = cycle(svgOf({ loop: true }));
    expect(cycle(svgOf({ loop: true, loopHold: 3.5 })) - base).toBeCloseTo(2, 3);
  });
});

describe('placementsToSvg caps', () => {
  test('a square cap draws dots square', () => {
    expect(svgOf({ animated: false, lineCap: 'square' })).toContain('<rect ');
  });
});

describe('placementsToSvg text', () => {
  const font = { family: "'Caveat', cursive", fontSize: 100, featureSettings: "'calt' 1" };

  test('clip-to-text masks all ink with the glyph outlines, flipped to y-down', () => {
    const svg = svgOf({ clipText: { glyphs: [{ d: 'M0,0L100,0L100,700Z', x: 10, y: 80, scale: 0.1 }] } });
    expect(svg).toContain('<mask id="tk-clip" maskUnits="userSpaceOnUse"');
    expect(svg).toContain('<path d="M0,0L100,0L100,700Z" transform="translate(10 80) scale(0.1 -0.1)" />');
    expect(svg).toContain('<g mask="url(#tk-clip)">');
    expect(svg).not.toContain('<text');
  });

  test('without outlines, clip-to-text sets the words in the font', () => {
    const svg = svgOf({ clipText: { font, words: [{ text: 'Hi', x: 10, y: 80, direction: 'ltr' }] } });
    expect(svg).toMatch(
      /<mask id="tk-clip"[^>]*><g fill="#fff"><text x="10" y="80" font-family="'Caveat', cursive" font-size="100"[^>]*>Hi<\/text><\/g><\/mask>/,
    );
    expect(svg).toContain('<g mask="url(#tk-clip)">');
  });

  test('an RTL word is anchored by its left edge', () => {
    const svg = svgOf({ clipText: { font, words: [{ text: 'שלום', x: 10, y: 80, direction: 'rtl' }] } });
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain('direction:rtl');
  });

  test('a fallback character appears as text when its slot ends', () => {
    const svg = svgOf({
      fallback: {
        font,
        texts: [{ text: '€', x: 120, y: 80, direction: 'ltr', fill: '#123', at: 1.5, box: [120, 0, 170, 100] }],
      },
    });
    expect(svg).toMatch(/<text [^>]*opacity="0">€<set attributeName="opacity" to="1" begin="1.5s" fill="freeze" \/><\/text>/);
  });

  test('embedded fonts become @font-face rules', () => {
    const svg = svgOf({ fontFaces: [{ family: 'Caveat', src: 'data:font/ttf;base64,AAAA' }] });
    expect(svg).toContain(`@font-face { font-family: 'Caveat'; src: url("data:font/ttf;base64,AAAA") }`);
  });
});

describe('placementsToSvg viewBox', () => {
  test('crops to the ink by default', () => {
    expect(svgOf({ animated: false })).not.toContain('viewBox="0 0 200 100"');
  });

  test('crop: false keeps the full canvas box', () => {
    expect(svgOf({ animated: false, crop: false })).toContain('viewBox="0 0 200 100"');
  });
});

describe('placementsToSvg plugin ink and decoration', () => {
  // The line slanted: from (0, 50) to (100, 20), 10px wide.
  const slanted = new StrokePath([
    { x: 0, y: 50, width: 10, t: 0 },
    { x: 100, y: 20, width: 10, t: 1 },
  ]);
  const deco = (over: Partial<SvgDecoration> = {}): SvgDecoration => ({
    defs: [],
    underlay: [],
    overlay: [],
    ink: [],
    strokes: new Map(),
    boxes: [],
    ...over,
  });

  test("a stroke is drawn from its ink, not from the bundle's points", () => {
    const svg = svgOf({ animated: false }, { inks: [{ path: slanted, nibs: [] }] });
    expect(svg).toContain('d="M 0 50 L 100 20"');
    expect(svg).not.toContain('L 100 50');
  });

  test('ink of varying width is drawn a segment at a time', () => {
    const tapered = slanted.map((p) => ({ ...p, width: p.t === 0 ? 2 : 10 }));
    const svg = svgOf({ animated: false }, { inks: [{ path: tapered, nibs: [] }] });
    expect(svg).toContain('<line x1="0" y1="50" x2="100" y2="20" stroke-width="6"');
  });

  test('a stroke without ink is left out', () => {
    expect(svgOf({ animated: false }, { inks: [undefined, inks[1]] })).not.toContain('<path ');
  });

  test('a stroke style with a color per draw progress colors each segment along the stroke', () => {
    const points = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 50, width: 10, t: i / 10 }));
    const svg = svgOf(
      { animated: false, decorate: () => deco({ strokes: new Map([['0:0', { color: (t: number) => (t < 0.5 ? '#f00' : '#00f') }]]) }) },
      { entryIndex: 0, inks: [{ path: new StrokePath(points), nibs: [] }, inks[1]] },
    );
    const colors = [...svg.matchAll(/<line [^>]*stroke="(#[^"]+)"/g)].map((m) => m[1]);
    expect(colors.length).toBe(10);
    expect(colors[0]).toBe('#f00');
    expect(colors[9]).toBe('#00f');
  });

  test("a stroke style repaints the stroke and wraps it in the style's attributes", () => {
    const svg = svgOf(
      { animated: false, decorate: () => deco({ strokes: new Map([['3:0', { color: '#f00', attrs: 'opacity="0.5"' }]]) }) },
      { entryIndex: 3 },
    );
    expect(svg).toMatch(/<g opacity="0.5">\n<path [^>]*stroke="#f00"/);
    // The dot, stroke 1, keeps the text's color.
    expect(svg).toContain('fill="#123"');
  });

  test('underlay goes under the ink, overlay over it, and ink attributes around it', () => {
    const svg = svgOf({
      animated: false,
      decorate: () =>
        deco({
          underlay: ['<rect id="under" />'],
          overlay: ['<rect id="over" />'],
          ink: ['filter="url(#f)"'],
          defs: ['<filter id="f" />'],
        }),
    });
    const under = svg.indexOf('id="under"');
    const ink = svg.indexOf('<g filter="url(#f)">');
    const over = svg.indexOf('id="over"');
    expect(under).toBeGreaterThan(-1);
    expect(under).toBeLessThan(ink);
    expect(ink).toBeLessThan(over);
    expect(svg).toMatch(/<defs>[\s\S]*<filter id="f" \/>[\s\S]*<\/defs>/);
  });

  test('a loop fades the overlay with the ink but not the underlay', () => {
    const svg = svgOf({ loop: true, decorate: () => deco({ underlay: ['<rect id="under" />'], overlay: ['<rect id="over" />'] }) });
    const fade = svg.search(/<g class="tk-a\d+">/);
    expect(svg.indexOf('id="under"')).toBeLessThan(fade);
    expect(svg.indexOf('id="over"')).toBeGreaterThan(fade);
  });

  test('the clock shows markup when the strokes reach a time, at the export speed', () => {
    let shown = '';
    svgOf({
      speed: 2,
      decorate: (clock) => {
        const a = clock.appear(1);
        shown = `<text${a.attrs}>1${a.inner}</text>`;
        return deco({ overlay: [shown] });
      },
    });
    expect(shown).toContain('<set attributeName="opacity" to="1" begin="0.5s"');
  });

  test('the crop takes in the boxes plugins paint in', () => {
    const svg = svgOf({ animated: false, decorate: () => deco({ boxes: [{ minX: -100, minY: 0, maxX: 0, maxY: 10 }] }) });
    expect(Number(/viewBox="(-?[\d.]+)/.exec(svg)?.[1])).toBeLessThanOrEqual(-100);
  });
});
