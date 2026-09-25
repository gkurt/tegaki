---
packages:
  tegaki: minor
---

## Bundled fonts traced from the outline, with better stroke order

Every bundled font was regenerated with a new generator pipeline. Strokes are now traced from the font's outline geometry instead of a rasterized skeleton, so they follow the letter shapes more closely and leave less ink unpainted. Points of a V, pointed stroke ends and serif tips use the new nib stamps. The glyph sets and the bundle format are unchanged, but the animations look different: stroke paths, stroke counts and timings all changed.

Stroke order also improved:

- **Klee One:** kana and kanji follow KanjiVG stroke order wherever the strokes match.
- **Caveat, Italianno, Tangerine and Parisienne:** Latin letters follow Hershey reference order where they match.
- **Nanum Pen Script:** Hangul syllables follow standard jamo order: initial, then vowel, then final. That includes syllables whose jamo the font writes as a single stroke.
- **Amiri:** a stroke that stands on another is written after it, so ط and ظ draw the bowl before the stem.
- **Suez One:** Hebrew letters start at their top, so ה begins at its top-left corner instead of the foot of its right leg.
- **Shaped glyphs:** contextual alternates and other glyphs drawn through shaping keep the same stroke order as their plain copies.
