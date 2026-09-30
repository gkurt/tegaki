import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import * as opentype from 'opentype.js';
import { createPadrone, padroneProgress } from 'padrone';
import * as z from 'zod/v4';
import { JAPANESE_CHARS } from '../charsets.ts';
import { formatCoverageSummary, runCoverageReport } from '../commands/coverage-report.ts';
import {
  extractTegakiBundle,
  generateArgsSchema,
  geometryOptionsSchema,
  type PipelineOptions,
  parseFont,
  pickGeometryOptions,
} from '../commands/generate.ts';
import {
  compareScoreboards,
  formatScoreboardComparison,
  parseScoreboard,
  runScoreboard,
  serializeScoreboard,
} from '../commands/scoreboard.ts';
import { formatStrokeOrderSummary, runStrokeOrderReport } from '../commands/stroke-order-report.ts';
import { DEFAULT_CHARS, DEFAULT_FONT_FAMILY } from '../constants.ts';
import { writeDebugOutput, writeGeometryDebugOutput } from '../debug/output.ts';
import { downloadFont } from '../font/download.ts';
import { loadLocalFont } from '../font/local.ts';
import { enumerateFontChars } from '../font/parse.ts';
import { initStraightSkeleton } from '../geometry/face-straight-skeleton.ts';
import type { GeometryOptions } from '../geometry/types.ts';
import { DEFAULT_GEOMETRY_OPTIONS } from '../geometry/types.ts';
import { createKanjiVGProvider } from '../stroke-order/kanjivg.ts';
import { createKanjiVGFileLoader } from '../stroke-order/kanjivg-fetch.ts';
import { createMakeMeAHanziProvider } from '../stroke-order/makemeahanzi.ts';
import { createMakeMeAHanziFileLoader } from '../stroke-order/makemeahanzi-fetch.ts';
import { createReferenceSet } from '../stroke-order/providers.ts';

// Each command ends its own progress line (`progress.succeed(...)`); `success:
// null` stops Padrone from ending it again with the default "Working...".
const PROGRESS = { spinner: true, bar: true, time: true, eta: true, message: { success: null } } as const;

/** Every stroke-order reference source, Han characters following `hanLocale` (see createReferenceSet). */
const referenceProviders = (hanLocale: GeometryOptions['hanLocale'], datasets: GeometryOptions['referenceDatasets']) =>
  createReferenceSet(
    {
      kanjiVG: createKanjiVGProvider(createKanjiVGFileLoader()),
      makeMeAHanzi: createMakeMeAHanziProvider(createMakeMeAHanziFileLoader()),
    },
    hanLocale,
    datasets,
  );

const fontFileArg = z
  .string()
  .optional()
  .describe('Read the font from this TTF/OTF file instead of Google Fonts (subset to the swept characters)');

/**
 * A command's font: a local `--font-file` (subset to `chars`; undefined keeps
 * the whole file) or a Google Fonts download (`&text=`-subset to `chars`, may
 * return several CJK subset files).
 */
async function resolveFont(
  source: { family?: string; fontFile?: string; force: boolean },
  chars: string | undefined,
  defaultFamily: string,
): Promise<{
  family: string;
  fontBuffer: ArrayBuffer;
  extraFontBuffers?: ArrayBuffer[];
  fontFileName: string;
  /** Set for a local font: the name its whole file takes in a bundle. */
  fullFontFileName?: string;
  local: boolean;
}> {
  if (source.fontFile) {
    if (source.family) throw new Error('Pass either a Google Fonts family or --font-file, not both');
    return { ...(await loadLocalFont(source.fontFile, chars)), local: true };
  }
  const family = source.family ?? defaultFamily;
  const fontPaths = await downloadFont(family, { force: source.force, chars });
  const fontBuffer = await Bun.file(fontPaths[0]!).arrayBuffer();
  const extraFontBuffers = fontPaths.length > 1 ? await Promise.all(fontPaths.slice(1).map((p) => Bun.file(p).arrayBuffer())) : undefined;
  return { family, fontBuffer, extraFontBuffers, fontFileName: basename(fontPaths[0]!), local: false };
}

