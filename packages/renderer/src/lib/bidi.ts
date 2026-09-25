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
