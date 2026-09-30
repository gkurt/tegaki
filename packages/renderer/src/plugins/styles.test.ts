import { describe, expect, test } from 'bun:test';
import { createPlugin, lengthToPx, parseLength } from '../core/createPlugin.ts';
import { drawGlyph } from '../core/drawGlyph.ts';
import { getPlugin, isDeclarative, onPluginRegistered, PluginResolver, parsePluginSpecs, registerPlugin } from '../core/plugin-registry.ts';
import { paintsAhead, paintWith, reshapeWith } from '../core/plugins.ts';
import { pressurePlugin, resolvePressure } from '../core/pressure.ts';
import type { TegakiPlugin, TegakiStrokePaintContext } from '../core/types.ts';
import { seededRandom } from '../lib/random.ts';
import { placeStrokes, sampleFrame, strokeInkBounds, strokeInstances } from '../lib/strokeTimeline.ts';
import { computeTimeline } from '../lib/timeline.ts';
import type { TegakiBundle, TegakiGlyphData } from '../types.ts';
import { glowPlugin } from './glow.ts';
import { globalGradientPlugin, strokeGradientPlugin } from './gradient.ts';
import { taperPlugin } from './taper.ts';
import { variationPlugin } from './variation.ts';

type Pt = [number, number, number];
const linear = (t: number) => t;

// One 1s stroke, 100 font units long, getting wider along the way.
const glyph: TegakiGlyphData = {
  w: 100,
  t: 1,
  s: [
    {
      p: [
        [0, 0, 4],
        [50, 0, 10],
        [100, 0, 16],
      ] as Pt[],
      d: 0,
      a: 1,
    },
  ],
};
const bundle: TegakiBundle = {
  family: 'test',
  lineCap: 'round',
  fontUrl: '',
  fontFaceCSS: '',
  unitsPerEm: 100,
  ascender: 0,
  descender: 0,
  glyphData: { a: glyph },
};
const instances = strokeInstances(computeTimeline('a', bundle), bundle);
const noError = (plugin: TegakiPlugin, hook: string, error: unknown) => {
  throw new Error(`${plugin.name}.${hook}: ${error}`);
};

