import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectReferences,
  type GeometryPipelineResult,
  initStraightSkeleton,
  type PipelineResult,
  processGlyph,
  processGlyphGeometry,
  type ReferenceGlyph,
} from 'tegaki-generator';
import { GEOMETRY_STAGES, type Pipeline, STAGES } from '../preview/constants.ts';
import { fontCacheId } from '../preview/font-cache-id.ts';
import { GeometryStageRenderer, StageRenderer } from '../preview/stage-views.tsx';
import { strokeOrderProviders } from '../preview/stroke-order-providers.ts';
import type { UrlState } from '../url-state.ts';
import { WarningIcon } from './icons.tsx';
import type { LoadedFont, SetSetting } from './state.ts';
import { Transport } from './Transport.tsx';
import { cx, isTypingTarget, Segmented, Spinner } from './ui.tsx';
import { ZoomStage } from './ZoomStage.tsx';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Registers the loaded font buffers as FontFaces so the glyph list renders in the font itself. */
function useFontFaceFamily(font: LoadedFont | null): string | undefined {
  const [family, setFamily] = useState<string>();
  useEffect(() => {
    if (!font) return;
    let cancelled = false;
    const id = Math.random().toString(36).slice(2, 8);
    const faces = [font.buffer, ...(font.extraBuffers ?? [])].map((buf, i) => new FontFace(`studio-glyph-${id}-${i}`, buf.slice(0)));
    Promise.all(faces.map((f) => f.load()))
      .then((loaded) => {
        if (cancelled) return;
        for (const f of loaded) document.fonts.add(f);
        setFamily(faces.map((f) => `"${f.family}"`).join(', '));
      })
      .catch(() => setFamily(undefined));
    return () => {
      cancelled = true;
      for (const f of faces) document.fonts.delete(f);
    };
  }, [font]);
  return family;
}

