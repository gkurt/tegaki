---
packages:
  tegaki: patch
---

## Lay out RTL and mixed-direction lines the way the browser does

A line containing any right-to-left character was treated as right-to-left and its words reversed. A line that opens with a Latin word, such as "Hi السلام", which `dir="auto"` lays out left to right, came out with "Hi" reversed and misplaced. Each word is now placed where the browser put it, so word order follows the browser's bidi and only the glyphs within a word follow the shaper.

The clip mask also always drew left to right from x = 0, which clipped away all but the leftmost word of a right-aligned RTL line. It now draws each word at its measured position, with the paragraph's direction and letter-spacing.
