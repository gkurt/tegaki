// Orchestrates `tegaki-generator generate` for every bundled font. The Latin
// fonts use the generator's default ASCII set; the non-Latin fonts pass an
// explicit `--chars` from `./charsets.ts` (see notes there for what's
// included). Fonts not on Google Fonts (or not in the variant wanted) are
// downloaded from their release into the generator's font cache and read with
// `--font-file`. Run via `bun --filter tegaki generate-fonts`.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ARABIC_CHARS,
  BENGALI_CHARS,
  DEVANAGARI_CHARS,
  HEBREW_CHARS,
  JAPANESE_CHARS,
  KOREAN_CHARS,
  SIMPLIFIED_CHINESE_CHARS,
} from 'tegaki-generator';

interface FontSpec {
  /** Google Fonts family; for a `file` font, the family its name table carries (the bundle takes that). */
  family: string;
  /** Output directory under `packages/renderer/fonts/`. */
  dir: string;
  /** Custom subset; omit to use the generator's default ASCII set. */
  chars?: string;
  /**
   * A font file from outside Google Fonts, cached under the generator's
   * `.cache/fonts/` as `cacheName`. Only the subset ships: the fonts that
   * need this are CJK, tens of megabytes whole, so characters outside the set
   * fall to the renderer's `fallbackFont` instead.
   */
  file?: { url: string; cacheName: string };
  /** Extra generator flags. */
  args?: string[];
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
  { family: 'Atma', dir: 'atma', chars: BENGALI_CHARS },
  { family: 'Nanum Pen Script', dir: 'nanum-pen-script', chars: KOREAN_CHARS },
  // The mainland-form release: Google Fonts carries only LXGW WenKai TC, whose
  // Taiwan-standard forms differ from simplified Chinese.
  {
    family: 'LXGW WenKai',
    dir: 'lxgw-wenkai',
    chars: SIMPLIFIED_CHINESE_CHARS,
    file: {
      url: 'https://github.com/lxgw/LxgwWenKai/releases/download/v1.522/LXGWWenKai-Regular.ttf',
      cacheName: 'LXGWWenKai-Regular-v1.522.ttf',
    },
    args: ['--han-locale', 'zh'],
  },
];

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
  if (spec.args) args.push(...spec.args);

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
