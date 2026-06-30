# Contributing to Tegaki

Thanks for your interest in contributing! This guide covers the workflow for getting changes into the repo. For a tour of the codebase — packages, pipeline stages, and design decisions — see [AGENTS.md](AGENTS.md).

## Prerequisites

- [Bun](https://bun.sh) (the repo uses Bun workspaces and Bun's test runner; `npm` / `yarn` / `pnpm` are **not** supported)
- Git
- A modern browser for testing the website / generator UI

Node is not required. All scripts, tests, and the dev server run on Bun.

## Setup

```bash
git clone https://github.com/gkurt/tegaki.git
cd tegaki
bun install
```

`bun install` also wires up Husky, which runs Biome on staged files before each commit.

## Repository layout

Three workspaces under `packages/`:

- **`packages/renderer`** ([`tegaki`](https://www.npmjs.com/package/tegaki)) — the published, framework-agnostic renderer with per-framework adapters.
- **`packages/generator`** (`tegaki-generator`) — internal CLI + library that turns a font into a Tegaki bundle.
- **`packages/website`** (`@tegaki/website`) — Astro + Starlight site hosting the docs and the interactive generator at `/tegaki/generator/`.

See [AGENTS.md](AGENTS.md) for the full architecture, pipeline stages, and file-by-file breakdown.

## Development commands

Run these from the repo root. They are wired up as Bun workspace scripts — **do not** prefix them with `bun run`.

```bash
bun start          # Run the generator CLI
bun dev            # Start the website dev server (http://localhost:4321/tegaki/)
bun run test       # Run tests across all packages
bun typecheck      # TypeScript checks
bun check          # Biome lint + format check
bun fix            # Biome auto-fix (safe + unsafe)
bun checks         # Everything: lint + format + typecheck + tests
```

Before opening a PR, make sure `bun checks` passes.

## Code style

- **Biome** handles linting and formatting (2-space indent, single quotes, 140-char line width). Configuration lives in [biome.jsonc](biome.jsonc). Husky + lint-staged run `biome check --write` on staged files, so formatting fixes are applied automatically on commit.
- **TypeScript** is strict, ESNext, `nodenext` modules. Local imports include the `.ts` extension (`import { foo } from './bar.ts'`); cross-package imports use bare specifiers (`import { TegakiRenderer } from 'tegaki'`).
- **Zod** is imported as `import * as z from 'zod/v4'` (not a default import).

## Tests

Tests use Bun's built-in test runner and live alongside the source they cover (e.g. `foo.ts` ↔ `foo.test.ts`). Run the full suite with `bun run test`, or a single file with `bun test path/to/file.test.ts`.

When fixing a bug, add a failing test first and make it pass.

## Changes that need a changelog

This repo uses [Tegami](https://tegami.fuma-nama.dev) to version and publish the `tegaki` package. If your change affects the **published renderer** (`packages/renderer`), add a changelog entry:

```bash
bun tegami
```

This opens an interactive prompt that writes a Markdown file under `.tegami/`. You can also write the file by hand — it's frontmatter listing the affected package + bump type, followed by the release notes:

```md
---
packages:
  tegaki: patch
---

## Fix Hangul baseline alignment

Composed syllables now sit on the same baseline as Latin glyphs.
```

The bump type is `patch` (bug fixes, internal refactors, docs in the published package), `minor` (new features, non-breaking API additions), or `major` (breaking API changes).

A changelog is **not** needed for changes that only touch the generator (`packages/generator`), the website (`packages/website`), CI / tooling, or examples (`examples/`) — those packages are private and never published.

### Tegami commands

Run from the repo root. Day to day, contributors only need the first one; the rest run in CI.

```bash
bun tegami                 # Add a changelog entry (interactive)
bun tegami version         # Apply pending changelogs: bump versions + write the publish lock
bun tegami publish         # Publish from the publish lock (CI)
bun tegami publish --dry-run  # Validate the publish lock without publishing
bun tegami ci              # CI entry point: version if changelogs are pending, else publish
bun tegami check-publish   # Exit 0 if a publish is pending, 1 otherwise
```

### Release flow

Releases are automated by [.github/workflows/release.yml](.github/workflows/release.yml), which runs `tegami ci` on every push to `main`:

1. Merge PRs that add `.tegami/*.md` changelog files.
2. CI versions the affected packages and opens a **Version Packages** PR.
3. Merging that PR triggers the next CI run, which publishes to npm and creates the GitHub release.

The publish lock (`.tegami/publish-lock.yaml`) lives in git, so a failed publish job can be re-run safely without duplicating a release. Don't edit the publish lock or `CHANGELOG.md` files by hand — Tegami owns them.

## Adding a new framework adapter

The renderer is structured so adapters are thin wrappers over the shared engine in `packages/renderer/src/core/`. To add one:

1. Create `packages/renderer/src/<framework>/` with your adapter.
2. Add a subpath export in `packages/renderer/package.json` (follow the pattern of `./react`, `./svelte`, etc.).
3. Add a working example under `packages/website/src/components/<framework>/` and link it from the relevant doc page.
4. Add tests covering the adapter's lifecycle (mount, update, unmount).

## Adding or updating a bundled font

Pre-generated bundles live under `packages/renderer/fonts/<family>/`. To add one:

1. Generate the bundle via the generator CLI (`bun start`) or the website's interactive generator.
2. Drop the output into `packages/renderer/fonts/<family>/`.
3. Add a subpath export in `packages/renderer/package.json`.
4. Update the README's "Built-in Fonts" list.
5. Verify the font's license permits redistribution and update [FONTS-LICENSE.md](packages/renderer/FONTS-LICENSE.md).

## Commit messages

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — internal change with no user-visible effect
- `test:` — test-only change
- `chore:` — tooling, deps, repo hygiene

Keep the subject under ~72 characters. The body (optional) explains the *why*.

## Opening a pull request

1. Fork the repo and create a feature branch from `main`.
2. Make your change + add tests + add a changelog entry with `bun tegami` (if the renderer changed).
3. Run `bun checks` locally — CI runs the same commands and will auto-apply Biome fixes, which then fail the build.
4. Push and open a PR against `main`. Describe *what* and *why*; link related issues.
5. Be ready to iterate — small, focused PRs merge fastest.

## Reporting bugs and requesting features

Open an issue on [GitHub](https://github.com/gkurt/tegaki/issues). For bugs, include:

- A minimal repro (a short URL to the [interactive generator](https://gkurt.com/tegaki/generator/) with URL state is often ideal — see the "Testing the preview app via URL state" section of [AGENTS.md](AGENTS.md))
- Expected vs. actual behavior
- Browser / OS / Bun version if relevant

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE) that covers the project.
