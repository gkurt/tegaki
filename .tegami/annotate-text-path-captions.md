---
packages:
  tegaki: minor
---

## Annotate plugin

`annotatePlugin`, now in `tegaki/core`, marks the text the way a pen marks a page. It can underline it (once or twice), strike it through, cross it out, circle it, box it or highlight it. It marks the whole text, each line, each word, or one of them (`pick`). The marks are drawn once the text is written, or each as soon as what it marks is written (`when: 'each'`), and `toSVG` draws them too.

The studio's Plugins tab also has text on a path (an arc, a circle or a flowing wave) and captions (each word written while it's said, from word timings). They're demos, not part of the package: their source, written against the public plugin API, is in the repository for you to copy.

Plugin authors get two additions:

- `geometry` and `outline` hooks now receive `textBox`, the box the text's lines fill, so a plugin can lay out the whole text.
- `createPlugin` takes a `'text'` param type for free-form strings.

`groupStrokes` gathers strokes into lines or words.
