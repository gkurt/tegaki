---
packages:
  tegaki: patch
---

## Fewer stray strokes drawn at the end of a character

Some ink runs past where the stroke-order reference ends a stroke, such as a stroke that starts just above the line it crosses. The bundled fonts used to draw that ink as a separate late stroke after the rest of the character. It is now drawn as part of its stroke. 79 Nanum Pen Script syllables changed, and many more now follow standard jamo order. Caveat's E and P and 14 Klee One characters also changed, along with a few Latin letters in Parisienne, Tangerine, Italianno, Suez One and Amiri.
