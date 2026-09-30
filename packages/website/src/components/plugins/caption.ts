import { createPlugin, type GroupableStroke, groupStrokes, type StrokeTime } from 'tegaki/core';

/** When one word is spoken: from `start`, to `end` if known (else until the next word), in seconds. */
export interface CaptionCue {
  start: number;
  end?: number;
  /** The word, for reading a cue list; not matched against the text. */
  text?: string;
}

/** How a word's writing fits its cue: stretched or squeezed to fill it, or at the hand's own pace, cut short only where it would run into the next word. */
export type CaptionFit = 'stretch' | 'pace';

export interface CaptionOptions {
  /** The cues, one per word of the text in order (see {@link parseCues}); empty to write at a speaking pace. */
  cues: string;
  fit: CaptionFit;
  /** Seconds the writing runs ahead of (negative) or behind the cues. */
  lead: number;
  /** Words a minute for words with no cue, and for all of them when there are none. */
  wpm: number;
}

/** A time: seconds (`1.25`), or minutes and seconds (`1:02.5`), or hours too (`0:01:02.5`). */
export function parseTime(token: string): number | null {
  const m = /^(?:(?:(\d+):)?(\d+):)?(\d+(?:\.\d*)?|\.\d+)(?:s)?$/.exec(token.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3]);
}

const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * A cue list, as text. Either JSON — an array of `{ start, end?, text? }`
 * (a transcriber's word list: `word` and `startTime` / `endTime` read too, and
 * `[start, end]` pairs) — or cues separated by new lines or `;`, each
 * `start [end] [word]` with the times in seconds or `m:ss.s` (`start-end`
 * works too). A single line of bare times is a start per word. Anything it
 * can't read is left out; cues come back in the order given.
 */
export function parseCues(input: string): CaptionCue[] {
  const text = input.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const list: unknown = JSON.parse(text);
      if (!Array.isArray(list)) return [];
      const out: CaptionCue[] = [];
      for (const item of list) {
        if (Array.isArray(item)) {
          const start = finite(item[0]);
          if (start !== undefined) out.push({ start, end: finite(item[1]) });
          continue;
        }
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const start = finite(o.start) ?? finite(o.startTime) ?? finite(o.from);
        if (start === undefined) continue;
        const end = finite(o.end) ?? finite(o.endTime) ?? finite(o.to);
        const word = typeof o.text === 'string' ? o.text : typeof o.word === 'string' ? o.word : undefined;
        out.push({ start, ...(end !== undefined ? { end } : {}), ...(word !== undefined ? { text: word } : {}) });
      }
      return out;
    } catch {
      return [];
    }
  }
  const entries = text
    .split(/[\n;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 1) {
    const tokens = entries[0]!.split(/\s+/);
    const times = tokens.map(parseTime);
    if (tokens.length > 2 && times.every((t) => t !== null)) return times.map((start) => ({ start: start! }));
  }
  const out: CaptionCue[] = [];
  for (const entry of entries) {
    const tokens = entry.split(/\s+/);
    const range = /^([^-\s]+)-([^-\s]+)$/.exec(tokens[0]!);
    let start: number | null;
    let end: number | null = null;
    let rest: string[];
    if (range) {
      start = parseTime(range[1]!);
      end = parseTime(range[2]!);
      rest = tokens.slice(1);
    } else {
      start = parseTime(tokens[0]!);
      end = tokens[1] !== undefined ? parseTime(tokens[1]) : null;
      rest = tokens.slice(end !== null ? 2 : 1);
    }
    if (start === null) continue;
    out.push({ start, ...(end !== null ? { end } : {}), ...(rest.length > 0 ? { text: rest.join(' ') } : {}) });
  }
  return out;
}

/** A word of the text as the cues see it: its strokes, when they'd draw at the hand's pace, and its characters. */
export interface CaptionWord {
  members: number[];
  start: number;
  end: number;
  /** How many characters it draws. */
  length: number;
  /** Its last character, for the pause punctuation makes. */
  last: string;
}

/** The text's words, in text order, with their strokes' span. */
export function captionWords(strokes: readonly (GroupableStroke & StrokeTime)[], fontSize: number): CaptionWord[] {
  return groupStrokes(strokes, 'words', fontSize).map((g) => {
    let start = Infinity;
    let end = -Infinity;
    for (const i of g.members) {
      start = Math.min(start, strokes[i]!.start);
      end = Math.max(end, strokes[i]!.start + strokes[i]!.duration);
    }
    const lastGlyph = g.glyphs[g.glyphs.length - 1];
    const last = strokes.find((s) => s.entryIndex === lastGlyph)?.entry.char ?? '';
    return { members: g.members, start, end, length: g.glyphs.length, last };
  });
}

/**
 * Seconds a word takes to say at `wpm` words a minute: longer words longer
 * (an average word being five characters), and a pause after a comma or a
 * full stop.
 */
