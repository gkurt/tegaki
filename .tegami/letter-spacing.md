---
packages:
  tegaki: minor
---

## Infer and apply CSS `letter-spacing`

The renderer now reads `letter-spacing` from the container's computed style — alongside `font-size`, `line-height`, and `color` — and applies it to the animated strokes, re-measuring when it changes. Spacing is inserted between clusters in the shaper pen-walk (matching the browser exactly for Latin, CJK, and non-cursive RTL like Hebrew) and picked up automatically from the DOM-measured offsets on the char-keyed fallback path, so line wrapping, glyph positions, and the drawn text stay in sync. The headless `textToSvg` export gained a matching `letterSpacing` option.
