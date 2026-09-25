---
packages:
  tegaki: minor
---

## Draw a word's headline after its letters

Devanagari and Bengali are written letter by letter, then the headline (shirorekha) is drawn across the whole word. The timeline now supports more than one deferred stroke tier: each negative `priority` (compact `r`) is its own phase after the word's body strokes, highest first. Priorities between -1 and 0 are connecting tiers, drawn glyph to glyph with no gap so the pieces read as one line. The bundled Tillana and Atma fonts tag headlines with `-0.5`, so a word draws its letters, then its headline, then marks such as the anusvara (`-1`). Marks keep `-1`, so existing bundles animate as before, and `deferDots: false` still turns all deferral off.
