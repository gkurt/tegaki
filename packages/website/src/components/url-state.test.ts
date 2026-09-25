/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { DEFAULT_CHARS, KOREAN_CHARS, SIMPLIFIED_CHINESE_CHARS } from 'tegaki-generator';
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

describe('text frame width', () => {
  test('w round-trips as the frame width in whole pixels', () => {
    const state = parseUrlState('?w=412.4');
    expect(state.frameWidth).toBe(412);
    expect(buildUrlParams(state).get('w')).toBe('412');
  });

  test('a missing or invalid w leaves the frame on auto and writes nothing', () => {
    expect(parseUrlState('?w=-5').frameWidth).toBeNull();
    expect(parseUrlState('?w=wide').frameWidth).toBeNull();
    expect(buildUrlParams(URL_DEFAULTS).has('w')).toBe(false);
  });
});

describe('glyph form', () => {
  test('gv round-trips as the selected glyph id', () => {
    const state = parseUrlState('?g=a&gv=412');
    expect(state.selectedForm).toBe('412');
    expect(buildUrlParams(state).get('gv')).toBe('412');
  });

  test('a form in an extra font subset keeps its subset prefix', () => {
    expect(parseUrlState('?gv=1:57').selectedForm).toBe('1:57');
  });

  test('the default form writes nothing, and an invalid gv falls back to it', () => {
    expect(buildUrlParams(URL_DEFAULTS).has('gv')).toBe(false);
    expect(parseUrlState('?gv=0').selectedForm).toBeNull();
    expect(parseUrlState('?gv=a.ss01').selectedForm).toBeNull();
  });
});

describe('character set in the URL', () => {
  const latin = DEFAULT_CHARS;

  test('a preset is written by name, not character by character', () => {
    const p = buildUrlParams({ ...URL_DEFAULTS, chars: KOREAN_CHARS });
    expect(p.get('cs')).toBe('korean');
    expect(p.has('ch')).toBe(false);
    expect(parseUrlState(p).chars).toBe(KOREAN_CHARS);
  });

  test('multi-word preset names become slugs', () => {
    const p = buildUrlParams({ ...URL_DEFAULTS, chars: SIMPLIFIED_CHINESE_CHARS });
    expect(p.get('cs')).toBe('simplified-chinese');
  });

  test('characters appended to a preset are written as additions', () => {
    const p = buildUrlParams({ ...URL_DEFAULTS, chars: `${KOREAN_CHARS}€£` });
    expect(p.get('cs')).toBe('korean');
    expect(p.get('ch')).toBe('€£');
    expect(parseUrlState(p).chars).toBe(`${KOREAN_CHARS}€£`);
  });

  test('characters removed from a preset are written as removals', () => {
    const chars = latin.replace('Q', '').replace('z', '');
    const p = buildUrlParams({ ...URL_DEFAULTS, chars });
    expect(p.get('cs')).toBe('latin');
    expect(p.get('cr')).toBe('Qz');
    expect(parseUrlState(p).chars).toBe(chars);
  });

  test('a short unrelated set stays raw', () => {
    const p = buildUrlParams({ ...URL_DEFAULTS, chars: 'abc' });
    expect(p.get('ch')).toBe('abc');
    expect(p.has('cs')).toBe(false);
  });

  test('a reordered preset stays raw so the glyph order is kept', () => {
    const chars = [...latin].reverse().join('');
    const p = buildUrlParams({ ...URL_DEFAULTS, chars });
    expect(p.has('cs')).toBe(false);
    expect(parseUrlState(p).chars).toBe(chars);
  });

  test('older URLs with raw ch still load', () => {
    expect(parseUrlState('?ch=xyz').chars).toBe('xyz');
  });

  test('an unknown preset falls back to the raw ch', () => {
    expect(parseUrlState('?cs=klingon&ch=xyz').chars).toBe('xyz');
  });
});

describe('all-in-font charset in the URL', () => {
  test('"All in font" is written as cs=all without listing the characters', () => {
    const p = buildUrlParams({ ...URL_DEFAULTS, allChars: true, chars: 'every glyph the font has' });
    expect(p.get('cs')).toBe('all');
    expect(p.has('ch')).toBe(false);
  });

  test('cs=all reads back as the all-in-font flag', () => {
    expect(parseUrlState('?cs=all').allChars).toBe(true);
  });
});
