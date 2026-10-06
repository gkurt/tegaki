---
packages:
  tegaki: patch
---

## Nib stamps keep their size below full pressure

With `pressure` below 1, including the default of loop-mode SVG export and the `tegaki` CLI, a nib stamp on a point where the stroke thins to nothing could swell into a large blot. Parisienne's comma drew as a black ellipse larger than the letters beside it. Such a stamp is now sized against the nearest point of the stroke at least as wide as it, so it stays where it was and scales with the ink as other stamps do. At full pressure every stamp draws as before.
