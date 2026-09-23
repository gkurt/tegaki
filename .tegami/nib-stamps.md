---
packages:
  tegaki: minor
---

## Render elliptic nib stamps

Bundles can now describe ink that a round pen can't reach, such as the point of a V, a pointed stroke end or a serif tip. Each such spot is an elliptic stamp the pen leaves as it passes a point. A stroke lists its stamps in an optional `n` field, one `[pointIndex, dx, dy, major, minor, angle]` entry each (the `Nib` type). The canvas renderer and SVG export draw each stamp when the pen reaches its point. Stamps follow the stroke's wobble, taper, stroke scale and color. Strokes without stamps render exactly as before, and older renderers ignore the field, so existing bundles stay compatible in both directions.
