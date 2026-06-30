#!/usr/bin/env node
/**
 * `tegaki` — turn text into an animated handwriting SVG from the command line.
 *
 *   npx tegaki "Tegaki is awesome"          # → tegaki-is-awesome.svg (looping)
 *   npx tegaki "Hello" -f tangerine -o hi.svg
 *
 * SVG is the only format emitted: it's the one the renderer can produce with
 * zero native dependencies (no canvas, no headless browser). Raster/video
 * export (PNG/GIF/WebM) lives in the browser studio at gkurt.com/tegaki/generator.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { type TextToSvgMode, textToSvg } from './lib/textToSvg.ts';
import type { TegakiBundle } from './types.ts';

/** Bundled fonts the CLI can load, keyed by `--font` name. */
const FONTS: Record<string, string> = {
  caveat: 'Caveat (Latin)',
  italianno: 'Italianno (Latin)',
  tangerine: 'Tangerine (Latin)',
  parisienne: 'Parisienne (Latin)',
  'suez-one': 'Suez One (Hebrew + Latin)',
  amiri: 'Amiri (Arabic + Latin)',
  tillana: 'Tillana (Devanagari + Latin)',
  'klee-one': 'Klee One (Japanese + Latin)',
  'nanum-pen-script': 'Nanum Pen Script (Korean + Latin)',
};

/** Fonts whose scripts need shaping the headless CLI does not apply (RTL / complex GPOS). */
const NEEDS_SHAPING = new Set(['suez-one', 'amiri', 'tillana']);

const MODES: TextToSvgMode[] = ['loop', 'once', 'static'];

interface CliOptions {
  text: string;
  output: string | null; // null → derive from text; '-' → stdout
  font: string;
  fontSize: number;
  lineHeight?: number;
  color: string;
  mode: TextToSvgMode;
  stagger?: string;
  staggerDuration?: number | 'auto';
  pressure?: number;
  smoothing: boolean;
  segmentSize?: number;
}

const HELP = `tegaki — animated handwriting SVG generator

Usage:
  tegaki <text...> [options]

Options:
  -o, --output <file>       Output path (default: <slug>.svg; "-" writes to stdout)
  -f, --font <name>         Bundled font (default: caveat). See --list-fonts.
  -m, --mode <mode>         loop | once | static (default: loop)
                              loop   self-drawing, repeats forever (README hero)
                              once   draws itself once, then stays complete
                              static finished artwork, no animation
      --size <px>           Font size in px (default: 100)
      --color <css>         Stroke color (default: #1a1a1a)
      --line-height <px>    Line height in px (default: from font metrics)
      --stagger <advance>   Overlap glyphs instead of drawing them in sequence.
                              e.g. "80%" (of the previous glyph) or "0.3" (seconds)
      --stagger-duration <s|auto>   Per-glyph duration when staggering (default: auto)
      --pressure <0-1>      Variable stroke width for once/static (default: 1)
      --smoothing           Smooth strokes onto a spline
      --segment-size <px>   Stroke subdivision threshold (default: 2 when applicable)
  -h, --help                Show this help
  -v, --version             Show version
      --list-fonts          List bundled fonts

Examples:
  tegaki "Tegaki is awesome"
  tegaki "Hello World" --font tangerine --mode once -o hello.svg
  tegaki "ABC" --stagger 80% --size 140 --color "#222"
`;

function fail(message: string): never {
  process.stderr.write(`tegaki: ${message}\n`);
  process.exit(1);
}

/** Slugify text into a safe base filename. */
function slug(text: string): string {
  const s = text
    .trim()
    .slice(0, 40)
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .toLowerCase();
  return s || 'tegaki';
}

