import { afterEach, describe, expect, test } from 'bun:test';
import type { BundleShaper } from '../lib/shaper.ts';
import type { TegakiBundle } from '../types.ts';
import { getShaperForBundle, registerShaper, settledShaperForBundle } from './shaper-registry.ts';

const bundle = (fontUrl: string, features?: string[]) => ({ fontUrl, features }) as unknown as TegakiBundle;
const fakeShaper = (): BundleShaper => ({ shape: () => [] });

afterEach(() => registerShaper(null));

describe('shaper registry', () => {
  test('the same font under other features gets its own shaper — a toggled-off feature is not shaped with', () => {
    const built: string[][] = [];
    registerShaper((b) => {
      built.push([...(b.features ?? [])]);
      return Promise.resolve(fakeShaper());
    });
    getShaperForBundle(bundle('font.ttf', ['calt', 'liga']));
    getShaperForBundle(bundle('font.ttf', ['liga']));
    getShaperForBundle(bundle('font.ttf', ['liga']));
    expect(built).toEqual([['calt', 'liga'], ['liga']]);
  });

  test('a built shaper is available synchronously, so an engine swapping bundles never draws a frame unshaped', async () => {
    const shaper = fakeShaper();
    registerShaper(() => Promise.resolve(shaper));
    expect(settledShaperForBundle(bundle('font.ttf'))).toBeUndefined();
    await getShaperForBundle(bundle('font.ttf'));
    // A rebuilt bundle object for the same font and features finds it.
    expect(settledShaperForBundle(bundle('font.ttf'))).toBe(shaper);
  });

  test('a shaper that failed to build settles as null — the engine renders unshaped instead of waiting', async () => {
    registerShaper(() => Promise.reject(new Error('fetch failed')));
    await getShaperForBundle(bundle('font.ttf'))?.catch(() => {});
    expect(settledShaperForBundle(bundle('font.ttf'))).toBeNull();
  });
});
