---
packages:
  tegaki: patch
---

## Idle plugin loops pause off screen

A plugin whose `steps` set `idle` (a boil, a flicker) kept redrawing at its `fps` after the renderer had scrolled out of view, for as long as the page was open. The idle loop now stops while the canvas is off screen and picks up where its clock would be when it comes back.
