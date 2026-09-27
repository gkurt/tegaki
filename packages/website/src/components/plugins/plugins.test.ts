/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { clearance, type PlacedStroke, type StrokeFrame, StrokePath, type TegakiFrame } from 'tegaki/core';
import { skipPieces } from './ballpoint.ts';
import { bristles, brushWidth, splashes } from './brush.ts';
import { burnColor, puffAt, puffs } from './burn.ts';
import { moteAt, motes } from './chalk.ts';
import { mix, parseCanvasColor } from './color.ts';
import { colorIndex, PALETTES, pickColor } from './colors.ts';
import { dimAt, tearsAt } from './crt.ts';
import { echoPasses, echoPlugin, lagged } from './echo.ts';
import { crumbs, eraseTimeline, erasingAt, isErased } from './eraser.ts';
import { foilColor, glintAt, METALS, sheen } from './foil.ts';
import { graphiteGray, smudges, splinters } from './graphite.ts';
import { hapticFor } from './haptics.ts';
import { hatchLines, inkOutline } from './hatch.ts';
import { createShowcasePlugins, normalizePluginOptions, SHOWCASE_PLUGINS } from './index.ts';
import { joinPath, joinProgress, joinTimes, planJoins } from './joins.ts';
import { ballAt, landings } from './karaoke.ts';
import { cooled, emitterAt } from './laser.ts';
import { markerLine } from './marker.ts';
import { brightness } from './neon.ts';
import { broadNib, nibFactor } from './nib.ts';
import { grainTile } from './noise.ts';
import { type PaperLayout, paperBounds, paperLayout, paperShapes } from './paper.ts';
import { penPoses } from './pen.ts';
import { handTimes } from './rhythm.ts';
import { segmentLag, segmentPlugin, segmentSpan, segmentsEnd, taperAt, taperPath } from './segment.ts';
import { settle } from './settle.ts';
import { shakeAt, shakeStrength } from './shake.ts';
import { tremorAt, tremorWaves } from './shaky.ts';
import { leanAbout } from './slant.ts';
import { penMotion } from './sound.ts';
import { sparkleAt, strokeSparkles } from './sparkle.ts';
import { dripLength, drips, lowPoints, overspray } from './spray.ts';
import { stitches } from './stitch.ts';
import { layoutGuides } from './stroke-order.ts';
import { sweepOrder, sweepTimes } from './sweep.ts';
import { keyTimes, punch, strikeOf, typedGlyphs } from './typewriter.ts';
import { dryness, inkAge, poolFactors } from './wet.ts';

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

  test('a quick hop between strokes only lifts the pen part of the way', () => {
    const strokes = [stroke('0', line(0, 100, 0), 'done', 1, 0), stroke('1', line(100, 200, 40), 'pending', 0, 1.06)];
    const [pose] = penPoses(frame(1.03, strokes));
    expect(pose!.lift).toBeCloseTo(0.2);
  });

  test('on a fast stroke the pen follows the way the ink runs, not each zigzag under the nib', () => {
    // Right along a zigzag: every segment steep, the whole of it level.
    const zigzag = new StrokePath(Array.from({ length: 21 }, (_, i) => ({ x: i * 5, y: i % 2 ? 10 : 0, width: 8, t: i / 20 })));
    const [pose] = penPoses(frame(0.1, [stroke('0', zigzag, 'drawing', 1, 0, 0.2)]));
    expect(Math.abs(pose!.angle)).toBeLessThan(0.1);
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

describe('segment', () => {
  const path = line(0, 100, 0);

  test('the tail trails the pen by the length, as a share of the stroke, never past its start', () => {
    expect(segmentLag(100, 25)).toBe(0.25);
    expect(segmentLag(100, 400)).toBe(1);
    expect(segmentLag(0, 25)).toBe(1);
  });

  test('while the stroke is drawn the segment ends at the pen', () => {
    expect(segmentSpan(stroke('0', path, 'drawing', 0.6, 0), 0.6, 25)).toEqual({ from: 0.35, to: 0.6 });
    expect(segmentSpan(stroke('0', path, 'drawing', 0.1, 0), 0.1, 25)).toEqual({ from: 0, to: 0.1 });
  });

  test('nothing shows before the pen reaches the stroke', () => {
    expect(segmentSpan(stroke('0', path, 'pending', 0, 1), 0.5, 25)).toBeNull();
  });

  test("once the stroke is done the tail runs on at the pen's pace, then the segment is gone", () => {
    const done = stroke('0', path, 'done', 1, 0, 1);
    expect(segmentSpan(done, 1, 25)).toEqual({ from: 0.75, to: 1 });
    expect(segmentSpan(done, 1.1, 25)!.from).toBeCloseTo(0.85);
    expect(segmentSpan(done, 1.25, 25)).toBeNull();
  });

  test('a taper narrows to a point at the end and is full width past its reach', () => {
    expect(taperAt(0, 10)).toBe(0);
    expect(taperAt(5, 10)).toBeCloseTo(Math.SQRT1_2);
    expect(taperAt(10, 10)).toBe(1);
    expect(taperAt(0, 0)).toBe(1);
  });

  test('a tapered segment comes to a point at both ends and keeps its width in the middle', () => {
    const tapered = taperPath(path, 20);
    const pts = tapered.points;
    expect(pts[0]!.width).toBe(0);
    expect(pts[pts.length - 1]!.width).toBeCloseTo(0);
    expect(tapered.pointAt(0.5).width).toBeCloseTo(8);
    expect(pts[0]!.t).toBe(0);
    expect(pts[pts.length - 1]!.t).toBe(1);
  });

  test('by default the segment is untapered, over the ink, and the text is written as usual', () => {
    expect(segmentPlugin.defaults).toMatchObject({ width: 1, taper: 0, own: false, under: false, whole: false, hide: false });
  });

  test('the timeline runs until the last segment has left its stroke', () => {
    const strokes = [stroke('0', path, 'done', 1, 0, 1), stroke('1', line(0, 10, 0), 'done', 1, 1, 2)];
    // The second is shorter than the segment: its tail takes a whole stroke's time to catch up.
    expect(segmentsEnd(strokes, 25)).toBe(5);
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
      brush: { bristles: 40 },
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

describe('wet ink pooling', () => {
  test('ink swells where the pen lands, most at the start, and not along a straight middle', () => {
    const f = poolFactors(line(0, 200, 0, 10).points, 1);
    expect(f[0]!).toBeGreaterThan(f.at(-1)!);
    expect(f.at(-1)!).toBeGreaterThan(1);
    expect(f[5]!).toBeCloseTo(1);
  });

  test('a sharp turn pools', () => {
    const corner = new StrokePath([
      ...Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0, width: 8, t: i / 20 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 100, y: (i + 1) * 10, width: 8, t: (11 + i) / 21 })),
    ]);
    const f = poolFactors(corner.points, 1);
    expect(f[10]!).toBeGreaterThan(1.3);
    expect(poolFactors(corner.points, 0).every((v) => v === 1)).toBe(true);
  });
});

describe('big brush', () => {
  test('pressed fat at the start, lifting to a point at the end', () => {
    expect(brushWidth(0, 3, 0.5)).toBeCloseTo(4.5);
    expect(brushWidth(0.5, 3, 0.5)).toBeCloseTo(3);
    expect(brushWidth(1, 3, 0.5)).toBeLessThan(1.5);
  });

  test('splatter lands near where the brush lands and leaves', () => {
    const path = line(0, 400, 0, 20);
    const drops = splashes(path, 1, lcg(5));
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) {
      expect(d.t < 0.12 || d.t > 0.95).toBe(true);
      expect(Math.abs(d.y)).toBeLessThan(60);
    }
    expect(splashes(path, 0, lcg())).toEqual([]);
  });
});

describe('slant', () => {
  test('leans about the baseline: points on it stay, points above it move right', () => {
    const place = { x: 0, y: 0, scale: 0.1, ascender: 800 };
    expect(leanAbout({ x: 10, y: 80 }, place, 0.5)).toEqual({ x: 10, y: 80 });
    expect(leanAbout({ x: 10, y: 60 }, place, 0.5).x).toBeCloseTo(20);
  });
});

describe('shaky hand', () => {
  test('the tremor stays within the amount', () => {
    const waves = tremorWaves(12, lcg());
    for (let a = 0; a < 3; a += 0.01) expect(Math.abs(tremorAt(a, waves))).toBeLessThanOrEqual(1);
    expect(new Set(Array.from({ length: 20 }, (_, i) => tremorAt(i * 0.05, waves).toFixed(3))).size).toBeGreaterThan(10);
  });
});

describe('neon', () => {
  const o = { flicker: 0.4, faulty: 0, warmup: 0.6 };

  test('the same glyph and step flicker the same every time', () => {
    expect(brightness(3, 17, 2, o)).toBe(brightness(3, 17, 2, o));
  });

  test('a tube sputters as it warms up, then holds steady but for its hum', () => {
    const warming = Array.from({ length: 40 }, (_, step) => brightness(3, step, 0.05, o));
    expect(warming.some((b) => b < 0.2)).toBe(true);
    const lit = Array.from({ length: 200 }, (_, step) => brightness(3, step, 5, o));
    expect(Math.min(...lit)).toBeGreaterThan(0.9);
  });

  test('a faulty tube stutters for good; with no hum a sound one is fully lit', () => {
    const faulty = Array.from({ length: 400 }, (_, step) => brightness(3, step, 5, { ...o, faulty: 1 }));
    expect(faulty.some((b) => b < 0.2)).toBe(true);
    expect(brightness(3, 9, 5, { flicker: 0, faulty: 0, warmup: 0 })).toBe(1);
  });
});

describe('laser', () => {
  test('the line is white-hot where the beam is, cooling to its final color', () => {
    const red: [number, number, number, number] = [255, 0, 0, 1];
    const char: [number, number, number, number] = [40, 20, 10, 1];
    expect(cooled(0, 1, red, char)).toEqual([255, 191, 191, 1]);
    expect(cooled(0.25, 1, red, char)).toEqual(red);
    expect(cooled(5, 1, red, char)).toEqual(char);
  });

  test('the beam comes from off the text on the side asked for', () => {
    const box = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    expect(emitterAt(box, 'top', 100)).toEqual({ x: 100, y: -150 });
    expect(emitterAt(box, 'left', 100).x).toBeLessThan(0);
  });
});

describe('graphite', () => {
  test('splinters lie off the line, shed along it', () => {
    const path = line(0, 400, 0, 8);
    const list = splinters(path, 100, 1, lcg());
    expect(list).toHaveLength(20);
    for (const f of list) expect(Math.abs(f.y)).toBeGreaterThanOrEqual(4);
  });

  test('dust is smudged down and to the right of the line', () => {
    for (const b of smudges(line(0, 400, 0, 8), 100, 1, lcg())) {
      expect(b.y).toBeGreaterThan(0);
      expect(b.alpha).toBeLessThan(0.2);
    }
  });

  test('softer graphite is darker', () => {
    const level = (c: string) => Number(/rgb\((\d+)/.exec(c)![1]);
    expect(level(graphiteGray(1))).toBeLessThan(level(graphiteGray(0)));
  });
});

describe('karaoke', () => {
  const glyph = (entryIndex: number, x: number, start: number): PlacedStroke =>
    ({
      entryIndex,
      start,
      place: { x, y: 0, scale: 0.1, ascender: 800 },
      rawPath: line(x + 10, x + 90, 50),
      path: line(x + 10, x + 90, 50),
      glyph: { w: 1000 },
    }) as unknown as PlacedStroke;

  test('the ball lands on each glyph as it starts, above the line, hopping between', () => {
    const stops = landings([glyph(0, 0, 0), glyph(1, 100, 1)], 100, 0.1);
    expect(stops.map((s) => [s.x, s.time])).toEqual([
      [50, 0],
      [150, 1],
    ]);
    expect(ballAt(stops, 0, 30)).toMatchObject({ x: 50 });
    const mid = ballAt(stops, 0.5, 30)!;
    expect(mid.x).toBeCloseTo(100);
    expect(mid.y).toBeLessThan(stops[0]!.y - 25);
    expect(ballAt(stops, 9, 30)).toMatchObject({ x: 150 });
  });
});

describe('haptics', () => {
  test('a tap on touch-down, a buzz while writing if asked for, nothing on a seek', () => {
    expect(hapticFor({ distance: 5, touches: 1 }, { tap: 14, buzz: false }, 1)).toBe(14);
    expect(hapticFor({ distance: 5, touches: 0 }, { tap: 14, buzz: false }, 1)).toBeNull();
    expect(hapticFor({ distance: 5, touches: 0 }, { tap: 14, buzz: true }, 1)).toBe(6);
    expect(hapticFor({ distance: 5, touches: 0 }, { tap: 14, buzz: true }, 0.01)).toBeNull();
    expect(hapticFor(null, { tap: 14, buzz: true }, 1)).toBeNull();
  });
});

describe('eraser', () => {
  // Two strokes, 0–1 and 1–2, in a timeline 2.5s long.
  const strokes = [
    { start: 0, duration: 1 },
    { start: 1, duration: 1 },
  ];

  test('write, then erase: written as it was, then erased over as long again, the last stroke first', () => {
    const t = eraseTimeline(strokes, 2.5, 'write-erase', 'reverse');
    expect(t.write).toEqual(strokes);
    expect(t.erase).toEqual([
      { start: 4, duration: 1 },
      { start: 3, duration: 1 },
    ]);
    expect(t.duration).toBe(5);
  });

  test('erasing from written: all there at the start, erased over the timeline in writing order', () => {
    const t = eraseTimeline(strokes, 2.5, 'erase', 'same');
    expect(t.write).toEqual([
      { start: 0, duration: 0 },
      { start: 0, duration: 0 },
    ]);
    expect(t.erase).toEqual(strokes);
    expect(t.duration).toBe(2.5);
  });

  test('erasing the last stroke first runs back along the stroke', () => {
    const erase = { start: 2, duration: 1 };
    expect(erasingAt(1, erase, 1.5, 'reverse')).toMatchObject({ from: 0, to: 1, eraser: null });
    const mid = erasingAt(1, erase, 2.5, 'reverse');
    expect(mid.to).toBeCloseTo(0.5);
    expect(mid.eraser).toBeCloseTo(0.5);
    expect(erasingAt(1, erase, 3.5, 'reverse').to).toBe(0);
  });

  test('erasing as written runs along each stroke from its start, up to what’s written', () => {
    const mid = erasingAt(0.8, { start: 1, duration: 1 }, 1.5, 'same');
    expect(mid.from).toBeCloseTo(0.5);
    expect(mid.to).toBe(0.8);
  });

  test('crumbs show where the eraser has been', () => {
    const e = erasingAt(1, { start: 2, duration: 1 }, 2.5, 'reverse');
    expect(isErased(e, 0.8, 'reverse')).toBe(true);
    expect(isErased(e, 0.2, 'reverse')).toBe(false);
    expect(crumbs(line(0, 200, 0), 100, 1, lcg()).length).toBe(8);
  });
});

describe('typewriter', () => {
  test('each glyph strikes its own way, the same every time', () => {
    expect(strikeOf(4, 1, 1)).toEqual(strikeOf(4, 1, 1));
    expect(strikeOf(4, 1, 1)).not.toEqual(strikeOf(5, 1, 1));
    const true_ = strikeOf(4, 0, 0);
    expect(true_.ink).toBe(1);
    expect(Math.abs(true_.dx) + Math.abs(true_.dy) + Math.abs(true_.turn)).toBe(0);
  });

  test('a strike snaps in and settles', () => {
    expect(punch(-0.1, 1)).toBe(0);
    expect(punch(0, 1)).toBe(1);
    expect(Math.abs(punch(0.3, 1))).toBeLessThan(0.001);
  });

  test('keys come at the rate, evenly without rhythm, unevenly with it', () => {
    expect(keyTimes(4, 10, 0, lcg())).toEqual([0, 0.1, 0.2, 0.30000000000000004]);
    const uneven = keyTimes(20, 10, 1, lcg());
    const gaps = uneven.slice(1).map((t, i) => t - uneven[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.05);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(0.15);
    expect(new Set(gaps.map((g) => g.toFixed(4))).size).toBeGreaterThan(5);
  });

  test('glyphs are typed in the order they’re struck, once each, ending where their advance does', () => {
    const at = (entryIndex: number, start: number, x: number) =>
      ({ entryIndex, start, place: { x, y: 0, scale: 0.1, ascender: 800 }, glyph: { w: 500 } }) as unknown as StrokeFrame;
    const typed = typedGlyphs([at(1, 0.5, 50), at(0, 0, 0), at(1, 0.5, 50)]);
    expect(typed.map((g) => g.entryIndex)).toEqual([0, 1]);
    expect(typed[1]!.end).toEqual({ x: 100, y: 80 });
  });
});

describe('cathode tube', () => {
  test('tears come now and then with a bad signal, never with a good one', () => {
    expect(Array.from({ length: 100 }, (_, s) => tearsAt(0, s, 0)).flat()).toEqual([]);
    const torn = Array.from({ length: 100 }, (_, s) => tearsAt(0, s, 1)).filter((t) => t.length > 0).length;
    expect(torn).toBeGreaterThan(15);
    expect(torn).toBeLessThan(60);
  });

  test('the flicker is steady for a step, and none without flicker', () => {
    expect(dimAt(0, 7, 0.5)).toBe(dimAt(0, 7, 0.5));
    expect(dimAt(0, 7, 0)).toBe(0);
  });
});

describe('screen shake', () => {
  const o = { trigger: 'strokes' as const, amount: 0.05, decay: 0.1, rotation: 1, speed: 10 };
  const shaking = (time: number, strokes: StrokeFrame[]) => frame(time, strokes);

  test('a stroke landing jolts it, dying away', () => {
    const s = (t: number) => shaking(t, [stroke('0', line(0, 100, 0), 'drawing', 0.5, 1), stroke('1', line(0, 100, 0), 'pending', 0, 5)]);
    expect(shakeStrength(s(1), o)).toBe(1);
    expect(shakeStrength(s(1.2), o)).toBeLessThan(0.2);
    expect(shakeStrength(s(0.5), o)).toBe(0);
  });

  test('it comes to rest once the text is written, and shakes the same at the same time', () => {
    const done = shaking(3, [stroke('0', line(0, 100, 0), 'done', 1, 2.99)]);
    expect(shakeAt(done, o)).toEqual({ dx: 0, dy: 0, turn: 0 });
    const live = shaking(1.01, [stroke('0', line(0, 100, 0), 'drawing', 0.5, 1)]);
    expect(shakeAt(live, o)).toEqual(shakeAt(live, o));
    expect(Math.abs(shakeAt(live, o).dx)).toBeLessThanOrEqual(0.05);
  });

  test('a rumble while writing, whatever the strokes did', () => {
    const live = shaking(4, [stroke('0', line(0, 100, 0), 'drawing', 0.5, 1)]);
    expect(shakeStrength(live, { ...o, trigger: 'writing' })).toBeCloseTo(0.45);
    expect(shakeStrength(live, o)).toBe(0);
  });
});

describe('hand rhythm', () => {
  // Two strokes in a row, 100px to the em: a 1em stroke, then a 2em one starting 1em past where it ended.
  const strokes = [
    { start: 0, duration: 1, path: line(0, 100, 0) },
    { start: 1, duration: 1, path: line(200, 400, 0) },
  ];
  const steady = { speed: 4, travel: 0.1, hesitate: 0 };

  test('at a speed, a stroke takes as long as its length, after the pen travels to it', () => {
    const [a, b] = handTimes(strokes, 100, steady, lcg());
    expect(a).toEqual({ start: 0, duration: 0.25 });
    expect(b!.start).toBeCloseTo(0.25 + 0.03 + 0.1, 6);
    expect(b!.duration).toBeCloseTo(0.5, 6);
  });

  test('at speed 0 each stroke keeps its own duration', () => {
    expect(handTimes(strokes, 100, { ...steady, speed: 0 }, lcg()).map((t) => t.duration)).toEqual([1, 1]);
  });

  test('strokes keep the order they came in, whatever order they’re listed', () => {
    const [b, a] = handTimes([strokes[1]!, strokes[0]!], 100, steady, lcg());
    expect(a!.start).toBe(0);
    expect(b!.start).toBeGreaterThan(a!.start);
  });

  test('a hesitant hand stops now and then', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ start: i, duration: 1, path: line(i * 100, i * 100 + 50, 0) }));
    const calm = handTimes(many, 100, steady, lcg()).at(-1)!;
    const unsure = handTimes(many, 100, { ...steady, hesitate: 1 }, lcg()).at(-1)!;
    expect(unsure.start).toBeGreaterThan(calm.start + 0.5);
  });
});

