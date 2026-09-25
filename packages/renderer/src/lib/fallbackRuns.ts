import { strongDirection } from './bidi.ts';
import type { TimelineEntry } from './timeline.ts';

const WHITESPACE_RE = /\s/u;

/** Consecutive fallback entries drawn as one string, so the browser shapes them together. */
export interface FallbackRun {
  /** Timeline entry indices, in logical order — several per grapheme for a multi-code-point cluster. */
  entries: number[];
  /** The graphemes the entries cover, in logical order. */
  text: string;
  /** The direction its letters are written in; `null` for a run of only neutral characters. */
  direction: 'ltr' | 'rtl' | null;
}

/**
 * Group the timeline's fallback entries (characters the bundle has no glyph
 * for, drawn as plain text) into runs of consecutive ones on the same line.
 * Drawing a character alone loses everything its neighbours do to it: Arabic
 * letters lose their joining forms, and a word drawn letter by letter doesn't
 * line up with the same word the DOM (and the clip mask) shapes whole.
 *
 * A run ends at whitespace, at an entry with a glyph, at a line break, and
 * where the direction switches (bidi may put the two halves apart, as
 * `lineWords` does for the mask). Returns each entry's run index (`-1` for an
 * entry in none) and the runs.
 */
export function fallbackRuns(
  entries: readonly Pick<TimelineEntry, 'char' | 'graphemeIndex' | 'hasGlyph'>[],
  characters: readonly string[],
  lineOf: (graphemeIndex: number) => number,
): { runOf: Int32Array; runs: FallbackRun[] } {
  const runOf = new Int32Array(entries.length).fill(-1);
  const runs: FallbackRun[] = [];
  let run: FallbackRun | null = null;
  let runLine = -1;
  let lastGrapheme = -1;
  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei]!;
    const line = lineOf(entry.graphemeIndex);
    if (entry.hasGlyph || entry.char === '\n' || WHITESPACE_RE.test(entry.char) || line < 0) {
      run = null;
      continue;
    }
    // A cluster the font has no glyphs for gives one entry per code point, all
    // on its first grapheme: they're one character of the run.
    if (run && line === runLine && entry.graphemeIndex === lastGrapheme) {
      run.entries.push(ei);
      runOf[ei] = runs.length - 1;
      continue;
    }
    const direction = strongDirection(entry.char.codePointAt(0)!);
    const switches = direction && run?.direction && direction !== run.direction;
    if (!run || line !== runLine || entry.graphemeIndex <= lastGrapheme || switches) {
      run = { entries: [], text: '', direction: null };
      runs.push(run);
      runLine = line;
    } else {
      // The previous cluster runs up to this entry's grapheme.
      run.text += characters.slice(lastGrapheme + 1, entry.graphemeIndex).join('');
    }
    run.entries.push(ei);
    run.text += characters[entry.graphemeIndex] ?? entry.char;
    run.direction ??= direction;
    runOf[ei] = runs.length - 1;
    lastGrapheme = entry.graphemeIndex;
  }
  return { runOf, runs };
}
