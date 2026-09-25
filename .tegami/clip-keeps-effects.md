---
packages:
  tegaki: patch
---

## Keep glow and wobble when strokes are clipped to the text

Clip-to-text masked everything drawn, effects included. A glow, which spreads past the letters, was cut away. A wobble moved the strokes, but the mask's edges stayed on the letters' outlines, so it never showed. Now the clipped ink glows after the clip, and the mask's outlines wobble in step with the strokes inside them. The canvas and SVG export both work this way, so the CLI's `--effects` glow no longer needs `--no-clip`.
