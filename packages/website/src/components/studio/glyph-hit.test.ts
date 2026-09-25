import { describe, expect, test } from 'bun:test';
import { type GlyphBox, hitGlyph } from './glyph-hit.ts';

const box = (index: number, x: number, width: number, y = 0, height = 40): GlyphBox => ({
  index,
  char: String(index),
  x,
  y,
  width,
  height,
});

describe('hitGlyph', () => {
  test('returns the box under the point', () => {
    expect(hitGlyph([box(0, 0, 20), box(1, 20, 20)], 25, 10)?.index).toBe(1);
  });

  test('a point between lines or past the text hits nothing', () => {
    const boxes = [box(0, 0, 20, 0), box(1, 0, 20, 60)];
    expect(hitGlyph(boxes, 10, 50)).toBeNull();
    expect(hitGlyph(boxes, 30, 10)).toBeNull();
  });

  test('overlapping boxes (kerning, connected scripts) resolve to the nearest centre', () => {
    const boxes = [box(0, 0, 30), box(1, 20, 30)];
    expect(hitGlyph(boxes, 22, 10)?.index).toBe(0);
    expect(hitGlyph(boxes, 28, 10)?.index).toBe(1);
  });
});