export const tegakiProgram = createPadrone('tegaki')
  .configure({
    description: 'Generate glyph data for handwriting animation',
  })
  .command('generate', (c) =>
    c
      .extend(padroneProgress(PROGRESS))
      .configure({
        title: 'Generate glyph data from a Google Font or a local font file',
        description:
          'Downloads a font (or reads --font-file), extracts glyph outlines, computes skeletons and stroke order, then writes a JSON file.',
      })
      .arguments(generateArgsSchema, { positional: ['family'] })
      .action(async (args, ctx) => {
        const progress = ctx.context.progress;
        const { family: familyArg, fontFile, fullFont, output, force, debug, chars, pipeline, ...pipelineOptions } = args;

        // chars: true → all glyphs in the font (skip &text= subsetting)
        // chars: false → DEFAULT_CHARS
        // chars: string → use as-is
        const downloadChars = typeof chars === 'string' ? chars : chars === false ? DEFAULT_CHARS : undefined;

        // Download or read the font (Google Fonts may return multiple subset files for CJK fonts)
        progress?.update(fontFile ? `Reading font "${fontFile}"...` : `Downloading font "${familyArg ?? DEFAULT_FONT_FAMILY}"...`);
        const {
          family,
          fontBuffer,
          extraFontBuffers,
          fontFileName,
          fullFontFileName: localFullFileName,
          local,
        } = await resolveFont({ family: familyArg, fontFile, force }, downloadChars, DEFAULT_FONT_FAMILY);

        // When generating a subset of a Google font, also download the full
        // font so the bundle can include it as a CSS fallback for
        // non-generated characters. A local font ships only its subset unless
        // --full-font asks for the file too: the fonts that need --font-file
        // (CJK) are tens of megabytes whole.
        const isSubset = chars !== true;
        let fullFontBuffer: ArrayBuffer | undefined;
        let fullFontFileName: string | undefined;
        if (isSubset && local && fullFont) {
          fullFontBuffer = await Bun.file(fontFile!).arrayBuffer();
          fullFontFileName = localFullFileName;
        } else if (isSubset && !local) {
          const fullPaths = await downloadFont(family, { force });
          fullFontBuffer = await Bun.file(fullPaths[0]!).arrayBuffer();
          fullFontFileName = basename(fullPaths[0]!);
        }

        // Resolve the final char set. When true, enumerate every mapped codepoint
        // from the downloaded font(s); otherwise use the explicit string.
        let resolvedChars: string;
        if (chars === true) {
          const primary = opentype.parse(fontBuffer);
          const extras = extraFontBuffers?.map((b) => opentype.parse(b));
          resolvedChars = enumerateFontChars(primary, extras);
          progress?.update(`Resolved ${[...resolvedChars].length} glyphs from "${family}"`);
        } else {
          resolvedChars = downloadChars!;
        }

        // Extract bundle (pure — no file I/O)
        progress?.update('Processing font...');
        const bundle = await extractTegakiBundle({
          fontBuffer,
          fontFileName,
          chars: resolvedChars,
          options: pipelineOptions as PipelineOptions,
          extraFontBuffers,
          requestedFamily: family,
          subset: isSubset,
          fullFontBuffer,
          fullFontFileName,
          pipeline,
          geometryOptions: pickGeometryOptions(args),
          strokeOrderProviders: pipeline === 'geometry' ? referenceProviders(args.hanLocale, args.referenceDatasets) : [],
          onProgress: (msg, p) => {
            if (p !== undefined) {
              progress?.update({ message: msg, progress: p });
            } else {
              progress?.update(msg);
            }
          },
        });

        // Write bundle files to disk
        const outputDir = output ?? `output/${family.toLowerCase().replace(/\s+/g, '-')}`;
        for (const file of bundle.files) {
          const filePath = join(outputDir, file.path);
          mkdirSync(dirname(filePath), { recursive: true });
          await Bun.write(filePath, file.content);
        }

        // Write debug output if requested
        if (debug) {
          const debugDir = join(outputDir, 'debug');
          await Bun.write(join(debugDir, 'font.json'), JSON.stringify(bundle.fontOutput, null, 2));
          for (const [char, result] of Object.entries(bundle.glyphResults)) {
            await writeDebugOutput(debugDir, char, result);
          }
          for (const [char, result] of Object.entries(bundle.geometryResults ?? {})) {
            await writeGeometryDebugOutput(debugDir, char, result, bundle.fontOutput.font.lineCap);
          }
        }

        progress?.succeed(`Processed ${bundle.stats.processed} glyphs (${bundle.stats.skipped} skipped). Output: ${outputDir}`);
        return { outputDir, ...bundle.stats };
      }),
  )
  .command('stroke-order-report', (c) =>
    c
      .extend(padroneProgress(PROGRESS))
      .configure({
        title: 'Score dataset stroke-order matching over a character set',
        description:
          'Sweeps every character through the geometry pipeline with its stroke-order reference (KanjiVG or Make Me a Hanzi, Hershey, Hangul) and reports count agreement, match costs, how many glyphs the reference ordered without a 1:1 match, and the worst offenders. The regression scoreboard for matcher/pipeline changes.',
      })
      .arguments(
        z.object({
          family: z.string().optional().describe('Google Fonts family name (default: Klee One)'),
          fontFile: fontFileArg,
          chars: z.string().default(JAPANESE_CHARS).describe('Characters to sweep (default: the Japanese preset)').meta({ flags: 'c' }),
          hanLocale: z
            .enum(['ja', 'zh'])
            .default(DEFAULT_GEOMETRY_OPTIONS.hanLocale)
            .describe('Stroke-order convention for Han characters — `ja` (KanjiVG) or `zh` (Make Me a Hanzi, PRC order)'),
          referenceDatasets: geometryOptionsSchema.shape.referenceDatasets,
          json: z.string().optional().describe('Write the full per-glyph report to this JSON file').meta({ flags: 'j' }),
          force: z.boolean().default(false).describe('Re-download font even if cached').meta({ flags: 'f' }),
        }),
        { positional: ['family'] },
      )
      .action(async (args, ctx) => {
        const progress = ctx.context.progress;
        const { chars, hanLocale, referenceDatasets, json } = args;

        progress?.update(args.fontFile ? `Reading font "${args.fontFile}"...` : 'Downloading font...');
        const { family, fontBuffer, extraFontBuffers } = await resolveFont(args, chars, 'Klee One');
        const fontInfo = await parseFont(fontBuffer, extraFontBuffers, family);

        await initStraightSkeleton();
        const providers = referenceProviders(hanLocale, referenceDatasets);

        const { summary, glyphs } = await runStrokeOrderReport(fontInfo, chars, providers, {
          onProgress: (done, total, char) => {
            progress?.update({ message: `Matching ${char || 'done'} (${done}/${total})`, progress: total > 0 ? done / total : 1 });
          },
        });

        if (json) {
          mkdirSync(dirname(join(json)), { recursive: true });
          await Bun.write(json, JSON.stringify({ family, summary, glyphs }, null, 2));
        }

        progress?.succeed(`Matched ${summary.withReference}/${summary.totalGlyphs} glyphs against their references`);
        console.log(`\n${formatStrokeOrderSummary(summary)}${json ? `\n\nfull report: ${json}` : ''}`);
        return summary;
      }),
  )
  .command('coverage-report', (c) =>
    c
      .extend(padroneProgress(PROGRESS))
      .configure({
        title: "Measure how much of each glyph's ink the strokes paint",
        description:
          "Sweeps a character set through the geometry and raster pipelines and reports the share of each glyph's rasterized ink no stroke pen or nib paints (within a tolerance in font units), with the worst offenders. The regression scoreboard for stroke-extraction changes; takes the same geometry flags as generate.",
      })
      .arguments(
        geometryOptionsSchema.extend({
          family: z.string().optional().describe(`Google Fonts family name (default: ${DEFAULT_FONT_FAMILY})`),
          fontFile: fontFileArg,
          chars: z
            .string()
            .default(DEFAULT_CHARS)
            .describe("Characters to sweep (default: the generator's default set)")
            .meta({ flags: 'c' }),
          tolerance: z
            .number()
            .default(2)
            .describe('Font units a pen may miss the ink by and still count as painting it')
            .meta({ flags: 't' }),
          worst: z.number().default(10).describe('How many of the worst glyphs to list'),
          json: z.string().optional().describe('Write the full per-glyph report to this JSON file').meta({ flags: 'j' }),
          force: z.boolean().default(false).describe('Re-download font even if cached').meta({ flags: 'f' }),
        }),
        { positional: ['family'] },
      )
      .action(async (args, ctx) => {
        const progress = ctx.context.progress;
        const { chars, tolerance, worst, json } = args;

        progress?.update(args.fontFile ? `Reading font "${args.fontFile}"...` : 'Downloading font...');
        const { family, fontBuffer, extraFontBuffers } = await resolveFont(args, chars, DEFAULT_FONT_FAMILY);
        const fontInfo = await parseFont(fontBuffer, extraFontBuffers, family);

        const geometryOptions = pickGeometryOptions(args);
        if (geometryOptions.extraction === 'partition' && geometryOptions.medialMethod === 'straight-skeleton')
          await initStraightSkeleton();
        const providers = referenceProviders(geometryOptions.hanLocale, geometryOptions.referenceDatasets);

        const { summary, glyphs } = await runCoverageReport(fontInfo, chars, providers, {
          geometryOptions,
          tolerance,
          worstN: worst,
          onProgress: (done, total, char) => {
            progress?.update({ message: `Measuring ${char || 'done'} (${done}/${total})`, progress: total > 0 ? done / total : 1 });
          },
        });

        if (json) {
          mkdirSync(dirname(join(json)), { recursive: true });
          await Bun.write(json, JSON.stringify({ family, tolerance, geometryOptions, summary, glyphs }, null, 2));
        }

        progress?.succeed(`Measured ${summary.totalGlyphs} glyphs of ${family}`);
        // The table is the output (a returned summary would be printed again, raw).
        console.log(`\n${formatCoverageSummary(summary)}${json ? `\n\nfull report: ${json}` : ''}`);
      }),
  )
  .command('scoreboard', (c) =>
    c
      .extend(padroneProgress(PROGRESS))
      .configure({
        title: 'Score a character set against a committed baseline',
        description:
          'Scores every glyph once through both pipelines — the ink the geometry strokes leave unpainted, and how its strokes were ordered — and compares the run with a baseline file, glyph by glyph. Exits non-zero on a regression; `--update` writes the run as the new baseline. The CI gate over the shipped bundles (`bun --filter tegaki scoreboard`).',
      })
      .arguments(
        geometryOptionsSchema.extend({
          family: z.string().optional().describe(`Google Fonts family name (default: ${DEFAULT_FONT_FAMILY})`),
          fontFile: fontFileArg,
          chars: z
            .string()
            .default(DEFAULT_CHARS)
            .describe("Characters to sweep (default: the generator's default set)")
            .meta({ flags: 'c' }),
          baseline: z.string().describe('Baseline JSON file to compare with (or write, with --update)').meta({ flags: 'b' }),
          update: z.boolean().default(false).describe('Write this run as the baseline instead of comparing with it').meta({ flags: 'u' }),
          name: z.string().optional().describe("Heading for the comparison (default: the font's family)"),
          summary: z.string().optional().describe('Append the Markdown comparison to this file (default: $GITHUB_STEP_SUMMARY when set)'),
          force: z.boolean().default(false).describe('Re-download font even if cached').meta({ flags: 'f' }),
        }),
        { positional: ['family'] },
      )
      .action(async (args, ctx) => {
        const progress = ctx.context.progress;
        const { chars, baseline, update } = args;
        if (!update && !existsSync(baseline)) throw new Error(`No baseline at ${baseline}; run with --update to write one`);

        progress?.update(args.fontFile ? `Reading font "${args.fontFile}"...` : 'Downloading font...');
        const { family, fontBuffer, extraFontBuffers } = await resolveFont(args, chars, DEFAULT_FONT_FAMILY);
        const fontInfo = await parseFont(fontBuffer, extraFontBuffers, family);

        const geometryOptions = pickGeometryOptions(args);
        await initStraightSkeleton();
        const board = await runScoreboard(
          fontInfo,
          family,
          chars,
          referenceProviders(geometryOptions.hanLocale, geometryOptions.referenceDatasets),
          {
            geometryOptions,
            onProgress: (done, total, char) => {
              progress?.update({ message: `Scoring ${char || 'done'} (${done}/${total})`, progress: total > 0 ? done / total : 1 });
            },
          },
        );

        if (update) {
          mkdirSync(dirname(baseline), { recursive: true });
          await Bun.write(baseline, serializeScoreboard(board));
          progress?.succeed(`Wrote the baseline for ${Object.keys(board.glyphs).length} glyphs of ${family} to ${baseline}`);
          return;
        }

        const comparison = compareScoreboards(parseScoreboard(await Bun.file(baseline).text()), board);
        const report = formatScoreboardComparison(args.name ?? family, comparison);
        const summaryFile = args.summary ?? process.env.GITHUB_STEP_SUMMARY;
        if (summaryFile) appendFileSync(summaryFile, `${report}\n\n`);
        progress?.succeed(`Scored ${Object.keys(board.glyphs).length} glyphs of ${family}`);
        console.log(`\n${report}`);
        if (comparison.regressions.length > 0) {
          throw new Error(
            `${comparison.regressions.length} scoreboard regression(s) against ${baseline}. If they are intended, rerun with --update and commit the baseline.`,
          );
        }
      }),
  );

if (import.meta.main) await tegakiProgram.cli().drain();
