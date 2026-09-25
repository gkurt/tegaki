import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { TegakiBundle } from '../types.ts';
import { warnFontLoadFailure } from './engine.ts';

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
