import { StrokePath } from '../lib/strokePath.ts';
import type { PlacedStroke } from '../lib/strokeTimeline.ts';

/** Font size the test strokes are laid out at, in px (an em). */
export const EM = 100;

/**
 * Placed strokes for `text` on one line, a glyph per character, each glyph
 * half an em wide with one stroke across its lower half, one after another
 * `each` seconds apart. A space draws nothing and leaves a gap; `\n` starts
 * the next line an em and a half down. For testing plugins without a font.
 */
export function strokesOf(text: string, each = 0.2): PlacedStroke[] {
  const out: PlacedStroke[] = [];
  let x = 0;
  let line = 0;
  let t = 0;
  [...text].forEach((char, i) => {
    if (char === '\n') {
      line++;
      x = 0;
      return;
    }
    const w = char === ' ' ? 0.25 : 0.5;
    if (char !== ' ') {
      const baseline = 80 + line * 150;
      const path = new StrokePath([
        { x: x + 5, y: baseline - 40, width: 6, t: 0 },
        { x: x + 45, y: baseline, width: 6, t: 1 },
      ]);
      out.push({
        id: `${i}:0`,
        entryIndex: i,
        entry: { char, graphemeIndex: i, offset: t, duration: each, hasGlyph: true },
        glyph: { w: w * 1000, t: each, s: [] },
        strokeIndex: 0,
        stroke: { p: [], d: 0, a: each },
        start: t,
        duration: each,
        path,
        rawPath: path,
        nibs: [],
        seed: i,
        place: { x, y: baseline - 80, scale: 0.1, ascender: 800 },
      } as unknown as PlacedStroke);
      t += each;
    }
    x += w * EM;
  });
  return out;
}
