import { type Box, unionBoxes } from '../lib/strokePath.ts';
import type { PlacedStroke } from '../lib/strokeTimeline.ts';

/** How {@link groupStrokes} gathers strokes: the whole text as one, a group per line, or per word. */
export type StrokeGroupBy = 'text' | 'lines' | 'words';

/** What a stroke is grouped by: its glyph (`entryIndex`, `entry`), where the glyph sits and how wide it is, and its ink. */
export type GroupableStroke = Pick<PlacedStroke, 'entryIndex' | 'entry' | 'place' | 'glyph' | 'path'>;

/** Strokes that belong together: a word, a line or the whole text. */
export interface StrokeGroup {
  /** Indices into the strokes given, in the order given. */
  members: number[];
  /** The glyphs it holds, as `entryIndex`es in text order. */
  glyphs: number[];
  /** Index of its first line (lines numbered top to bottom); a `'text'` group spanning lines starts on the first. */
  line: number;
  /** Its first line's baseline, in px. */
  baseline: number;
  /** The box its ink covers. */
  ink: Box;
  /** Where its glyphs' advances start and end, left to right, in px. */
  left: number;
  right: number;
  /** Whether it's written right to left: its first glyph is right of its last. */
  rtl: boolean;
}

/** A gap between two glyphs this wide, in ems, is a space between words — narrower only if a character is left out between them. */
const WORD_GAP = 0.35;
const SPACE_GAP = 0.08;

const baselineOf = (s: GroupableStroke) => s.place.y + s.place.ascender * s.place.scale;

/**
 * The strokes gathered into words, lines or the whole text, in text order.
 * A line is the glyphs on one baseline. Words split a line where the text
 * leaves a character undrawn between two glyphs (a space) and they sit apart
 * — a ligature spans characters but not a gap — or where they sit far
 * apart. Text without spaces (Chinese, Japanese) is a word per line.
 * Nothing about time: strokes are grouped by where they are.
 */
export function groupStrokes(strokes: readonly GroupableStroke[], by: StrokeGroupBy, fontSize: number): StrokeGroup[] {
  // The glyphs in text order, each with its strokes.
  const glyphs = new Map<number, { entryIndex: number; members: number[]; baseline: number; left: number; right: number; char: number }>();
  strokes.forEach((s, i) => {
    let g = glyphs.get(s.entryIndex);
    if (!g) {
      const left = s.place.x;
      const right = s.place.x + s.glyph.w * s.place.scale;
      g = { entryIndex: s.entryIndex, members: [], baseline: baselineOf(s), left, right, char: s.entry.graphemeIndex };
      glyphs.set(s.entryIndex, g);
    }
    g.members.push(i);
  });
  const ordered = [...glyphs.values()].sort((a, b) => a.entryIndex - b.entryIndex);

  // Lines, top to bottom.
  const lineKeys = [...new Set(ordered.map((g) => Math.round(g.baseline * 4)))].sort((a, b) => a - b);
  const lineOf = (g: { baseline: number }) => lineKeys.indexOf(Math.round(g.baseline * 4));

  const runs: (typeof ordered)[] = [];
  let run: typeof ordered = [];
  for (const g of ordered) {
    const prev = run[run.length - 1];
    let split = false;
    if (prev) {
      if (by !== 'text' && lineOf(prev) !== lineOf(g)) split = true;
      else if (by === 'words') {
        const gap = Math.max(g.left, prev.left) - Math.min(g.right, prev.right);
        const skipped = g.char > prev.char + 1;
        split = gap > WORD_GAP * fontSize || (skipped && gap > SPACE_GAP * fontSize);
      }
    }
    if (split) {
      runs.push(run);
      run = [];
    }
    run.push(g);
  }
  if (run.length > 0) runs.push(run);

  return runs.map((glyphsOfRun) => {
    const members = glyphsOfRun.flatMap((g) => g.members).sort((a, b) => a - b);
    const first = glyphsOfRun[0]!;
    const last = glyphsOfRun[glyphsOfRun.length - 1]!;
    const ink = unionBoxes(members.map((i) => strokes[i]!.path.bounds())) ?? {
      minX: first.left,
      minY: first.baseline,
      maxX: last.right,
      maxY: first.baseline,
    };
    const lineStart = Math.min(...glyphsOfRun.map(lineOf));
    const onFirstLine = glyphsOfRun.filter((g) => lineOf(g) === lineStart);
    return {
      members,
      glyphs: glyphsOfRun.map((g) => g.entryIndex),
      line: lineStart,
      baseline: onFirstLine[0]!.baseline,
      ink,
      left: Math.min(...glyphsOfRun.map((g) => g.left)),
      right: Math.max(...glyphsOfRun.map((g) => g.right)),
      rtl: glyphsOfRun.length > 1 && first.left > last.left,
    };
  });
}
