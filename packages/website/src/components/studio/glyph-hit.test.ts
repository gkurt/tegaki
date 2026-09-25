import { describe, expect, test } from 'bun:test';
import { type GlyphBox, hitGlyph, unionBox } from './glyph-hit.ts';

const box = (index: number, x: number, width: number, y = 0, height = 40): GlyphBox => ({
  index,
  char: String(index),
  offset: index,
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

describe('unionBox', () => {
  test("wraps a ligature's letters in one box that carries their text", () => {
    const u = unionBox([box(0, 0, 10), box(1, 10, 10), box(2, 20, 10), box(3, 30, 10)], 1, 3, 2);
    expect(u).toMatchObject({ index: 1, char: '12', offset: 1, x: 10, width: 20 });
  });

  test('keeps to the line of the picked letter', () => {
    const u = unionBox([box(0, 90, 10, 0), box(1, 0, 10, 60)], 0, 2, 1);
    expect(u).toMatchObject({ index: 1, x: 0, y: 60, width: 10 });
  });
});
