/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { clearance, type PlacedStroke, type StrokeFrame, StrokePath, type TegakiFrame } from 'tegaki/core';
import { skipPieces } from './ballpoint.ts';
import { bristles } from './brush.ts';
import { mix, parseCanvasColor } from './color.ts';
import { colorIndex, PALETTES, pickColor } from './colors.ts';
import { echoPasses, echoPlugin, lagged } from './echo.ts';
import { createShowcasePlugins, normalizePluginOptions, SHOWCASE_PLUGINS } from './index.ts';
import { broadNib, nibFactor } from './nib.ts';
import { grainTile } from './noise.ts';
import { paperBounds, paperLayout } from './paper.ts';
import { penPoses } from './pen.ts';
import { penMotion } from './sound.ts';
import { sparkleAt, strokeSparkles } from './sparkle.ts';
import { layoutGuides } from './stroke-order.ts';
import { dryness, inkAge } from './wet.ts';

/** A straight stroke from (x0, y) to (x1, y), `width` px wide. */
const line = (x0: number, x1: number, y: number, width = 8) =>
  new StrokePath(Array.from({ length: 11 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 10, y, width, t: i / 10 })));

function stroke(id: string, path: StrokePath, state: StrokeFrame['state'], progress: number, start: number, duration = 1): StrokeFrame {
  const head = state === 'pending' ? null : path.pointAt(progress);
  return {
    id,
    entryIndex: 0,
    strokeIndex: Number(id),
    path,
    state,
    progress,
    linear: progress,
    start,
    duration,
    head,
  } as unknown as StrokeFrame;
}

const frame = (time: number, strokes: StrokeFrame[]): TegakiFrame => ({
  time,
  strokes,
  active: strokes.filter((s) => s.state === 'drawing') as TegakiFrame['active'],
});

describe('pen', () => {
  test('the pen sits on the head of the stroke being drawn', () => {
    const [pose] = penPoses(frame(0.5, [stroke('0', line(0, 100, 0), 'drawing', 0.5, 0)]));
    expect(pose).toMatchObject({ x: 50, y: 0, lift: 0 });
  });

  test('between strokes the pen travels from the end of one to the start of the next, lifted halfway', () => {
    const strokes = [stroke('0', line(0, 100, 0), 'done', 1, 0), stroke('1', line(100, 200, 40), 'pending', 0, 2)];
    const [pose] = penPoses(frame(1.5, strokes));
    expect(pose!.x).toBeCloseTo(100);
    expect(pose!.y).toBeCloseTo(20);
    expect(pose!.lift).toBeCloseTo(1);
  });

  test('once the text is done the pen lifts off its last point', () => {
    const [pose] = penPoses(frame(5, [stroke('0', line(0, 100, 0), 'done', 1, 0)]));
    expect(pose).toMatchObject({ x: 100, y: 0, lift: 1 });
  });
});

describe('stroke order', () => {
  test("a stroke's arrow runs on the side away from its neighbour, clear of the ink", () => {
    const top = line(0, 200, 0);
    const bottom = line(0, 200, 30);
    const [guide] = layoutGuides([{ path: top }, { path: bottom }], 100);
    const arrow = guide!.arrow!;
    for (const p of arrow.points) expect(p.y).toBeLessThan(0);
    for (const p of arrow.points) expect(clearance(p, [top, bottom])).toBeGreaterThan(0);
  });

  test('numbers stay off the ink and off each other', () => {
    const paths = [line(0, 200, 0), line(0, 200, 30), line(0, 200, 60)];
    const guides = layoutGuides(
      paths.map((path) => ({ path })),
      100,
    );
    for (const { number } of guides) expect(clearance(number, paths)).toBeGreaterThan(0);
    for (let i = 1; i < guides.length; i++) {
      const [a, b] = [guides[i - 1]!.number, guides[i]!.number];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(10);
    }
  });

  test('a dot gets a number and no arrow', () => {
    const dot = new StrokePath([{ x: 0, y: 0, width: 8, t: 0 }]);
    expect(layoutGuides([{ path: dot }], 100)[0]!.arrow).toBeNull();
  });
});

