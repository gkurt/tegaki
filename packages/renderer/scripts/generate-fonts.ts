// Orchestrates `tegaki-generator generate` for every bundled font. The Latin
// fonts use the generator's default ASCII set; the non-Latin fonts pass an
// explicit `--chars` from `./charsets.ts` (see notes there for what's
// included). Run via `bun --filter tegaki generate-fonts`.

import { spawn } from 'node:child_process';
import { ARABIC_CHARS, DEVANAGARI_CHARS, HEBREW_CHARS, JAPANESE_CHARS } from 'tegaki-generator';

interface FontSpec {
  family: string;
  /** Output directory under `packages/renderer/fonts/`. */
  dir: string;
  /** Custom subset; omit to use the generator's default ASCII set. */
  chars?: string;
}

const FONTS: FontSpec[] = [
  { family: 'Caveat', dir: 'caveat' },
  { family: 'Italianno', dir: 'italianno' },
  { family: 'Tangerine', dir: 'tangerine' },
  { family: 'Parisienne', dir: 'parisienne' },
  { family: 'Suez One', dir: 'suez-one', chars: HEBREW_CHARS },
  { family: 'Klee One', dir: 'klee-one', chars: JAPANESE_CHARS },
  { family: 'Amiri', dir: 'amiri', chars: ARABIC_CHARS },
  { family: 'Tillana', dir: 'tillana', chars: DEVANAGARI_CHARS },
];

async function runOne(spec: FontSpec): Promise<void> {
  const args = ['--filter', 'tegaki-generator', 'start', 'generate', spec.family, '--output', `../renderer/fonts/${spec.dir}`];
  if (spec.chars !== undefined) args.push('--chars', spec.chars);

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
