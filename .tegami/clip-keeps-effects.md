---
packages:
  tegaki: patch
---

## Keep glow and reshaped strokes when strokes are clipped to the text

Clip-to-text masked everything drawn, effects included. A glow, which spreads past the letters, was cut away. A plugin that moved the strokes, such as a wobble, never showed, because the mask's edges stayed on the letters' outlines. Now the clipped ink glows after the clip, and a plugin's `outline` hook moves the mask's outlines in step with the strokes inside them (`variationPlugin` does). The canvas and SVG export both work this way, so a glow in the CLI's `--plugins` no longer needs `--no-clip`.
