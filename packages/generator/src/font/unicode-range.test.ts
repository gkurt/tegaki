import { describe, expect, test } from 'bun:test';
import { claimedCodepoints, toUnicodeRange } from './unicode-range.ts';

describe('toUnicodeRange', () => {
  test('runs of consecutive codepoints collapse into ranges, in order', () => {
    expect(toUnicodeRange([0x629, 0x28, 0x627, 0x29, 0x628])).toBe('U+28-29, U+627-629');
  });

  test('no codepoints is an empty range', () => {
    expect(toUnicodeRange([])).toBe('');
  });
});

describe('claimedCodepoints', () => {
  test('a subset keeps only what no earlier subset covers — "(" stays with Latin even though Arabic has it', () => {
    const latin = new Set([0x28, 0x29, 0x41]);
    const arabic = new Set([0x28, 0x627, 0x644]);
    expect(claimedCodepoints([latin, arabic])).toEqual([[0x627, 0x644]]);
  });

  test('a later subset loses characters an earlier extra subset already claimed', () => {
    const latin = new Set([0x41]);
    const latinExt = new Set([0x28, 0x100]);
    const arabic = new Set([0x28, 0x627]);
    expect(claimedCodepoints([latin, latinExt, arabic])).toEqual([[0x28, 0x100], [0x627]]);
  });

  test('a subset that adds nothing claims nothing', () => {
    expect(claimedCodepoints([new Set([0x28, 0x29]), new Set([0x28])])).toEqual([[]]);
  });
});