export function spokenLength(word: Pick<CaptionWord, 'length' | 'last'>, wpm: number): number {
  const beat = 60 / Math.max(1, wpm);
  const pause = /[.!?。！？…]/u.test(word.last) ? 0.6 : /[,;:،、，；：]/u.test(word.last) ? 0.3 : 0;
  return beat * (0.4 + 0.6 * (word.length / 5) + pause);
}

/**
 * When each word is written: its own cue if it has one (shifted by
 * `lead`), else one speaking beat after the word before — `{ start, end }`
 * of the span the word gets, which `fit` then fills or keeps within.
 */
export function captionSlots(
  words: readonly CaptionWord[],
  cues: readonly CaptionCue[],
  o: Pick<CaptionOptions, 'lead' | 'wpm'>,
): StrokeTime[] {
  const out: StrokeTime[] = [];
  let at = cues.length > 0 ? 0 : (words[0]?.start ?? 0);
  for (let i = 0; i < words.length; i++) {
    const cue = cues[i];
    const said = spokenLength(words[i]!, o.wpm);
    if (cue) {
      const next = cues[i + 1];
      const end = cue.end ?? (next ? next.start : cue.start + said);
      const start = cue.start + o.lead;
      out.push({ start, duration: Math.max(0.01, end - cue.start) });
      // A word past the last cue follows on from it.
      at = end + o.lead;
    } else {
      out.push({ start: at, duration: said });
      at += said;
    }
  }
  return out;
}

/**
 * Each stroke's time with every word written in its slot: the word's
 * strokes keep their order and share of its writing, stretched or squeezed
 * to fill the slot (`'stretch'`), or at their own pace unless that would
 * run past it (`'pace'`).
 */
export function captionTimes(
  strokes: readonly StrokeTime[],
  words: readonly CaptionWord[],
  slots: readonly StrokeTime[],
  fit: CaptionFit,
): StrokeTime[] {
  const out = strokes.map((s) => ({ start: s.start, duration: s.duration }));
  words.forEach((w, i) => {
    const slot = slots[i]!;
    const natural = w.end - w.start;
    // A word's writing leaves a breath before the next word's.
    const room = slot.duration * 0.92;
    const k = natural <= 0 ? 1 : fit === 'stretch' ? room / natural : Math.min(1, room / natural);
    for (const m of w.members) {
      const s = strokes[m]!;
      out[m] = { start: Math.max(0, slot.start + (s.start - w.start) * k), duration: s.duration * k };
    }
  });
  return out;
}

/**
 * Handwriting in time with speech, for captions and lyrics: each word of
 * the text is written while it's said, from a list of when each word
 * starts (and ends) — a transcriber's word timings, as JSON, or typed as
 * `start end word` lines. Without cues the text is written at a speaking
 * pace, word by word, pausing at commas and full stops. A `timing` plugin.
 *
 * ```ts
 * const words = [{ start: 0.1, end: 0.5 }, { start: 0.62, end: 1.3 }]; // from your transcript
 * plugins: [captionPlugin({ cues: JSON.stringify(words) })]
 * ```
 */
export const captionPlugin = createPlugin({
  name: 'caption',
  label: 'Captions',
  description:
    'Writes each word while it’s said, from word timings (a transcript’s, or typed as “start end word” lines) — or at a speaking pace. timing.',
  params: {
    cues: {
      type: 'text',
      label: 'Cues',
      description: 'One per word: "start end" in seconds, a line or ";" each, or a JSON word list. Empty: a speaking pace.',
      default: '',
      placeholder: '0 0.4 Hello; 0.6 1.2 world',
    },
    fit: {
      type: 'select',
      label: 'Fit',
      default: 'stretch',
      options: [
        { value: 'stretch', label: 'Fill each word’s time' },
        { value: 'pace', label: 'The hand’s own pace' },
      ],
    },
    lead: {
      type: 'number',
      label: 'Lead',
      description: 'Seconds the writing runs behind the voice (negative: ahead of it).',
      default: 0,
      min: -1,
      max: 1,
      step: 0.05,
    },
    wpm: {
      type: 'number',
      label: 'Words a minute',
      description: 'For words with no cue: a handwriting pace by default, speech is 140 or so.',
      default: 70,
      min: 20,
      max: 400,
      step: 5,
    },
  },
  presets: {
    Speech: { wpm: 150 },
    Slow: { wpm: 40 },
    Rap: { wpm: 260, fit: 'stretch' },
    Beat: { cues: '0 0.5 1 1.5 2 2.5 3 3.5', fit: 'stretch' },
  },
  setup: (options) => {
    const cues = parseCues(options.cues);
    return {
      timing({ strokes, fontSize }) {
        const words = captionWords(strokes, fontSize);
        if (words.length === 0) return undefined;
        return { strokes: captionTimes(strokes, words, captionSlots(words, cues, options), options.fit) };
      },
    };
  },
});
