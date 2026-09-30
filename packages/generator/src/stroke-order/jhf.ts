// Hershey fonts in James Hurt's JHF format, parsed into pen strokes.
//
// A JHF glyph is a 5-column glyph number, a 3-column vertex count, then that
// many vertices as two characters each, wrapped over lines of 72: the first
// vertex holds the left and right bearings, every other one a point as
// (code − 'R') for x and y (y-down), and " R" lifts the pen. The fonts in
// the Hershey distribution list their glyphs in ASCII order from the space.

/** One glyph: pen strokes as [x, y] pairs, y-down, in pen order. */
export type JhfStrokes = [number, number][][];

/** One JHF glyph: its strokes and its left and right bearings (the advance is `right − left`). */
export interface JhfGlyph {
  left: number;
  right: number;
  strokes: JhfStrokes;
}

/** Every glyph of a JHF file with its bearings, in file order. */
export function parseJhfGlyphs(text: string): JhfGlyph[] {
  const glyphs: JhfGlyph[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!;
    if (head.trim() === '') continue;
    const count = Number.parseInt(head.slice(5, 8), 10);
    if (!Number.isFinite(count)) throw new Error(`JHF line ${i + 1}: no vertex count`);
    let body = head.slice(8);
    while (body.length < count * 2 && i + 1 < lines.length) body += lines[++i]!;
    const strokes: JhfStrokes = [];
    let stroke: [number, number][] = [];
    // The first vertex is the bearings, not a point.
    for (let v = 1; v < count; v++) {
      const pair = body.slice(v * 2, v * 2 + 2);
      if (pair === ' R') {
        if (stroke.length > 0) strokes.push(stroke);
        stroke = [];
        continue;
      }
      stroke.push([pair.charCodeAt(0) - 82, pair.charCodeAt(1) - 82]);
    }
    if (stroke.length > 0) strokes.push(stroke);
    glyphs.push({ left: body.charCodeAt(0) - 82, right: body.charCodeAt(1) - 82, strokes });
  }
  return glyphs;
}

/** Every glyph of a JHF file, in file order. */
export function parseJhf(text: string): JhfStrokes[] {
  return parseJhfGlyphs(text).map((g) => g.strokes);
}

/** A JHF font's glyphs by the ASCII character each one draws (from the space, in order). */
export function jhfByAscii(text: string): Record<string, JhfStrokes> {
  const out: Record<string, JhfStrokes> = {};
  parseJhf(text).forEach((strokes, i) => {
    out[String.fromCharCode(32 + i)] = strokes;
  });
  return out;
}

/**
 * Join each stroke that starts on a point of the stroke before it to that
 * stroke: a plotter lifts its pen to hop back to a point it just drew
 * through (Simplex A's apex, Script m's arches), where a hand runs back
 * along the line. A stroke starting partway along a line (E's middle bar,
 * Script d's stem) is a new pen stroke.
 */
export function mergeRetraces(strokes: JhfStrokes): JhfStrokes {
  const out: JhfStrokes = [];
  for (const stroke of strokes) {
    const prev = out.at(-1);
    const start = stroke[0]!;
    const lands = prev?.some((p) => p[0] === start[0] && p[1] === start[1]);
    if (prev && lands) prev.push(...stroke);
    else out.push(stroke.map((p) => [p[0], p[1]] as [number, number]));
  }
  return out;
}
