import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { BUNDLE_VERSION, type TegakiBundle } from '../types.ts';
import { registerBundle } from './bundle-registry.ts';

const bundle = (family: string, version: number | undefined): TegakiBundle => ({
  version,
  family,
  lineCap: 'round',
  fontUrl: '',
  fontFaceCSS: '',
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  glyphData: {},
});

describe('bundle versions', () => {
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  test('a bundle of the current version, or a pre-1.0 one (the same format), registers quietly', () => {
    expect(BUNDLE_VERSION).toBe(1);
    registerBundle(bundle('current', BUNDLE_VERSION));
    registerBundle(bundle('pre-1.0', 0));
    expect(warn).not.toHaveBeenCalled();
  });

  test('a bundle of a version this engine does not know, or none, is warned about once', () => {
    const future = bundle('future', 2);
    registerBundle(future);
    registerBundle(future);
    registerBundle(bundle('unversioned', undefined));
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
