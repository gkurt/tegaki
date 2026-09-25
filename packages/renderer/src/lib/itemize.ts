import { BRACKET_PAIRS, CLOSING_BRACKETS } from './bidi.ts';

/** ISO 15924 tags harfbuzz takes for `setScript`, tested against each character's Script property. */
const SCRIPTS = [
  'Latn',
  'Grek',
  'Cyrl',
  'Armn',
  'Hebr',
  'Arab',
  'Syrc',
  'Thaa',
  'Nkoo',
  'Deva',
  'Beng',
  'Guru',
  'Gujr',
  'Orya',
  'Taml',
  'Telu',
  'Knda',
  'Mlym',
  'Sinh',
  'Thai',
  'Laoo',
  'Tibt',
  'Mymr',
  'Geor',
  'Hang',
  'Ethi',
  'Khmr',
  'Mong',
  'Hira',
  'Kana',
  'Bopo',
  'Hani',
].map((tag) => ({ tag, re: new RegExp(`\\p{Script=${tag}}`, 'u') }));
const COMMON_RE = /[\p{Script=Common}\p{Script=Inherited}]/u;
/** Japanese and Chinese text mixes these in one run, as browsers shape it. */
const HAN_GROUP = new Set(['Hira', 'Kana', 'Bopo', 'Hani']);

const OPENING = BRACKET_PAIRS;
const CLOSING = CLOSING_BRACKETS;

/** A character's own script tag, `'Zyyy'` for Common / Inherited, `'Zzzz'` for one not in {@link SCRIPTS}. */
function scriptOf(ch: string): string {
  if (COMMON_RE.test(ch)) return 'Zyyy';
  for (const { tag, re } of SCRIPTS) if (re.test(ch)) return tag;
  return 'Zzzz';
}

/**
 * The script each character of `text` is shaped in, by UTF-16 offset — as
 * browsers itemize a paragraph: punctuation, marks and other Common
 * characters take the script before them (the first one after, at the
 * start), and a closing bracket takes its opening bracket's. `null` where
 * the text has no script of its own at all, or the script isn't one
 * harfbuzz is told explicitly.
 *
 * It decides which glyph a font draws for shared punctuation: Amiri's
 * default `[` is its wide Arabic bracket, with a narrow Latin one swapped in
 * only for Latin text. Shaped alone, `[` in `Hello [مرحبا]` would take the
 * Arabic one while the browser draws the Latin.
 */
export function resolvedScripts(text: string, before: string | null = null): (string | null)[] {
  const out: (string | null)[] = new Array(text.length).fill(null);
  const openers: { close: string; at: number }[] = [];
  let current = before;
  let started = before !== null;
  const pending: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const own = scriptOf(ch);
    let script = current;
    if (own !== 'Zyyy') {
      script = current = own === 'Zzzz' ? null : own;
      for (const at of pending) out[at] = script;
      pending.length = 0;
      started = true;
    } else if (CLOSING.has(ch)) {
      const j = openers.findLastIndex((o) => o.close === ch);
      if (j >= 0) {
        script = out[openers[j]!.at] ?? current;
        openers.length = j;
      }
    } else if (OPENING.has(ch)) openers.push({ close: OPENING.get(ch)!, at: i });
    // Leading Common characters wait for the first script after them.
    for (let k = i; k < i + ch.length; k++) {
      if (!started) pending.push(k);
      out[k] = script;
    }
    i += ch.length;
  }
  return out;
}

/** The script of the last character of `text` that has one of its own — what text after it continues in. */
export function trailingScript(text: string): string | null {
  for (let i = text.length - 1; i >= 0; i--) {
    const cp = text.codePointAt(i)!;
    if (cp >= 0xdc00 && cp <= 0xdfff && i > 0) continue;
    const own = scriptOf(String.fromCodePoint(cp));
    if (own !== 'Zyyy') return own === 'Zzzz' ? null : own;
  }
  return null;
}

/** Whether characters of these two scripts go in separate shaping runs. */
export function scriptsDiffer(a: string | null, b: string | null): boolean {
  if (a === b) return false;
  return !(a !== null && b !== null && HAN_GROUP.has(a) && HAN_GROUP.has(b));
}
