import { mkdirSync } from 'node:fs';
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
import { formatStrokeOrderSummary, runStrokeOrderReport } from '../commands/stroke-order-report.ts';
import { DEFAULT_CHARS, DEFAULT_FONT_FAMILY } from '../constants.ts';
import { writeDebugOutput, writeGeometryDebugOutput } from '../debug/output.ts';
import { downloadFont } from '../font/download.ts';
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
const referenceProviders = (hanLocale: GeometryOptions['hanLocale']) =>
  createReferenceSet(
    {
      kanjiVG: createKanjiVGProvider(createKanjiVGFileLoader()),
      makeMeAHanzi: createMakeMeAHanziProvider(createMakeMeAHanziFileLoader()),
    },
    hanLocale,
  );

export const tegakiProgram = createPadrone('tegaki')
  .configure({
    description: 'Generate glyph data for handwriting animation',
  })
  .command('generate', (c) =>
    c
      .extend(padroneProgress(PROGRESS))
      .configure({
        title: 'Generate glyph data from a Google Font',
        description: 'Downloads a font, extracts glyph outlines, computes skeletons and stroke order, then writes a JSON file.',
      })
      .arguments(generateArgsSchema, { positional: ['family'] })
      .action(async (args, ctx) => {
        const progress = ctx.context.progress;
        const { family, output, force, debug, chars, pipeline, ...pipelineOptions } = args;

        // chars: true → all glyphs in the font (skip &text= subsetting)
        // chars: false → DEFAULT_CHARS
        // chars: string → use as-is
        const downloadChars = typeof chars === 'string' ? chars : chars === false ? DEFAULT_CHARS : undefined;

        // Download and read font (may return multiple subset files for CJK fonts)
        progress?.update(`Downloading font "${family}"...`);
        const fontPaths = await downloadFont(family, { force, chars: downloadChars });
        const fontBuffer = await Bun.file(fontPaths[0]!).arrayBuffer();
        const extraFontBuffers =
          fontPaths.length > 1 ? await Promise.all(fontPaths.slice(1).map((p) => Bun.file(p).arrayBuffer())) : undefined;
        const fontFileName = basename(fontPaths[0]!);

        // When generating a subset, also download the full font so the bundle
        // can include it as a CSS fallback for non-generated characters.
        const isSubset = chars !== true;
        let fullFontBuffer: ArrayBuffer | undefined;
        let fullFontFileName: string | undefined;
        if (isSubset) {
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
          strokeOrderProviders: pipeline === 'geometry' ? referenceProviders(args.hanLocale) : [],
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
          family: z.string().default('Klee One').describe('Google Fonts family name'),
          chars: z.string().default(JAPANESE_CHARS).describe('Characters to sweep (default: the Japanese preset)').meta({ flags: 'c' }),
          hanLocale: z
            .enum(['ja', 'zh'])
            .default(DEFAULT_GEOMETRY_OPTIONS.hanLocale)
            .describe('Stroke-order convention for Han characters — `ja` (KanjiVG) or `zh` (Make Me a Hanzi, PRC order)'),
          json: z.string().optional().describe('Write the full per-glyph report to this JSON file').meta({ flags: 'j' }),
          force: z.boolean().default(false).describe('Re-download font even if cached').meta({ flags: 'f' }),
        }),
        { positional: ['family'] },
      )
      .action(async (args, ctx) => {
        const progress = ctx.context.progress;
        const { family, chars, hanLocale, json, force } = args;

        progress?.update(`Downloading font "${family}"...`);
        const fontPaths = await downloadFont(family, { force, chars });
        const fontBuffer = await Bun.file(fontPaths[0]!).arrayBuffer();
        const extraFontBuffers =
          fontPaths.length > 1 ? await Promise.all(fontPaths.slice(1).map((p) => Bun.file(p).arrayBuffer())) : undefined;
        const fontInfo = await parseFont(fontBuffer, extraFontBuffers, family);

        await initStraightSkeleton();
        const providers = referenceProviders(hanLocale);

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
          family: z.string().default(DEFAULT_FONT_FAMILY).describe('Google Fonts family name'),
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
        const { family, chars, tolerance, worst, json, force } = args;

        progress?.update(`Downloading font "${family}"...`);
        const fontPaths = await downloadFont(family, { force, chars });
        const fontBuffer = await Bun.file(fontPaths[0]!).arrayBuffer();
        const extraFontBuffers =
          fontPaths.length > 1 ? await Promise.all(fontPaths.slice(1).map((p) => Bun.file(p).arrayBuffer())) : undefined;
        const fontInfo = await parseFont(fontBuffer, extraFontBuffers, family);

        const geometryOptions = pickGeometryOptions(args);
        if (geometryOptions.extraction === 'partition' && geometryOptions.medialMethod === 'straight-skeleton')
          await initStraightSkeleton();
        const providers = referenceProviders(geometryOptions.hanLocale);

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
  );

if (import.meta.main) await tegakiProgram.cli().drain();
