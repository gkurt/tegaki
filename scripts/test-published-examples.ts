/**
 * Post-release smoke check: install the *published* `tegaki` tarball from npm
 * into copies of each example and verify they typecheck, build, and render.
 *
 * Unlike the in-repo `examples` CI job (which tests the workspace-linked
 * package), this exercises the actual npm artifact — catching packaging
 * regressions the workspace hides: missing `dist/` files, a wrong `files`
 * allowlist, a broken `exports` map, or a subpath that resolves to raw source.
 *
 * The examples are copied OUT of the workspace first. A workspace member whose
 * `tegaki` range satisfies the workspace version is linked to the workspace
 * package regardless of the range written, so testing the published tarball
 * requires escaping the workspace entirely. We also strip the `tegaki@dev`
 * resolve conditions so resolution falls through to the published entry points
 * (`import` -> dist/*.mjs, `types` -> dist/*.d.mts) — exactly what a real
 * consumer gets.
 *
 * Usage:
 *   bun scripts/test-published-examples.ts [version] [--staging <dir>] [--no-smoke]
 *
 *   version    npm version to test, or a dist-tag. Defaults to `latest`.
 *   --staging  where to stage the copies. Defaults to a fresh temp dir.
 *   --no-smoke skip the browser/render smoke tests (typecheck + build only).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

// Examples that consume the `tegaki` npm package. `build` examples produce a
// servable/typecheckable artifact; remotion is rendered via the still check.
// Keep in step with EXAMPLES in e2e/examples/playwright.config.ts.
const WEB_EXAMPLES = ['vite', 'next', 'nuxt', 'svelte', 'vue', 'solid', 'astro', 'vanilla'] as const;
const ALL_EXAMPLES = [...WEB_EXAMPLES, 'remotion'] as const;

const args = process.argv.slice(2);
const smoke = !args.includes('--no-smoke');
const stagingArgIdx = args.indexOf('--staging');
const stagingArg = stagingArgIdx >= 0 ? args[stagingArgIdx + 1] : undefined;
const stagingValueIdx = stagingArgIdx >= 0 ? stagingArgIdx + 1 : -1;
const versionArg = args.find((a, i) => !a.startsWith('--') && i !== stagingValueIdx) ?? 'latest';

function run(cmd: string, cmdArgs: string[], cwd: string, env?: Record<string, string>) {
  execFileSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
}

function npmView(spec: string): string {
  return execFileSync('npm', ['view', spec, 'version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Whether the registry's abbreviated packument — the document `bun install` reads —
 * lists the version. `npm view` reads the full packument, which the registry's CDN
 * caches separately (max-age 300): 1.0.0 showed up in `npm view` while installs
 * still got a document without it.
 */
async function installable(version: string): Promise<boolean> {
  const res = await fetch('https://registry.npmjs.org/tegaki', {
    headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*' },
  });
  if (!res.ok) return false;
  const doc = (await res.json()) as { versions?: Record<string, unknown> };
  return Boolean(doc.versions?.[version]);
}

/** Resolve a dist-tag to a concrete version, then wait for the registry to serve it. */
async function resolveVersion(spec: string): Promise<string> {
  const version = /^\d/.test(spec) ? spec : npmView(`tegaki@${spec}`);
  if (!version) throw new Error(`Could not resolve tegaki@${spec} on npm`);

  // A fresh publish can take minutes to become visible (0.22.2 took ~2m, 1.0.0 ~6m).
  const deadline = Date.now() + 600_000;
  for (;;) {
    if (await installable(version).catch(() => false)) return version;
    if (Date.now() > deadline) throw new Error(`tegaki@${version} never became visible on npm`);
    console.log(`Waiting for tegaki@${version} to propagate on npm...`);
    await Bun.sleep(5000);
  }
}

/**
 * `bun install`, retried a few times: the CDN edge an install hits can still serve
 * a packument without the new version after the poll above saw it.
 */
async function install(dest: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      run('bun', ['install'], dest);
      return;
    } catch (err) {
      if (attempt === 4) throw err;
      console.log(`bun install failed (attempt ${attempt}); retrying in 30s...`);
      await Bun.sleep(30_000);
    }
  }
}

