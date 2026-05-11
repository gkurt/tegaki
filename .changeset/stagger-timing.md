---
"tegaki": minor
---

Add `stagger` timing mode where each glyph starts a fixed advance (seconds or `"N%"` of the previous glyph's effective duration) after the previous one, with an optional static per-glyph duration that scales strokes to fit. Exposed in the website previewer via the new `st` / `sa` / `sd` URL keys.
