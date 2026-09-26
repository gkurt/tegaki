import { DEFAULT_GEOMETRY_OPTIONS, DEFAULT_OPTIONS, type GeometryOptions, type PipelineOptions } from 'tegaki-generator';
import { buildUrlParams, type UrlState } from '../url-state.ts';

export type AgentGoal = 'generate' | 'optimize' | 'fix';

export const AGENT_GOALS: { value: AgentGoal; label: string; placeholder: string }[] = [
  { value: 'generate', label: 'Generate', placeholder: 'Anything to keep in mind? e.g. “only lowercase + digits”, “for a React app”' },
  { value: 'optimize', label: 'Optimize', placeholder: 'What should improve? e.g. “strokes look too mechanical”, “the kanji order”' },
  { value: 'fix', label: 'Fix issue', placeholder: 'What looks wrong? e.g. “the tail of g draws backwards”' },
];

const GOAL_TEXT: Record<AgentGoal, string> = {
  generate:
    'Generate a Tegaki font bundle (stroke data + font) for this font that I can drop into the tegaki renderer, with settings that make it animate well. Check the result visually before handing it over.',
  optimize:
    'Improve how this font animates: strokes that cover all the ink with nothing doubled or missing, natural stroke order and direction, and pleasant timing. Try settings, compare the results visually, and tell me the settings (URL params and CLI flags) that work best.',
  fix: 'Help me fix a problem with how this font is extracted, rendered or animated. Reproduce it, find the cause (settings or pipeline), and fix it — or tell me which settings avoid it.',
};

const REPO = 'https://github.com/gkurt/tegaki';

/** The `tegaki-generator` export holding each charset preset (for the CLI's `-c`). */
const PRESET_CONSTANTS: Record<string, string> = {
  Latin: 'DEFAULT_CHARS',
  Hebrew: 'HEBREW_CHARS',
  Arabic: 'ARABIC_CHARS',
  Devanagari: 'DEVANAGARI_CHARS',
  Bengali: 'BENGALI_CHARS',
  Japanese: 'JAPANESE_CHARS',
  Korean: 'KOREAN_CHARS',
  'Simplified Chinese': 'SIMPLIFIED_CHINESE_CHARS',
};

/** Characters inlined into the prompt for a custom set at most this long. */
const INLINE_CHARS_MAX = 120;

export interface AgentPromptInput {
  goal: AgentGoal;
  note: string;
  settings: UrlState;
  font: {
    family: string;
    style: string;
    unitsPerEm: number;
    lineCap: string;
    features: string[];
    /** Set when the font came from a local file rather than Google Fonts. */
    fileName?: string;
  } | null;
  charset: {
    /** Preset name, or null for a hand-edited set. */
    preset: string | null;
    /** Every glyph the font maps ("All in font"). */
    allInFont?: boolean;
    count: number;
    /** How many of the set's characters the font maps (null before the font loads). */
    mapped: number | null;
    recommended: { name: string; covered: number; total: number } | null;
  };
  /** Glyph mode: the inspected glyph (and form, when not its default glyph) and its geometry-pipeline warnings. */
  glyph: { char: string; form?: string; warnings: string[] } | null;
  /** Origin + base path of the site, e.g. `https://gkurt.com/tegaki`. */
  siteUrl: string;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const codepoint = (c: string) => `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

/** CLI flags for every pipeline / geometry option that differs from its default. */
export function nonDefaultFlags(options: PipelineOptions, geometry: GeometryOptions): string[] {
  const flags: string[] = [];
  for (const [key, value] of Object.entries(options) as [keyof PipelineOptions, unknown][]) {
    if (Array.isArray(value)) continue; // disabledFeatures — reported separately
    if (value !== DEFAULT_OPTIONS[key]) flags.push(`--${kebab(key)} ${value}`);
  }
  for (const [key, value] of Object.entries(geometry) as [keyof GeometryOptions, unknown][]) {
    if (value !== DEFAULT_GEOMETRY_OPTIONS[key]) flags.push(`--${kebab(key)} ${value}`);
  }
  return flags;
}

/** The studio link (current state) and a /preview link paused on a deterministic frame. */
export function agentUrls(settings: UrlState, siteUrl: string): { studio: string; preview: string } {
  // The demo plugins draw over the render — not what an agent tuning the strokes should judge.
  const params = buildUrlParams({ ...settings, plugins: [] });
  const studio = `${siteUrl}/studio/${params.size ? `?${params}` : ''}`;
  const preview = new URLSearchParams(params);
  for (const key of ['m', 'g', 's', 'gs']) preview.delete(key);
  preview.set('tm', 'controlled');
  // A time past the end clamps to the finished frame.
  if (!(settings.timeMode === 'controlled' && settings.currentTime > 0)) preview.set('ct', '99');
  return { studio, preview: `${siteUrl}/preview/?${preview}` };
}

/** Markdown prompt that hands an agent this font, the studio state and links it can iterate on. */
export function buildAgentPrompt(input: AgentPromptInput): string {
  const { goal, settings, font, charset, glyph } = input;
  const family = font?.family ?? settings.fontFamily;
  const { studio, preview } = agentUrls(settings, input.siteUrl);
  const flags = nonDefaultFlags(settings.options, settings.geometryOptions);
  const disabledFeatures = settings.options.disabledFeatures;
  const note = input.note.trim();
  const out: string[] = [];

  out.push(
    `I'm using Tegaki (${REPO}) to turn the font **${family}** into a handwriting animation. Tegaki extracts pen strokes from a font's outlines into a bundle that its renderer draws stroke by stroke.`,
  );

  out.push('', '## Goal', '', GOAL_TEXT[goal]);
  if (note) out.push('', `In my words: ${note}`);

  out.push('', '## Font', '');
  out.push(font?.fileName ? `- ${family} — a local file (\`${font.fileName}\`), not from Google Fonts` : `- ${family} (Google Fonts)`);
  if (font) {
    out.push(`- ${font.style} · ${font.unitsPerEm} units per em · ${font.lineCap} line caps`);
    out.push(`- OpenType features: ${font.features.length ? font.features.join(', ') : 'none'}`);
  }
  const set = charset.allInFont ? 'every glyph in the font' : charset.preset ? `the ${charset.preset} preset` : 'a custom set';
  const mapped = charset.mapped !== null ? `, ${charset.mapped} of them in the font` : '';
  out.push(`- Character set: ${set} (${charset.count} characters${mapped})`);
  if (!charset.preset && !charset.allInFont && charset.count <= INLINE_CHARS_MAX) out.push(`  - \`${settings.chars}\``);
  if (charset.recommended && charset.recommended.name !== charset.preset) {
    const r = charset.recommended;
    out.push(`- Tegaki recommends the ${r.name} preset for this font (${r.covered}/${r.total} mapped)`);
  }

