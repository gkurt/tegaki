---
packages:
  tegaki: patch
---

## Keep ink that reaches past a glyph inside the canvas

The canvas was the text box plus a fixed 0.2em margin, so ink reaching past a glyph's advance was cut off at the edge. One example is Caveat's d under negative letter-spacing, whose stem runs past the shortened advance. The canvas now grows each edge to fit the strokes' ink, including stroke width, clip-to-text scaling, glow and wobble. It sizes itself from every glyph in the text, drawn yet or not, so it holds still while the text animates.