/** The stroke placed at `at` and reshaped by `plugins`, after the pressure step at `pressure`. */
function placed(plugins: readonly TegakiPlugin[], pressure = 1, at = { x: 0, y: 0, scale: 1, ascender: 0, seed: 0 }) {
  const reshape = reshapeWith(
    [pressurePlugin(pressure), ...plugins],
    { fontSize: 100, random: (k) => seededRandom(0, k), textBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
    noError,
  );
  return placeStrokes(instances, { placeEntry: () => at, reshape });
}
const widths = (plugins: readonly TegakiPlugin[], pressure = 1) => placed(plugins, pressure)[0]!.path.points.map((p) => p.width);

/** A stroke to paint, done, with a context that does nothing. */
function paintInput(plugins: readonly TegakiPlugin[], over: Partial<TegakiStrokePaintContext> = {}) {
  const frame = sampleFrame(placed(plugins), 1).strokes[0]!;
  return {
    ctx: { save() {}, restore() {}, createLinearGradient: () => ({ addColorStop() {} }) } as unknown as CanvasRenderingContext2D,
    stroke: frame,
    style: '#123',
    lineCap: 'round' as const,
    color: '#123',
    clipped: false,
    fontSize: 100,
    textBox: { minX: 0, minY: 0, maxX: 100, maxY: 20 },
    frame: { time: 1, strokes: [frame], active: [] },
    random: (k: string | number) => seededRandom(0, k),
    ...over,
  };
}

describe('pressure', () => {
  test("full strength keeps the bundle's widths", () => {
    expect(widths([])).toEqual([4, 10, 16]);
  });

  test('none draws the stroke at one width, its mean', () => {
    expect(widths([], 0)).toEqual([10, 10, 10]);
  });

  test('half strength goes halfway to the mean', () => {
    expect(widths([], 0.5)).toEqual([7, 10, 13]);
  });

  test('the option is kept within 0–1, and unset is full strength', () => {
    expect([resolvePressure(undefined), resolvePressure(2), resolvePressure(-1), resolvePressure(Number.NaN)]).toEqual([1, 1, 0, 1]);
  });
});

describe('taper', () => {
  test('thins the ink toward both ends', () => {
    const [start, middle, end] = widths([taperPlugin({ startLength: 0.5, endLength: 0.5 })], 0);
    expect(start!).toBeLessThan(middle!);
    expect(end!).toBeLessThan(middle!);
  });
});

describe('a geometry plugin (variation)', () => {
  test('moves the ink, and the head moves with it', () => {
    const [s] = placed([variationPlugin({ amount: 2 })], 1, { x: 30, y: 40, scale: 1.5, ascender: 0, seed: 7 });
    expect(s!.path.points.some((p, i) => p.y !== s!.rawPath.points[i]!.y)).toBe(true);
    const head = sampleFrame([s!], 0.4, { strokeEasing: linear }).active[0]!.head;
    expect(head).toEqual(s!.path.pointAt(0.4));
  });

  test('the head is where the canvas ends the ink', () => {
    const vary = variationPlugin({ amount: 2 });
    // Variation measures in em, so both sides lay the glyph out at the same font size (100px, `placed`'s).
    const at = { x: 30, y: 40, scale: 1, ascender: 0, seed: 7 };
    const head = sampleFrame(placed([vary], 0, at), 0.4, { strokeEasing: linear }).active[0]!.head;

    // A 2D context stub that keeps the last point the ink was drawn to.
    let last: [number, number] = [Number.NaN, Number.NaN];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => {
        if (key === 'lineTo') return (x: number, y: number) => (last = [x, y]);
        return target[key as string] ?? (() => {});
      },
      set: (target, key, value) => {
        target[key as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const pos = { x: at.x, y: at.y, fontSize: 100, unitsPerEm: 100, ascender: 0, descender: 0 };
    drawGlyph(ctx, glyph, pos, 0.4, { pressure: 0, plugins: [vary], seed: at.seed, strokeEasing: linear });
    expect(head.x).toBeCloseTo(last[0], 6);
    expect(head.y).toBeCloseTo(last[1], 6);
  });

  test("moves a clip outline's points by the same field as its glyph's strokes", () => {
    const place = { x: 0, y: 0, scale: 1, ascender: 0 };
    const contour = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const moved = variationPlugin({ amount: 2 }).outline!(contour, {
      place,
      seed: 3,
      fontSize: 100,
      textBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      step: 0,
    });
    expect(moved).not.toEqual(contour);
  });
});

describe('gradients', () => {
  /** What reaches the default painter when `plugins` paint the stroke. */
  function paintedStyle(plugins: readonly TegakiPlugin[]) {
    let style: unknown;
    paintWith(plugins, noError, (s) => (style = s.style))(paintInput(plugins));
    return style;
  }

  test('without one the stroke is painted in the text color', () => {
    expect(paintedStyle([])).toBe('#123');
  });

  test('a text gradient paints with one gradient across the text box', () => {
    expect(paintedStyle([globalGradientPlugin({ colors: ['#f00', '#00f'] })])).toHaveProperty('addColorStop');
  });

  test('a stroke gradient paints a color at each point; the later plugin wins', () => {
    const style = paintedStyle([globalGradientPlugin({ colors: ['#f00', '#00f'] }), strokeGradientPlugin({ colors: ['#0f0', '#f0f'] })]);
    expect(typeof style).toBe('function');
    expect((style as (t: number) => string)(0)).toBeString();
  });

  test('no colors is a rainbow', () => {
    const style = paintedStyle([strokeGradientPlugin()]) as (t: number) => string;
    expect(style(0)).toStartWith('hsl(');
    expect(style(0.5)).not.toBe(style(0));
  });
});

describe('glow', () => {
  test('bounds reach past the ink by the blur and offset, in em of the font size', () => {
    const glow = glowPlugin({ radius: 0.1, offsetX: 0.05, offsetY: -0.2 });
    const strokes = placed([glow], 1, { x: 0, y: 0, scale: 0.5, ascender: 0, seed: 0 });
    const box = glow.bounds!({ strokes, fontSize: 50 })!;
    const ink = strokeInkBounds(strokes[0]!)!;
    // 0.1em + 0.2em at 50px.
    expect(box.minX).toBeCloseTo(ink.minX - 15, 6);
    expect(box.maxY).toBeCloseTo(ink.maxY + 15, 6);
  });

  test('a length with px stays that many px at any font size', () => {
    const glow = glowPlugin({ radius: '6px' });
    const strokes = placed([glow]);
    const ink = strokeInkBounds(strokes[0]!)!;
    for (const fontSize of [20, 200]) expect(glow.bounds!({ strokes, fontSize })!.minX).toBeCloseTo(ink.minX - 6, 6);
  });

  /** The canvas calls painting `input` through a glow makes. */
  function glowCalls(over: Partial<TegakiStrokePaintContext>) {
    const calls: string[] = [];
    const state: Record<string, unknown> = {};
    const ctx = new Proxy(state, {
      get(target, key) {
        if (key === 'stroke') return () => calls.push(`copy w=${target.lineWidth} blur=${target.shadowBlur}`);
        if (key in target) return target[key as string];
        return () => {};
      },
      set(target, key, value) {
        target[key as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const glow = glowPlugin({ radius: 0.08, color: '#f0f' });
    paintWith([glow], noError, () => calls.push('ink'))(paintInput([glow], { ctx, ...over }));
    return calls;
  }

  test('each stroke gets one blurred copy at its mean width, under the stroke; 0.08em at 100px blurs by 8', () => {
    expect(glowCalls({})).toEqual(['copy w=10 blur=8', 'ink']);
  });

  test("with clip-to-text it doesn't paint per stroke: it lights the clipped ink in `ink`", () => {
    expect(glowCalls({ clipped: true })).toEqual(['ink']);
  });

  test('a stroke the pen has not reached gets no glow', () => {
    const glow = glowPlugin();
    const pending = { ...paintInput([glow]).stroke, state: 'pending' as const, progress: 0 };
    expect(glowCalls({ stroke: pending })).toEqual(['ink']);
  });
});

describe('painting ahead of the pen', () => {
  test('glow and the gradients paint only what the pen has drawn; a plain paint hook may paint ahead', () => {
    expect([glowPlugin(), strokeGradientPlugin(), globalGradientPlugin()].map(paintsAhead)).toEqual([false, false, false]);
    expect(paintsAhead({ name: 'guide', paint: (s, next) => next(s) })).toBe(true);
    expect(paintsAhead(taperPlugin())).toBe(false);
  });

  test('a factory made to paint what is drawn keeps its params and presets', () => {
    expect(glowPlugin.name).toBe('glow');
    expect(glowPlugin.params.radius.default).toBe(0.1);
    expect(glowPlugin.resolve({ radius: 5 }).radius).toBe(1);
  });
});

describe('length params', () => {
  const factory = createPlugin({
    name: 'sized',
    params: {
      size: { type: 'length', default: '0.2em', min: 0, max: 1 },
      shift: { type: 'length', unit: 'px', default: 0, min: -10, max: 10 },
    },
    setup: () => ({}),
  });

  test('a length is a bare number in its unit, or a number with px or em', () => {
    expect(parseLength(0.5)).toEqual({ value: 0.5, unit: undefined });
    expect(parseLength(' 8 PX ')).toEqual({ value: 8, unit: 'px' });
    expect(parseLength('.25em')).toEqual({ value: 0.25, unit: 'em' });
    expect(parseLength('-3')).toEqual({ value: -3, unit: undefined });
    for (const bad of ['8pt', '1rem', 'wide', '', Number.NaN, null, {}]) expect(parseLength(bad)).toBeUndefined();
  });

  test('lengthToPx scales em by the font size and keeps px; a bare number is in the unit given, em by default', () => {
    expect(lengthToPx(0.1, 80)).toBe(8);
    expect(lengthToPx('0.5em', 80)).toBe(40);
    expect(lengthToPx('12px', 80)).toBe(12);
    expect(lengthToPx(12, 80, 'px')).toBe(12);
    expect(lengthToPx('nope' as never, 80)).toBe(0);
  });

  test('in its own unit a length is written bare and kept in range', () => {
    expect(factory.defaults).toEqual({ size: 0.2, shift: 0 });
    expect(factory.resolve({ size: '3em', shift: '-40px' })).toEqual({ size: 1, shift: -10 });
  });

  test("in the other unit it's kept as given, only not below 0 when the range isn't", () => {
    expect(factory.resolve({ size: '40px', shift: '-0.5em' })).toEqual({ size: '40px', shift: '-0.5em' });
    expect(factory.resolve({ size: '-4px' }).size).toBe('0px');
  });

  test("what isn't a length takes the default, and the default written another way isn't a change", () => {
    expect(factory.resolve({ size: 'huge', shift: true }).size).toBe(0.2);
    expect(factory.changed({ size: '0.2em', shift: '0px' })).toEqual({});
    expect(factory.resolve({ shift: '0em' }).shift).toBe(0);
    expect(factory.changed({ size: '8px' })).toEqual({ size: '8px' });
  });
});

describe('paintWith', () => {
  const stroke = { ctx: { save() {}, restore() {} } } as unknown as TegakiStrokePaintContext;

  test('the first plugin is outermost; the default painter is last', () => {
    const calls: string[] = [];
    const wrap = (name: string): TegakiPlugin => ({
      name,
      paint(s, next) {
        calls.push(`${name}>`);
        next(s);
        calls.push(`<${name}`);
      },
    });
    paintWith([wrap('a'), wrap('b')], noError, () => calls.push('base'))(stroke);
    expect(calls).toEqual(['a>', 'b>', 'base', '<b', '<a']);
  });

  test('a paint hook that throws before calling next still has the stroke painted', () => {
    const errors: string[] = [];
    let painted = 0;
    const broken: TegakiPlugin = {
      name: 'broken',
      paint() {
        throw new Error('nope');
      },
    };
    paintWith(
      [broken],
      (p, hook) => errors.push(`${p.name}.${hook}`),
      () => painted++,
    )(stroke);
    expect(painted).toBe(1);
    expect(errors).toEqual(['broken.paint']);
  });
});

describe('point data through the plugins', () => {
  test('data a geometry hook attaches reaches the frame — through variation, taper and pressure — and the pen head', () => {
    const depth: TegakiPlugin = { name: 'depth', geometry: (path) => path.map((p) => ({ ...p, data: { z: p.t * 10 } })) };
    const [stroke] = placed([depth, variationPlugin(), taperPlugin()]);
    expect(stroke!.path.points.map((p) => p.data?.z)).toEqual(stroke!.path.points.map((p) => p.t * 10));
    const [drawing] = sampleFrame([stroke!], 0.5).active;
    expect(drawing!.head.data?.z).toBeCloseTo(drawing!.progress * 10, 6);
  });
});

describe('colors params', () => {
  const palette = createPlugin({
    name: 'palette',
    params: { colors: { type: 'colors', default: ['#000', '#fff'] } },
    setup: () => ({}),
  });

  test('a list of non-empty strings is taken as given; anything else is the default', () => {
    expect(palette.resolve({ colors: ['#f00'] }).colors).toEqual(['#f00']);
    expect(palette.resolve({ colors: 'red' }).colors).toEqual(['#000', '#fff']);
    expect(palette.resolve({ colors: ['#f00', ''] }).colors).toEqual(['#000', '#fff']);
  });

  test('a list equal to the default is not a change', () => {
    expect(palette.changed({ colors: ['#000', '#fff'] })).toEqual({});
    expect(palette.changed({ colors: ['#000'] })).toEqual({ colors: ['#000'] });
  });

  test("the default can't be changed through what resolve returns", () => {
    palette.resolve().colors.push('#123');
    expect(palette.defaults.colors).toEqual(['#000', '#fff']);
    expect(palette.resolve().colors).toEqual(['#000', '#fff']);
  });
});

describe('the plugin registry', () => {
  const probe = createPlugin({
    name: 'registry-probe',
    params: { size: { type: 'number', default: 1, min: 0, max: 10 } },
    setup: () => ({ geometry: (path) => path }),
  });
  registerPlugin(probe);

  test('a factory is found by its name', () => {
    expect(getPlugin('registry-probe')).toBe(probe);
  });

  test('names and [name, options] become plugins made by the factory, with their options resolved', () => {
    const { plugins, missing } = new PluginResolver().resolve(['registry-probe', ['registry-probe', { size: 99 }]]);
    expect(plugins.map((p) => p.name)).toEqual(['registry-probe', 'registry-probe']);
    expect(plugins[0]).not.toBe(plugins[1]);
    expect(missing).toEqual([]);
  });

  test('plugin objects pass through as they are', () => {
    const own: TegakiPlugin = { name: 'own' };
    expect(new PluginResolver().resolve([own]).plugins).toEqual([own]);
  });

  test('the same names with the same options keep their plugins from list to list', () => {
    const resolver = new PluginResolver();
    const first = resolver.resolve(['registry-probe', ['registry-probe', { size: 2 }]]).plugins;
    const again = resolver.resolve(['registry-probe', ['registry-probe', { size: 2, unknown: true }]]).plugins;
    expect(again[0]).toBe(first[0]);
    expect(again[1]).toBe(first[1]);
    expect(resolver.resolve([['registry-probe', { size: 3 }]]).plugins[0]).not.toBe(first[1]);
  });

  test('a name nothing is registered as is reported missing and left out', () => {
    const { plugins, missing } = new PluginResolver().resolve(['nothing-here'], { warn: false });
    expect(plugins).toEqual([]);
    expect(missing).toEqual(['nothing-here']);
  });

  test('listeners hear of registrations by name', () => {
    const heard: string[] = [];
    const off = onPluginRegistered((names) => heard.push(...names));
    const late = createPlugin({ name: 'registry-late', setup: () => ({}) });
    registerPlugin(late);
    off();
    registerPlugin(late);
    expect(heard).toEqual(['registry-late']);
  });

  test('a factory registered again under a name makes new plugins', () => {
    const resolver = new PluginResolver();
    const before = resolver.resolve(['registry-swap'], { warn: false });
    expect(before.missing).toEqual(['registry-swap']);
    registerPlugin(createPlugin({ name: 'registry-swap', setup: () => ({}) }));
    const a = resolver.resolve(['registry-swap']).plugins[0];
    registerPlugin(createPlugin({ name: 'registry-swap', setup: () => ({}) }));
    expect(resolver.resolve(['registry-swap']).plugins[0]).not.toBe(a);
  });

  test('only a list of names and [name, options] is declarative', () => {
    expect(isDeclarative(['a', ['b', { x: 1 }]])).toBe(true);
    expect(isDeclarative(['a', { name: 'c' }])).toBe(false);
  });

  test('a plugins attribute is names split by spaces or commas, or a JSON array', () => {
    expect(parsePluginSpecs('taper  glow,boil')).toEqual(['taper', 'glow', 'boil']);
    expect(parsePluginSpecs('["taper", ["glow", {"radius": 0.15}]]')).toEqual(['taper', ['glow', { radius: 0.15 }]]);
    expect(parsePluginSpecs('  ')).toBeUndefined();
    expect(parsePluginSpecs(null)).toBeUndefined();
  });
});
