---
packages:
  tegaki: patch
---

## Fix doubled ghost text when exporting through DOM rasterizers

The DOM text overlay (kept for selection, accessibility and layout measurement) was hidden only with `-webkit-text-fill-color: transparent`. DOM-to-image/video rasterizers that don't implement that non-standard property — Editframe, html-to-image, Satori, headless-screenshot pipelines — repainted the overlay text in the inherited color and a default font, doubled on top of the canvas handwriting. It is now hidden with the standard `color: transparent`, which those exporters honor. (In `editable` mode the caret follows `currentColor`, so it is no longer independently visible — an accepted trade-off for correct exports.)
