// The quality gate over the shipped bundles: reruns the generator's pipelines
// on each bundle's own font subset (the file committed next to its
// glyphData.json, so the run is offline and the font never drifts under it)
// and compares the scores with `packages/renderer/scoreboard/<dir>.json`,
// glyph by glyph. Exits non-zero on a regression. Run via
// `bun --filter tegaki scoreboard [dir…] [--update]`; `--update` rewrites the
// baselines after an intended change, for the diff to show it glyph by glyph.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { FONTS, type FontSpec } from './bundled-fonts.ts';

const RENDERER_DIR = join(import.meta.dir, '..');

/** The subset font a bundle draws with: the file its `bundle.ts` imports as `fontUrl`. */
async function bundleFontFile(dir: string): Promise<string> {
  const source = await Bun.file(join(RENDERER_DIR, 'fonts', dir, 'bundle.ts')).text();
  const match = source.match(/^import fontUrl from '\.\/([^']+)'/m);
  if (!match) throw new Error(`fonts/${dir}/bundle.ts imports no fontUrl`);
  if (/^import extraFontUrl/m.test(source)) throw new Error(`fonts/${dir} has extra font subsets, which the scoreboard doesn't read yet`);
  return join(RENDERER_DIR, 'fonts', dir, match[1]!);
}

async function runOne(spec: FontSpec, update: boolean): Promise<boolean> {
  const args = ['--filter', 'tegaki-generator', 'start', 'scoreboard', '--font-file', await bundleFontFile(spec.dir)];
  args.push('--baseline', join(RENDERER_DIR, 'scoreboard', `${spec.dir}.json`), '--name', `${spec.family} (${spec.dir})`);
  if (spec.chars !== undefined) args.push('--chars', spec.chars);
  if (spec.hanLocale) args.push('--han-locale', spec.hanLocale);
  if (update) args.push('--update');

  return new Promise((resolve, reject) => {
    const proc = spawn('bun', args, { stdio: 'inherit' });
    proc.on('exit', (code) => resolve(code === 0));
    proc.on('error', reject);
  });
}

/** Glyphs a font sweeps, weighted: a Han or Hangul glyph takes the pipelines about twice as long as a letter. */
const cost = (spec: FontSpec) => [...(spec.chars ?? 'x'.repeat(90))].reduce((sum, c) => sum + (c.codePointAt(0)! >= 0x3000 ? 2 : 1), 0);

/**
 * Split the fonts into `count` shards of about equal cost (largest first, each
 * to the lightest shard) and return shard `index` (1-based) — so CI's matrix
 * follows FONTS without listing it.
 */
function shardFonts(fonts: FontSpec[], index: number, count: number): FontSpec[] {
  const shards = Array.from({ length: count }, () => ({ cost: 0, fonts: [] as FontSpec[] }));
  for (const spec of [...fonts].sort((a, b) => cost(b) - cost(a))) {
    const lightest = shards.reduce((min, s) => (s.cost < min.cost ? s : min));
    lightest.cost += cost(spec);
    lightest.fonts.push(spec);
  }
  return fonts.filter((f) => shards[index - 1]!.fonts.includes(f));
}

// `bun scripts/scoreboard.ts caveat klee-one` scores only the listed bundles (matched by `dir`);
// `--shard 2/4` only the second of four equal-cost shards.
const argv = process.argv.slice(2);
const update = argv.includes('--update');
const shardArg = argv.includes('--shard') ? argv[argv.indexOf('--shard') + 1] : undefined;
const wanted = new Set(argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--shard'));
const unknown = [...wanted].filter((dir) => !FONTS.some((f) => f.dir === dir));
if (unknown.length > 0) throw new Error(`No bundled font ${unknown.join(', ')}; pick from ${FONTS.map((f) => f.dir).join(', ')}`);

let todo = wanted.size === 0 ? FONTS : FONTS.filter((f) => wanted.has(f.dir));
if (shardArg) {
  const [index, count] = shardArg.split('/').map(Number);
  if (!index || !count || index > count) throw new Error(`--shard takes <index>/<count>, e.g. 2/4 (got ${shardArg})`);
  todo = shardFonts(todo, index, count);
  console.log(`Shard ${index}/${count}: ${todo.map((f) => f.dir).join(', ')}`);
}

const failed: string[] = [];
for (const spec of todo) {
  if (!(await runOne(spec, update))) failed.push(spec.dir);
}
if (failed.length > 0) {
  console.error(`\nScoreboard failed for: ${failed.join(', ')}`);
  process.exit(1);
}
