---
"tegaki": patch
---

Fix Next.js App Router / Turbopack compatibility. Two build/packaging issues prevented `tegaki` from being used in a Next.js (App Router) app:

- The bundler dropped the `'use client'` directive from the React adapter's output chunk, so importing `TegakiRenderer` into a Server Component failed with "You're importing a module that depends on `useState` into a React Server Component". The directive is now preserved in the built output.
- The font subpath exports (`tegaki/fonts/*`) resolved the `node` condition to the raw TypeScript source, which uses `import ... with { type: 'url' }` import attributes that Turbopack/webpack can't process. The `node` condition now points to the pre-built `.mjs` bundle (which loads the font via `new URL('./font.ttf', import.meta.url)`), so it works in any Node-based bundler.