export function GlyphWorkspace({
  font,
  settings,
  set,
  resultsCache,
  onPipelineChange,
}: {
  font: LoadedFont | null;
  settings: UrlState;
  set: SetSetting;
  resultsCache: RefObject<Map<string, PipelineResult>>;
  onPipelineChange: (p: Pipeline) => void;
}) {
  const fontInfo = font?.info ?? null;
  const { pipeline, selectedChar, options, geometryOptions, activeStage, geometryStage } = settings;
  const glyphFamily = useFontFaceFamily(font);

  const [result, setResult] = useState<PipelineResult | null>(null);
  const [geoResult, setGeoResult] = useState<GeometryPipelineResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [stageError, setStageError] = useState('');
  const geoResultsCache = useRef(new Map<string, GeometryPipelineResult>());
  // Stroke-order reference variants for the selected char: undefined = fetch
  // in flight, [] = no dataset has an entry (or fetches failed). Fetched
  // BEFORE the pipeline runs so the (synchronous) pipeline can register +
  // match them.
  const [refGlyphs, setRefGlyphs] = useState<ReferenceGlyph[] | undefined>(undefined);

  const chars = useMemo(() => [...segmenter.segment(settings.chars)].map((s) => s.segment), [settings.chars]);

  // Characters the font actually maps (checks all subset fonts).
  const availableChars = useMemo(() => {
    const available = new Set<string>();
    if (!fontInfo) return available;
    const fonts = [fontInfo.font, ...(fontInfo.extraFonts ?? [])];
    for (const c of chars) {
      if (fonts.some((f) => (f.charToGlyph(c)?.index ?? 0) !== 0)) available.add(c);
    }
    return available;
  }, [fontInfo, chars]);

  // Raster pipeline
  useEffect(() => {
    if (pipeline !== 'raster' || !fontInfo || !selectedChar) {
      setResult(null);
      return;
    }
    const cacheKey = `${selectedChar}:${fontCacheId(fontInfo)}:${JSON.stringify(options)}`;
    const cached = resultsCache.current.get(cacheKey);
    if (cached) {
      setResult(cached);
      setProcessing(false);
      return;
    }
    setProcessing(true);
    // Let the UI paint the spinner before the heavy computation.
    const id = setTimeout(() => {
      const res = processGlyph(fontInfo, selectedChar, options);
      if (res) resultsCache.current.set(cacheKey, res);
      setResult(res);
      setProcessing(false);
    }, 10);
    return () => clearTimeout(id);
  }, [pipeline, fontInfo, selectedChar, options, resultsCache]);

  // Fetch the stroke-order reference variants for the selected char (memoized
  // per character by each provider). Failures (offline, rate limit) degrade to
  // "no reference" and the pipeline falls back to heuristic ordering.
  const hanLocale = geometryOptions.hanLocale;
  useEffect(() => {
    if (pipeline !== 'geometry' || !selectedChar) return;
    let cancelled = false;
    setRefGlyphs(undefined);
    collectReferences(selectedChar, strokeOrderProviders(hanLocale))
      .then((refs) => !cancelled && setRefGlyphs(refs))
      .catch(() => !cancelled && setRefGlyphs([]));
    return () => {
      cancelled = true;
    };
  }, [pipeline, selectedChar, hanLocale]);

  // Geometry pipeline
  useEffect(() => {
    if (pipeline !== 'geometry' || !fontInfo || !selectedChar) {
      setGeoResult(null);
      return;
    }
    // Wait for the reference fetches to settle so a single pipeline run sees them.
    if (refGlyphs === undefined) {
      setProcessing(true);
      return;
    }
    const cacheKey = `${fontCacheId(fontInfo)}:${selectedChar}:${options.bezierTolerance}:${JSON.stringify(geometryOptions)}:${refGlyphs.map((r) => r.source).join('+') || 'noref'}`;
    const cached = geoResultsCache.current.get(cacheKey);
    if (cached) {
      setGeoResult(cached);
      setProcessing(false);
      return;
    }
    setProcessing(true);
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        // The straight-skeleton method needs its wasm module loaded once before
        // the (synchronous) pipeline can use it.
        if (geometryOptions.medialMethod === 'straight-skeleton') await initStraightSkeleton();
        if (cancelled) return;
        const res = processGlyphGeometry(fontInfo, selectedChar, geometryOptions, options.bezierTolerance, refGlyphs);
        if (res) geoResultsCache.current.set(cacheKey, res);
        setGeoResult(res);
        setStageError('');
      } catch (e) {
        if (cancelled) return;
        setGeoResult(null);
        setStageError((e as Error).message);
      }
      setProcessing(false);
    }, 10);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [pipeline, fontInfo, selectedChar, geometryOptions, options.bezierTolerance, refGlyphs]);

  // ── Stroke animation ──
  const animResult: PipelineResult | GeometryPipelineResult | null = pipeline === 'geometry' ? geoResult : result;
  const [animPlaying, setAnimPlaying] = useState(true);
  const [animTime, setAnimTime] = useState(0);
  const prevAnimResult = useRef(animResult);
  // Replay from the start whenever the active result changes.
  if (prevAnimResult.current !== animResult) {
    prevAnimResult.current = animResult;
    if (animTime !== 0 || !animPlaying) {
      setAnimTime(0);
      setAnimPlaying(true);
    }
  }

  const totalDuration = useMemo(() => {
    const last = animResult?.strokesFontUnits.at(-1);
    return last ? last.delay + last.animationDuration : 0;
  }, [animResult]);

  const animStageActive = pipeline === 'geometry' ? geometryStage === 'animation' : activeStage === 'animation' || activeStage === 'final';

  useEffect(() => {
    if (!animPlaying || !animStageActive || totalDuration <= 0) return;
    let lastTs: number | null = null;
    let raf: number;
    const tick = (ts: number) => {
      if (lastTs !== null) {
        const dt = (ts - lastTs) / 1000;
        setAnimTime((prev) => Math.min(prev + dt, totalDuration));
      }
      lastTs = ts;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animPlaying, totalDuration, animStageActive]);

  // Stop at the end of the timeline.
  useEffect(() => {
    if (animPlaying && totalDuration > 0 && animTime >= totalDuration) setAnimPlaying(false);
  }, [animPlaying, animTime, totalDuration]);

  const playPause = useCallback(() => {
    setAnimTime((t) => (t >= totalDuration ? 0 : t));
    setAnimPlaying((p) => !p);
  }, [totalDuration]);

  // Keyboard: Space plays the animation stage, ←/→ step through the glyph list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Space' && animStageActive && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        playPause();
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const pickable = chars.filter((c) => !fontInfo || availableChars.has(c));
        const i = pickable.indexOf(selectedChar);
        const next = pickable[i + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) {
          e.preventDefault();
          set('selectedChar', next);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [animStageActive, playPause, chars, availableChars, fontInfo, selectedChar, set]);

  const stages = pipeline === 'raster' ? STAGES : GEOMETRY_STAGES;
  const stageValue = pipeline === 'raster' ? activeStage : geometryStage;
  const activeResult = pipeline === 'raster' ? result : geoResult;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
      <GlyphList
        chars={chars}
        selected={selectedChar}
        available={fontInfo ? availableChars : null}
        family={glyphFamily}
        onSelect={(c) => set('selectedChar', c)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white pl-2 dark:border-zinc-800 dark:bg-zinc-900">
          <Segmented
            size="sm"
            value={pipeline}
            onChange={onPipelineChange}
            options={[
              { value: 'geometry', label: 'Geometry' },
              { value: 'raster', label: 'Raster' },
            ]}
          />
          <div className="h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-800" />
          <div
            className="studio-scroll-x flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pr-2"
            role="tablist"
            aria-label="Pipeline stage"
          >
            {stages.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={s.key === stageValue}
                onClick={() =>
                  pipeline === 'raster'
                    ? set('activeStage', s.key as UrlState['activeStage'])
                    : set('geometryStage', s.key as UrlState['geometryStage'])
                }
                className={cx(
                  'h-7 shrink-0 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
                  s.key === stageValue
                    ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <ZoomStage
          contentKey={`${selectedChar}:${pipeline}:${stageValue}:${activeResult ? 1 : 0}`}
          overlay={
            <StageStatus
              processing={processing}
              error={pipeline === 'geometry' ? stageError : ''}
              fontLoaded={!!fontInfo}
              hasResult={!!activeResult}
              char={selectedChar}
            />
          }
        >
          <div className="text-zinc-900">
            {pipeline === 'raster'
              ? result && !processing && <StageRenderer result={result} stage={activeStage} animTime={animTime} />
              : geoResult && !processing && <GeometryStageRenderer result={geoResult} stage={geometryStage} animTime={animTime} />}
          </div>
        </ZoomStage>

        {animStageActive && animResult && (
          <Transport
            time={animTime}
            duration={totalDuration}
            playing={animPlaying}
            onPlayPause={playPause}
            onRestart={() => {
              setAnimTime(0);
              setAnimPlaying(false);
            }}
            onSeek={(t) => {
              setAnimTime(t);
              setAnimPlaying(false);
            }}
          />
        )}

        <GlyphStats pipeline={pipeline} result={result} geoResult={geoResult} />
      </div>
    </div>
  );
}

function StageStatus({
  processing,
  error,
  fontLoaded,
  hasResult,
  char,
}: {
  processing: boolean;
  error: string;
  fontLoaded: boolean;
  hasResult: boolean;
  char: string;
}) {
  let message: React.ReactNode = null;
  if (!fontLoaded) message = 'Load a font to get started';
  else if (error && !processing)
    message = (
      <span className="max-w-[80vw] truncate text-red-600 dark:text-red-400" title={error}>
        Pipeline failed: {error}
      </span>
    );
  else if (processing)
    message = (
      <>
        <Spinner className="size-3" /> Processing “{char}”…
      </>
    );
  else if (!hasResult) message = `No glyph data for “${char}”`;
  if (!message) return null;
  return (
    <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-zinc-500 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800">
      {message}
    </div>
  );
}

function GlyphList({
  chars,
  selected,
  available,
  family,
  onSelect,
}: {
  chars: string[];
  selected: string;
  available: Set<string> | null;
  family: string | undefined;
  onSelect: (c: string) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the selection moves
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);
  const count = available ? chars.filter((c) => available.has(c)).length : chars.length;
  return (
    <div className="flex shrink-0 flex-col border-zinc-200 bg-white max-lg:border-b lg:w-60 lg:border-r dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex h-11 shrink-0 items-center justify-between px-3 max-lg:hidden">
        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Glyphs</span>
        <span className="font-mono text-[11px] text-zinc-400">
          {count}/{chars.length}
        </span>
      </div>
      <div
        className={cx(
          'studio-scroll studio-scroll-x grid gap-1 p-2',
          'max-lg:auto-cols-[2.5rem] max-lg:grid-flow-col max-lg:grid-rows-1 max-lg:overflow-x-auto',
          'lg:min-h-0 lg:flex-1 lg:auto-rows-[2.5rem] lg:grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] lg:content-start lg:overflow-y-auto lg:pt-0',
        )}
      >
        {chars.map((c, i) => {
          const missing = available !== null && !available.has(c);
          const isSelected = c === selected;
          return (
            <button
              type="button"
              key={`${c}-${i}`}
              ref={isSelected ? selectedRef : undefined}
              disabled={missing}
              title={`${c} · U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}${missing ? ' · not in font' : ''}`}
              onClick={() => onSelect(c)}
              style={{ fontFamily: family }}
              className={cx(
                'flex h-10 items-center justify-center rounded-md text-lg leading-none transition-colors',
                missing
                  ? 'cursor-not-allowed text-zinc-300 dark:text-zinc-700'
                  : isSelected
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
              )}
            >
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GlyphStats({
  pipeline,
  result,
  geoResult,
}: {
  pipeline: Pipeline;
  result: PipelineResult | null;
  geoResult: GeometryPipelineResult | null;
}) {
  const r = pipeline === 'raster' ? result : geoResult;
  if (!r) return null;
  const hex = r.unicode.toString(16).padStart(4, '0').toUpperCase();
  const items: [string, React.ReactNode][] =
    pipeline === 'raster' && result
      ? [
          ['Advance', result.advanceWidth],
          ['Bitmap', `${result.bitmapWidth}×${result.bitmapHeight}`],
          ['Polylines', result.polylines.length],
          ['Strokes', result.strokes.length],
          ['Cap', result.lineCap],
        ]
      : geoResult
        ? [
            ['Contours', geoResult.contours.length],
            ['Corners', geoResult.corners.length],
            ['Cuts', geoResult.cuts.length],
            ['Faces', `${geoResult.faces.length} (${geoResult.faces.filter((f) => f.kind === 'junction').length}J)`],
            ['Segments', geoResult.segments.length],
            ['Strokes', geoResult.strokesFontUnits.length],
          ]
        : [];
  const warnings = pipeline === 'geometry' && geoResult ? geoResult.warnings : [];
  return (
    <div className="studio-scroll-x flex h-8 shrink-0 items-center gap-4 overflow-x-auto border-t border-zinc-200 bg-white px-3 font-mono text-[11px] whitespace-nowrap text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      <span className="text-zinc-900 dark:text-zinc-100">
        {r.char} <span className="text-zinc-400">U+{hex}</span>
      </span>
      {items.map(([k, v]) => (
        <span key={k}>
          <span className="text-zinc-400">{k}</span> {v}
        </span>
      ))}
      {warnings.length > 0 && (
        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400" title={warnings.join('\n')}>
          <WarningIcon size={12} /> {warnings.length} warning{warnings.length > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