  out.push('', '## Current settings', '');
  out.push(`- Pipeline: ${settings.pipeline}`);
  out.push(`- Changed from defaults: ${flags.length ? flags.map((f) => `\`${f}\``).join(' ') : 'nothing'}`);
  if (disabledFeatures.length) out.push(`- Disabled OpenType features: ${disabledFeatures.join(', ')}`);
  out.push(`- Preview text: “${settings.previewText}”`);

  if (glyph) {
    out.push('', `## Glyph I'm looking at: “${glyph.char}” (${codepoint(glyph.char)})`, '');
    if (glyph.form)
      out.push(
        `Specifically its form \`${glyph.form}\` (a ligature or alternate the font substitutes in context — \`gv=<glyph id>\` in the studio URL).`,
        '',
      );
    if (glyph.warnings.length) {
      out.push('The geometry pipeline reports:');
      for (const w of glyph.warnings) out.push(`- ${w}`);
    } else {
      out.push('No pipeline warnings for it.');
    }
  }

  out.push('', '## Links', '');
  out.push(`- Studio (interactive, this exact state): ${studio}`);
  out.push(`- Preview (chrome-free render, for screenshots): ${preview}`);
  if (font?.fileName) {
    out.push(
      `- The font is a local file, so these links only load it if “${family}” is also on Google Fonts. Ask me for the file and use \`--font-file\` with the CLI.`,
    );
  }

  out.push('', '## How to iterate', '');
  out.push(
    `- All state lives in the URL. The keys are defined in ${REPO}/blob/main/packages/website/src/components/url-state.ts, and only non-defaults are written. The page reads the URL once on load, so re-navigate after each change.`,
  );
  out.push(
    '- In /preview, wait for `body[data-tegaki-ready="true"]` before taking a screenshot. `tm=controlled&ct=<seconds>` pauses on a frame, a `ct` past the end shows the finished text, and `w=…&h=…` fix the canvas size in pixels. Change the text with `t=`.',
  );
  out.push(
    '- In /studio, `m=glyph&g=<char>` inspects one glyph (`gv=<glyph id>` one of its forms — alternates, ligatures). `gs=<stage>` (geometry) or `s=<stage>` (raster) picks the pipeline stage, from the outline through the extracted strokes to `final`, the glyph as the renderer draws it.',
  );
  const chars = charset.allInFont
    ? ' -c true'
    : charset.preset
      ? charset.preset === 'Latin'
        ? ''
        : ` -c "<${PRESET_CONSTANTS[charset.preset] ?? 'chars'}>"`
      : charset.count <= INLINE_CHARS_MAX
        ? ` -c "${settings.chars.replaceAll('"', '\\"')}"`
        : ' -c "<chars>"';
  const source = font?.fileName ? ` --font-file ${font.fileName}` : '';
  const cmd = `bun start generate "${family}"${source}${chars} -p ${settings.pipeline}${flags.length ? ` ${flags.join(' ')}` : ''} -o <output-dir>`;
  out.push(
    `- To build the bundle, use Export → Download bundle in the studio, or clone the repo and run \`${cmd}\`. Every studio pipeline setting is a CLI flag.${
      charset.preset && charset.preset !== 'Latin'
        ? ` \`${PRESET_CONSTANTS[charset.preset]}\` is exported from packages/generator/src/charsets.ts.`
        : ''
    }`,
  );
  out.push(
    "- `--debug` writes each glyph's pipeline stages. `bun start coverage-report` (ink the strokes miss) and `bun start stroke-order-report` (agreement with reference stroke orders) score a character set, so run them before and after a change.",
  );
  out.push(`- Rendering the bundle: ${REPO}#readme`);

  return out.join('\n');
}
