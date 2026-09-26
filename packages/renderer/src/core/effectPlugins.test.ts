import { describe, expect, test } from 'bun:test';
import { type ResolvedEffect, resolveEffects } from '../lib/effects.ts';
import { seededRandom } from '../lib/random.ts';
import { placeStrokes, sampleFrame, strokeInkBounds, strokeInstances } from '../lib/strokeTimeline.ts';
import { computeTimeline } from '../lib/timeline.ts';
import type { TegakiBundle, TegakiGlyphData } from '../types.ts';
import { drawGlyph } from './drawGlyph.ts';
import { effectPlugins } from './effectPlugins.ts';
import { paintWith, reshapeWith } from './plugins.ts';
import type { TegakiPlugin, TegakiStrokePaintContext } from './types.ts';

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

/** The stroke placed at `at` and reshaped by the effects' plugins. */
function placed(effects: ResolvedEffect[], at = { x: 0, y: 0, scale: 1, ascender: 0, seed: 0 }) {
  const reshape = reshapeWith(effectPlugins(effects), { fontSize: 100, random: (k) => seededRandom(0, k) }, noError);
  return placeStrokes(instances, { placeEntry: () => at, reshape });
}
const widths = (effects: ResolvedEffect[]) => placed(effects)[0]!.path.points.map((p) => p.width);

describe('effectPlugins', () => {
  test('pressureWidth is always there; the rest only when asked for', () => {
    expect(effectPlugins(resolveEffects(undefined)).map((p) => p.name)).toEqual(['pressureWidth']);
    const all = resolveEffects({
      glow: true,
      wobble: true,
      taper: true,
      strokeGradient: true,
      globalGradient: { colors: ['#f00', '#00f'] },
    });
    expect(effectPlugins(all).map((p) => p.name)).toEqual(['pressureWidth', 'taper', 'wobble', 'globalGradient', 'strokeGradient', 'glow']);
  });

  test('a globalGradient without colors adds nothing', () => {
    expect(effectPlugins(resolveEffects({ globalGradient: { colors: [] } })).map((p) => p.name)).toEqual(['pressureWidth']);
  });
});

describe('pressureWidth', () => {
  test("full strength keeps the bundle's widths", () => {
    expect(widths(resolveEffects(undefined))).toEqual([4, 10, 16]);
  });

  test('without it the stroke is one width, its mean', () => {
    expect(widths(resolveEffects({ pressureWidth: false }))).toEqual([10, 10, 10]);
  });

  test('half strength goes halfway to the mean', () => {
    expect(widths(resolveEffects({ pressureWidth: { strength: 0.5 } }))).toEqual([7, 10, 13]);
  });
});

describe('taper', () => {
  test('thins the ink toward both ends', () => {
    const [start, middle, end] = widths(resolveEffects({ pressureWidth: false, taper: { startLength: 0.5, endLength: 0.5 } }));
    expect(start!).toBeLessThan(middle!);
    expect(end!).toBeLessThan(middle!);
  });
});

describe('wobble', () => {
  test('moves the ink, and the head moves with it', () => {
    const wobble = resolveEffects({ wobble: { amplitude: 4 } });
    const [s] = placed(wobble, { x: 30, y: 40, scale: 1.5, ascender: 0, seed: 7 });
    expect(s!.path.points.some((p, i) => p.y !== s!.rawPath.points[i]!.y)).toBe(true);
    const head = sampleFrame([s!], 0.4, { strokeEasing: linear }).active[0]!.head;
    expect(head).toEqual(s!.path.pointAt(0.4));
  });

  test('the head is where the canvas ends the ink', () => {
    const wobble = resolveEffects({ pressureWidth: false, wobble: { amplitude: 4 } });
    const at = { x: 30, y: 40, scale: 1.5, ascender: 0, seed: 7 };
    const head = sampleFrame(placed(wobble, at), 0.4, { strokeEasing: linear }).active[0]!.head;

    // A 2D context stub that keeps the last point the ink was drawn to.
    let last: [number, number] = [NaN, NaN];
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
    const pos = { x: at.x, y: at.y, fontSize: 150, unitsPerEm: 100, ascender: 0, descender: 0 };
    drawGlyph(ctx, glyph, pos, 0.4, 'round', '#000', wobble, at.seed, undefined, linear);
    expect(head.x).toBeCloseTo(last[0], 6);
    expect(head.y).toBeCloseTo(last[1], 6);
  });
});

describe('paint plugins', () => {
  /** What reaches the default painter when the plugins paint the stroke. */
  function paintedStyle(effects: ResolvedEffect[]) {
    const frame = sampleFrame(placed(effects), 1).strokes[0]!;
    let style: unknown;
    const ctx = {
      save() {},
      restore() {},
      createLinearGradient: () => ({ addColorStop() {} }),
    } as unknown as CanvasRenderingContext2D;
    const paint = paintWith(effectPlugins(effects), noError, (s) => (style = s.style));
    paint({
      ctx,
      stroke: frame,
      style: '#123',
      lineCap: 'round',
      color: '#123',
      fontSize: 100,
      textBox: { minX: 0, minY: 0, maxX: 100, maxY: 20 },
      random: (k) => seededRandom(0, k),
    });
    return style;
  }

  test('without a gradient the stroke is painted in the text color', () => {
    expect(paintedStyle(resolveEffects(undefined))).toBe('#123');
  });

  test('globalGradient paints with one gradient across the text box', () => {
    expect(paintedStyle(resolveEffects({ globalGradient: { colors: ['#f00', '#00f'] } }))).toHaveProperty('addColorStop');
  });

  test('strokeGradient paints a color at each point, over globalGradient', () => {
    const style = paintedStyle(
      resolveEffects({ globalGradient: { colors: ['#f00', '#00f'] }, strokeGradient: { colors: ['#0f0', '#f0f'] } }),
    );
    expect(typeof style).toBe('function');
    expect((style as (t: number) => string)(0)).toBeString();
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

describe('glow', () => {
  test('bounds reach past the ink by the blur and offset', () => {
    const effects = resolveEffects({ glow: { radius: 10, offsetX: 5, offsetY: -20 } });
    const strokes = placed(effects);
    const glow = effectPlugins(effects).find((p) => p.name === 'glow')!;
    const box = glow.bounds!({ strokes, fontSize: 100, scale: 0.5 })!;
    const ink = strokeInkBounds(strokes[0]!)!;
    expect(box.minX).toBeCloseTo(ink.minX - 20, 6);
    expect(box.maxY).toBeCloseTo(ink.maxY + 20, 6);
  });
});
