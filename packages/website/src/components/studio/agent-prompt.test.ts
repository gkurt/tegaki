import { describe, expect, test } from 'bun:test';
import { DEFAULT_GEOMETRY_OPTIONS, DEFAULT_OPTIONS, KOREAN_CHARS } from 'tegaki-generator';
import { URL_DEFAULTS, type UrlState } from '../url-state.ts';
import { type AgentPromptInput, agentUrls, buildAgentPrompt, nonDefaultFlags } from './agent-prompt.ts';

const SITE = 'https://example.com/tegaki';

function input(overrides: Partial<AgentPromptInput> = {}, settings: Partial<UrlState> = {}): AgentPromptInput {
  return {
    goal: 'generate',
    note: '',
    settings: { ...URL_DEFAULTS, ...settings },
    font: { family: 'Caveat', style: 'Regular', unitsPerEm: 1000, lineCap: 'round', features: ['calt'] },
    charset: { preset: 'Latin', count: 90, mapped: 90, recommended: { name: 'Latin', covered: 90, total: 90 } },
    glyph: null,
    siteUrl: SITE,
    ...overrides,
  };
}

describe('nonDefaultFlags', () => {
  test('default options produce no flags', () => {
    expect(nonDefaultFlags(DEFAULT_OPTIONS, DEFAULT_GEOMETRY_OPTIONS)).toEqual([]);
  });

  test('changed options become kebab-case CLI flags', () => {
    const flags = nonDefaultFlags({ ...DEFAULT_OPTIONS, bezierTolerance: 2 }, { ...DEFAULT_GEOMETRY_OPTIONS, strokeOrder: 'heuristic' });
    expect(flags).toEqual(['--bezier-tolerance 2', '--stroke-order heuristic']);
  });
});

describe('agentUrls', () => {
  test('the preview link drops glyph-mode keys and pauses on the finished frame', () => {
    const { studio, preview } = agentUrls({ ...URL_DEFAULTS, previewMode: 'glyph', selectedChar: 'F', fontFamily: 'Amiri' }, SITE);
    expect(studio).toStartWith(`${SITE}/studio/?`);
    expect(studio).toContain('g=F');
    const params = new URL(preview).searchParams;
    expect(params.get('f')).toBe('Amiri');
    expect(params.has('g')).toBe(false);
    expect(params.has('m')).toBe(false);
    expect(params.get('tm')).toBe('controlled');
    expect(params.get('ct')).toBe('99');
  });

  test('a paused controlled time is kept in the preview link', () => {
    const { preview } = agentUrls({ ...URL_DEFAULTS, timeMode: 'controlled', currentTime: 1.5 }, SITE);
    expect(new URL(preview).searchParams.get('ct')).toBe('1.5');
  });

  test('the demo plugins stay out of both links', () => {
    const { studio, preview } = agentUrls({ ...URL_DEFAULTS, plugins: ['pen', 'brush'] }, SITE);
    expect(studio).not.toContain('pg=');
    expect(new URL(preview).searchParams.has('pg')).toBe(false);
  });
});

describe('buildAgentPrompt', () => {
  test('carries the goal, the note, and both links', () => {
    const prompt = buildAgentPrompt(input({ goal: 'fix', note: 'the g tail draws backwards' }));
    expect(prompt).toContain('Help me fix a problem');
    expect(prompt).toContain('In my words: the g tail draws backwards');
    expect(prompt).toContain(`Studio (interactive, this exact state): ${SITE}/studio/`);
    expect(prompt).toContain(`${SITE}/preview/?`);
  });

  test("lists the inspected glyph's warnings", () => {
    const prompt = buildAgentPrompt(input({ glyph: { char: 'F', warnings: ['stroke order: heuristic order kept'] } }));
    expect(prompt).toContain('“F” (U+0046)');
    expect(prompt).toContain('- stroke order: heuristic order kept');
  });

  test('names the recommended preset when a different set is selected', () => {
    const prompt = buildAgentPrompt(
      input({ charset: { preset: 'Latin', count: 90, mapped: 90, recommended: { name: 'Korean', covered: 780, total: 780 } } }),
    );
    expect(prompt).toContain('recommends the Korean preset');
  });

  test('a preset charset is passed to the CLI by its export name', () => {
    const prompt = buildAgentPrompt(
      input({ charset: { preset: 'Korean', count: 780, mapped: 780, recommended: null } }, { chars: KOREAN_CHARS }),
    );
    expect(prompt).toContain('-c "<KOREAN_CHARS>"');
    expect(prompt).not.toContain(KOREAN_CHARS);
  });

  test('a short custom charset is inlined', () => {
    const prompt = buildAgentPrompt(input({ charset: { preset: null, count: 3, mapped: 3, recommended: null } }, { chars: 'abc' }));
    expect(prompt).toContain('-c "abc"');
  });

  test('an uploaded font points the CLI at the file and warns the links may not load it', () => {
    const prompt = buildAgentPrompt(
      input({ font: { family: 'My Hand', style: 'Regular', unitsPerEm: 1000, lineCap: 'round', features: [], fileName: 'myhand.ttf' } }),
    );
    expect(prompt).toContain('--font-file myhand.ttf');
    expect(prompt).toContain('a local file');
  });

  test('changed pipeline settings appear as CLI flags', () => {
    const prompt = buildAgentPrompt(input({}, { pipeline: 'raster', options: { ...DEFAULT_OPTIONS, resolution: 600 } }));
    expect(prompt).toContain('-p raster --resolution 600');
  });
});

