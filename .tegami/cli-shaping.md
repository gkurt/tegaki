---
packages:
  tegaki: minor
---

## The CLI shapes text and matches the renderer's quality

`npx tegaki` now shapes text with harfbuzz, compiled to WASM and bundled into the CLI (nothing extra to install). Ligatures and contextual alternates, Arabic joining, Devanagari conjuncts and matras, and right-to-left and mixed-direction text are laid out the way the renderer lays them out. Before this, Hebrew and Arabic came out reversed and unjoined. `--no-shaping` restores the old advance-width layout.

Quality defaults now follow the studio:

- Strokes are clipped to the letter outlines, scaled ×1.2 first (`--clip <scale>`, `--no-clip`).
- Loop mode keeps variable stroke width (`--pressure 1`).

New flags:

- `--stroke-easing` / `--glyph-easing`, which take the studio's easing names.
- `--plugins` for glow, wobble, taper, stroke and text gradients, and every other `tegaki/core` plugin, by name (`--plugins "taper glow"`) or as JSON with options.
- `--letter-spacing` and `--seed`.

The CLI warns about characters the font has no strokes for, and `atma` (Bengali) is now available.

In the library:

- `textToSvg` takes `shaper`, `clipText`, `plugins` and `seed`.
- `tegaki/shaper-harfbuzz` exports `createHarfbuzzShaper(bundle, fonts?)`, which builds a shaper from font bytes you already hold (for example read from disk in Node) instead of fetching them.
