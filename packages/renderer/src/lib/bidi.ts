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
export const BRACKET_PAIRS: ReadonlyMap<string, string> = new Map([
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
/** Closing → opening bracket. */
export const CLOSING_BRACKETS: ReadonlyMap<string, string> = new Map([...BRACKET_PAIRS].map(([open, close]) => [close, open]));

/** Separators a number keeps inside it when they stand between two digits (`1:2`, `3.5`) — bidi rule W4. */
const SEPARATOR_RE = /^[,.:/+\-\u00a0\u060c\u066b\u066c]$/u;
/** Signs a number takes in when next to its digits (`50%`, `$5`) — rule W5. */
const TERMINATOR_RE = /^[#$%\u00b0\u2030\u2031\u066a\p{Sc}]$/u;
/** Marks and format characters (ZWJ) go with the character before them — rule W1. */
const ATTACHED_RE = /^[\p{M}\p{Cf}]$/u;

/** Bracket pairs of `text` as [open, close] UTF-16 offsets, matched the way bidi rule BD16 does, in order of opening. */
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
  return pairs.sort((a, b) => a[0] - b[0]);
}

/**
 * The direction each character of `text` is laid out in, by UTF-16 offset,
 * in a paragraph of direction `base` — a single-level take on the Unicode
 * bidi algorithm, enough to split text into the runs the browser shapes:
 *
 * - letters have their own direction, and a number is LTR — with the
 *   separators between its digits and the signs next to them (`1:2`, `50%`);
 * - a bracket pair goes by what it encloses (rule N0): the paragraph's
 *   direction if any of it is, else the other when the text before the pair
 *   is too — so `( b )` stays LTR after a Latin word in an RTL paragraph —
 *   and a resolved bracket counts as strong for what follows it;
 * - other neutral characters between two strong ones of one direction take
 *   it, and the paragraph's otherwise (N1/N2). A digit counts as the letter
 *   before it here: after Hebrew it keeps a bracket RTL.
 * - marks and joiners go with the character before them.
 */
export function resolvedDirections(text: string, base: Direction): Direction[] {
  const n = text.length;
  const own: (Direction | 'digit' | null)[] = new Array(n).fill(null);
  const attached: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const strong = strongDirection(cp);
    const type = strong ? (DIGIT_RE.test(ch) ? 'digit' : strong) : null;
    const isAttached = !strong && i > 0 && ATTACHED_RE.test(ch);
    for (let k = i; k < i + ch.length; k++) {
      own[k] = isAttached ? own[i - 1]! : type;
      attached[k] = isAttached;
    }
    i += ch.length;
  }
  for (let i = 1; i < n - 1; i++) {
    if (own[i] === null && own[i - 1] === 'digit' && own[i + 1] === 'digit' && SEPARATOR_RE.test(text[i]!)) own[i] = 'digit';
  }
  for (let i = 0; i < n; i++) {
    if (own[i] !== null || !TERMINATOR_RE.test(text[i]!)) continue;
    let end = i;
    while (end < n && own[end] === null && TERMINATOR_RE.test(text[end]!)) end++;
    if (own[i - 1] === 'digit' || own[end] === 'digit') own.fill('digit', i, end);
    i = end - 1;
  }

  // The direction each character counts as for resolving neutrals.
  const type: (Direction | null)[] = new Array(n).fill(null);
  let letter = base;
  for (let i = 0; i < n; i++) {
    const t = own[i];
    if (t === 'digit') type[i] = letter;
    else if (t) type[i] = letter = t;
  }
  const before = (at: number): Direction => {
    for (let k = at - 1; k >= 0; k--) if (type[k]) return type[k]!;
    return base;
  };
  for (const [open, close] of bracketPairs(text)) {
    let embedding = false;
    let opposite = false;
    for (let k = open + 1; k < close; k++) {
      if (type[k] === base) embedding = true;
      else if (type[k]) opposite = true;
    }
    if (!embedding && !opposite) continue;
    type[open] = type[close] = embedding ? base : before(open);
  }
  for (let i = 0; i < n; ) {
    if (type[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end < n && !type[end]) end++;
    const prev = before(i);
    const next = end < n ? type[end]! : base;
    type.fill(prev === next ? prev : base, i, end);
    i = end;
  }

  const out: Direction[] = own.map((t, i) => (t === 'digit' ? 'ltr' : (t ?? type[i]!)));
  for (let i = 1; i < n; i++) if (attached[i]) out[i] = out[i - 1]!;
  return out;
}

/**
 * The direction bidi resolves a run of direction-neutral characters to —
 * `text.slice(start, end)`, say a bracket with a space either side. It decides
 * whether the run is mirrored: bidi draws `(` as `)` in RTL text. See
 * {@link resolvedDirections}; this reads its first character.
 */
export function neutralRunDirection(text: string, start: number, _end: number, base: Direction): Direction {
  return resolvedDirections(text, base)[start] ?? base;
}