describe('brush', () => {
  test('the hairs stay within the width of the stroke', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const hairs = bristles(line(0, 200, 0, 20), 9, random);
    expect(hairs).toHaveLength(9);
    for (const { path } of hairs) for (const p of path.points) expect(Math.abs(p.y) + p.width / 2).toBeLessThanOrEqual(11);
  });

  test('a hair that runs dry covers only part of the stroke', () => {
    const hairs = bristles(line(0, 200, 0, 20), 9, () => 0);
    const dry = hairs.find((h) => h.reach < 1)!;
    expect(dry.path.pointAt(1).x).toBeLessThan(200);
  });

  test('with no dryness every hair lasts the whole stroke; the drier, the sooner they give out', () => {
    const reach = (dryness: number) => bristles(line(0, 200, 0, 20), 9, () => 0.5, dryness).map((h) => h.reach);
    expect(reach(0).every((r) => r === 1)).toBe(true);
    const wet = reach(0.3);
    const dry = reach(0.9);
    for (let i = 0; i < wet.length; i++) expect(dry[i]!).toBeLessThanOrEqual(wet[i]!);
    expect(dry.some((r, i) => r < wet[i]!)).toBe(true);
  });
});

describe('echo', () => {
  test('a lagging pass waits for its lag, then finishes with the lead', () => {
    expect(lagged(0.3, 0.3)).toBe(0);
    expect(lagged(0.65, 0.3)).toBeCloseTo(0.5);
    expect(lagged(1, 0.3)).toBe(1);
    expect(lagged(0.4, 0)).toBe(0.4);
  });

  test('the defaults lay a lead and a follow, the follow narrower and halfway behind the lead to the ink', () => {
    const [lead, follow] = echoPasses(echoPlugin.defaults);
    expect(lead).toEqual({ color: '#ffd166', width: 2.6, lag: 0 });
    expect(follow!.color).toBe('#ef476f');
    expect(follow!.width).toBeGreaterThan(1);
    expect(follow!.width).toBeLessThan(lead!.width);
    expect(follow!.lag).toBeCloseTo(0.18);
  });

  test('the highlighter preset is one wide pass that keeps pace with the ink', () => {
    const passes = echoPasses(echoPlugin.resolve(echoPlugin.presets.Highlighter));
    expect(passes).toEqual([{ color: '#fff176', width: 4, lag: 0 }]);
  });
});

describe('showcase', () => {
  test('every demo is a factory with a label and a description, and presets its params take as given', () => {
    for (const { factory } of SHOWCASE_PLUGINS) {
      expect(factory.label.length).toBeGreaterThan(0);
      expect(factory.description?.length).toBeGreaterThan(0);
      for (const preset of Object.values(factory.presets)) expect(factory.resolve(preset)).toMatchObject(preset);
    }
  });

  test('options state keeps known plugins with something changed, as their params take it', () => {
    expect(normalizePluginOptions({ brush: { bristles: 100, core: 0.45 }, echo: { lag: 0.36 }, nope: { x: 1 } })).toEqual({
      brush: { bristles: 24 },
    });
    expect(normalizePluginOptions('brush')).toEqual({});
  });

  test('plugins are made in the order they run, each with its options', () => {
    const plugins = createShowcasePlugins(['sound', 'pen'], { pen: { size: 2 } });
    expect(plugins.map((p) => p.name)).toEqual(['pen', 'sound']);
  });
});

