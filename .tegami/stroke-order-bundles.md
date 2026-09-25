---
packages:
  tegaki: patch
---

## Better stroke order in the bundled fonts

The bundled fonts were regenerated with better stroke order where no reference data could be matched stroke for stroke.

- **Nanum Pen Script:** Hangul syllables whose jamo the font writes in one stroke now follow standard jamo order: initial, then vowel, then final.
- **Amiri:** a stroke that stands on another is written after it, so ط and ظ draw the bowl before the stem.
- **Suez One:** Hebrew letters start at their top, so ה begins at its top-left corner instead of the foot of its right leg.
- **Klee One, Caveat and the other shaped fonts:** glyphs drawn through shaping now keep the same reference stroke order as their plain copies. Before, when shaping was on, Klee One's あ and Caveat's contextual letters used the fallback top-to-bottom order.
