import { describe, expect, test } from 'bun:test';
import { findEffect, globalGradientGeometry, resolveEffects } from './effects.ts';
import { computeLayoutBbox, type TextLayout } from './textLayout.ts';

describe('resolveEffects', () => {
  test('returns empty array when nothing is passed', () => {
    const resolved = resolveEffects({});
    // `pressureWidth` is in defaultEffects and auto-enabled.
    expect(resolved.map((e) => e.effect)).toEqual(['pressureWidth']);
  });

  test('known keys infer effect name', () => {
    const resolved = resolveEffects({ glow: { radius: 4 }, strokeGradient: { colors: ['#000'] } });
    expect(findEffect(resolved, 'glow')?.config).toEqual({ radius: 4 });
    expect(findEffect(resolved, 'strokeGradient')?.config).toEqual({ colors: ['#000'] });
  });

  test('custom keys require explicit effect field', () => {
    const resolved = resolveEffects({ outerGlow: { effect: 'glow', radius: 20 } });
    expect(resolved.find((e) => e.effect === 'glow')?.config).toEqual({ radius: 20 });
  });

  test('false / enabled:false entries are skipped', () => {
    const resolved = resolveEffects({ pressureWidth: false, glow: { enabled: false, radius: 5 } });
    expect(resolved).toEqual([]);
  });

  test('only built-in names are inferred from a key', () => {
    expect(resolveEffects({ pressureWidth: false, sparkle: true, toString: true } as Record<string, unknown>)).toEqual([]);
  });

  test('respects `order` for sort', () => {
    const resolved = resolveEffects({
      glow: { radius: 5, order: 2 },
      wobble: { amplitude: 1, order: 0 },
      pressureWidth: false,
    });
    expect(resolved.map((e) => e.effect)).toEqual(['wobble', 'glow']);
  });
});

describe('globalGradientGeometry', () => {
  test('angle 0 spans the box width at its vertical centre', () => {
    const g = globalGradientGeometry({ x: 0, y: 0, width: 200, height: 100 }, ['#f00', '#00f'], 0);
    expect([g.x1, g.y1, g.x2, g.y2]).toEqual([0, 50, 200, 50]);
    expect(g.stops).toEqual([
      [0, '#f00'],
      [1, '#00f'],
    ]);
  });

  test('angle 90 spans the box height at its horizontal centre', () => {
    const g = globalGradientGeometry({ x: 0, y: 0, width: 200, height: 100 }, ['#f00', '#00f'], 90);
    expect(g.x1).toBeCloseTo(100);
    expect(g.x2).toBeCloseTo(100);
    expect(g.y1).toBeCloseTo(0);
    expect(g.y2).toBeCloseTo(100);
  });

  test('three colors stop at 0, 0.5 and 1', () => {
    expect(globalGradientGeometry({ x: 0, y: 0, width: 300, height: 100 }, ['#f00', '#0f0', '#00f'], 0).stops).toEqual([
      [0, '#f00'],
      [0.5, '#0f0'],
      [1, '#00f'],
    ]);
  });

  test('a single color fills both ends', () => {
    expect(globalGradientGeometry({ x: 0, y: 0, width: 100, height: 50 }, ['#abc'], 0).stops).toEqual([
      [0, '#abc'],
      [1, '#abc'],
    ]);
  });
});

describe('computeLayoutBbox', () => {
  test('width is max (charOffset + charWidth) * fontSize; height is lines * lineHeight', () => {
    const layout: TextLayout = {
      lines: [
        [0, 1],
        [2, 3],
      ],
      charOffsets: [0, 0.5, 0, 0.8],
      charWidths: [0.5, 0.7, 0.5, 1.0],
    };
    const bbox = computeLayoutBbox(layout, 100, 120);
    expect(bbox).toEqual({ x: 0, y: 0, width: 180, height: 240 });
  });

  test('empty layout yields zero-size bbox', () => {
    expect(computeLayoutBbox({ lines: [], charOffsets: [], charWidths: [] }, 100, 120)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});
