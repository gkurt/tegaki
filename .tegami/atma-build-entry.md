---
packages:
  tegaki: patch
---

## Ship the `tegaki/fonts/atma` build output

The Atma (Bengali) bundle was wired into the package `exports` map but never added to the renderer's `tsdown` build config, so `dist/fonts/atma/bundle.mjs` was missing from the published package and `import 'tegaki/fonts/atma'` failed to resolve. Registered the bundle in both the build `entry` map and the `.ttf` copy step so the compiled output ships alongside the other font bundles.
