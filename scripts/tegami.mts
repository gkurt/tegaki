import { tegami } from 'tegami';
import { createCli } from 'tegami/cli';
import { github } from 'tegami/plugins/github';

// Tegami versioning + publishing config.
// - Only `tegaki` (packages/renderer) is published; every other package is
//   private and never published.
// - All packages live in one `tegaki` group with `syncBump`, so they stay on a
//   single shared version: bumping the published renderer bumps everything else
//   by the same amount (replacing the old scripts/sync-versions.ts step). They
//   are aligned today, so syncBump keeps them aligned going forward.
// - Bun is the registry client (Tegami runs prepack via `bun run` and packs
//   with `bun pm pack`, then publishes the tarball with `npm publish`).
const paper = tegami({
  groups: {
    tegaki: {
      syncBump: true,
    },
  },
  packages: () => ({ group: 'tegaki' }),
  npm: {
    client: 'bun',
  },
  plugins: [
    github({
      repo: 'gkurt/tegaki',
      versionPr: {
        base: 'main',
      },
    }),
  ],
});

void createCli(paper).parseAsync();
