/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { clearance, type StrokeFrame, StrokePath, type TegakiFrame } from 'tegaki/core';
import { bristles } from './brush.ts';
import { echoPasses, echoPlugin, lagged } from './echo.ts';
import { createShowcasePlugins, normalizePluginOptions, SHOWCASE_PLUGINS } from './index.ts';
import { penPoses } from './pen.ts';
import { penMotion } from './sound.ts';
import { layoutGuides } from './stroke-order.ts';

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
