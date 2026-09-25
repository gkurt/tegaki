---
packages:
  tegaki: patch
---

## Shape letter-spaced text the way the browser draws it

With letter-spacing set, browsers stop applying optional ligatures, and Chrome also drops contextual alternates. The overlay and clip mask then drew base letters while the shaper still picked their alternates, so the strokes didn't fit the mask (Caveat's d and o). Letter-spaced text is now shaped with `liga`, `clig`, `dlig`, `hlig` and `calt` turned off, and the overlay turns them off explicitly so every browser agrees. `BundleShaper.shape` takes a `letterSpaced` option for this, and the timeline is recomputed when the spacing changes to or from zero.
