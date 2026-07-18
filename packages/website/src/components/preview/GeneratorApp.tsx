import { zipSync } from 'fflate';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LineCap } from 'tegaki';
import {
  CHARSET_PRESETS,
  DEFAULT_GEOMETRY_OPTIONS,
  DEFAULT_OPTIONS,
  EXAMPLE_FONTS,
  enumerateFontChars,
  extractTegakiBundle,
  type GeometryOptions,
  type GeometryPipelineResult,
  type ParsedFontInfo,
  type PipelineOptions,
  type PipelineResult,
  parseFont,
  processGlyph,
  processGlyphGeometry,
  type SkeletonMethod,
} from 'tegaki-generator';
import { ZoomCanvas } from '../reactive-canvas.tsx';
import { parseUrlState, syncUrlState, type TimeMode } from '../url-state.ts';
import {
  DEFAULT_EXAMPLE_FONT_TEXT,
  EXAMPLE_FONT_TEXTS,
  GEOMETRY_STAGES,
  type GeometryStageKey,
  type Pipeline,
  type PreviewMode,
  SKELETON_METHODS,
  STAGES,
  type Stage,
} from './constants.ts';
import { fetchFontFromCDN } from './font-cdn.ts';
import { SelectOption, SliderOption } from './form-controls.tsx';
import { AnimationControls, GeometryStageRenderer, StageRenderer } from './stage-views.tsx';
import { TextPreview } from './TextPreview.tsx';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function GeneratorApp() {
  const [initialUrlState] = useState(parseUrlState);
  const [fontFamily, setFontFamily] = useState(initialUrlState.fontFamily);
  const [fontInput, setFontInput] = useState('');
  const [fontInfo, setFontInfo] = useState<ParsedFontInfo | null>(null);
  const [fontBuffer, setFontBuffer] = useState<ArrayBuffer | null>(null);
  const [extraFontBuffers, setExtraFontBuffers] = useState<ArrayBuffer[] | undefined>(undefined);
  const [fontLoading, setFontLoading] = useState(false);
  const [fontError, setFontError] = useState('');
  // GSUB feature tags declared by the currently loaded font. Detected once at
  // parse time and carried on `fontInfo` — empty when no font is loaded or the
  // font has no GSUB table.
  const detectedFeatures = fontInfo?.features ?? [];

  // Autocomplete state
  const [allFonts, setAllFonts] = useState<{ family: string; category: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const fontListFetched = useRef(false);

  const filteredFonts = useMemo(() => {
    if (!fontInput.trim()) return [];
    const query = fontInput.toLowerCase();
    return allFonts.filter((f) => f.family.toLowerCase().includes(query)).slice(0, 12);
  }, [fontInput, allFonts]);

  // Fetch font list from Fontsource for autocomplete (lazy, on first interaction)
  const fetchFontList = useCallback(() => {
    if (fontListFetched.current) return;
    fontListFetched.current = true;
    fetch('https://api.fontsource.org/v1/fonts?type=google')
      .then((r) => r.json())
      .then((data: { family: string; category: string }[]) => {
        setAllFonts(data.map((f) => ({ family: f.family, category: f.category })));
      })
      .catch(() => {
        fontListFetched.current = false;
      });
  }, []);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        fontInputRef.current &&
        !fontInputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const [chars, setChars] = useState(initialUrlState.chars);
  const [selectedChar, setSelectedChar] = useState(initialUrlState.selectedChar);
  const [activeStage, setActiveStage] = useState<Stage>(initialUrlState.activeStage);
  const [options, setOptions] = useState<PipelineOptions>(initialUrlState.options);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [processing, setProcessing] = useState(false);
  // Alternative geometry-based pipeline (experimental, glyph inspector only).
  const [pipeline, setPipeline] = useState<Pipeline>(initialUrlState.pipeline);
  const [geometryStage, setGeometryStage] = useState<GeometryStageKey>(initialUrlState.geometryStage);
  const [geometryOptions, setGeometryOptions] = useState<GeometryOptions>(initialUrlState.geometryOptions);
  const [geoResult, setGeoResult] = useState<GeometryPipelineResult | null>(null);
  const geoResultsCache = useRef(new Map<string, GeometryPipelineResult>());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>(initialUrlState.previewMode);
  const [previewText, setPreviewText] = useState(initialUrlState.previewText);
  const [animSpeed, setAnimSpeed] = useState(initialUrlState.animSpeed);
  const [fontSizePx, setFontSizePx] = useState(initialUrlState.fontSizePx);
  const [lineHeightRatio, setLineHeightRatio] = useState(initialUrlState.lineHeightRatio);
  const [letterSpacingPx, setLetterSpacingPx] = useState(initialUrlState.letterSpacingPx);
  const [showOverlay, setShowOverlay] = useState(initialUrlState.showOverlay);
  const [timeMode, setTimeMode] = useState<TimeMode>(initialUrlState.timeMode);
  const [currentTime, setCurrentTime] = useState(initialUrlState.currentTime);
  const [loop, setLoop] = useState(initialUrlState.loop);
  const [effectsState, setEffectsState] = useState(initialUrlState.effectsState);
  const [customEffects, setCustomEffects] = useState(initialUrlState.customEffects);
  const [quality, setQuality] = useState(initialUrlState.quality);
  const [catchUp, setCatchUp] = useState(initialUrlState.catchUp);
  const [strokeEasing, setStrokeEasing] = useState(initialUrlState.strokeEasing);
  const [glyphEasing, setGlyphEasing] = useState(initialUrlState.glyphEasing);
  const [deferDots, setDeferDots] = useState(initialUrlState.deferDots);
  const [useShaper, setUseShaper] = useState(initialUrlState.useShaper);
  const [staggerEnabled, setStaggerEnabled] = useState(initialUrlState.staggerEnabled);
  const [staggerAdvance, setStaggerAdvance] = useState(initialUrlState.staggerAdvance);
  const [staggerDuration, setStaggerDuration] = useState(initialUrlState.staggerDuration);

  // Animation state (lifted up so controls live outside the canvas area)
  const [animPlaying, setAnimPlaying] = useState(true);
  const [animTime, setAnimTime] = useState(0);
  const prevAnimResultRef = useRef<PipelineResult | null>(null);

  // Cache of results per character
  const resultsCache = useRef(new Map<string, PipelineResult>());

  // Set of characters the font actually supports (checks all subset fonts)
  const availableChars = useMemo(() => {
    if (!fontInfo) return new Set<string>();
    const fonts = [fontInfo.font, ...(fontInfo.extraFonts ?? [])];
    const available = new Set<string>();
    for (const c of chars) {
      for (const f of fonts) {
        const glyph = f.charToGlyph(c);
        if (glyph && glyph.index !== 0) {
          available.add(c);
          break;
        }
      }
    }
    return available;
  }, [fontInfo, chars]);

  const loadFont = useCallback(async (family: string) => {
    setFontLoading(true);
    setFontError('');
    resultsCache.current.clear();
    try {
      const { primary, extra } = await fetchFontFromCDN(family);
      const info = await parseFont(primary, extra.length > 0 ? extra : undefined);
      setFontInfo(info);
      setFontBuffer(primary);
      setExtraFontBuffers(extra.length > 0 ? extra : undefined);
      setFontFamily(family);
    } catch (e) {
      setFontError((e as Error).message);
      setFontInfo(null);
    } finally {
      setFontLoading(false);
    }
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFontLoading(true);
    setFontError('');
    resultsCache.current.clear();
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const buf = reader.result as ArrayBuffer;
        const info = await parseFont(buf);
        setFontInfo(info);
        setFontBuffer(buf);
        setExtraFontBuffers(undefined);
        setFontFamily(info.family);
      } catch (err) {
        setFontError((err as Error).message);
        setFontInfo(null);
      } finally {
        setFontLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  // Process glyph when selection or options change
  useEffect(() => {
    if (!fontInfo || !selectedChar) {
      setResult(null);
      return;
    }

    const cacheKey = `${selectedChar}:${JSON.stringify(options)}`;
    const cached = resultsCache.current.get(cacheKey);
    if (cached) {
      setResult(cached);
      return;
    }

    setProcessing(true);
    // Use setTimeout to let the UI update before heavy computation
    const id = setTimeout(() => {
      const res = processGlyph(fontInfo, selectedChar, options);
      if (res) {
        resultsCache.current.set(cacheKey, res);
      }
      setResult(res);
      setProcessing(false);
    }, 10);
    return () => clearTimeout(id);
  }, [fontInfo, selectedChar, options]);

  // Process glyph through the geometry pipeline (only when that pipeline is active)
  useEffect(() => {
    if (pipeline !== 'geometry' || previewMode !== 'glyph' || !fontInfo || !selectedChar) {
      setGeoResult(null);
      return;
    }
    const cacheKey = `${selectedChar}:${options.bezierTolerance}:${JSON.stringify(geometryOptions)}`;
    const cached = geoResultsCache.current.get(cacheKey);
    if (cached) {
      setGeoResult(cached);
      return;
    }
    setProcessing(true);
    const id = setTimeout(() => {
      const res = processGlyphGeometry(fontInfo, selectedChar, geometryOptions, options.bezierTolerance);
      if (res) geoResultsCache.current.set(cacheKey, res);
      setGeoResult(res);
      setProcessing(false);
    }, 10);
    return () => clearTimeout(id);
  }, [pipeline, previewMode, fontInfo, selectedChar, geometryOptions, options.bezierTolerance]);

  // The result whose strokes drive the animation controls / loop for the active pipeline.
  const animResult: PipelineResult | GeometryPipelineResult | null = pipeline === 'geometry' ? geoResult : result;

  // Auto-play animation when the active result changes
  if (prevAnimResultRef.current !== animResult) {
    prevAnimResultRef.current = animResult as PipelineResult | null;
    if (animTime !== 0 || !animPlaying) {
      setAnimTime(0);
      setAnimPlaying(true);
    }
  }

  const totalDuration = useMemo(() => {
    const strokes = animResult?.strokesFontUnits;
    if (!strokes || strokes.length === 0) return 0;
    const last = strokes[strokes.length - 1]!;
    return last.delay + last.animationDuration;
  }, [animResult]);

  // Whether the active stage in the active pipeline is an animated one.
  const animStageActive = pipeline === 'geometry' ? geometryStage === 'animation' : activeStage === 'animation' || activeStage === 'final';

  // Animation loop
  useEffect(() => {
    if (!animPlaying || !animStageActive) return;
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
      setAnimTime((prev) => {
        const next = prev + dt;
        if (next >= totalDuration) {
          setAnimPlaying(false);
          return totalDuration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animPlaying, totalDuration, animStageActive]);

  // Sync configurable state to URL (debounced to avoid thrashing during slider drags)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncUrlState({
        fontFamily,
        chars,
        selectedChar,
        activeStage,
        previewMode,
        previewText,
        options,
        animSpeed,
        fontSizePx,
        lineHeightRatio,
        letterSpacingPx,
        showOverlay,
        timeMode,
        currentTime,
        loop,
        effectsState,
        customEffects,
        quality,
        catchUp,
        strokeEasing,
        glyphEasing,
        deferDots,
        useShaper,
        staggerEnabled,
        staggerAdvance,
        staggerDuration,
        pipeline,
        geometryStage,
        geometryOptions,
      });
    }, 300);
    return () => clearTimeout(syncTimerRef.current);
  }, [
    fontFamily,
    chars,
    selectedChar,
    activeStage,
    previewMode,
    previewText,
    options,
    pipeline,
    geometryStage,
    geometryOptions,
    animSpeed,
    fontSizePx,
    lineHeightRatio,
    letterSpacingPx,
    showOverlay,
    timeMode,
    currentTime,
    loop,
    catchUp,
    effectsState,
    customEffects,
    quality,
    strokeEasing,
    glyphEasing,
    deferDots,
    useShaper,
    staggerEnabled,
    staggerAdvance,
    staggerDuration,
  ]);

  // Auto-load font on mount (from URL state or default)
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      loadFont(fontFamily);
    }
  }, [fontFamily, loadFont]);

  const updateOption = useCallback(<K extends keyof PipelineOptions>(key: K, value: PipelineOptions[K]) => {
    resultsCache.current.clear();
    setOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateGeometryOption = useCallback(<K extends keyof GeometryOptions>(key: K, value: GeometryOptions[K]) => {
    setGeometryOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    if (!fontInfo || !fontBuffer) return;
    setDownloading(true);
    try {
      const slug = fontInfo.family.toLowerCase().replace(/\s+/g, '-');
      const bundle = await extractTegakiBundle({
        fontBuffer,
        fontFileName: `${slug}.ttf`,
        chars,
        options,
        extraFontBuffers,
        subset: false,
      });

      const encoder = new TextEncoder();
      const zipFiles: Record<string, Uint8Array> = {};
      for (const file of bundle.files) {
        const content = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
        zipFiles[`${slug}/${file.path}`] = content instanceof Uint8Array ? content : new Uint8Array(content);
      }

      const zip = zipSync(zipFiles);
      const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }, [fontInfo, fontBuffer, extraFontBuffers, chars, options]);

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* Sidebar */}
      <aside className="w-80 min-w-80 border-r border-gray-200 bg-white overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <a href="/tegaki/" className="text-gray-400 hover:text-gray-700 transition-colors" title="Back to docs">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </a>
            <h1 className="text-lg font-semibold">Tegaki studio</h1>
          </div>
          <a
            href="https://github.com/gkurt/tegaki"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-700 transition-colors"
            title="View on GitHub"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </div>

        <div className="p-4 flex flex-col gap-4 flex-1">
          {/* Font loading */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-gray-600 mb-1">Font</legend>
            <div className="flex flex-wrap gap-1">
              {EXAMPLE_FONTS.map((f) => (
                <button
                  type="button"
                  key={f}
                  className={`px-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
                    fontInfo?.family === f ? 'bg-gray-800 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                  onClick={() => {
                    loadFont(f);
                    setPreviewText(EXAMPLE_FONT_TEXTS[f] ?? DEFAULT_EXAMPLE_FONT_TEXT);
                  }}
                  disabled={fontLoading}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="relative flex gap-2">
              <div className="relative flex-1">
                <input
                  ref={fontInputRef}
                  type="text"
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  value={fontInput}
                  onChange={(e) => {
                    setFontInput(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => {
                    fetchFontList();
                    if (fontInput.trim()) setShowSuggestions(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && fontInput.trim()) {
                      setShowSuggestions(false);
                      loadFont(fontInput.trim());
                    }
                    if (e.key === 'Escape') setShowSuggestions(false);
                  }}
                  placeholder="Search Google Fonts..."
                />
                {showSuggestions && filteredFonts.length > 0 && (
                  <div
                    ref={suggestionsRef}
                    className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto"
                  >
                    {filteredFonts.map((f) => (
                      <button
                        type="button"
                        key={f.family}
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 flex items-center justify-between cursor-pointer"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setFontInput(f.family);
                          setShowSuggestions(false);
                          loadFont(f.family);
                        }}
                      >
                        <span>{f.family}</span>
                        <span className="text-xs text-gray-400">{f.category}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="px-3 py-1 bg-gray-800 text-white rounded text-sm hover:bg-gray-700 disabled:opacity-50"
                onClick={() => fontInput.trim() && loadFont(fontInput.trim())}
                disabled={fontLoading || !fontInput.trim()}
              >
                {fontLoading ? '...' : 'Load'}
              </button>
            </div>
            <label className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
              or upload .ttf/.otf:
              <input type="file" accept=".ttf,.otf,.woff" className="hidden" onChange={handleFileUpload} />
            </label>
            {fontError && <p className="text-xs text-red-600">{fontError}</p>}
            {fontInfo && (
              <p className="text-xs text-green-700">
                {fontInfo.family} {fontInfo.style} ({fontInfo.unitsPerEm} UPM, {fontInfo.lineCap} caps)
              </p>
            )}
          </fieldset>

          {/* Characters */}
          <fieldset className="flex flex-col gap-1">
            <div className="flex items-center justify-between mb-1">
              <legend className="text-sm font-medium text-gray-600">Characters</legend>
              {fontInfo && (
                <button
                  type="button"
                  className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                  onClick={() => {
                    setChars(enumerateFontChars(fontInfo.font, fontInfo.extraFonts));
                  }}
                >
                  Select all available
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {CHARSET_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.name}
                  className={`px-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
                    chars === p.chars ? 'bg-gray-800 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                  onClick={() => setChars(p.chars)}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <textarea
              className="px-2 py-1 border border-gray-300 rounded text-sm font-mono h-16 resize-y"
              value={chars}
              onChange={(e) => {
                const seen = new Set<string>();
                const unique: string[] = [];
                for (const { segment } of segmenter.segment(e.target.value)) {
                  if (!seen.has(segment)) {
                    seen.add(segment);
                    unique.push(segment);
                  }
                }
                setChars(unique.join(''));
              }}
            />
          </fieldset>

          {/* Main options */}
          <fieldset className="flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1">
              <legend className="text-sm font-medium text-gray-600">Options</legend>
              {JSON.stringify(options) !== JSON.stringify(DEFAULT_OPTIONS) && (
                <button
                  type="button"
                  className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                  onClick={() => {
                    resultsCache.current.clear();
                    setOptions(DEFAULT_OPTIONS);
                  }}
                >
                  Reset all
                </button>
              )}
            </div>

            <SliderOption
              label="Resolution"
              value={options.resolution}
              defaultValue={DEFAULT_OPTIONS.resolution}
              min={50}
              max={800}
              step={10}
              onChange={(v) => updateOption('resolution', v)}
            />

            <SelectOption
              label="Skeleton method"
              value={options.skeletonMethod}
              defaultValue={DEFAULT_OPTIONS.skeletonMethod}
              options={SKELETON_METHODS}
              onChange={(v) => updateOption('skeletonMethod', v as SkeletonMethod)}
            />

            <SelectOption
              label="Line cap"
              value={options.lineCap}
              defaultValue={DEFAULT_OPTIONS.lineCap}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'round', label: 'Round' },
                { value: 'butt', label: 'Butt' },
                { value: 'square', label: 'Square' },
              ]}
              onChange={(v) => updateOption('lineCap', v as LineCap | 'auto')}
            />

            <SelectOption
              label="Distance transform"
              value={options.dtMethod}
              defaultValue={DEFAULT_OPTIONS.dtMethod}
              options={[
                { value: 'chamfer', label: 'Chamfer' },
                { value: 'euclidean', label: 'Euclidean' },
              ]}
              onChange={(v) => updateOption('dtMethod', v as 'euclidean' | 'chamfer')}
            />

            <FeatureToggles
              detected={detectedFeatures}
              disabled={options.disabledFeatures}
              onChange={(next) => updateOption('disabledFeatures', next)}
            />
          </fieldset>

          {/* Advanced options */}
          <fieldset className="flex flex-col gap-2">
            <button
              type="button"
              className="text-sm font-medium text-gray-600 text-left flex items-center gap-1"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span className="text-xs">{showAdvanced ? '\u25BC' : '\u25B6'}</span>
              Advanced
            </button>

            {showAdvanced && (
              <div className="flex flex-col gap-2 pl-2">
                <SliderOption
                  label="Bezier tolerance"
                  value={options.bezierTolerance}
                  defaultValue={DEFAULT_OPTIONS.bezierTolerance}
                  min={0.1}
                  max={5}
                  step={0.1}
                  onChange={(v) => updateOption('bezierTolerance', v)}
                />
                <SliderOption
                  label="RDP tolerance"
                  value={options.rdpTolerance}
                  defaultValue={DEFAULT_OPTIONS.rdpTolerance}
                  min={0.1}
                  max={10}
                  step={0.1}
                  onChange={(v) => updateOption('rdpTolerance', v)}
                />
                <SliderOption
                  label="Spur length ratio"
                  value={options.spurLengthRatio}
                  defaultValue={DEFAULT_OPTIONS.spurLengthRatio}
                  min={0}
                  max={0.3}
                  step={0.01}
                  onChange={(v) => updateOption('spurLengthRatio', v)}
                />
                <SliderOption
                  label="Merge threshold"
                  value={options.mergeThresholdRatio}
                  defaultValue={DEFAULT_OPTIONS.mergeThresholdRatio}
                  min={0}
                  max={0.3}
                  step={0.01}
                  onChange={(v) => updateOption('mergeThresholdRatio', v)}
                />
                <SliderOption
                  label="Trace lookback"
                  value={options.traceLookback}
                  defaultValue={DEFAULT_OPTIONS.traceLookback}
                  min={1}
                  max={30}
                  step={1}
                  onChange={(v) => updateOption('traceLookback', v)}
                />
                <SliderOption
                  label="Curvature bias"
                  value={options.curvatureBias}
                  defaultValue={DEFAULT_OPTIONS.curvatureBias}
                  min={0}
                  max={2}
                  step={0.1}
                  onChange={(v) => updateOption('curvatureBias', v)}
                />
                <SliderOption
                  label="Junction cleanup iterations"
                  value={options.junctionCleanupIterations}
                  defaultValue={DEFAULT_OPTIONS.junctionCleanupIterations}
                  min={0}
                  max={20}
                  step={1}
                  onChange={(v) => updateOption('junctionCleanupIterations', v)}
                />
                {options.skeletonMethod === 'thin' && (
                  <SliderOption
                    label="Thin max iterations"
                    value={options.thinMaxIterations}
                    defaultValue={DEFAULT_OPTIONS.thinMaxIterations}
                    min={1}
                    max={100}
                    step={1}
                    onChange={(v) => updateOption('thinMaxIterations', v)}
                  />
                )}
                {options.skeletonMethod === 'voronoi' && (
                  <SliderOption
                    label="Voronoi sampling interval"
                    value={options.voronoiSamplingInterval}
                    defaultValue={DEFAULT_OPTIONS.voronoiSamplingInterval}
                    min={1}
                    max={10}
                    step={0.5}
                    onChange={(v) => updateOption('voronoiSamplingInterval', v)}
                  />
                )}
                <SliderOption
                  label="Drawing speed"
                  value={options.drawingSpeed}
                  defaultValue={DEFAULT_OPTIONS.drawingSpeed}
                  min={500}
                  max={10000}
                  step={100}
                  onChange={(v) => updateOption('drawingSpeed', v)}
                />
                <SliderOption
                  label="Stroke pause"
                  value={options.strokePause}
                  defaultValue={DEFAULT_OPTIONS.strokePause}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => updateOption('strokePause', v)}
                />
              </div>
            )}
          </fieldset>

          {/* Geometry pipeline options (glyph inspector, experimental) */}
          {pipeline === 'geometry' && previewMode === 'glyph' && (
            <fieldset className="flex flex-col gap-2 border border-indigo-200 rounded p-2 bg-indigo-50/40">
              <div className="flex items-center justify-between mb-1">
                <legend className="text-sm font-medium text-indigo-700">Geometry options</legend>
                {JSON.stringify(geometryOptions) !== JSON.stringify(DEFAULT_GEOMETRY_OPTIONS) && (
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                    onClick={() => setGeometryOptions(DEFAULT_GEOMETRY_OPTIONS)}
                  >
                    Reset all
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-600">Medial axis</span>
                <div className="flex rounded overflow-hidden border border-gray-300">
                  {(['chain', 'voronoi'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      className={`px-2 py-1 text-xs cursor-pointer ${
                        geometryOptions.medialMethod === method ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
                      }`}
                      onClick={() => updateGeometryOption('medialMethod', method)}
                    >
                      {method === 'chain' ? 'Chain' : 'Voronoi'}
                    </button>
                  ))}
                </div>
              </div>
              <SliderOption
                label="Corner angle (deg)"
                value={geometryOptions.cornerAngleThresholdDeg}
                defaultValue={DEFAULT_GEOMETRY_OPTIONS.cornerAngleThresholdDeg}
                min={10}
                max={90}
                step={1}
                onChange={(v) => updateGeometryOption('cornerAngleThresholdDeg', v)}
              />
              <SliderOption
                label="Corner window (×em)"
                value={geometryOptions.cornerWindowRatio}
                defaultValue={DEFAULT_GEOMETRY_OPTIONS.cornerWindowRatio}
                min={0.005}
                max={0.08}
                step={0.005}
                onChange={(v) => updateGeometryOption('cornerWindowRatio', v)}
              />
              <SliderOption
                label="Cut align tol (deg)"
                value={geometryOptions.cutAlignToleranceDeg}
                defaultValue={DEFAULT_GEOMETRY_OPTIONS.cutAlignToleranceDeg}
                min={10}
                max={80}
                step={1}
                onChange={(v) => updateGeometryOption('cutAlignToleranceDeg', v)}
              />
              <SliderOption
                label="Max cut length (×width)"
                value={geometryOptions.maxCutLengthFactor}
                defaultValue={DEFAULT_GEOMETRY_OPTIONS.maxCutLengthFactor}
                min={1}
                max={6}
                step={0.1}
                onChange={(v) => updateGeometryOption('maxCutLengthFactor', v)}
              />
              <SliderOption
                label="Lobe extent (×cut span)"
                value={geometryOptions.junctionCompactness}
                defaultValue={DEFAULT_GEOMETRY_OPTIONS.junctionCompactness}
                min={0.5}
                max={4}
                step={0.1}
                onChange={(v) => updateGeometryOption('junctionCompactness', v)}
              />
              <SliderOption
                label="Continuation max bend (deg)"
                value={geometryOptions.continuationMaxBendDeg}
                defaultValue={DEFAULT_GEOMETRY_OPTIONS.continuationMaxBendDeg}
                min={20}
                max={120}
                step={5}
                onChange={(v) => updateGeometryOption('continuationMaxBendDeg', v)}
              />
              <SliderOption
                label="Axis spacing (×em)"
                value={geometryOptions.resampleSpacingRatio}
                defaultValue={DEFAULT_GEOMETRY_OPTIONS.resampleSpacingRatio}
                min={0.005}
                max={0.06}
                step={0.005}
                onChange={(v) => updateGeometryOption('resampleSpacingRatio', v)}
              />
            </fieldset>
          )}

          {/* Download */}
          <button
            type="button"
            className="w-full px-3 py-2 bg-gray-800 text-white rounded text-sm hover:bg-gray-700 disabled:opacity-50 cursor-pointer"
            disabled={!fontInfo || !fontBuffer || downloading}
            onClick={handleDownload}
          >
            {downloading ? 'Generating...' : 'Download Bundle (.zip)'}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mode toggle */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white">
          {(['glyph', 'text'] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              className={`px-3 py-1 text-xs rounded cursor-pointer transition-colors ${
                previewMode === mode ? 'bg-gray-800 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
              onClick={() => setPreviewMode(mode)}
            >
              {mode === 'glyph' ? 'Glyph Inspector' : 'Text Preview'}
            </button>
          ))}
          {previewMode === 'glyph' && (
            <div className="ml-auto flex items-center gap-1">
              <span className="text-xs text-gray-400">Pipeline:</span>
              {(['raster', 'geometry'] as const).map((p) => (
                <button
                  type="button"
                  key={p}
                  className={`px-2.5 py-1 text-xs rounded cursor-pointer transition-colors ${
                    pipeline === p ? 'bg-indigo-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                  onClick={() => setPipeline(p)}
                  title={p === 'geometry' ? 'Experimental geometry-based stroke extraction' : 'Rasterize + skeletonize pipeline'}
                >
                  {p === 'raster' ? 'Raster' : 'Geometry'}
                </button>
              ))}
            </div>
          )}
        </div>

        {previewMode === 'glyph' ? (
          <>
            {/* Character grid */}
            <div className="flex flex-wrap gap-0.5 p-3 border-b border-gray-200 bg-white overflow-y-auto max-h-32">
              {[...chars].map((c, i) => (
                <button
                  type="button"
                  key={`${c}-${i}`}
                  className={`w-8 h-8 flex items-center justify-center text-sm font-mono rounded transition-colors ${
                    fontInfo && !availableChars.has(c)
                      ? 'text-gray-300 cursor-not-allowed'
                      : c === selectedChar
                        ? 'bg-gray-800 text-white cursor-pointer'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-800 cursor-pointer'
                  }`}
                  onClick={() => setSelectedChar(c)}
                >
                  {c}
                </button>
              ))}
            </div>

            {/* Stage tabs */}
            <div className="flex gap-1 px-3 py-2 border-b border-gray-200 bg-white overflow-x-auto">
              {pipeline === 'raster'
                ? STAGES.map((s) => (
                    <button
                      type="button"
                      key={s.key}
                      className={`px-2.5 py-1 text-xs rounded whitespace-nowrap cursor-pointer transition-colors ${
                        s.key === activeStage ? 'bg-gray-800 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                      }`}
                      onClick={() => setActiveStage(s.key)}
                    >
                      {s.label}
                    </button>
                  ))
                : GEOMETRY_STAGES.map((s) => (
                    <button
                      type="button"
                      key={s.key}
                      className={`px-2.5 py-1 text-xs rounded whitespace-nowrap cursor-pointer transition-colors ${
                        s.key === geometryStage ? 'bg-indigo-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                      }`}
                      onClick={() => setGeometryStage(s.key)}
                    >
                      {s.label}
                    </button>
                  ))}
            </div>

            {/* Canvas area */}
            <ZoomCanvas contentWidth={700} contentHeight={700} className="flex-1 p-4">
              <div className="flex-1 flex p-4 overflow-auto">
                <div className="m-auto">
                  {processing && <p className="text-gray-500">Processing...</p>}
                  {!processing && !fontInfo && <p className="text-gray-400">Load a font to get started</p>}
                  {pipeline === 'raster' ? (
                    <>
                      {!processing && !result && fontInfo && <p className="text-gray-400">No glyph data for "{selectedChar}"</p>}
                      {!processing && result && <StageRenderer result={result} stage={activeStage} animTime={animTime} />}
                    </>
                  ) : (
                    <>
                      {!processing && !geoResult && fontInfo && <p className="text-gray-400">No glyph data for "{selectedChar}"</p>}
                      {!processing && geoResult && <GeometryStageRenderer result={geoResult} stage={geometryStage} animTime={animTime} />}
                    </>
                  )}
                </div>
              </div>
            </ZoomCanvas>

            {/* Animation controls bar (always rendered with fixed height to prevent layout shift) */}
            <div className={`h-[44px] ${animStageActive && animResult ? '' : 'invisible'}`}>
              {animResult && (
                <AnimationControls
                  totalDuration={totalDuration}
                  time={animTime}
                  setTime={setAnimTime}
                  playing={animPlaying}
                  setPlaying={setAnimPlaying}
                />
              )}
            </div>

            {/* Info bar */}
            {pipeline === 'raster' && result && (
              <div className="px-3 py-1.5 border-t border-gray-200 bg-white text-xs text-gray-500 flex gap-4">
                <span>
                  Char: {result.char} (U+{result.unicode.toString(16).padStart(4, '0').toUpperCase()})
                </span>
                <span>Advance: {result.advanceWidth}</span>
                <span>
                  Bitmap: {result.bitmapWidth}x{result.bitmapHeight}
                </span>
                <span>Polylines: {result.polylines.length}</span>
                <span>Strokes: {result.strokes.length}</span>
                <span>Line cap: {result.lineCap}</span>
              </div>
            )}
            {pipeline === 'geometry' && geoResult && (
              <div className="px-3 py-1.5 border-t border-gray-200 bg-white text-xs text-gray-500 flex gap-4 flex-wrap">
                <span>
                  Char: {geoResult.char} (U+{geoResult.unicode.toString(16).padStart(4, '0').toUpperCase()})
                </span>
                <span>Contours: {geoResult.contours.length}</span>
                <span>Corners: {geoResult.corners.length}</span>
                <span>Cuts: {geoResult.cuts.length}</span>
                <span>
                  Faces: {geoResult.faces.length} ({geoResult.faces.filter((f) => f.kind === 'junction').length}J)
                </span>
                <span>Segments: {geoResult.segments.length}</span>
                <span>Strokes: {geoResult.strokesFontUnits.length}</span>
                {geoResult.warnings.length > 0 && (
                  <span className="text-amber-600" title={geoResult.warnings.join('\n')}>
                    ⚠ {geoResult.warnings.length}
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <TextPreview
            fontInfo={fontInfo}
            fontBuffer={fontBuffer}
            extraFontBuffers={extraFontBuffers}
            options={options}
            text={previewText}
            onTextChange={setPreviewText}
            resultsCache={resultsCache}
            animSpeed={animSpeed}
            onAnimSpeedChange={setAnimSpeed}
            fontSizePx={fontSizePx}
            onFontSizePxChange={setFontSizePx}
            lineHeightRatio={lineHeightRatio}
            onLineHeightRatioChange={setLineHeightRatio}
            letterSpacingPx={letterSpacingPx}
            onLetterSpacingPxChange={setLetterSpacingPx}
            showOverlay={showOverlay}
            onShowOverlayChange={setShowOverlay}
            timeMode={timeMode}
            onTimeModeChange={setTimeMode}
            currentTime={currentTime}
            onCurrentTimeChange={setCurrentTime}
            loop={loop}
            onLoopChange={setLoop}
            catchUp={catchUp}
            onCatchUpChange={setCatchUp}
            effectsState={effectsState}
            onEffectsStateChange={setEffectsState}
            customEffects={customEffects}
            onCustomEffectsChange={setCustomEffects}
            quality={quality}
            onQualityChange={setQuality}
            strokeEasing={strokeEasing}
            onStrokeEasingChange={setStrokeEasing}
            glyphEasing={glyphEasing}
            onGlyphEasingChange={setGlyphEasing}
            deferDots={deferDots}
            onDeferDotsChange={setDeferDots}
            useShaper={useShaper}
            onUseShaperChange={setUseShaper}
            staggerEnabled={staggerEnabled}
            onStaggerEnabledChange={setStaggerEnabled}
            staggerAdvance={staggerAdvance}
            onStaggerAdvanceChange={setStaggerAdvance}
            staggerDuration={staggerDuration}
            onStaggerDurationChange={setStaggerDuration}
          />
        )}
      </main>
    </div>
  );
}

interface FeatureTogglesProps {
  detected: string[];
  disabled: string[];
  onChange: (next: string[]) => void;
}

/**
 * Renders one checkbox per GSUB feature declared by the loaded font.
 * Checked = enabled (absent from `disabled`). Unchecked = in `disabled`.
 * Shows a placeholder when the font exposes no features so the panel still
 * occupies a consistent slot in the options layout.
 */
function FeatureToggles({ detected, disabled, onChange }: FeatureTogglesProps) {
  const toggle = (feature: string, enabled: boolean) => {
    const next = enabled ? disabled.filter((f) => f !== feature) : [...disabled, feature];
    onChange(next);
  };

  if (detected.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-700">Features</span>
        <span className="text-xs text-gray-500 italic">None declared by this font</span>
      </div>
    );
  }

  const allEnabled = disabled.length === 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">Features</span>
        <button
          type="button"
          className="text-xs text-gray-500 hover:text-gray-700 underline"
          onClick={() => onChange(allEnabled ? [...detected] : [])}
        >
          {allEnabled ? 'Disable all' : 'Enable all'}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {detected.map((feature) => (
          <label key={feature} className="flex items-center gap-1 text-xs font-mono text-gray-700 cursor-pointer">
            <input type="checkbox" checked={!disabled.includes(feature)} onChange={(e) => toggle(feature, e.target.checked)} />
            {feature}
          </label>
        ))}
      </div>
    </div>
  );
}
