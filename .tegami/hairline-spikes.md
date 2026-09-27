---
packages:
  tegaki: patch
---

## Caveat's F draws in three strokes

Caveat's capital F was drawn as 85 strokes, 81 of them tiny fragments piled at the tip of its top bar. The outline has a zero-width spike there, where it runs out and straight back over itself, and the stroke extraction couldn't handle the two overlapping edges. The generator now folds such spikes out of an outline before extracting strokes. F draws as stem, top bar and middle bar, in reference stroke order. Atma's স is fixed the same way (3 strokes instead of 13), and the Atma bundle picks up the apostrophe its character set gained after it was last generated. Bundles you generate yourself get the fix when you regenerate them.
