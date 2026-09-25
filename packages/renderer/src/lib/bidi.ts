/** Scripts written right to left (their letters are bidi class R / AL). */
const RTL_SCRIPT_RE =
  /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}]/u;
const LETTER_RE = /\p{L}/u;
const COMMON_SCRIPT_RE = /[\p{Script=Common}\p{Script=Inherited}]/u;
const DIGIT_RE = /\p{Nd}/u;

/**
 * The direction a character forces on its run, or `null` for one that takes
 * its neighbours' (punctuation, marks, the Arabic tatweel). Digits are LTR
 * even in an RTL script — bidi lays `١٢` out left to right — so they get a
 * run of their own instead of being reversed with the Arabic around them.
 * A simplification of the Unicode bidi classes: enough to find where a word
 * switches direction — harfbuzz shapes one direction per buffer, and the
 * browser's bidi may put the two halves far apart on the line.
 */
export function strongDirection(cp: number): 'ltr' | 'rtl' | null {
  const ch = String.fromCodePoint(cp);
  if (DIGIT_RE.test(ch)) return 'ltr';
  if (RTL_SCRIPT_RE.test(ch)) return 'rtl';
  if (LETTER_RE.test(ch) && !COMMON_SCRIPT_RE.test(ch)) return 'ltr';
  return null;
}

/**
 * The base direction `dir="auto"` gives `text`: that of its first strong
 * letter (digits don't count), LTR when it has none.
 */
export function paragraphDirection(text: string): 'ltr' | 'rtl' {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (DIGIT_RE.test(ch)) continue;
    const direction = strongDirection(cp);
    if (direction) return direction;
  }
  return 'ltr';
}

type Direction = 'ltr' | 'rtl';

/** Opening → closing bracket, for the pairs bidi resolves together (Bidi_Paired_Bracket). */
const BRACKET_PAIRS = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['\u2329', '\u232a'],
  ['\u27e6', '\u27e7'],
  ['\u27e8', '\u27e9'],
  ['\u3008', '\u3009'],
  ['\uff08', '\uff09'],
  ['\uff3b', '\uff3d'],
  ['\uff5b', '\uff5d'],
]);
const CLOSING_BRACKETS = new Map([...BRACKET_PAIRS].map(([open, close]) => [close, open]));

/**
 * Each strong character of `text` (by UTF-16 offset) with the direction it
 * resolves to: a digit counts as the letter before it — after Latin it is LTR,
 * after Hebrew it stands with the Hebrew (rules W7, N0 and N1), and before any
 * letter it takes the paragraph's `base`.
 */
function resolvedStrongs(text: string, base: Direction): { at: number; direction: Direction }[] {
  const out: { at: number; direction: Direction }[] = [];
  let letter = base;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const strong = strongDirection(cp);
    if (strong) {
      const digit = DIGIT_RE.test(String.fromCodePoint(cp));
      if (!digit) letter = strong;
      out.push({ at: i, direction: digit ? letter : strong });
    }
    i += cp > 0xffff ? 2 : 1;
  }
  return out;
}

/** Bracket pairs of `text` as [open, close] UTF-16 offsets, matched the way bidi rule BD16 does. */
function bracketPairs(text: string): [number, number][] {
  const pairs: [number, number][] = [];
  const stack: { at: number; close: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    const close = BRACKET_PAIRS.get(text[i]!);
    if (close) {
      if (stack.length === 63) break;
      stack.push({ at: i, close });
      continue;
    }
    if (!CLOSING_BRACKETS.has(text[i]!)) continue;
    for (let j = stack.length - 1; j >= 0; j--) {
      if (stack[j]!.close !== text[i]) continue;
      pairs.push([stack[j]!.at, i]);
      stack.length = j;
      break;
    }
  }
  return pairs;
}

/**
 * The direction bidi resolves a run of direction-neutral characters to —
 * `text.slice(start, end)`, say a bracket with a space either side. It decides
 * whether the run is mirrored: bidi draws `(` as `)` in RTL text.
 *
 * A bracket of a matched pair goes by what the pair encloses (rule N0): a
 * strong character of the paragraph's `base` direction makes it `base`; only
 * characters of the other direction make it that direction when the text
 * before the pair is too — so `( b )` in an RTL paragraph stays LTR after a
 * Latin word. Anything else between two strong characters of one direction
 * takes it, and the rest the paragraph's `base` (rules N1/N2).
 */
export function neutralRunDirection(text: string, start: number, end: number, base: Direction): Direction {
  const strongs = resolvedStrongs(text, base);
  const before = (at: number): Direction => {
    let direction = base;
    for (const s of strongs) {
      if (s.at >= at) break;
      direction = s.direction;
    }
    return direction;
  };

  for (const [open, close] of bracketPairs(text)) {
    if (!((open >= start && open < end) || (close >= start && close < end))) continue;
    const inside = strongs.filter((s) => s.at > open && s.at < close);
    if (inside.length === 0) continue;
    if (inside.some((s) => s.direction === base)) return base;
    const other = inside[0]!.direction;
    return before(open) === other ? other : base;
  }

  const after = strongs.find((s) => s.at >= end)?.direction ?? base;
  const prev = before(start);
  return prev === after ? prev : base;
}
