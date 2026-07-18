/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { parseUrlState, URL_DEFAULTS } from './url-state.ts';

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
