import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = dirname(fileURLToPath(import.meta.url));

// In Next.js 16, Turbopack is the default bundler for both `next dev` and
// `next build` — running this example exercises Tegaki under Turbopack with no
// extra flags. (Pass `--webpack` to either script to opt back into webpack.)
//
// Note: unlike the other examples in this repo, this one does NOT use the
// `tegaki@dev` source condition. Turbopack can't resolve the `import ... with
// { type: 'url' }` attributes used by the raw TS font bundles, so we resolve
// `tegaki` to its built `dist/` output (the standard `import` condition) — the
// same artifact published to npm. Run `bun --filter tegaki build` first.
const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack doesn't infer it from an unrelated
  // parent lockfile (this example lives inside the Tegaki monorepo).
  turbopack: { root: resolve(here, '..', '..') },
};

export default nextConfig;
