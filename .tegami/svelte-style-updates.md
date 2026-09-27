---
packages:
  tegaki: patch
---

## Svelte: follow `style` changes after mount

The Svelte `TegakiRenderer` rendered its root `style` once and ignored later changes, so a reactive `` style={`font-size: ${size}px`} `` stayed at its first value. The component now applies changes one property at a time, and leaves alone the properties the engine sets on the root itself (`font-family`, `direction`, the `--tegaki-*` time properties). An object `style` now works too, instead of rendering as `[object Object]`. The initial server render now also takes the `seed` option.
