import { tegami } from 'tegami';
import { createCli } from 'tegami/cli';
import { simpleGenerator } from 'tegami/generators/simple';
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
// The built-in generator lists a release's entries in the order it reads
// them. List them by bump instead, breaking changes first, so a major
// release's notes open with what it breaks (the 1.0 entry, not a bug fix).
const BUMP_RANK: Record<string, number> = { major: 0, minor: 1, patch: 2 };
const simple = simpleGenerator();
const byBump: typeof simple = {
  generate(opts) {
    const rank = (entry: NonNullable<typeof opts.packageDraft.changelogs>[number]) =>
      BUMP_RANK[entry.packages.get(opts.pkg.name)?.type ?? ''] ?? 3;
    const changelogs = [...(opts.packageDraft.changelogs ?? [])].sort((a, b) => rank(a) - rank(b));
    return simple.generate.call(this, { ...opts, packageDraft: { ...opts.packageDraft, changelogs } });
  },
};

const paper = tegami({
  generator: byBump,
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
        // Put the release version in the PR title (e.g. "chore: release v0.20.0"),
        // mirroring the old Changesets workflow. Every package shares one version
        // via the group, so the published renderer's bumped version stands in for
        // the whole release.
        //
        // `create` runs AFTER the draft is applied, so the graph already holds the
        // bumped versions — read the new version directly. Do NOT call
        // `bumpVersion` here: the graph is post-apply, so it would bump a second
        // time (e.g. 0.20.0 -> 0.21.0).
        create() {
          const version = this.graph.get('npm:tegaki')?.version;
          return { title: version ? `chore: release v${version}` : 'chore: release' };
        },
      },
    }),
  ],
});

void createCli(paper).parseAsync();
