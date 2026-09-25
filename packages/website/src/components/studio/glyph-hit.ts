/** A laid-out character of the preview text, in px relative to the picker's box. */
export interface GlyphBox {
  /** Grapheme index in the text. */
  index: number;
  char: string;
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
