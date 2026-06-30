---
packages:
  tegaki: minor
---

## Add `TegakiEngine.toSVG()` and a `canvas` accessor

The engine can now serialize its current text to a standalone SVG string via `toSVG({ animated, loop })` — either self-drawing (SMIL mask reveal, variable stroke width) or looping (CSS keyframes, constant width), with the viewBox cropped to the ink. The backing `<canvas>` is also exposed through a `canvas` getter so export tooling can read pixels without reaching through the DOM.