describe('sound', () => {
  test('playback measures the ink laid since the last frame and the strokes set down', () => {
    const path = line(0, 100, 0);
    const prev = frame(0.4, [stroke('0', path, 'drawing', 0.4, 0), stroke('1', path, 'pending', 0, 0.45)]);
    const next = frame(0.5, [stroke('0', path, 'drawing', 0.5, 0), stroke('1', path, 'drawing', 0.05, 0.45)]);
    const motion = penMotion(next, prev)!;
    expect(motion.distance).toBeCloseTo(15);
    expect(motion.touches).toBe(1);
  });

  test('a seek or a repeated time is silent', () => {
    const a = frame(0.4, [stroke('0', line(0, 100, 0), 'drawing', 0.4, 0)]);
    expect(penMotion(frame(3, a.strokes), a)).toBeNull();
    expect(penMotion(frame(0.4, a.strokes), a)).toBeNull();
    expect(penMotion(a, null)).toBeNull();
  });
});

/** A random source that repeats: the same sequence every time it's made. */
function lcg(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

describe('paper', () => {
  /** A glyph at (x, baseline) one stroke of ink across its advance, 100px to the em. */
  const glyph = (entryIndex: number, x: number, baseline: number, advance = 100): PlacedStroke => {
    const place = { x, y: baseline - 80, scale: 0.1, ascender: 800 };
    const rawPath = line(x + 10, x + advance - 10, baseline - 30);
    return { entryIndex, strokeIndex: 0, place, rawPath, path: rawPath, glyph: { w: advance * 10 } } as unknown as PlacedStroke;
  };

  test('a line per baseline, spanning its glyphs, and a square per glyph centred on its advance', () => {
    const { lines, cells } = paperLayout([glyph(0, 0, 100), glyph(1, 100, 100), glyph(2, 0, 250)], 100);
    expect(lines.map((l) => [l.left, l.right, l.baseline])).toEqual([
      [0, 200, 100],
      [0, 100, 250],
    ]);
    expect(cells).toHaveLength(3);
    expect(cells[1]).toMatchObject({ x: 100, size: 100 });
    // Squares sit on the middle of their line's ink.
    expect(cells[0]!.y + 50).toBeCloseTo(70);
  });

  test("a glyph's strokes share one square", () => {
    const a = glyph(0, 0, 100);
    expect(paperLayout([a, { ...a, strokeIndex: 1 }], 100).cells).toHaveLength(1);
  });

  test('ruled paper runs past the text and reaches above the capital line', () => {
    const layout = paperLayout([glyph(0, 0, 100)], 100);
    const box = paperBounds(layout, 'ruled', 100)!;
    expect(box.minX).toBeLessThan(0);
    expect(box.maxX).toBeGreaterThan(100);
    expect(box.minY).toBeLessThan(100 - 70);
  });
});

describe('broad nib', () => {
  test('full width across the edge, the hairline along it', () => {
    // A 45° edge rises to the right: moving up-right runs along it, down-right across it.
    expect(nibFactor(-Math.PI / 4, 45, 0.8)).toBeCloseTo(0.2);
    expect(nibFactor(Math.PI / 4, 45, 0.8)).toBeCloseTo(1);
    expect(nibFactor(0, 45, 0)).toBe(1);
  });

  test('a flat nib draws verticals thick and horizontals thin', () => {
    const o = { angle: 0, contrast: 0.9, weight: 1 };
    const across = broadNib(line(0, 100, 0, 10), o);
    const down = broadNib(new StrokePath(Array.from({ length: 11 }, (_, i) => ({ x: 0, y: i * 10, width: 10, t: i / 10 }))), o);
    expect(across.points[5]!.width).toBeCloseTo(1);
    expect(down.points[5]!.width).toBeCloseTo(10);
  });
});

describe('colors', () => {
  test('in turn, glyph by glyph or stroke by stroke', () => {
    const colors = PALETTES.rainbow;
    expect(pickColor(colors, colorIndex({ entryIndex: 2, strokeIndex: 1 }, 'glyph'))).toBe(colors[2]);
    expect(colorIndex({ entryIndex: 0, strokeIndex: 1 }, 'stroke')).not.toBe(colorIndex({ entryIndex: 0, strokeIndex: 0 }, 'stroke'));
  });

  test('shuffled, neighbours never share a color', () => {
    const random = (i: number) => ((i * 7919) % 101) / 101;
    for (let i = 1; i < 50; i++) expect(pickColor(PALETTES.pastel, i, random)).not.toBe(pickColor(PALETTES.pastel, i - 1, random));
  });

  test('canvas colors read back as numbers', () => {
    expect(parseCanvasColor('#ff8000')).toEqual([255, 128, 0, 1]);
    expect(parseCanvasColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3, 0.5]);
    expect(parseCanvasColor('url(x)')).toBeNull();
    expect(mix([0, 0, 0, 1], [255, 255, 255, 0], 0.5)).toEqual([128, 128, 128, 0.5]);
  });
});