describe('sweep', () => {
  const at = (x: number, y: number, seed = 0) => ({ path: line(x, x + 10, y), seed });
  const random = (k: number) => lcg(k + 1);

  test('a wipe goes left to right, a rise bottom to top, from the middle out', () => {
    const strokes = [at(100, 0), at(0, 0), at(50, 50)];
    expect(sweepOrder(strokes, 'wipe', random)).toEqual([1, 0, 0.5]);
    expect(sweepOrder(strokes, 'rise', random)).toEqual([1, 1, 0]);
    const center = sweepOrder([at(0, 0), at(50, 0), at(100, 0)], 'center', random);
    expect(center[1]).toBe(0);
    expect(center[0]).toBe(1);
  });

  test('all at once, every stroke starts together; scattered, glyph by glyph', () => {
    expect(sweepOrder([at(0, 0), at(90, 0)], 'together', random)).toEqual([0, 0]);
    const [a, b, c] = sweepOrder([at(0, 0, 1), at(10, 0, 1), at(20, 0, 2)], 'scatter', random);
    expect(a).toBe(b!);
    expect(a).not.toBe(c!);
  });

  test('the sweep takes its time across the text, each stroke its own draw', () => {
    expect(sweepTimes([0, 0.5, 1], 2, 0.3)).toEqual([
      { start: 0, duration: 0.3 },
      { start: 1, duration: 0.3 },
      { start: 2, duration: 0.3 },
    ]);
  });
});

