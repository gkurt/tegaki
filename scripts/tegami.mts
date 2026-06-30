import { tegami } from 'tegami';
import { createCli } from 'tegami/cli';
import { github } from 'tegami/plugins/github';

// Tegami versioning + publishing config.
// - Only `tegaki` (packages/renderer) is published. Everything else is
//   private/unpublished, so we keep it out of the version graph entirely.
// - Bun is the registry client (Tegami runs prepack via `bun run` and packs
//   with `bun pm pack`, then publishes the tarball with `npm publish`).
const paper = tegami({
  ignore: [/^@tegaki\//, 'tegaki-generator', 'hyperframes'],
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
