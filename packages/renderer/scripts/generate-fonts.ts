// Orchestrates `tegaki-generator generate` for every bundled font. The Latin
// fonts use the generator's default ASCII set; the non-Latin fonts pass an
// explicit `--chars` from `./charsets.ts` (see notes there for what's
// included). Fonts not on Google Fonts (or not in the variant wanted) are
// downloaded from their release into the generator's font cache and read with
// `--font-file`. Run via `bun --filter tegaki generate-fonts`.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FONTS, type FontSpec } from './bundled-fonts.ts';

const GENERATOR_DIR = join(import.meta.dir, '../../generator');

/** Download a `file` font into the generator's font cache (once); returns its path relative to the generator. */
async function cachedFontFile(file: NonNullable<FontSpec['file']>): Promise<string> {
  const path = join('.cache/fonts', file.cacheName);
  const absolute = join(GENERATOR_DIR, path);
  if (!existsSync(absolute)) {
    console.log(`Downloading ${file.url}...`);
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`${file.url}: HTTP ${res.status}`);
    mkdirSync(dirname(absolute), { recursive: true });
    await Bun.write(absolute, await res.arrayBuffer());
  }
  return path;
}

async function runOne(spec: FontSpec): Promise<void> {
  const source = spec.file ? ['--font-file', await cachedFontFile(spec.file)] : [spec.family];
  const args = ['--filter', 'tegaki-generator', 'start', 'generate', ...source, '--output', `../renderer/fonts/${spec.dir}`];
  if (spec.chars !== undefined) args.push('--chars', spec.chars);
  if (spec.hanLocale) args.push('--han-locale', spec.hanLocale);

  return new Promise((resolve, reject) => {
    const proc = spawn('bun', args, { stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`generate ${spec.family} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

// Optional filter: `bun scripts/generate-fonts.ts caveat suez-one` regenerates
// only the listed bundles (matched by `dir`). Useful when adding a new font
// without re-running the slow Japanese pipeline.
const wanted = new Set(process.argv.slice(2));
const todo = wanted.size === 0 ? FONTS : FONTS.filter((f) => wanted.has(f.dir));

for (const spec of todo) {
  await runOne(spec);
}
