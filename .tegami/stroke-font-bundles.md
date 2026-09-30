---
packages:
  tegaki: minor
---

## Add single-line font bundles: Hershey Script and EMS Allure

`tegaki/fonts/hershey-script` and `tegaki/fonts/ems-allure` are stroke fonts: fonts made of pen strokes rather than outlines, like the ones pen plotters and engravers write with. Their strokes are the glyph data as the fonts draw them, in the fonts' own order and direction, with a round pen; the bundled `.otf` is made from those strokes, so layout, wrapping, clip-to-text and every effect and plugin work as with any bundle. Both cover Latin with its accented letters. Hershey Script carries the Hershey Fonts' acknowledgement (see `FONTS-LICENSE.md`), EMS Allure the Open Font License.
