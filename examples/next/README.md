# Tegaki × Next.js example

A minimal [Next.js](https://nextjs.org) App Router app that renders animated
handwriting with the `tegaki` React adapter.

In **Next.js 16, Turbopack is the default bundler** for both `next dev` and
`next build`, so running this example is a direct test of Tegaki under
Turbopack — no extra flags required. (Pass `--webpack` to either script to opt
back into the webpack bundler for comparison.)

## Running

From the repo root, build the renderer's `dist/` once, then start the example:

```bash
bun --filter tegaki build   # produce packages/renderer/dist
bun --filter @tegaki/example-next dev
```

Then open http://localhost:3000.

To verify a production Turbopack build:

```bash
bun --filter @tegaki/example-next build
```

## Why this example resolves `tegaki` to `dist/` (not the dev source)

The other examples in this repo use the `tegaki@dev` export condition to import
the renderer's raw TypeScript source for live editing. Turbopack can't resolve
the `import fontUrl from './x.ttf' with { type: 'url' }` import attributes that
the source font bundles use, so this example instead resolves `tegaki` to its
built `dist/` output (the standard `import` condition) — the exact artifact
published to npm. The dist bundles load fonts via the bundler-friendly
`new URL('./x.ttf', import.meta.url)` pattern, which Turbopack understands.

This means you must build `dist/` before running, and rebuild it after changing
renderer source.
