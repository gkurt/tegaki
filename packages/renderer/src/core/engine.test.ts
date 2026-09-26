import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { TegakiBundle } from '../types.ts';
import { isMotionReduced, nextSeed, resolveSeed, warnFontLoadFailure } from './engine.ts';

const bundleAt = (fontUrl: string) => ({ family: 'Test', fontUrl }) as TegakiBundle;

describe('warnFontLoadFailure', () => {
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, 'warn').mockImplementation(mock());
  });
  afterEach(() => warn.mockRestore());

  test('warns only once per font URL', () => {
    const bundle = bundleAt('https://example.com/once.ttf');
    warnFontLoadFailure(bundle, new Error('x'));
    warnFontLoadFailure(bundle, new Error('x'));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a URL inside the Vite pre-bundle cache points at optimizeDeps.exclude', () => {
    warnFontLoadFailure(bundleAt('http://localhost:5173/node_modules/.vite/deps/caveat.ttf'), new Error('x'));
    expect(warn.mock.calls[0][0]).toContain("optimizeDeps: { exclude: ['tegaki'] }");
  });

  test("a bundle's full font is named by its own family and URL", () => {
    const bundle = { ...bundleAt('https://example.com/subset.ttf'), fullFamily: 'Test Full', fullFontUrl: 'https://example.com/full.ttf' };
    warnFontLoadFailure(bundle, new Error('x'), { family: 'Test Full', url: 'https://example.com/full.ttf' });
    expect(warn.mock.calls[0][0]).toContain('"Test Full" from https://example.com/full.ttf');
  });

  test('other URLs get no Vite hint', () => {
    warnFontLoadFailure(bundleAt('https://cdn.example.com/caveat.ttf'), new Error('x'));
    expect(warn.mock.calls[0][0]).not.toContain('optimizeDeps');
  });
});

describe('isMotionReduced', () => {
  test('animates by default, whatever the OS setting', () => {
    expect(isMotionReduced(undefined, true)).toBe(false);
    expect(isMotionReduced('never', true)).toBe(false);
  });

  test("'user' follows prefers-reduced-motion", () => {
    expect(isMotionReduced('user', true)).toBe(true);
    expect(isMotionReduced('user', false)).toBe(false);
  });

  test("'always' skips the animation even without the OS setting", () => {
    expect(isMotionReduced('always', false)).toBe(true);
  });
});

describe('seed', () => {
  test('a number is drawn with as given; anything else draws with 0', () => {
    expect(resolveSeed(42)).toBe(42);
    expect(resolveSeed(undefined)).toBe(0);
    expect(resolveSeed(Number.NaN)).toBe(0);
    expect(resolveSeed(Number.POSITIVE_INFINITY)).toBe(0);
  });

  test("'random' picks a whole number, short enough to write down", () => {
    const seed = resolveSeed('random');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(1_000_000);
  });

  test('an engine starts at seed 0, so an unset seed draws the same everywhere', () => {
    expect(nextSeed(undefined, { option: 0, seed: 0 })).toEqual({ option: 0, seed: 0 });
  });

  test("'random' set again keeps the number it picked", () => {
    const first = nextSeed('random', { option: 0, seed: 0 });
    expect(nextSeed('random', first)).toBe(first);
  });

  test("changing the option resolves it anew, and a number replaces the one 'random' picked", () => {
    const random = { option: 'random' as const, seed: 123456 };
    expect(nextSeed(7, random)).toEqual({ option: 7, seed: 7 });
    expect(nextSeed(undefined, random)).toEqual({ option: 0, seed: 0 });
  });
});
