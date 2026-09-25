---
packages:
  tegaki: patch
---

## Stop drawing digits as numerators next to Arabic text

The fraction features `frac`, `numr` and `dnom` were enabled for the whole text like any other substitution feature, which turns every digit into a numerator. Amiri registers `numr` for Arabic, so the browser drew "123" beside Arabic as small numerators while the handwriting drew plain digits. These features are now left to the shaper, which applies them around a fraction slash on its own, as it already does for `init`, `medi` and `fina`.