function parseArgs(argv: string[]): CliOptions {
  const words: string[] = [];
  const opts: CliOptions = {
    text: '',
    output: null,
    font: 'caveat',
    fontSize: 100,
    color: '#1a1a1a',
    mode: 'loop',
    smoothing: false,
  };

  // Pull the value for a flag, supporting both `--flag value` and `--flag=value`.
  const expectValue = (flag: string, inline: string | undefined, i: { v: number }): string => {
    if (inline !== undefined) return inline;
    const next = argv[++i.v];
    if (next === undefined) fail(`option ${flag} requires a value`);
    return next;
  };

  const idx = { v: 0 };
  for (idx.v = 0; idx.v < argv.length; idx.v++) {
    const arg = argv[idx.v]!;
    if (!arg.startsWith('-') || arg === '-') {
      words.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const flag = eq >= 0 ? arg.slice(0, eq) : arg;
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;

    switch (flag) {
      case '-h':
      case '--help':
        process.stdout.write(HELP);
        process.exit(0);
        break;
      case '-v':
      case '--version':
        process.stdout.write(`${cachedVersion}\n`);
        process.exit(0);
        break;
      case '--list-fonts':
        listFonts();
        process.exit(0);
        break;
      case '-o':
      case '--output':
        opts.output = expectValue(flag, inline, idx);
        break;
      case '-f':
      case '--font':
        opts.font = expectValue(flag, inline, idx).toLowerCase();
        break;
      case '-m':
      case '--mode': {
        const m = expectValue(flag, inline, idx) as TextToSvgMode;
        if (!MODES.includes(m)) fail(`unknown mode "${m}" (expected: ${MODES.join(', ')})`);
        opts.mode = m;
        break;
      }
      case '--size':
        opts.fontSize = numeric(flag, expectValue(flag, inline, idx));
        break;
      case '--line-height':
        opts.lineHeight = numeric(flag, expectValue(flag, inline, idx));
        break;
      case '--color':
        opts.color = expectValue(flag, inline, idx);
        break;
      case '--stagger':
        opts.stagger = expectValue(flag, inline, idx);
        break;
      case '--stagger-duration': {
        const v = expectValue(flag, inline, idx);
        opts.staggerDuration = v === 'auto' ? 'auto' : numeric(flag, v);
        break;
      }
      case '--pressure':
        opts.pressure = numeric(flag, expectValue(flag, inline, idx));
        break;
      case '--smoothing':
        opts.smoothing = true;
        break;
      case '--segment-size':
        opts.segmentSize = numeric(flag, expectValue(flag, inline, idx));
        break;
      default:
        fail(`unknown option "${flag}" (try --help)`);
    }
  }

  opts.text = words.join(' ');
  return opts;
}

function numeric(flag: string, value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`option ${flag} expects a number, got "${value}"`);
  return n;
}

function listFonts(): void {
  process.stdout.write('Bundled fonts:\n');
  for (const [name, label] of Object.entries(FONTS)) {
    process.stdout.write(`  ${name.padEnd(18)} ${label}\n`);
  }
}

// Resolved once at startup (before args are parsed) so `--version` can print synchronously.
let cachedVersion = 'unknown';
async function resolveVersion(): Promise<void> {
  try {
    const url = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(await readFile(url, 'utf-8')) as { version?: string };
    if (pkg.version) cachedVersion = pkg.version;
  } catch {
    // leave default
  }
}

/**
 * Load a built font bundle by name. Tries the shipped `dist/fonts/<name>` first
 * (the `npx` path), then the source `fonts/<name>` (running from a checkout).
 */
async function loadBundle(name: string): Promise<TegakiBundle> {
  if (!(name in FONTS)) {
    fail(`unknown font "${name}". Run \`tegaki --list-fonts\` to see the ${Object.keys(FONTS).length} bundled fonts.`);
  }
  const candidates = [
    new URL(`./fonts/${name}/bundle.mjs`, import.meta.url), // built: dist/cli.mjs → dist/fonts/<name>/bundle.mjs
    new URL(`../fonts/${name}/bundle.ts`, import.meta.url), // dev: src/cli.ts → fonts/<name>/bundle.ts
  ];
  for (const url of candidates) {
    try {
      const mod = (await import(url.href)) as { default?: TegakiBundle };
      if (mod?.default) return mod.default;
    } catch {
      // try next candidate
    }
  }
  fail(`could not load font bundle "${name}".`);
}

async function main(): Promise<void> {
  await resolveVersion();
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.text) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  if (NEEDS_SHAPING.has(opts.font)) {
    process.stderr.write(
      `tegaki: note — "${opts.font}" is a complex/RTL script. The CLI lays glyphs out by ` +
        `advance width without shaping, so joins and direction may be wrong. ` +
        `Use the browser studio (gkurt.com/tegaki/generator) for shaped output.\n`,
    );
  }

  const font = await loadBundle(opts.font);

  const timing =
    opts.stagger !== undefined
      ? {
          stagger: {
            advance: /%$/.test(opts.stagger) ? (opts.stagger as `${number}%`) : Number(opts.stagger),
            duration: opts.staggerDuration ?? ('auto' as const),
          },
        }
      : undefined;

  const svg = textToSvg(opts.text, font, {
    fontSize: opts.fontSize,
    lineHeight: opts.lineHeight,
    color: opts.color,
    mode: opts.mode,
    pressure: opts.pressure,
    smoothing: opts.smoothing,
    segmentSize: opts.segmentSize,
    timing,
  });

  if (opts.output === '-') {
    process.stdout.write(svg);
    return;
  }

  const outPath = opts.output ?? `${slug(opts.text)}.svg`;
  await writeFile(outPath, svg, 'utf-8');
  const kb = (Buffer.byteLength(svg, 'utf-8') / 1024).toFixed(1);
  process.stderr.write(`tegaki: wrote ${outPath} (${opts.mode}, ${FONTS[opts.font]}, ${kb} KB)\n`);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
