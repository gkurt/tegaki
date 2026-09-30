---
packages:
  tegaki: patch
---

## Vue, Svelte, Solid and Astro components share `tegaki/core`

The Vue, Nuxt, Svelte, Solid and Astro components now run on the same core as `tegaki/core`. These adapters ship as source, and they had been compiling a second copy of the engine from it. So plugins made with `tegaki/core`'s factories failed to typecheck in the `plugins` prop (`Type 'TegakiPlugin[]' is not assignable to type 'readonly TegakiPluginSpec[]'`), and a plugin or bundle registered through `tegaki/core` wasn't found by name in these components.
