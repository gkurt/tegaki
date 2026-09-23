---
packages:
  tegaki: patch
---

## Keep rendering when a bundle's font file fails to load

When a bundle's `.ttf` failed to load, the engine waited on the rejected promise forever. The canvas stayed blank, with only an unhandled `NetworkError` in the console. The usual trigger is Vite's dev pre-bundler (Vite ≤ 7): it moves the bundle into `node_modules/.vite/deps/`, which breaks the font's relative URL. The engine now logs one warning per font that names the fix (`optimizeDeps: { exclude: ['tegaki'] }`) and links to the bundler guide. It then keeps rendering the handwriting, using the fallback font's layout. A shaper whose promise rejects now falls back to unshaped rendering, so it can no longer stall playback.
