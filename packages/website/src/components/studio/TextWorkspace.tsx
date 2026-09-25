import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TegakiBundle, TegakiRendererHandle, TimeControlProp } from 'tegaki';
import type { PipelineResult } from 'tegaki-generator';
import { TEXT_PRESETS } from '../preview/constants.ts';
import { TegakiTextPreview } from '../preview/TegakiTextPreview.tsx';
import { buildEffects, buildTimingConfig } from '../preview/utils.ts';
import type { UrlState } from '../url-state.ts';
import { fontHasChar } from './charsets.ts';
import { GlyphPicker } from './GlyphPicker.tsx';
import { ChevronDownIcon, ExternalLinkIcon, RestartIcon } from './icons.tsx';
import type { LoadedFont, SetSetting } from './state.ts';
import { TextFrame } from './TextFrame.tsx';
import { Transport } from './Transport.tsx';
import { cx, IconButton, isTypingTarget, Popover, Spinner } from './ui.tsx';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export interface TextPlaybackHandle {
  pause: () => void;
}

export function TextWorkspace({
  font,
  settings,
  set,
  resultsCache,
  rendererRef,
  playbackRef,
}: {
  font: LoadedFont | null;
  settings: UrlState;
  set: SetSetting;
  resultsCache: RefObject<Map<string, PipelineResult>>;
  rendererRef: RefObject<TegakiRendererHandle | null>;
  playbackRef: RefObject<TextPlaybackHandle | null>;
}) {
  const { timeMode, animSpeed, previewText: text } = settings;
  const fontInfo = font?.info ?? null;

  // Picking a character in the text opens it in the glyph inspector, adding it
  // to the character set first when the set doesn't have it.
  const hasChar = useMemo(() => (fontInfo ? fontHasChar(fontInfo) : () => false), [fontInfo]);
  const inspectGlyph = useCallback(
    (char: string) => {
      set('chars', (chars) => ([...segmenter.segment(chars)].some((g) => g.segment === char) ? chars : chars + char));
      set('selectedChar', char);
      set('previewMode', 'glyph');
    },
    [set],
  );

  // Initial time/paused state come from the URL (controlled mode only): a non-zero
  // `ct` param loads the timeline paused at that position so agents can inspect a
  // specific frame by editing the URL.
  const [playing, setPlaying] = useState(() => settings.currentTime === 0);
  const [displayTime, setDisplayTime] = useState(() => settings.currentTime);
  const timeRef = useRef(settings.currentTime);
  const [bundleReady, setBundleReady] = useState(false);
  const [totalDuration, setTotalDuration] = useState(0);

  playbackRef.current = { pause: () => setPlaying(false) };

  const effects = useMemo(
    () => buildEffects(settings.effectsState, settings.customEffects),
    [settings.effectsState, settings.customEffects],
  );

  // Synchronous font change detection — reset playback state BEFORE rendering so
  // the renderer never sees stale displayTime or glyph components. We skip the
  // initial null→loaded transition so URL-seeded state (e.g. `ct`) survives the
  // first font load; playback is only reset when the user actually switches fonts.
  const prevFontInfoForReset = useRef(fontInfo);
  if (prevFontInfoForReset.current !== fontInfo) {
    const wasLoaded = prevFontInfoForReset.current !== null;
    prevFontInfoForReset.current = fontInfo;
    if (bundleReady) setBundleReady(false);
    if (totalDuration !== 0) setTotalDuration(0);
    if (wasLoaded) {
      timeRef.current = 0;
      if (displayTime !== 0) setDisplayTime(0);
      if (!playing) setPlaying(true);
    }
  }

  const handleReady = useCallback(
    (info: { bundle: TegakiBundle; totalDuration: number }) => {
      setBundleReady(true);
      setTotalDuration(info.totalDuration);
      // Mirror the renderer's engine onto `window.__tegakiEngine` so an attached
      // browser-harness / devtools session can inspect timeline entries, layout
      // offsets, and shaper output without modifying the engine itself. Fires
      // whenever the bundle becomes ready (also on font swaps, since each
      // engine is recreated per font). Pure dev affordance — does not affect
      // rendering.
      (window as Window & { __tegakiEngine?: unknown }).__tegakiEngine = rendererRef.current?.engine ?? null;
    },
    [rendererRef],
  );

  const prevTotalRef = useRef(totalDuration);

  // Auto-resume when text extends timeline. Guard against the initial 0→N transition
  // (font loading) so a URL-seeded pause isn't silently resumed on mount.
  useEffect(() => {
    if (prevTotalRef.current > 0 && totalDuration > prevTotalRef.current && timeRef.current >= prevTotalRef.current) {
      setPlaying(true);
    }
    prevTotalRef.current = totalDuration;
  }, [totalDuration]);

  // Clamp time when text shortens. Skip while the timeline is empty (font not loaded yet)
  // so URL-seeded `ct` isn't clamped to 0 before the real duration becomes known.
  useEffect(() => {
    if (totalDuration > 0 && timeRef.current > totalDuration) {
      timeRef.current = totalDuration;
      setDisplayTime(totalDuration);
    }
  }, [totalDuration]);

  // Persist the paused timeline position to the URL (controlled mode). We only sync
  // while paused — during playback the URL would update 60x/sec, which is both noisy
  // and not useful (the URL represents a specific frame to resume from). This covers
  // pause, seek (which forces `playing=false`), reset, and natural animation end.
  useEffect(() => {
    if (!playing) set('currentTime', displayTime);
  }, [playing, displayTime, set]);

  // rAF playback loop (controlled mode only)
  useEffect(() => {
    if (timeMode !== 'controlled' || !playing || totalDuration <= 0) return;
    let lastTs: number | null = null;
    let raf: number;
    const tick = (ts: number) => {
      if (lastTs === null) {
        lastTs = ts;
        raf = requestAnimationFrame(tick);
        return;
      }
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      timeRef.current = Math.min(timeRef.current + dt * animSpeed, totalDuration);
      setDisplayTime(timeRef.current);
      if (timeRef.current >= totalDuration) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [timeMode, playing, totalDuration, animSpeed]);

  const playPause = useCallback(() => {
    if (timeRef.current >= totalDuration) {
      timeRef.current = 0;
      setDisplayTime(0);
    }
    setPlaying((p) => !p);
  }, [totalDuration]);

  const seek = (t: number) => {
    timeRef.current = t;
    setDisplayTime(t);
    setPlaying(false);
  };

  // Space toggles playback while focus isn't in a text field.
  useEffect(() => {
    if (timeMode !== 'controlled') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target) || e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      playPause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [timeMode, playPause]);

  const timeProp: TimeControlProp =
    timeMode === 'controlled'
      ? displayTime
      : timeMode === 'uncontrolled'
        ? { mode: 'uncontrolled' as const, speed: animSpeed, loop: settings.loop, catchUp: settings.catchUp || undefined }
        : 'css';

  const { strokeEasing, glyphEasing, deferDots, staggerEnabled, staggerAdvance, staggerDuration } = settings;
  const timingConfig = useMemo(
    () => buildTimingConfig({ strokeEasing, glyphEasing, deferDots, staggerEnabled, staggerAdvance, staggerDuration }),
    [strokeEasing, glyphEasing, deferDots, staggerEnabled, staggerAdvance, staggerDuration],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TextInputBar text={text} onChange={(t) => set('previewText', t)} />

      {/* CSS mode needs timeline-scope on a common ancestor of the scroller and the renderer */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        style={timeMode === 'css' ? ({ timelineScope: '--tegaki-scroll' } as React.CSSProperties) : undefined}
      >
        {timeMode === 'css' && (
          <style>
            {`@keyframes tegaki-scroll-progress {
              from { --tegaki-progress: 0; }
              to { --tegaki-progress: 1; }
            }`}
          </style>
        )}

        {/* A fixed frame can be wider than the canvas — then the canvas scrolls sideways instead of squeezing it. */}
        <div
          className={cx(
            'studio-canvas studio-scroll min-h-0 flex-1 overflow-y-auto',
            settings.frameWidth === null ? 'overflow-x-hidden' : 'studio-scroll-x overflow-x-auto',
          )}
        >
          <div className={cx('min-h-full px-6 pt-14 pb-10 sm:px-10 sm:pt-16', settings.frameWidth !== null && 'w-max min-w-full')}>
            {!fontInfo && <CanvasMessage>Load a font to get started</CanvasMessage>}
            {fontInfo && !bundleReady && (
              <CanvasMessage>
                <Spinner className="size-3" /> Generating strokes…
              </CanvasMessage>
            )}
            {font && (
              <TextFrame width={settings.frameWidth} onWidthChange={(w) => set('frameWidth', w)} autoClassName="w-full max-w-3xl">
                <GlyphPicker onInspect={inspectGlyph} canInspect={hasChar}>
                  <TegakiTextPreview
                    ref={rendererRef}
                    className="w-full text-zinc-900 dark:text-zinc-100"
                    style={
                      timeMode === 'css'
                        ? ({ animation: 'tegaki-scroll-progress linear both', animationTimeline: '--tegaki-scroll' } as React.CSSProperties)
                        : undefined
                    }
                    fontInfo={font.info}
                    fontBuffer={font.buffer}
                    extraFontBuffers={font.extraBuffers}
                    text={text}
                    options={settings.options}
                    pipeline={settings.pipeline}
                    geometryOptions={settings.geometryOptions}
                    time={timeProp}
                    effects={effects}
                    timing={timingConfig}
                    quality={settings.quality}
                    showOverlay={settings.showOverlay}
                    fontSizePx={settings.fontSizePx}
                    lineHeightRatio={settings.lineHeightRatio}
                    letterSpacingPx={settings.letterSpacingPx}
                    resultsCache={resultsCache}
                    onReady={handleReady}
                    useShaper={settings.useShaper}
                  />
                </GlyphPicker>
              </TextFrame>
            )}
          </div>
        </div>

        {timeMode === 'controlled' && (
          <Transport
            time={displayTime}
            duration={totalDuration}
            playing={playing}
            onPlayPause={playPause}
            onRestart={() => seek(0)}
            onSeek={seek}
            trailing={<SpeedBadge speed={animSpeed} />}
          />
        )}
        {timeMode === 'uncontrolled' && (
          <div className="flex h-12 shrink-0 items-center gap-2 border-t border-zinc-200 bg-white px-2 dark:border-zinc-800 dark:bg-zinc-900">
            <IconButton label="Restart" onClick={() => rendererRef.current?.engine?.restart()}>
              <RestartIcon size={14} />
            </IconButton>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Engine clock{settings.loop ? ' · looping' : ''}</span>
            <SpeedBadge speed={animSpeed} />
          </div>
        )}
        {timeMode === 'css' && (
          <div className="flex h-12 shrink-0 items-center gap-3 border-t border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
            <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">Scroll →</span>
            <div
              className="studio-css-scroller min-w-0 flex-1"
              style={{ overflowX: 'scroll', scrollTimeline: '--tegaki-scroll inline' } as React.CSSProperties}
            >
              <div style={{ width: '300%', height: 1 }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SpeedBadge({ speed }: { speed: number }) {
  if (speed === 1) return null;
  return (
    <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      {speed}×
    </span>
  );
}

function CanvasMessage({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 flex items-center gap-2 text-sm text-zinc-400">{children}</p>;
}

/** The text being previewed: an auto-growing field with script samples and a pop-out to /preview. */
function TextInputBar({ text, onChange }: { text: string; onChange: (t: string) => void }) {
  const [samplesOpen, setSamplesOpen] = useState(false);
  const rows = Math.min(Math.max(text.split('\n').length, 1), 4);
  return (
    <div className="flex shrink-0 items-start gap-1 border-b border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
      <Popover
        open={samplesOpen}
        onOpenChange={setSamplesOpen}
        panelClassName="w-64 p-1"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            title="Sample text per writing system"
            className={cx(
              'flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
              open && 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
            )}
          >
            Samples
            <ChevronDownIcon size={12} />
          </button>
        )}
      >
        {TEXT_PRESETS.map((p) => (
          <button
            type="button"
            key={p.name}
            onClick={() => {
              onChange(p.text);
              setSamplesOpen(false);
            }}
            className={cx(
              'flex h-9 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800',
              text === p.text ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400',
            )}
          >
            <span className="text-xs font-medium">{p.name}</span>
            <span className="truncate text-zinc-400">{p.text}</span>
          </button>
        ))}
      </Popover>
      <textarea
        aria-label="Preview text"
        rows={rows}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type something to write…"
        className="min-h-8 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] leading-5 text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
      />
      <IconButton
        label="Open in the standalone /preview page"
        onClick={() => window.open(window.location.href.replace('/studio', '/preview'), '_blank', 'noopener,noreferrer')}
      >
        <ExternalLinkIcon size={14} />
      </IconButton>
    </div>
  );
}
