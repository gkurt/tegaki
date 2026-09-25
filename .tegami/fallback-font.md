---
packages:
  tegaki: minor
---

## Choose the font for characters a bundle doesn't cover

The new `fallbackFont` option takes a CSS font-family list, such as `'"Noto Serif SC", serif'`. It sets the font for characters the bundle has no stroke data for, which appear without a handwriting animation. Every adapter accepts it, and on `<tegaki-renderer>` it is the `fallback-font` attribute.

Bundles that ship their full font now actually use it for those characters. Before, only the Astro adapter with `loadFont` registered the full font, so other adapters drew those characters in the browser's default font. The full font now downloads only once the text contains a character outside the bundle's set, so text inside the set never fetches it.
