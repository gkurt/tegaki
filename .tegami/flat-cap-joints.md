---
packages:
  tegaki: patch
---

## Smooth strokes with flat and square caps

With a `butt` or `square` line cap, strokes drawn with pressure width, taper or a stroke gradient came out fringed: those effects draw each short piece of a stroke separately, and every piece showed its own flat ends. The cap now applies only at the start and end of each stroke, and the pieces join round in between, the same as with round caps. SVG export gets the same fix.
