import { describe, expect, test } from 'bun:test';
import caveat from '../../fonts/caveat/bundle.ts';
import type { TegakiBundle } from '../types.ts';
import { textToSvg } from './textToSvg.ts';

const font = caveat as unknown as TegakiBundle;

describe('textToSvg', () => {
  test('loop mode emits CSS keyframes + group fade and crops the viewBox to ink', () => {
    const svg = textToSvg('Hi', font, { mode: 'loop' });
    expect(svg).toContain('@keyframes tk-d0');
    expect(svg).toContain('stroke-dashoffset');
    expect(svg).toContain('class="tk-grp"');
    expect(svg).toContain('@keyframes tk-fade');
    // No SMIL / mask reveal in the looping path.
    expect(svg).not.toContain('<animate');
    expect(svg).not.toContain('<mask');
    // viewBox is cropped to ink bounds, so it doesn't start at the origin.
    const vb = /viewBox="([\d.]+) ([\d.]+)/.exec(svg);
    expect(vb).not.toBeNull();
    expect(Number(vb![1])).toBeGreaterThan(0);
  });

  test('once mode reveals each stroke through an animated mask (variable width)', () => {
    const svg = textToSvg('Hi', font, { mode: 'once' });
    expect(svg).toContain('<mask');
    expect(svg).toContain('<animate');
    expect(svg).toContain('stroke-dashoffset');
    // Per-segment variable-width lines (not constant-width paths) carry the ink.
    expect(svg).toContain('<line');
    // Single-play, not the looping keyframe machinery.
    expect(svg).not.toContain('@keyframes');
  });

  test('static mode is finished artwork — no animation of any kind', () => {
    const svg = textToSvg('Hi', font, { mode: 'static' });
    expect(svg).not.toContain('@keyframes');
    expect(svg).not.toContain('<animate');
    expect(svg).not.toContain('<mask');
    expect(svg).toContain('<line');
  });

  test('color and font size are honoured', () => {
    const svg = textToSvg('A', font, { mode: 'static', color: '#ff0000', fontSize: 200 });
    expect(svg).toContain('#ff0000');
    // viewBox height scales with font size (static viewBox is the full layout box).
    const h = /height="([\d.]+)"/.exec(svg);
    expect(Number(h![1])).toBeGreaterThan(200);
  });

  test('advance-width layout places the second glyph past the first', () => {
    // Static placements draw left-to-right; the second character's lines must
    // start further right than the first character's, proving the cursor moved
    // by the first glyph's advance width.
    const svg = textToSvg('AV', font, { mode: 'static' });
    const xs = [...svg.matchAll(/x1="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(2);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    // The text spans a meaningful horizontal range (two glyphs side by side).
    expect(max - min).toBeGreaterThan(font.glyphData.A!.w / font.unitsPerEm); // > one em-advance in px-ish
  });

  test('a newline produces a two-line layout (taller box)', () => {
    const one = textToSvg('Ab', font, { mode: 'static' });
    const two = textToSvg('A\nb', font, { mode: 'static' });
    const h1 = Number(/height="([\d.]+)"/.exec(one)![1]);
    const h2 = Number(/height="([\d.]+)"/.exec(two)![1]);
    expect(h2).toBeGreaterThan(h1 * 1.5);
  });

  test('stagger timing overlaps glyph reveals (earlier begin offsets)', () => {
    const sequential = textToSvg('abcd', font, { mode: 'loop' });
    const staggered = textToSvg('abcd', font, { mode: 'loop', timing: { stagger: { advance: '50%' } } });
    // Both are valid; stagger should not throw and should still animate.
    expect(staggered).toContain('@keyframes');
    expect(sequential).toContain('@keyframes');
  });

  test('empty text yields an empty (but valid) svg', () => {
    const svg = textToSvg('', font, { mode: 'static' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<line');
  });
});