describe('practice paper shapes', () => {
  const layout: PaperLayout = { lines: [{ left: 0, right: 100, baseline: 80, middle: 60 }], cells: [{ x: 0, y: 10, size: 50 }] };

  test('a ruled line is a capital line, a dashed middle line and the baseline', () => {
    const { rules, squares } = paperShapes(layout, 'ruled', 100);
    expect(rules.map((r) => [r.y0, r.dashed])).toEqual([
      [10, false],
      [45, true],
      [80, false],
    ]);
    expect(squares).toEqual([]);
  });

  test('a 米字格 square has its cross and both diagonals, dashed', () => {
    const { rules, squares } = paperShapes(layout, 'mi', 100);
    expect(squares).toHaveLength(1);
    expect(rules).toHaveLength(4);
    expect(rules.every((r) => r.dashed)).toBe(true);
  });
});

/** Placed strokes for `text` on one line: a glyph per character half an em (50 px) wide, one stroke across its lower half each, 0.2 s apart. A space draws nothing. */
function placedText(text: string): PlacedStroke[] {
  const out: PlacedStroke[] = [];
  let x = 0;
  let t = 0;
  [...text].forEach((char, i) => {
    if (char !== ' ') {
      const path = new StrokePath([
        { x: x + 5, y: 40, width: 6, t: 0 },
        { x: x + 45, y: 80, width: 6, t: 1 },
      ]);
      out.push({
        id: `${i}:0`,
        entryIndex: i,
        entry: { char, graphemeIndex: i, offset: t, duration: 0.2, hasGlyph: true },
        glyph: { w: 500, t: 0.2, s: [] },
        strokeIndex: 0,
        start: t,
        duration: 0.2,
        path,
        rawPath: path,
        nibs: [],
        seed: i,
        place: { x, y: 0, scale: 0.1, ascender: 800 },
      } as unknown as PlacedStroke);
      t += 0.2;
    }
    x += char === ' ' ? 25 : 50;
  });
  return out;
}