describe('wet ink', () => {
  test('ink ages from when the pen passed it', () => {
    const stroke = { start: 1, duration: 2 };
    expect(inkAge(stroke, 0.5, 2.5)).toBeCloseTo(0.5);
    expect(inkAge(stroke, 1, 2.5)).toBeLessThan(0);
  });

  test('fresh ink is wet, and dry once the drying time has passed', () => {
    expect(dryness(0, 1.5)).toBe(0);
    expect(dryness(0.75, 1.5)).toBeCloseTo(0.5);
    expect(dryness(5, 1.5)).toBe(1);
  });
});

describe('paper grain', () => {
  test('no amount, no grain; the most is fully clear', () => {
    expect(grainTile(16, 0, 1, lcg()).every((a) => a === 0)).toBe(true);
    const tile = grainTile(32, 1, 1, lcg());
    expect(Math.max(...tile)).toBeLessThanOrEqual(255);
    expect(tile.some((a) => a > 200)).toBe(true);
  });

  test('fibers add streaks to the speckle', () => {
    const sum = (t: Uint8ClampedArray) => t.reduce((s, a) => s + a, 0);
    expect(sum(grainTile(32, 1, 1, lcg()))).toBeGreaterThan(sum(grainTile(32, 1, 0, lcg())));
  });
});

describe('ballpoint', () => {
  test('pieces run in order, leaving gaps, with the ends of the stroke inked', () => {
    const pieces = skipPieces(1000, 100, { skips: 1, gap: 0.03 }, lcg(3));
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[0]![0]).toBe(0);
    expect(pieces.at(-1)![1]).toBe(1);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i]![0]).toBeGreaterThan(pieces[i - 1]![1]);
    expect(pieces[0]![1]).toBeGreaterThanOrEqual(0.1);
  });

  test('no skips, one piece', () => {
    expect(skipPieces(1000, 100, { skips: 0, gap: 0.03 }, lcg())).toEqual([[0, 1]]);
  });
});

describe('sparkles', () => {
  test('about `density` per em of ink, each starting near the ink', () => {
    const sparkles = strokeSparkles(line(0, 300, 0), 100, { density: 4, spread: 0.1, rise: 0.2 }, lcg());
    expect(sparkles).toHaveLength(12);
    for (const s of sparkles) expect(Math.hypot(s.ox, s.oy)).toBeLessThanOrEqual(10);
    expect(sparkles.every((s) => s.vy < 0)).toBe(true);
  });

  test('a sparkle shows after the pen passes, fading, and is gone after its life', () => {
    const [s] = strokeSparkles(line(0, 100, 0), 100, { density: 1, spread: 0, rise: 0.2 }, lcg());
    const from = { x: 50, y: 0 };
    expect(sparkleAt(s!, from, -0.1, 1)).toBeNull();
    const early = sparkleAt(s!, from, 0.1, 1)!;
    const late = sparkleAt(s!, from, 0.5, 1)!;
    expect(late.alpha).toBeLessThan(early.alpha);
    expect(late.y).toBeLessThan(early.y);
    expect(sparkleAt(s!, from, 1.01, 1)).toBeNull();
  });
});
