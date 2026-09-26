import { describe, expect, test } from 'bun:test';
import { canvasBoxStyle } from '../core/render-elements.ts';
import type { TegakiGlyphData } from '../types.ts';
import { glyphInkBounds, inkOverflow, NO_OVERFLOW } from './inkBounds.ts';

const glyph = (s: TegakiGlyphData['s']): TegakiGlyphData => ({ w: 500, t: 1, s });

describe('glyphInkBounds', () => {
  test('bounds the centerlines and keeps the widest half-width apart', () => {
    const g = glyph([
      {
        p: [
          [10, 20, 8],
          [300, -40, 30],
        ],
        d: 0,
        a: 1,
      },
      { p: [[620, 5, 4]], d: 1, a: 0.1 },
    ]);
    expect(glyphInkBounds(g)).toEqual({ minX: 10, minY: -40, maxX: 620, maxY: 20, reach: 15 });
  });

  test('a nib stamp counts at its offset centre, with its larger diameter', () => {
    const g = glyph([{ p: [[0, 0, 2]], d: 0, a: 1, n: [[0, 100, -50, 60, 20, 0]] }]);
    expect(glyphInkBounds(g)).toEqual({ minX: 0, minY: -50, maxX: 100, maxY: 0, reach: 30 });
  });

  test('a glyph without points has no bounds', () => {
    expect(glyphInkBounds(glyph([]))).toBeNull();
  });
});

describe('inkOverflow', () => {
  test('ink inside the box needs no overflow', () => {
    expect(inkOverflow({ minX: 0, minY: 3, maxX: 100, maxY: 50 }, 100, 50)).toEqual(NO_OVERFLOW);
  });

  test('each side grows by what the ink reaches past it, rounded up to whole pixels', () => {
    expect(inkOverflow({ minX: -2.2, minY: 0, maxX: 112.1, maxY: 60 }, 100, 50)).toEqual({ left: 3, top: 0, right: 13, bottom: 10 });
  });

  test('no ink, no overflow', () => {
    expect(inkOverflow({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, 100, 50)).toEqual(NO_OVERFLOW);
  });
});

describe('canvasBoxStyle', () => {
  test('without overflow the box is the text box plus the default padding', () => {
    expect(canvasBoxStyle()).toMatchObject({ left: '-0.2em', right: '-0.2em', width: 'calc(100% + 0.4em)' });
  });

  test('overflow moves each edge out by its own amount and widens the box by both', () => {
    const style = canvasBoxStyle({ left: 0, top: 4, right: 13, bottom: 0 });
    expect(style).toMatchObject({ left: '-0.2em', right: 'calc(-0.2em - 13px)', width: 'calc(100% + 0.4em + 13px)' });
    expect(style.top).toEndWith(' - 4px)');
    expect(style.height).toEndWith(' + 4px)');
  });
});
