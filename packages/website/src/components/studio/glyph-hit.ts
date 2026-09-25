/** A laid-out character of the preview text, in px relative to the picker's box. */
export interface GlyphBox {
  /** Grapheme index in the text. */
  index: number;
  char: string;
  /** Where the grapheme sits in the text layer's text node, in UTF-16 code units. */
  offset: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const WHITESPACE = /^\s+$/u;

/**
 * Measure every visible character of the renderer's text layer (the laid-out
 * DOM text the canvas is positioned from) with DOM Ranges. Whitespace and
 * zero-width characters are left out — there's nothing to inspect.
 */
export function measureGlyphBoxes(textLayer: HTMLElement, origin: DOMRect): GlyphBox[] {
  const node = textLayer.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [];
  const text = node.textContent ?? '';
  const range = document.createRange();
  const boxes: GlyphBox[] = [];
  let index = 0;
  for (const { segment, index: offset } of segmenter.segment(text)) {
    if (!WHITESPACE.test(segment)) {
      range.setStart(node, offset);
      range.setEnd(node, offset + segment.length);
      // A grapheme split across a line break reports one rect per line; the first is where it starts.
      const rect = [...range.getClientRects()].find((r) => r.width > 0);
      if (rect) {
        boxes.push({
          index,
          char: segment,
          offset,
          x: rect.left - origin.left,
          y: rect.top - origin.top,
          width: rect.width,
          height: rect.height,
        });
      }
    }
    index++;
  }
  return boxes;
}

/** The box under a point, preferring the closest centre where boxes overlap (kerned or connected scripts). */
export function hitGlyph(boxes: readonly GlyphBox[], x: number, y: number): GlyphBox | null {
  let best: GlyphBox | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const b of boxes) {
    if (x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height) continue;
    const dist = Math.abs(x - (b.x + b.width / 2));
    if (dist < bestDist) {
      best = b;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * One box around graphemes `start`…`end` (exclusive) — a ligature's letters —
 * on the line of grapheme `at`. It takes the first grapheme's index, and the
 * characters and text offset of the whole run.
 */
export function unionBox(boxes: readonly GlyphBox[], start: number, end: number, at: number): GlyphBox | undefined {
  const anchor = boxes.find((b) => b.index === at);
  const run = boxes.filter((b) => b.index >= start && b.index < end && (!anchor || Math.abs(b.y - anchor.y) < anchor.height / 2));
  if (run.length === 0) return anchor;
  const first = run[0]!;
  const left = Math.min(...run.map((b) => b.x));
  const top = Math.min(...run.map((b) => b.y));
  return {
    index: first.index,
    char: run.map((b) => b.char).join(''),
    offset: first.offset,
    x: left,
    y: top,
    width: Math.max(...run.map((b) => b.x + b.width)) - left,
    height: Math.max(...run.map((b) => b.y + b.height)) - top,
  };
}
