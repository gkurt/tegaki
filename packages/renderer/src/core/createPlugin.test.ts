import { describe, expect, test } from 'bun:test';
import { changedPluginOptions, createPlugin, resolvePluginOptions } from './createPlugin.ts';
import type { TegakiStrokePaintContext } from './types.ts';

const params = {
  size: { type: 'number', default: 1, min: 0.5, max: 2 },
  arrows: { type: 'boolean', default: true },
  mode: { type: 'select', default: 'sine', options: ['sine', { value: 'noise', label: 'Noise' }] },
  color: { type: 'color', default: '#e5484d' },
} as const;

describe('createPlugin', () => {
  test('a plugin made with no options gets every default', () => {
    let seen: unknown;
    const make = createPlugin({
      name: 'probe',
      params,
      setup: (options) => {
        seen = options;
        return {};
      },
    });
    make();
    expect(seen).toEqual({ size: 1, arrows: true, mode: 'sine', color: '#e5484d' });
  });

  test('the options passed go over the defaults, the rest keep theirs', () => {
    let seen: unknown;
    const make = createPlugin({
      name: 'probe',
      params,
      setup: (options) => {
        seen = options;
        return {};
      },
    });
    make({ size: 1.5, mode: 'noise' });
    expect(seen).toEqual({ size: 1.5, arrows: true, mode: 'noise', color: '#e5484d' });
  });

  test('the plugin takes the definition’s name, whatever setup returns', () => {
    const make = createPlugin({ name: 'shadow', setup: () => ({ name: 'other', overlay: () => {} }) as never });
    const plugin = make();
    expect(plugin.name).toBe('shadow');
    expect(typeof plugin.overlay).toBe('function');
    expect(make.name).toBe('shadow');
  });

  test('each plugin made gets a setup of its own, so state in its closure isn’t shared', () => {
    let calls = 0;
    const make = createPlugin({
      name: 'counter',
      setup: () => {
        calls++;
        return {};
      },
    });
    make();
    make();
    expect(calls).toBe(2);
  });

  test('the factory tells a UI what it can be set to', () => {
    const make = createPlugin({
      name: 'probe',
      label: 'Probe',
      description: 'Looks around.',
      params,
      presets: { Big: { size: 2 } },
      setup: () => ({}),
    });
    expect(make.label).toBe('Probe');
    expect(make.description).toBe('Looks around.');
    expect(make.params).toBe(params);
    expect(make.defaults).toEqual({ size: 1, arrows: true, mode: 'sine', color: '#e5484d' });
    expect(make.presets).toEqual({ Big: { size: 2 } });
  });

  test('without a label a plugin is labelled by its name, and has no params or presets', () => {
    const make = createPlugin({ name: 'bare', setup: () => ({}) });
    expect(make.label).toBe('bare');
    expect(make.params).toEqual({});
    expect(make.defaults).toEqual({});
    expect(make.presets).toEqual({});
  });
});

describe('resolvePluginOptions', () => {
  test('numbers are kept in range', () => {
    expect(resolvePluginOptions(params, { size: 9 }).size).toBe(2);
    expect(resolvePluginOptions(params, { size: -1 }).size).toBe(0.5);
  });

  test('values of the wrong type, or not among a select’s options, take the default', () => {
    const resolved = resolvePluginOptions(params, { size: '2', arrows: 1, mode: 'square', color: '' });
    expect(resolved).toEqual({ size: 1, arrows: true, mode: 'sine', color: '#e5484d' });
  });

  test('a number that isn’t finite takes the default', () => {
    expect(resolvePluginOptions(params, { size: Number.NaN }).size).toBe(1);
  });

  test('unknown keys are dropped, and input that isn’t an object gives the defaults', () => {
    expect(resolvePluginOptions(params, { size: 1.2, extra: 5 })).toEqual({ size: 1.2, arrows: true, mode: 'sine', color: '#e5484d' });
    expect(resolvePluginOptions(params, 'size=2')).toEqual(resolvePluginOptions(params));
    expect(resolvePluginOptions(params, null)).toEqual(resolvePluginOptions(params));
  });

  test('a factory resolves options the same way when it makes a plugin', () => {
    let seen: { size: number } | undefined;
    const make = createPlugin({
      name: 'probe',
      params,
      setup: (options) => {
        seen = options;
        return {};
      },
    });
    make({ size: 40 });
    expect(seen!.size).toBe(2);
    expect(make.resolve({ size: 40 }).size).toBe(2);
  });
});

describe('changedPluginOptions', () => {
  test('only options that differ from their defaults are kept', () => {
    expect(changedPluginOptions(params, { size: 1, arrows: false, mode: 'sine' })).toEqual({ arrows: false });
  });

  test('an option out of range is kept as it resolves, and dropped when that is the default', () => {
    expect(changedPluginOptions(params, { size: 5 })).toEqual({ size: 2 });
    expect(changedPluginOptions(params, { mode: 'square' as never })).toEqual({});
  });
});

describe('the docs example', () => {
  // As in docs/api/renderer.mdx, "Plugins with options".
  const shadow = createPlugin({
    name: 'shadow',
    params: {
      offset: { type: 'number', default: 4, min: 0, max: 20, step: 1 },
      color: { type: 'color', default: '#2850c8' },
      under: { type: 'boolean', default: true },
      cap: { type: 'select', default: 'round', options: ['round', { value: 'butt', label: 'Flat' }] },
    },
    presets: { Deep: { offset: 12 } },
    setup: ({ offset, color, under, cap }) => ({
      paint(s, next) {
        const path = s.stroke.path.map((p) => ({ ...p, x: p.x + offset, y: p.y + offset }));
        const copy = { ...s, style: color, lineCap: cap, stroke: { ...s.stroke, path } };
        if (under) next(copy);
        next(s);
        if (!under) next(copy);
      },
    }),
  });

  const path = { map: (f: (p: { x: number; y: number }) => unknown) => f({ x: 0, y: 0 }) };
  const stroke = { style: '#000', lineCap: 'round', stroke: { path } } as unknown as TegakiStrokePaintContext;
  const painted = (plugin: ReturnType<typeof shadow>) => {
    const out: { style: unknown; lineCap: string; at: unknown }[] = [];
    plugin.paint!(stroke, (s) => out.push({ style: s.style, lineCap: s.lineCap, at: s.stroke.path }));
    return out;
  };

  test('options are typed from the params', () => {
    const cap: 'round' | 'butt' = shadow.defaults.cap;
    const offset: number = shadow.defaults.offset;
    expect([cap, offset]).toEqual(['round', 4]);
  });

  test('the copy goes under the ink by default, offset and in its own color and cap', () => {
    const [copy, ink] = painted(shadow({ offset: 8, cap: 'butt' }));
    expect(copy).toEqual({ style: '#2850c8', lineCap: 'butt', at: { x: 8, y: 8 } });
    expect(ink!.style).toBe('#000');
  });

  test('switched off under, the copy goes over the ink', () => {
    const [ink, copy] = painted(shadow({ under: false }));
    expect(ink!.style).toBe('#000');
    expect(copy!.at).toEqual({ x: 4, y: 4 });
  });
});
