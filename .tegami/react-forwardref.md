---
packages:
  tegaki: patch
---

## Fix the React `TegakiRenderer` ref handle on React 18

`TegakiRenderer` exposed its imperative handle via React 19's ref-as-prop, which React 18 silently drops (`ref is not a prop`), leaving the ref `null` despite the declared `react: >=18` support. It now uses `forwardRef`, so the `{ engine, element }` handle works on both React 18 and 19 (the generic component API is preserved).
