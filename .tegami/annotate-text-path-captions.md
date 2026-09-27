---
packages:
  tegaki: minor
---

## Annotate, text on a path and captions plugins

Three plugins now ship in `tegaki/core`:

- `annotatePlugin` marks the text the way a pen marks a page. It can underline it (once or twice), strike it through, cross it out, circle it, box it or highlight it. It marks the whole text, each line, each word, or one of them (`pick`). The marks are drawn once the text is written, or each as soon as what it marks is written (`when: 'each'`), and `toSVG` draws them too.
- `textPathPlugin` lays the text on an arc (a rainbow, a smile, or round a circle at `angle: ±360`) or on a wave, which can flow like a flag (`flow`). Each glyph is turned along the curve, kept upright, or bent with it, and clip-to-text follows.
- `captionPlugin` writes each word while it's said, from word timings (a transcriber's JSON, or `start end word` lines). Without them it writes at a steady pace in words a minute. `parseCues` reads a cue list the way the plugin does.

Plugin authors get two additions:

- `geometry` and `outline` hooks now receive `textBox`, the box the text's lines fill, so a plugin can lay out the whole text.
- `createPlugin` takes a `'text'` param type for free-form strings.

`groupStrokes` gathers strokes into lines or words.