/**
 * Remove the `tegaki@dev` member from any (custom / external) conditions array
 * — tsconfig `customConditions`, Vite's `resolve.conditions` and Astro's
 * `vite.ssr.resolve.{conditions,externalConditions}` — and drop the arrays it
 * leaves empty.
 */
function stripDevCondition(text: string): string {
  return text
    .replace(/(['"])tegaki@dev\1\s*,\s*/g, '')
    .replace(/\s*,\s*(['"])tegaki@dev\1/g, '')
    .replace(/(['"])tegaki@dev\1/g, '')
    .replace(/^\s*["']?customConditions["']?\s*:\s*\[\s*\],?\s*\n/gm, '')
    .replace(/^\s*(?:external)?[cC]onditions\s*:\s*\[\s*\],?\s*\n/gm, '');
}

// The configs that may carry the `tegaki@dev` condition, across the examples' bundlers.
const DEV_CONDITION_CONFIGS = ['tsconfig.json', 'vite.config.ts', 'astro.config.ts'];

const version = await resolveVersion(versionArg);
console.log(`\n=== Testing published tegaki@${version} against examples ===\n`);

const staging = stagingArg ? resolve(stagingArg) : mkdtempSync(join(tmpdir(), 'tegaki-published-'));
if (staging.startsWith(root)) throw new Error(`Staging dir must be outside the workspace, got: ${staging}`);
console.log(`Staging in ${staging}\n`);

const SKIP_COPY = new Set(['node_modules', 'dist', '.next', '.nuxt', '.output', '.astro', 'out']);

for (const name of ALL_EXAMPLES) {
  const dest = join(staging, name);
  cpSync(join(root, 'examples', name), dest, {
    recursive: true,
    filter: (src) => !SKIP_COPY.has(src.split('/').pop() ?? ''),
  });

  // Pin the published version and drop the source resolve conditions.
  const pkgPath = join(dest, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  pkg.dependencies.tegaki = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  for (const cfg of DEV_CONDITION_CONFIGS) {
    const p = join(dest, cfg);
    try {
      writeFileSync(p, stripDevCondition(readFileSync(p, 'utf-8')));
    } catch {
      /* not every example has every config */
    }
  }
}

// Install (and build) each copy. Each runs against the real registry.
for (const name of ALL_EXAMPLES) {
  const dest = join(staging, name);
  console.log(`\n--- ${name}: install ---`);
  await install(dest);

  // Sanity: the installed package must be the npm tarball, not a workspace link.
  const dep = join(dest, 'node_modules', 'tegaki');
  const depPkg = JSON.parse(readFileSync(join(dep, 'package.json'), 'utf-8'));
  if (depPkg.version !== version) throw new Error(`${name}: resolved tegaki@${depPkg.version}, expected ${version}`);
  try {
    statSync(join(dep, 'dist'));
  } catch {
    throw new Error(`${name}: installed tegaki has no dist/ — not the published tarball`);
  }
  if (lstatSync(dep).isSymbolicLink()) throw new Error(`${name}: tegaki is a symlink (workspace), not the npm tarball`);

  console.log(`--- ${name}: typecheck ---`);
  run('bun', ['run', 'typecheck'], dest);

  // remotion's `build` renders a full mp4; its meaningful check is the still.
  if (WEB_EXAMPLES.includes(name as (typeof WEB_EXAMPLES)[number])) {
    console.log(`--- ${name}: build ---`);
    run('bun', ['run', 'build'], dest);
  }
}

if (smoke) {
  console.log('\n=== Smoke tests against published copies ===\n');
  const env = { TEGAKI_EXAMPLES_DIR: staging, CI: '1' };
  run('bun', ['--filter', '@tegaki/example-e2e', 'test'], root, env);
  run('bun', ['--filter', '@tegaki/example-e2e', 'remotion-still'], root, env);
  // Web-component over the esm.sh CDN — exercises the published /wc + /fonts
  // subpaths, not the npm install. Polls esm.sh for its build before loading.
  run('bun', ['--filter', '@tegaki/example-e2e', 'wc-cdn'], root, { ...env, TEGAKI_VERSION: version });
}

if (!stagingArg) rmSync(staging, { recursive: true, force: true });
console.log(`\n✓ Published tegaki@${version} works on all examples\n`);
