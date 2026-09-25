---
packages:
  tegaki: minor
---

## SVG export draws what the canvas draws

`TegakiEngine.toSVG()` now reproduces the canvas render instead of an approximation of it:

- **Timing** — the playback speed (new `speed` option, defaulting to the engine's uncontrolled `speed`), stroke and glyph easing, deferred dots and stagger's fixed durations. Each stroke's reveal follows its eased curve as cubic Bézier segments (SMIL `keySplines` / per-keyframe CSS timing functions); the default ease-out quad is one exact segment.
- **Effects** — taper, wobble, glow (as drop-shadow filters), `strokeGradient` and `globalGradient`, alongside pressure width and nib stamps. Loop mode now keeps variable width too.
- **Clip-to-text** — strokes are clipped to the text's glyph outlines, taken from the harfbuzz shaper (the new optional `BundleShaper.glyphPath`), so the font need not be embedded.
- **Fallback characters** — drawn as `<text>` in the fallback font, appearing when the canvas draws them.
- **Square and butt caps** draw dots square, as the canvas does.

New options: `loopHold` (seconds the finished text holds before a loop repeats) and `crop` — the viewBox now crops to the ink in every mode, not only in loop mode; pass `crop: false` for the full canvas box. The new async `exportSVG()` embeds the fonts an SVG's text still needs (clip-to-text without a shaper, fallback characters) as data URIs.

`textToSvg` and the CLI take `speed`, `loopHold` and `crop` (`--speed`, `--loop-hold`), follow the timing config's easings, and honour an explicit `pressure` in loop mode.
