import { describe, expect, test } from 'bun:test';
import type { TegakiGlyphData } from '../types.ts';
import { resolveEffects } from './effects.ts';
import { placementsToSvg, type SvgExportConfig, type SvgGlyphPlacement } from './svgExport.ts';

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
  pressure: 0,
  segmentLengthFU: Infinity,
  smoothing: false,
  strokeScale: 1,
  animated: true,
  totalDuration: 1.1,
};

const item: SvgGlyphPlacement = { glyph, ox: 0, oy: 50, scale: 1, ascender: 0, offset: 0, duration: 1.1 };

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

describe('placementsToSvg effects', () => {
  const segmentLengthFU = 10;

  test('taper narrows the stroke toward its ends', () => {
    const svg = svgOf({ animated: false, segmentLengthFU, effects: resolveEffects({ taper: true }) });
    const widths = [...svg.matchAll(/<line [^>]*stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths.length).toBe(10);
    expect(widths[0]!).toBeLessThan(widths[5]!);
    expect(widths[9]!).toBeLessThan(widths[5]!);
  });

  test('strokeGradient colors each segment along the stroke', () => {
    const svg = svgOf({
      animated: false,
      segmentLengthFU,
      effects: resolveEffects({ strokeGradient: { colors: ['#ff0000', '#0000ff'] } }),
    });
    const colors = new Set([...svg.matchAll(/<line [^>]*stroke="(rgb[^"]+)"/g)].map((m) => m[1]));
    expect(colors.size).toBeGreaterThan(5);
  });

  test('glow draws a drop-shadowed copy under the stroke', () => {
    const svg = svgOf({ animated: false, effects: resolveEffects({ glow: { radius: 8, color: '#f0f' } }) });
    expect(svg).toContain('<feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#f0f" />');
    const glowAt = svg.indexOf('stroke="#f0f"');
    const mainAt = svg.indexOf('stroke="#123"');
    expect(glowAt).toBeGreaterThan(0);
    expect(glowAt).toBeLessThan(mainAt);
  });

  test('wobble displaces the stroke', () => {
    const d = (svg: string) => /<path d="([^"]+)"/.exec(svg)?.[1];
    const plain = svgOf({ animated: false, segmentLengthFU });
    const wobbly = svgOf({ animated: false, segmentLengthFU, effects: resolveEffects({ wobble: { amplitude: 5 } }) }, { seed: 3 });
    expect(d(wobbly)).not.toBe(d(plain));
  });

  test('a global gradient paints every stroke with one user-space gradient', () => {
    const svg = svgOf({
      animated: false,
      globalGradient: {
        x1: 0,
        y1: 0,
        x2: 100,
        y2: 0,
        stops: [
          [0, '#f00'],
          [1, '#00f'],
        ],
      },
    });
    expect(svg).toContain('<linearGradient id="tk-gg" gradientUnits="userSpaceOnUse"');
    expect(svg).toContain('stroke="url(#tk-gg)"');
    expect(svg).toContain('fill="url(#tk-gg)"');
  });

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

  test('a clipped glow is filtered from the clipped ink, outside the mask', () => {
    const svg = svgOf({
      animated: false,
      effects: resolveEffects({ glow: { radius: 8, color: '#f0f' } }),
      clipText: { glyphs: [{ d: 'M0,0L100,0L100,700Z', x: 10, y: 80, scale: 0.1 }] },
    });
    // No per-stroke glow copies for the mask to cut away…
    expect(svg).not.toContain('stroke="#f0f"');
    // …but one filter wrapping the masked group.
    expect(svg).toContain('<filter id="tk-clip-glow"');
    expect(svg).toContain('<feDropShadow in="tk-t0"');
    expect(svg.indexOf('<g filter="url(#tk-clip-glow)">')).toBeLessThan(svg.indexOf('<g mask="url(#tk-clip)">'));
  });

  test('a wobble moves the clip outlines with the strokes', () => {
    const d = 'M0,0L100,0L100,700Z';
    const clipText = { glyphs: [{ d, x: 10, y: 80, scale: 0.1 }] };
    const wobbly = svgOf({ segmentLengthFU: 20, effects: resolveEffects({ wobble: { amplitude: 5 } }), clipText });
    expect(wobbly).not.toContain(`<path d="${d}"`);
    expect(wobbly).toMatch(/<mask id="tk-clip"[^>]*><g fill="#fff"><path d="M[^"]*Z" transform/);
    expect(svgOf({ segmentLengthFU: 20, clipText })).toContain(`<path d="${d}"`);
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
        texts: [{ text: '€', x: 120, y: 80, direction: 'ltr', fill: '#123', glows: [], at: 1.5, box: [120, 0, 170, 100] }],
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
