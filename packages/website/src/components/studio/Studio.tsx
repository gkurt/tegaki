import { zipSync } from 'fflate';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TegakiRendererHandle } from 'tegaki';
import { CHARSET_PRESETS, enumerateFontChars, extractTegakiBundle, type PipelineResult } from 'tegaki-generator';
import { DEFAULT_EXAMPLE_FONT_TEXT, EXAMPLE_FONT_TEXTS, type Pipeline } from '../preview/constants.ts';
import { strokeOrderProviders } from '../preview/stroke-order-providers.ts';
import { defaultClipText } from '../url-state.ts';
import { AgentPromptMenu } from './AgentPromptMenu.tsx';
import { type CharsetInfo, charsetCoverage, fontHasChar, recommendCharset } from './charsets.ts';
import { ExportMenu } from './ExportMenu.tsx';
import { FontPicker } from './FontPicker.tsx';
import { GlyphWorkspace } from './GlyphWorkspace.tsx';
import {
  BookIcon,
  ChevronLeftIcon,
  GithubIcon,
  GlyphModeIcon,
  KeyboardIcon,
  MoonIcon,
  MoreIcon,
  SlidersIcon,
  SparklesIcon,
  SunIcon,
  TextModeIcon,
} from './icons.tsx';
import { DialThemeContext } from './inspector/dial.tsx';
import { Inspector } from './inspector/Inspector.tsx';
import { ShortcutsDialog } from './ShortcutsDialog.tsx';
import { useShortcuts } from './shortcuts.ts';
import { useFontLoader, useStudioSettings, useTheme } from './state.ts';
import { type TextPlaybackHandle, TextWorkspace } from './TextWorkspace.tsx';
import { cx, IconButton, Popover, Segmented, useMediaQuery } from './ui.tsx';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export function Studio() {
  const { settings, set, setSettings } = useStudioSettings();
  const { theme, toggle: toggleTheme } = useTheme();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [inspectorOpen, setInspectorOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches);

  // Raster results shared by the glyph inspector and the text preview.
  const resultsCache = useRef(new Map<string, PipelineResult>());
  const rendererRef = useRef<TegakiRendererHandle>(null);
  const playbackRef = useRef<TextPlaybackHandle>(null);

  // A font the user picks switches the charset to the one it's made for, unless
  // the current set was edited by hand. Fonts restored from the URL keep the
  // URL's charset.
  const adoptRecommendedCharset = useRef(false);
  const { font, loading, error, loadFamily, loadFile } = useFontLoader((loaded) => {
    resultsCache.current.clear();
    set('fontFamily', loaded.info.family);
    // "All in font" follows the font: expand it to the new font's glyphs.
    setSettings((s) => (s.allChars ? { ...s, chars: enumerateFontChars(loaded.info.font, loaded.info.extraFonts) } : s));
    if (adoptRecommendedCharset.current) {
      adoptRecommendedCharset.current = false;
      const recommended = recommendCharset(charsetCoverage(fontHasChar(loaded.info)));
      if (recommended) set('chars', (chars) => (CHARSET_PRESETS.some((p) => p.chars === chars) ? recommended.chars : chars));
    }
  });
  const charsets = useMemo<CharsetInfo | null>(() => {
    if (!font) return null;
    const coverage = charsetCoverage(fontHasChar(font.info));
    return { coverage, recommended: recommendCharset(coverage) };
  }, [font]);

  // Track whether the set is "All in font", so the URL can say `cs=all` rather
  // than list thousands of characters.
  const fontAllChars = useMemo(() => (font ? enumerateFontChars(font.info.font, font.info.extraFonts) : null), [font]);
  useEffect(() => {
    if (fontAllChars === null) return;
    const isAll = settings.chars === fontAllChars;
    if (isAll !== settings.allChars) set('allChars', isAll);
  }, [fontAllChars, settings.chars, settings.allChars, set]);

  // Load the URL's font once on mount.
  const initialFamily = useRef(settings.fontFamily);
  useEffect(() => {
    loadFamily(initialFamily.current);
  }, [loadFamily]);

  // Switching pipelines carries Clip to text over to the new pipeline's default,
  // unless it was changed by hand.
  const switchPipeline = useCallback(
    (next: Pipeline) =>
      setSettings((s) =>
        s.pipeline === next
          ? s
          : {
              ...s,
              pipeline: next,
              quality: s.quality.clipText === defaultClipText(s.pipeline) ? { ...s.quality, clipText: defaultClipText(next) } : s.quality,
            },
      ),
    [setSettings],
  );

  const [bundleBusy, setBundleBusy] = useState(false);
  const downloadBundle = useCallback(async () => {
    if (!font) return;
    setBundleBusy(true);
    try {
      const slug = font.info.family.toLowerCase().replace(/\s+/g, '-');
      const bundle = await extractTegakiBundle({
        fontBuffer: font.buffer,
        fontFileName: `${slug}.ttf`,
        chars: settings.chars,
        options: settings.options,
        extraFontBuffers: font.extraBuffers,
        subset: false,
        pipeline: settings.pipeline,
        geometryOptions: settings.geometryOptions,
        strokeOrderProviders: strokeOrderProviders(settings.geometryOptions.hanLocale),
      });
      const encoder = new TextEncoder();
      const zipFiles: Record<string, Uint8Array> = {};
      for (const file of bundle.files) {
        const content = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
        zipFiles[`${slug}/${file.path}`] = content instanceof Uint8Array ? content : new Uint8Array(content);
      }
      const zip = zipSync(zipFiles);
      const url = URL.createObjectURL(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBundleBusy(false);
    }
  }, [font, settings.chars, settings.options, settings.pipeline, settings.geometryOptions]);

  const [agentOpen, setAgentOpen] = useState(false);
  const [glyphReport, setGlyphReport] = useState<{ char: string; warnings: string[] } | null>(null);

  const mode = settings.previewMode;
  const showInspector = inspectorOpen;

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useShortcuts((key) => {
    if (key === 't') set('previewMode', 'text');
    else if (key === 'g') set('previewMode', 'glyph');
    else if (key === 'i') setInspectorOpen((open) => !open);
    else if (key === 'o') set('showOverlay', (on) => !on);
    else if (key === '?') setShortcutsOpen(true);
    else return false;
    return true;
  });

  return (
    <DialThemeContext.Provider value={theme}>
      <div className="flex h-dvh flex-col overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {/* ── Top bar ── */}
        <header className="relative z-20 flex h-12 shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-2 sm:gap-2 dark:border-zinc-800 dark:bg-zinc-900">
          <a
            href={`${BASE}/`}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md pr-2 pl-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="Back to the docs"
          >
            <ChevronLeftIcon size={16} />
            <img src={`${BASE}/favicon.svg`} alt="" className="size-5" />
            <span className="text-[13px] font-semibold text-zinc-900 max-md:hidden dark:text-zinc-100">Studio</span>
          </a>
          <div className="h-5 w-px shrink-0 bg-zinc-200 max-sm:hidden dark:bg-zinc-800" />
          <div className="min-w-0 flex-1 sm:max-w-64 sm:flex-none">
            <FontPicker
              family={settings.fontFamily}
              fontInfo={font?.info ?? null}
              loading={loading}
              error={error}
              onPickFamily={(family, featured) => {
                adoptRecommendedCharset.current = true;
                loadFamily(family);
                if (featured) set('previewText', EXAMPLE_FONT_TEXTS[family] ?? DEFAULT_EXAMPLE_FONT_TEXT);
              }}
              onPickFile={(file) => {
                adoptRecommendedCharset.current = true;
                loadFile(file);
              }}
            />
          </div>

          <Segmented
            className="lg:absolute lg:left-1/2 lg:-translate-x-1/2"
            compact
            value={mode}
            onChange={(m) => set('previewMode', m)}
            options={[
              { value: 'text', label: 'Text', icon: <TextModeIcon size={14} />, title: 'Text preview (T)' },
              { value: 'glyph', label: 'Glyphs', icon: <GlyphModeIcon size={14} />, title: 'Glyph inspector (G)' },
            ]}
          />

          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            <div className="flex items-center gap-0.5 max-md:hidden">
              <IconButton label="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)}>
                <KeyboardIcon size={16} />
              </IconButton>
              <IconButton label={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme}>
                {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
              </IconButton>
              <a
                href="https://github.com/gkurt/tegaki"
                target="_blank"
                rel="noopener noreferrer"
                title="View on GitHub"
                aria-label="View on GitHub"
                className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <GithubIcon size={16} />
              </a>
            </div>
            <OverflowMenu theme={theme} onToggleTheme={toggleTheme} onAskAgent={() => setAgentOpen(true)} />
            <AgentPromptMenu
              open={agentOpen}
              onOpenChange={setAgentOpen}
              font={font}
              settings={settings}
              charsets={charsets}
              glyph={mode === 'glyph' ? glyphReport : null}
            />
            <ExportMenu
              getEngine={mode === 'text' ? () => rendererRef.current?.engine ?? null : null}
              text={settings.previewText}
              onExportStart={() => playbackRef.current?.pause()}
              canDownloadBundle={!!font}
              onDownloadBundle={downloadBundle}
              bundleBusy={bundleBusy}
              chars={settings.chars}
              pipeline={settings.pipeline}
            />
            <IconButton
              label={showInspector ? 'Hide inspector (I)' : 'Show inspector (I)'}
              active={showInspector}
              onClick={() => setInspectorOpen(!showInspector)}
            >
              <SlidersIcon size={16} />
            </IconButton>
          </div>
        </header>

        {/* ── Workspace + inspector ── */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {mode === 'text' ? (
              <TextWorkspace
                font={font}
                settings={settings}
                set={set}
                resultsCache={resultsCache}
                rendererRef={rendererRef}
                playbackRef={playbackRef}
              />
            ) : (
              <GlyphWorkspace
                font={font}
                charsets={charsets}
                settings={settings}
                set={set}
                resultsCache={resultsCache}
                onGlyphReport={setGlyphReport}
              />
            )}
          </main>
          {showInspector && (
            <Inspector
              mode={mode}
              settings={settings}
              set={set}
              fontInfo={font?.info ?? null}
              charsets={charsets}
              onPipelineChange={switchPipeline}
              onClose={isDesktop ? undefined : () => setInspectorOpen(false)}
              className={cx(
                'border-zinc-200 dark:border-zinc-800',
                // Desktop: a docked column. Smaller screens: a bottom sheet sharing the height with the canvas.
                'lg:w-80 lg:shrink-0 lg:border-l xl:w-[22rem]',
                'max-lg:h-[min(55dvh,32rem)] max-lg:shrink-0 max-lg:border-t max-lg:shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.15)]',
              )}
            />
          )}
        </div>
      </div>
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </DialThemeContext.Provider>
  );
}

/** Theme + links, folded into a menu where the top bar has no room for them. */
function OverflowMenu({
  theme,
  onToggleTheme,
  onAskAgent,
}: {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onAskAgent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item =
    'flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800';
  return (
    <div className="md:hidden">
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="end"
        panelClassName="w-52 p-1"
        fullWidthOnMobile
        trigger={({ toggle }) => (
          <IconButton label="More" onClick={toggle}>
            <MoreIcon size={16} />
          </IconButton>
        )}
      >
        <button
          type="button"
          className={cx(item, 'sm:hidden')}
          onClick={() => {
            setOpen(false);
            onAskAgent();
          }}
        >
          <SparklesIcon size={15} /> Ask an agent
        </button>
        <button
          type="button"
          className={item}
          onClick={() => {
            onToggleTheme();
            setOpen(false);
          }}
        >
          {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
        <a className={item} href={`${BASE}/getting-started/`}>
          <BookIcon size={15} /> Documentation
        </a>
        <a className={item} href="https://github.com/gkurt/tegaki" target="_blank" rel="noopener noreferrer">
          <GithubIcon size={15} /> GitHub
        </a>
      </Popover>
    </div>
  );
}