describe('cursive joins', () => {
  const joinOptions = { reach: 0.7, weight: 0.6, swing: 0.06, pace: 1.4 };

  test('a join runs from where one stroke ends to where the next starts', () => {
    const path = joinPath(0, 0, 0, 40, -20, 0, 4, 5);
    expect(path.pointAt(0)).toMatchObject({ x: 0, y: 0 });
    const end = path.pointAt(1);
    expect(end.x).toBeCloseTo(40);
    expect(end.y).toBeCloseTo(-20);
    // A hairline: thinner in the middle than at its ends.
    expect(path.pointAt(0.5).width).toBeLessThan(4);
  });

  test('letters are joined within a word, never across a space', () => {
    const joins = planJoins(placedText('ab cd'), joinOptions, 100);
    expect(joins.map((j) => [j.from, j.to])).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  test('the writing waits for each join, from the stroke it runs into on', () => {
    const strokes = placedText('abc');
    const joins = planJoins(strokes, joinOptions, 100);
    const times = joinTimes(strokes, joins);
    expect(times[0]!.start).toBe(0);
    expect(times[1]!.start).toBeCloseTo(0.2 + joins[0]!.duration);
    expect(times[2]!.start).toBeCloseTo(0.4 + joins[0]!.duration + joins[1]!.duration);
  });

  test('a join is drawn between the end of the stroke it leaves and the start of the next', () => {
    const join = { from: 0, to: 1, path: joinPath(0, 0, 0, 10, 0, 0, 2, 0), duration: 0.1 };
    const from = { start: 0, duration: 0.2 };
    const to = { start: 0.3, duration: 0.2 };
    expect(joinProgress(join, from, to, 0.2)).toBe(0);
    expect(joinProgress(join, from, to, 0.25)).toBeCloseTo(0.5);
    expect(joinProgress(join, from, to, 0.3)).toBe(1);
  });
});

describe('hatching', () => {
  test('lines are spaced as asked and cover the box', () => {
    const lines = hatchLines({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0, 10, 0, 1);
    const ys = lines.map((l) => l.y0).sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBeCloseTo(10);
    expect(ys[0]!).toBeLessThanOrEqual(0);
    expect(ys[ys.length - 1]!).toBeGreaterThanOrEqual(100);
  });

  test('overlapping boxes share their lines, so overlapping strokes share their hatching', () => {
    const a = hatchLines({ minX: 0, minY: 0, maxX: 50, maxY: 50 }, 0.7, 8, 2, 3);
    const b = hatchLines({ minX: 20, minY: 20, maxX: 90, maxY: 90 }, 0.7, 8, 2, 3);
    const across = (l: { x0: number; y0: number }) => Math.round((-Math.sin(0.7) * l.x0 + Math.cos(0.7) * l.y0) * 1000);
    const shared = a.map(across).filter((k) => b.map(across).includes(k));
    expect(shared.length).toBeGreaterThan(0);
  });

  test("a stroke's ink outline runs along both its edges; a dot has none", () => {
    const outline = inkOutline(line(0, 100, 0, 10))!;
    expect(Math.min(...outline.map((p) => p.y))).toBeCloseTo(-5);
    expect(Math.max(...outline.map((p) => p.y))).toBeCloseTo(5);
    expect(inkOutline(new StrokePath([{ x: 0, y: 0, width: 4, t: 0 }]))).toBeNull();
  });
});

describe('marker', () => {
  test('a felt tip lays one even width, the tip times the stroke’s mean', () => {
    const path = new StrokePath([
      { x: 0, y: 0, width: 2, t: 0 },
      { x: 10, y: 0, width: 6, t: 1 },
    ]);
    const out = markerLine(path, 2);
    expect(out.uniformWidth).toBe(true);
    expect(out.points[0]!.width).toBe(8);
  });
});

describe('chalk', () => {
  test('dust falls from where it’s shed and fades, then is gone', () => {
    const [m] = motes(line(0, 100, 0), 100, 1, lcg());
    const early = moteAt(m!, 0, 0, 0.1, 100)!;
    const late = moteAt(m!, 0, 0, m!.life * 0.9, 100)!;
    expect(late.y).toBeGreaterThan(early.y);
    expect(late.alpha).toBeLessThan(early.alpha);
    expect(moteAt(m!, 0, 0, -0.1, 100)).toBeNull();
    expect(moteAt(m!, 0, 0, m!.life + 0.1, 100)).toBeNull();
  });
});

describe('settle', () => {
  const strokes = [
    { start: 0, duration: 1 },
    { start: 1.5, duration: 1 },
  ] as unknown as PlacedStroke[];
  const ctx = (duration: number) => ({ strokes, duration, fontSize: 100, random: () => Math.random });

  test('the timeline runs on until the last stroke has settled', () => {
    expect(settle(1.5)!(ctx(2.5))!.duration).toBe(4);
  });

  test('two plugins settling wait for the longer, not both', () => {
    const once = settle(1)!(ctx(2.5))!.duration!;
    expect(settle(0.5)!(ctx(once))!.duration).toBe(3.5);
  });

  test('nothing to settle leaves the timing alone', () => {
    expect(settle(0)).toBeUndefined();
  });
});

describe('spray paint', () => {
  test('a drip waits, then runs, slowing, to its length', () => {
    const d = { t: 0, length: 40, width: 2, wait: 0.2 };
    expect(dripLength(d, 0.1, 1)).toBe(0);
    // It runs further in its first quarter second than in the next.
    const first = dripLength(d, 0.45, 1) - dripLength(d, 0.2, 1);
    const second = dripLength(d, 0.7, 1) - dripLength(d, 0.45, 1);
    expect(first).toBeGreaterThan(second);
    const end = dripLength(d, 5, 1);
    expect(end).toBeLessThanOrEqual(40);
    expect(end).toBeGreaterThan(39);
  });

  test('paint runs from where a line bottoms out, lowest first', () => {
    // A "u": down, round the bottom, and up again.
    const u = new StrokePath([
      { x: 0, y: 0, width: 4, t: 0 },
      { x: 5, y: 40, width: 4, t: 0.4 },
      { x: 10, y: 50, width: 4, t: 0.5 },
      { x: 15, y: 40, width: 4, t: 0.6 },
      { x: 20, y: 0, width: 4, t: 1 },
    ]);
    expect(lowPoints(u)).toEqual([0.5]);
    // A line running down ends low.
    expect(lowPoints(line(0, 0, 0).map((p) => ({ ...p, y: p.t * 30 })))).toEqual([1]);
  });

  test('overspray lands near the line, and none with no flecks asked for', () => {
    const path = line(0, 100, 0, 10);
    for (const f of overspray(path, 1, lcg())) expect(Math.abs(f.y)).toBeLessThanOrEqual(10 * 2.2);
    expect(overspray(path, 0, lcg())).toEqual([]);
    expect(drips(path, 100, 0, lcg())).toEqual([]);
  });
});

describe('gold foil', () => {
  test('the foil is brightest running across the light, darkest along it', () => {
    expect(sheen(Math.PI / 4, -Math.PI / 4)).toBeCloseTo(0);
    expect(sheen(0, 0)).toBeCloseTo(1);
    expect(foilColor(METALS.gold, 1, 0)).toEqual(METALS.gold[2]);
    expect(foilColor(METALS.gold, 0.5, 1)).toEqual([255, 255, 255, 1]);
  });

  test('the glint crosses in its sweep, then is off until the next', () => {
    expect(glintAt(0, 90, 3, 1)).toBe(0);
    expect(glintAt(15, 90, 3, 1)).toBeCloseTo(0.5);
    expect(glintAt(60, 90, 3, 1)).toBeNull();
    expect(glintAt(90, 90, 3, 1)).toBe(0);
  });
});

describe('embroidery', () => {
  test('satin stitches cross the stroke within the width asked, packed tighter the denser', () => {
    const path = line(0, 200, 0, 10);
    const loose = stitches(path, 'satin', 0.3, 1.4);
    const dense = stitches(path, 'satin', 0.9, 1.4);
    expect(dense.length).toBeGreaterThan(loose.length);
    for (const s of dense) expect(Math.max(Math.abs(s.y0), Math.abs(s.y1))).toBeLessThanOrEqual(7 + 1e-9);
  });

  test('running stitch leaves gaps along the line, cross stitch sews two threads a step', () => {
    const path = line(0, 200, 0, 10);
    const run = stitches(path, 'running', 0.6, 1);
    expect(run[1]!.x0).toBeGreaterThan(run[0]!.x1);
    const cross = stitches(path, 'cross', 0.6, 1);
    expect(cross.length % 2).toBe(0);
  });
});

describe('burn', () => {
  test('the line cools from white-hot to char', () => {
    expect(burnColor(0, 1)[0]).toBeGreaterThan(250);
    expect(burnColor(5, 1)).toEqual([38, 20, 10, 1]);
    const ember = burnColor(0.3, 1);
    expect(ember[0]).toBeGreaterThan(ember[2]);
  });

  test('smoke rises and fades', () => {
    const [p] = puffs(line(0, 100, 0), 100, 1, lcg());
    const a = puffAt(p!, p!.life * 0.3)!;
    const b = puffAt(p!, p!.life * 0.8)!;
    expect(b.dy).toBeLessThan(a.dy);
    expect(b.alpha).toBeLessThan(a.alpha);
    expect(puffAt(p!, p!.life + 1)).toBeNull();
  });
});
