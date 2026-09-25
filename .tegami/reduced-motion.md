---
packages:
  tegaki: minor
---

## Handwriting animates even with reduced motion turned on

The renderer now animates by default when the visitor has turned on `prefers-reduced-motion`. Ink appearing in place isn't the kind of motion (parallax, zooming, sliding) that the setting guards against.

The new `reducedMotion` option chooses the behaviour. `'never'` (the default) always animates, `'user'` follows the OS setting, and `'always'` never animates. When the animation is skipped, the text is drawn finished and `onComplete` still fires. Every adapter accepts the option, and on `<tegaki-renderer>` it is the `reduced-motion` attribute. It only affects uncontrolled time.

This also fixes a bug: a page opened with reduced motion already on used to draw nothing, because the renderer stopped the animation at its first frame instead of showing the finished text.