test('names the inspected form of the glyph', () => {
  const prompt = buildAgentPrompt(input({ glyph: { char: 'a', form: 'a.ss01', warnings: [] } }));
  expect(prompt).toContain('its form `a.ss01`');
});

describe('all-in-font charset', () => {
  test('"All in font" asks the CLI for every glyph', () => {
    const prompt = buildAgentPrompt(input({ charset: { preset: null, allInFont: true, count: 2000, mapped: 2000, recommended: null } }));
    expect(prompt).toContain('every glyph in the font');
    expect(prompt).toContain(' -c true ');
  });
});

describe('plugin goal', () => {
  test('asks for a createPlugin plugin doing what the note says, with the API docs', () => {
    const prompt = buildAgentPrompt(input({ goal: 'plugin', note: 'ink that glows like lava' }));
    expect(prompt).toContain('`createPlugin`');
    expect(prompt).toContain('What it should do, in my words: ink that glows like lava');
    expect(prompt).toContain(`${SITE}/api/renderer.md`);
  });

  test('without a note the agent is told to ask what the plugin should do', () => {
    expect(buildAgentPrompt(input({ goal: 'plugin' }))).toContain('Ask me what it should do');
  });

  test("is written for the user's own project, not the Tegaki repo", () => {
    const prompt = buildAgentPrompt(input({ goal: 'plugin' }));
    expect(prompt).toContain('`tegaki` npm package');
    expect(prompt).toContain('plugins={plugins}');
    expect(prompt).not.toContain('SHOWCASE_PLUGINS');
    expect(prompt).not.toContain('bun ');
  });

  test('a shipped font is imported from tegaki/fonts', () => {
    expect(buildAgentPrompt(input({ goal: 'plugin' }))).toContain("import bundle from 'tegaki/fonts/caveat'");
  });

  test('any other font is generated in the studio', () => {
    const prompt = buildAgentPrompt(
      input({ goal: 'plugin', font: { family: 'Pacifico', style: 'Regular', unitsPerEm: 1000, lineCap: 'round', features: [] } }),
    );
    expect(prompt).toContain('Export → Download bundle');
  });

  test('shipped plugins are named by their tegaki/core export, demos as not in the package; both stay in the links', () => {
    const prompt = buildAgentPrompt(input({ goal: 'plugin' }, { plugins: ['vary', 'echo'], pluginOptions: { echo: { lag: 0.2 } } }));
    expect(prompt).toContain('`variationPlugin()`');
    expect(prompt).toContain('Echo (set to `{"lag":0.2}`)');
    expect(prompt).toContain("aren't in the package");
    const preview = prompt.match(/Preview \(the same, chrome-free, for screenshots\): (\S+)/)?.[1] ?? '';
    expect(new URL(preview).searchParams.get('pg')).toBe('vary,echo');
  });

  test('leaves out the stroke-tuning parts: pipeline flags and the generate command', () => {
    const prompt = buildAgentPrompt(input({ goal: 'plugin' }, { pipeline: 'raster', options: { ...DEFAULT_OPTIONS, resolution: 600 } }));
    expect(prompt).not.toContain('--resolution');
    expect(prompt).not.toContain('generate "');
  });
});
