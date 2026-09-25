import { describe, expect, test } from 'bun:test';
import { BUNDLE_VERSION, type TegakiBundle } from '../types.ts';
import { buildRootProps } from './render-elements.ts';

const bundle: TegakiBundle = {
  version: BUNDLE_VERSION,
  family: 'Test Tegaki 1234',
  fullFamily: 'Test',
  lineCap: 'round',
  fontUrl: '',
  fontFaceCSS: '',
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  glyphData: {},
};

describe('buildRootProps', () => {
  test('the server-rendered font stack ends with the fallbackFont list', () => {
    expect(buildRootProps({ font: bundle, fallbackFont: 'serif' }).style.fontFamily).toBe("'Test Tegaki 1234', 'Test', serif");
  });
});
