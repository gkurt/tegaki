import { describe, expectTypeOf, test } from 'bun:test';
import font from 'tegaki/fonts/tangerine';
import type { TegakiPluginSpec } from './core/types.ts';
import { glowPlugin } from './plugins/glow.ts';
import type { TegakiBundle } from './types.ts';

describe.skip('types', () => {
  test('ensure font assignable', () => {
    expectTypeOf(font).toExtend<TegakiBundle>();
  });

  test('a plugin list takes plugins, names and [name, options]', () => {
    expectTypeOf(['taper', ['glow', { radius: 0.15 }], glowPlugin()] as const).toExtend<readonly TegakiPluginSpec[]>();
  });
});
