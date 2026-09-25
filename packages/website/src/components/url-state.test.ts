/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { buildUrlParams, defaultClipText, parseUrlState, URL_DEFAULTS } from './url-state.ts';

describe('parseUrlState', () => {
  test('invalid gs value falls back to the default geometry stage instead of poisoning state', () => {
    const state = parseUrlState('?pl=geometry&gs=axes');
    expect(state.pipeline).toBe('geometry');
    expect(state.geometryStage).toBe(URL_DEFAULTS.geometryStage);
  });

  test('valid gs value is preserved', () => {
    const state = parseUrlState('?pl=geometry&gs=corners');
    expect(state.geometryStage).toBe('corners');
  });

  test('invalid enum-like params (s, m, tm, pl, se, ge) all fall back to defaults', () => {
    const state = parseUrlState('?s=bogus&m=bogus&tm=bogus&pl=bogus&se=bogus&ge=bogus');
    expect(state.activeStage).toBe(URL_DEFAULTS.activeStage);
    expect(state.previewMode).toBe(URL_DEFAULTS.previewMode);
    expect(state.timeMode).toBe(URL_DEFAULTS.timeMode);
    expect(state.pipeline).toBe(URL_DEFAULTS.pipeline);
    expect(state.strokeEasing).toBe(URL_DEFAULTS.strokeEasing);
    expect(state.glyphEasing).toBe(URL_DEFAULTS.glyphEasing);
  });

  test('valid enum-like params are preserved', () => {
    const state = parseUrlState('?s=skeleton&m=glyph&tm=css&se=ease-out-cubic&ge=linear');
    expect(state.activeStage).toBe('skeleton');
    expect(state.previewMode).toBe('glyph');
    expect(state.timeMode).toBe('css');
    expect(state.strokeEasing).toBe('ease-out-cubic');
    expect(state.glyphEasing).toBe('linear');
  });
});

describe('clip-to-text default follows the pipeline', () => {
  test('a bare URL opens on the geometry pipeline, clipped at ×1.2', () => {
    const state = parseUrlState('');
    expect(state.pipeline).toBe('geometry');
    expect(state.quality.clipText).toBe(1.2);
  });

  test('pl=raster without ct_ is unclipped', () => {
    expect(parseUrlState('?pl=raster').quality.clipText).toBe(false);
  });

  test("each pipeline's own clip default is left out of the URL", () => {
    for (const pipeline of ['geometry', 'raster'] as const) {
      const state = { ...URL_DEFAULTS, pipeline, quality: { ...URL_DEFAULTS.quality, clipText: defaultClipText(pipeline) } };
      expect(buildUrlParams(state).has('ct_')).toBe(false);
    }
  });

  test('turning the geometry clip off round-trips as ct_=0', () => {
    const state = { ...URL_DEFAULTS, quality: { ...URL_DEFAULTS.quality, clipText: false } };
    const params = buildUrlParams(state);
    expect(params.get('ct_')).toBe('0');
    expect(parseUrlState(params).quality.clipText).toBe(false);
  });

  test('a clipped raster preview round-trips its factor', () => {
    const state = { ...URL_DEFAULTS, pipeline: 'raster' as const, quality: { ...URL_DEFAULTS.quality, clipText: 1.5 } };
    expect(parseUrlState(buildUrlParams(state)).quality.clipText).toBe(1.5);
  });
});

describe('Han locale', () => {
  test('the Chinese convention round-trips as ghl=zh; the Japanese default stays out of the URL', () => {
    const zh = { ...URL_DEFAULTS, geometryOptions: { ...URL_DEFAULTS.geometryOptions, hanLocale: 'zh' as const } };
    const params = buildUrlParams(zh);
    expect(params.get('ghl')).toBe('zh');
    expect(parseUrlState(params).geometryOptions.hanLocale).toBe('zh');
    expect(buildUrlParams(URL_DEFAULTS).has('ghl')).toBe(false);
  });

  test('an unknown locale falls back to the default', () => {
    expect(parseUrlState('?ghl=ko').geometryOptions.hanLocale).toBe(URL_DEFAULTS.geometryOptions.hanLocale);
  });
});
