import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TegakiBundle, TegakiRendererHandle, TimeControlProp } from 'tegaki';
import type { ParsedFontInfo, PipelineOptions, PipelineResult } from 'tegaki-generator';
import { type CustomEffect, DEFAULT_EFFECTS_STATE, EFFECT_DEFAULTS, type EffectsState, type TimeMode } from '../url-state.ts';
import { EASING_PRESETS, getEasingFn, TEXT_PRESETS } from './constants.ts';
import { CustomEffectControls, EffectColor, EffectSlider, GradientColorStops } from './effect-controls.tsx';
import { TegakiTextPreview } from './TegakiTextPreview.tsx';
import { buildEffects } from './utils.ts';

export function TextPreview({
  fontInfo,
  fontBuffer,
  extraFontBuffers,
  options,
  text,
  onTextChange,
  resultsCache,
  animSpeed,
  onAnimSpeedChange,
  fontSizePx,
  onFontSizePxChange,
  lineHeightRatio,
  onLineHeightRatioChange,
  showOverlay,
  onShowOverlayChange,
  timeMode,
  onTimeModeChange: setTimeMode,
  currentTime,
  onCurrentTimeChange,
  loop,
  onLoopChange: setLoop,
  catchUp,
  onCatchUpChange,
  effectsState,
  onEffectsStateChange,
  customEffects,
  onCustomEffectsChange,
  quality,
  onQualityChange,
  strokeEasing,
  onStrokeEasingChange,
  glyphEasing,
  onGlyphEasingChange,
  deferDots,
  onDeferDotsChange,
  useShaper,
  onUseShaperChange,
}: {
  fontInfo: ParsedFontInfo | null;
  fontBuffer: ArrayBuffer | null;
  extraFontBuffers: ArrayBuffer[] | undefined;
  options: PipelineOptions;
  text: string;
  onTextChange: (text: string) => void;
  resultsCache: React.RefObject<Map<string, PipelineResult>>;
  animSpeed: number;
  onAnimSpeedChange: (v: number) => void;
  fontSizePx: number;
  onFontSizePxChange: (v: number) => void;
  lineHeightRatio: number;
  onLineHeightRatioChange: (v: number) => void;
  showOverlay: boolean;
  onShowOverlayChange: (v: boolean) => void;
  timeMode: TimeMode;
  onTimeModeChange: (v: TimeMode) => void;
  currentTime: number;
  onCurrentTimeChange: (v: number) => void;
  loop: boolean;
  onLoopChange: (v: boolean) => void;
  catchUp: number;
  onCatchUpChange: (v: number) => void;
  effectsState: EffectsState;
  onEffectsStateChange: (v: EffectsState) => void;
  customEffects: CustomEffect[];
  onCustomEffectsChange: (v: CustomEffect[]) => void;
  quality: { pixelRatio: number; segmentSize: number; clipText: boolean | number; smoothing: boolean };
  onQualityChange: (v: { pixelRatio: number; segmentSize: number; clipText: boolean | number; smoothing: boolean }) => void;
  strokeEasing: string;
  onStrokeEasingChange: (v: string) => void;
  glyphEasing: string;
  onGlyphEasingChange: (v: string) => void;
  deferDots: boolean;
  onDeferDotsChange: (v: boolean) => void;
  useShaper: boolean;
  onUseShaperChange: (v: boolean) => void;
}) {
  // Initial time/paused state come from the URL (controlled mode only): a non-zero
  // `ct` param loads the timeline paused at that position so agents can inspect a
  // specific frame by editing the URL.
  const [playing, setPlaying] = useState(() => currentTime === 0);
  const [displayTime, setDisplayTime] = useState(() => currentTime);
  const timeRef = useRef(currentTime);
  const [bundleReady, setBundleReady] = useState(false);
  const [totalDuration, setTotalDuration] = useState(0);
  const [showEffectsDrawer, setShowEffectsDrawer] = useState(false);
  const [copied, setCopied] = useState(false);
  const rendererRef = useRef<TegakiRendererHandle>(null);
  const updateEffect = useCallback(
    (updater: (prev: EffectsState) => EffectsState) => onEffectsStateChange(updater(effectsState)),
    [effectsState, onEffectsStateChange],
  );

  const addCustomEffect = useCallback(
    (effect: CustomEffect['effect']) => {
      // Find next available key: glow1, glow2, etc.
      const existing = customEffects.filter((e) => e.effect === effect);
      let n = existing.length + 1;
      while (customEffects.some((e) => e.key === `${effect}${n}`)) n++;
      onCustomEffectsChange([...customEffects, { key: `${effect}${n}`, effect, enabled: true, config: { ...EFFECT_DEFAULTS[effect] } }]);
    },
    [customEffects, onCustomEffectsChange],
  );

  const removeCustomEffect = useCallback(
    (key: string) => onCustomEffectsChange(customEffects.filter((e) => e.key !== key)),
    [customEffects, onCustomEffectsChange],
  );

  const updateCustomEffect = useCallback(
    (key: string, update: Partial<CustomEffect>) =>
      onCustomEffectsChange(customEffects.map((e) => (e.key === key ? { ...e, ...update } : e))),
    [customEffects, onCustomEffectsChange],
  );

  const effects = useMemo(() => buildEffects(effectsState, customEffects), [effectsState, customEffects]);

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

  const handleReady = useCallback((info: { bundle: TegakiBundle; totalDuration: number }) => {
    setBundleReady(true);
    setTotalDuration(info.totalDuration);
  }, []);

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
    if (!playing) onCurrentTimeChange(displayTime);
  }, [playing, displayTime, onCurrentTimeChange]);

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

  // Compute time prop for TegakiRenderer
  const timeProp: TimeControlProp =
    timeMode === 'controlled'
      ? displayTime
      : timeMode === 'uncontrolled'
        ? { mode: 'uncontrolled' as const, speed: animSpeed, loop, catchUp: catchUp || undefined }
        : 'css';

  const timingConfig = useMemo(() => {
    const strokeFn = getEasingFn(strokeEasing);
    const glyphFn = getEasingFn(glyphEasing);
    if (strokeFn === undefined && glyphFn === undefined && deferDots) return undefined;
    return {
      ...(strokeFn !== undefined ? { strokeEasing: strokeFn } : {}),
      ...(glyphFn !== undefined ? { glyphEasing: glyphFn } : {}),
      ...(deferDots ? {} : { deferDots: false }),
    };
  }, [strokeEasing, glyphEasing, deferDots]);

  const activeEffectCount = effects ? Object.keys(effects).length : 0;

  const handleCopyEffects = useCallback(() => {
    const json = effects ? JSON.stringify(effects, null, 2) : '{}';
    navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [effects]);

  return (
    <div className="flex-1 flex flex-col">
      {/* Text input */}
      <div className="p-3 border-b border-gray-200 bg-white flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1">
          {TEXT_PRESETS.map((p) => (
            <button
              type="button"
              key={p.name}
              className={`px-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
                text === p.text ? 'bg-gray-800 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
              onClick={() => onTextChange(p.text)}
              title={p.text}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex items-start gap-2">
          <textarea
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm resize-y"
            rows={2}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="Type text to preview..."
          />
          <button
            type="button"
            onClick={() => {
              const href = window.location.href.replace('/generator', '/preview');
              window.open(href, '_blank', 'noopener,noreferrer');
            }}
            title="Open this text in the standalone /preview page (new tab)"
            className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 3h6v6" />
              <path d="M10 14L21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content area: preview + optional effects drawer */}
      <div className="flex-1 flex min-h-0">
        {/* Rendered text — CSS mode needs timeline-scope on a common ancestor */}
        <div
          className="flex-1 flex flex-col min-h-0 min-w-0"
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

          <div className="flex-1 flex items-start justify-start p-8 overflow-auto">
            {!fontInfo && <p className="text-gray-400">Load a font to get started</p>}
            {fontInfo && !bundleReady && <p className="text-gray-500">Loading font...</p>}
            {fontInfo && fontBuffer && (
              <TegakiTextPreview
                ref={rendererRef}
                className="w-full max-w-2xl"
                style={
                  timeMode === 'css'
                    ? ({
                        animation: 'tegaki-scroll-progress linear both',
                        animationTimeline: '--tegaki-scroll',
                      } as React.CSSProperties)
                    : undefined
                }
                fontInfo={fontInfo}
                fontBuffer={fontBuffer}
                extraFontBuffers={extraFontBuffers}
                text={text}
                options={options}
                time={timeProp}
                effects={effects}
                timing={timingConfig}
                quality={quality}
                showOverlay={showOverlay}
                fontSizePx={fontSizePx}
                lineHeightRatio={lineHeightRatio}
                resultsCache={resultsCache}
                onReady={handleReady}
                useShaper={useShaper}
              />
            )}
          </div>

          {/* CSS mode: horizontal scroll bar */}
          {timeMode === 'css' && (
            <div
              className="border-t border-gray-200 bg-white"
              style={
                {
                  overflowX: 'scroll',
                  scrollTimeline: '--tegaki-scroll inline',
                } as React.CSSProperties
              }
            >
              <div style={{ width: '300%', height: 1 }} />
            </div>
          )}
        </div>

        {/* Effects drawer (right side) */}
        {showEffectsDrawer && (
          <aside className="w-64 min-w-64 border-l border-gray-200 bg-white overflow-y-auto flex flex-col">
            <div className="p-3 border-b border-gray-200 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Effects</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={`px-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
                    copied ? 'bg-green-100 text-green-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                  }`}
                  onClick={handleCopyEffects}
                  title="Copy effects as React JSX prop"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                {activeEffectCount > 0 && (
                  <button
                    type="button"
                    className="px-2 py-0.5 text-xs rounded cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-600"
                    onClick={() => {
                      onEffectsStateChange(DEFAULT_EFFECTS_STATE);
                      onCustomEffectsChange([]);
                    }}
                    title="Reset all effects"
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-600 cursor-pointer px-1"
                  onClick={() => setShowEffectsDrawer(false)}
                  title="Close"
                >
                  {'\u2715'}
                </button>
              </div>
            </div>

            <div className="p-3 flex flex-col gap-4">
              {/* Glow */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={effectsState.glow.enabled}
                      onChange={(e) => updateEffect((s) => ({ ...s, glow: { ...s.glow, enabled: e.target.checked } }))}
                    />
                    Glow
                  </label>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-600 text-xs cursor-pointer px-1"
                    onClick={() => addCustomEffect('glow')}
                    title="Add another glow"
                  >
                    +
                  </button>
                </div>
                {effectsState.glow.enabled && (
                  <div className="flex flex-col gap-1.5 pl-5">
                    <EffectSlider
                      label="Radius"
                      value={effectsState.glow.radius as number}
                      min={1}
                      max={30}
                      step={1}
                      onChange={(v) => updateEffect((s) => ({ ...s, glow: { ...s.glow, radius: v } }))}
                    />
                    <EffectColor
                      label="Color"
                      value={effectsState.glow.color}
                      onChange={(v) => updateEffect((s) => ({ ...s, glow: { ...s.glow, color: v } }))}
                    />
                    <EffectSlider
                      label="Offset X"
                      value={effectsState.glow.offsetX}
                      min={-20}
                      max={20}
                      step={1}
                      onChange={(v) => updateEffect((s) => ({ ...s, glow: { ...s.glow, offsetX: v } }))}
                    />
                    <EffectSlider
                      label="Offset Y"
                      value={effectsState.glow.offsetY}
                      min={-20}
                      max={20}
                      step={1}
                      onChange={(v) => updateEffect((s) => ({ ...s, glow: { ...s.glow, offsetY: v } }))}
                    />
                  </div>
                )}
                {customEffects
                  .filter((e) => e.effect === 'glow')
                  .map((ce) => (
                    <CustomEffectControls key={ce.key} entry={ce} onUpdate={updateCustomEffect} onRemove={removeCustomEffect}>
                      <EffectSlider
                        label="Radius"
                        value={ce.config.radius as number}
                        min={1}
                        max={30}
                        step={1}
                        onChange={(v) => updateCustomEffect(ce.key, { config: { ...ce.config, radius: v } })}
                      />
                      <EffectColor
                        label="Color"
                        value={(ce.config.color as string) ?? '#00ccff'}
                        onChange={(v) => updateCustomEffect(ce.key, { config: { ...ce.config, color: v } })}
                      />
                      <EffectSlider
                        label="Offset X"
                        value={(ce.config.offsetX as number) ?? 0}
                        min={-20}
                        max={20}
                        step={1}
                        onChange={(v) => updateCustomEffect(ce.key, { config: { ...ce.config, offsetX: v } })}
                      />
                      <EffectSlider
                        label="Offset Y"
                        value={(ce.config.offsetY as number) ?? 0}
                        min={-20}
                        max={20}
                        step={1}
                        onChange={(v) => updateCustomEffect(ce.key, { config: { ...ce.config, offsetY: v } })}
                      />
                    </CustomEffectControls>
                  ))}
              </div>

              {/* Wobble */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={effectsState.wobble.enabled}
                    onChange={(e) => updateEffect((s) => ({ ...s, wobble: { ...s.wobble, enabled: e.target.checked } }))}
                  />
                  Wobble
                </label>
                {effectsState.wobble.enabled && (
                  <div className="flex flex-col gap-1.5 pl-5">
                    <label className="flex items-center justify-between text-[11px] text-gray-500">
                      Mode
                      <select
                        className="px-1 py-0.5 border border-gray-300 rounded text-[11px] bg-white"
                        value={effectsState.wobble.mode}
                        onChange={(e) => updateEffect((s) => ({ ...s, wobble: { ...s.wobble, mode: e.target.value as 'sine' | 'noise' } }))}
                      >
                        <option value="sine">Sine</option>
                        <option value="noise">Noise</option>
                      </select>
                    </label>
                    <EffectSlider
                      label="Amplitude"
                      value={effectsState.wobble.amplitude}
                      min={0.5}
                      max={10}
                      step={0.5}
                      onChange={(v) => updateEffect((s) => ({ ...s, wobble: { ...s.wobble, amplitude: v } }))}
                    />
                    <EffectSlider
                      label="Frequency"
                      value={effectsState.wobble.frequency}
                      min={1}
                      max={20}
                      step={1}
                      onChange={(v) => updateEffect((s) => ({ ...s, wobble: { ...s.wobble, frequency: v } }))}
                    />
                  </div>
                )}
              </div>

              {/* Pressure Width */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={effectsState.pressureWidth.enabled}
                    onChange={(e) => updateEffect((s) => ({ ...s, pressureWidth: { ...s.pressureWidth, enabled: e.target.checked } }))}
                  />
                  Pressure Width
                </label>
                {effectsState.pressureWidth.enabled && (
                  <div className="flex flex-col gap-1.5 pl-5">
                    <EffectSlider
                      label="Strength"
                      value={effectsState.pressureWidth.strength}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => updateEffect((s) => ({ ...s, pressureWidth: { ...s.pressureWidth, strength: v } }))}
                    />
                  </div>
                )}
              </div>

              {/* Taper */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={effectsState.taper.enabled}
                    onChange={(e) => updateEffect((s) => ({ ...s, taper: { ...s.taper, enabled: e.target.checked } }))}
                  />
                  Taper
                </label>
                {effectsState.taper.enabled && (
                  <div className="flex flex-col gap-1.5 pl-5">
                    <EffectSlider
                      label="Start"
                      value={effectsState.taper.startLength}
                      min={0}
                      max={0.5}
                      step={0.05}
                      onChange={(v) => updateEffect((s) => ({ ...s, taper: { ...s.taper, startLength: v } }))}
                    />
                    <EffectSlider
                      label="End"
                      value={effectsState.taper.endLength}
                      min={0}
                      max={0.5}
                      step={0.05}
                      onChange={(v) => updateEffect((s) => ({ ...s, taper: { ...s.taper, endLength: v } }))}
                    />
                  </div>
                )}
              </div>

              {/* Gradient */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={effectsState.strokeGradient.enabled}
                    onChange={(e) => updateEffect((s) => ({ ...s, strokeGradient: { ...s.strokeGradient, enabled: e.target.checked } }))}
                  />
                  Stroke Gradient
                </label>
                {effectsState.strokeGradient.enabled && (
                  <div className="flex flex-col gap-1.5 pl-5">
                    <label className="flex items-center justify-between text-[11px] text-gray-500">
                      Preset
                      <select
                        className="px-1 py-0.5 border border-gray-300 rounded text-[11px] bg-white"
                        value={effectsState.strokeGradient.colors === 'rainbow' ? 'rainbow' : 'custom'}
                        onChange={(e) =>
                          updateEffect((s) => ({
                            ...s,
                            strokeGradient: {
                              ...s.strokeGradient,
                              colors: e.target.value === 'rainbow' ? 'rainbow' : ['#ff0000', '#00ff00', '#0000ff'],
                            },
                          }))
                        }
                      >
                        <option value="rainbow">Rainbow</option>
                        <option value="custom">Custom</option>
                      </select>
                    </label>
                    {effectsState.strokeGradient.colors === 'rainbow' ? (
                      <>
                        <EffectSlider
                          label="Saturation"
                          value={effectsState.strokeGradient.saturation}
                          min={0}
                          max={100}
                          step={5}
                          suffix="%"
                          onChange={(v) => updateEffect((s) => ({ ...s, strokeGradient: { ...s.strokeGradient, saturation: v } }))}
                        />
                        <EffectSlider
                          label="Lightness"
                          value={effectsState.strokeGradient.lightness}
                          min={10}
                          max={90}
                          step={5}
                          suffix="%"
                          onChange={(v) => updateEffect((s) => ({ ...s, strokeGradient: { ...s.strokeGradient, lightness: v } }))}
                        />
                      </>
                    ) : (
                      <GradientColorStops
                        colors={
                          Array.isArray(effectsState.strokeGradient.colors) ? effectsState.strokeGradient.colors : ['#ff0000', '#0000ff']
                        }
                        onChange={(colors) => updateEffect((s) => ({ ...s, strokeGradient: { ...s.strokeGradient, colors } }))}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Global Gradient */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={effectsState.globalGradient.enabled}
                    onChange={(e) => updateEffect((s) => ({ ...s, globalGradient: { ...s.globalGradient, enabled: e.target.checked } }))}
                  />
                  Global gradient
                </label>
                {effectsState.globalGradient.enabled && (
                  <div className="flex flex-col gap-1.5 pl-5">
                    <GradientColorStops
                      colors={effectsState.globalGradient.colors}
                      onChange={(colors) => updateEffect((s) => ({ ...s, globalGradient: { ...s.globalGradient, colors } }))}
                    />
                    <EffectSlider
                      label="Angle"
                      value={effectsState.globalGradient.angle}
                      min={0}
                      max={360}
                      step={5}
                      suffix="°"
                      onChange={(v) => updateEffect((s) => ({ ...s, globalGradient: { ...s.globalGradient, angle: v } }))}
                    />
                  </div>
                )}
              </div>

              {/* Quality: segment size + pixel ratio + clip text */}
              <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
                <label className="flex items-center justify-between text-xs text-gray-600">
                  Segment size
                  <span className="flex items-center gap-1">
                    <input
                      type="range"
                      className="w-24"
                      min={0.5}
                      max={10}
                      step={0.5}
                      value={quality.segmentSize}
                      onChange={(e) => onQualityChange({ ...quality, segmentSize: Number(e.target.value) })}
                    />
                    <span className="tabular-nums w-7 text-right text-gray-400">{quality.segmentSize}px</span>
                  </span>
                </label>
                <label className="flex items-center justify-between text-xs text-gray-600">
                  Pixel ratio
                  <span className="flex items-center gap-1">
                    <input
                      type="range"
                      className="w-24"
                      min={0.5}
                      max={4}
                      step={0.25}
                      value={quality.pixelRatio}
                      onChange={(e) => onQualityChange({ ...quality, pixelRatio: Number(e.target.value) })}
                    />
                    <span className="tabular-nums w-7 text-right text-gray-400">{quality.pixelRatio}x</span>
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={!!quality.clipText}
                    onChange={(e) => onQualityChange({ ...quality, clipText: e.target.checked ? 2 : false })}
                  />
                  Clip to text
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={quality.smoothing}
                    onChange={(e) => onQualityChange({ ...quality, smoothing: e.target.checked })}
                  />
                  Smoothing (Catmull-Rom)
                </label>
                {!!quality.clipText && (
                  <label className="flex items-center justify-between text-xs text-gray-600 pl-4">
                    Stroke scale
                    <span className="flex items-center gap-1">
                      <input
                        type="range"
                        className="w-24"
                        min={1}
                        max={5}
                        step={0.05}
                        value={typeof quality.clipText === 'number' ? quality.clipText : 1}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          onQualityChange({ ...quality, clipText: v === 1 ? true : v });
                        }}
                      />
                      <span className="tabular-nums w-7 text-right text-gray-400">
                        {typeof quality.clipText === 'number' ? quality.clipText : 1}x
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Controls */}
      <div className="border-t border-gray-200 bg-white px-3 py-1.5 flex flex-col gap-1.5">
        {/* Row 1: time mode + mode-specific controls */}
        <div className="flex items-center gap-3">
          {/* Time mode selector */}
          <div className="flex gap-0.5">
            {(['controlled', 'uncontrolled', 'css'] as const).map((m) => (
              <button
                type="button"
                key={m}
                className={`px-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
                  timeMode === m ? 'bg-gray-800 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
                onClick={() => setTimeMode(m)}
              >
                {m === 'controlled' ? 'Controlled' : m === 'uncontrolled' ? 'Uncontrolled' : 'CSS'}
              </button>
            ))}
          </div>

          <span className="border-l border-gray-200 h-6" />

          {/* Controlled mode controls */}
          {timeMode === 'controlled' && (
            <>
              <button
                type="button"
                className="px-3 py-1 border border-gray-300 rounded text-sm cursor-pointer hover:bg-gray-100"
                onClick={() => {
                  if (timeRef.current >= totalDuration) {
                    timeRef.current = 0;
                    setDisplayTime(0);
                  }
                  setPlaying(!playing);
                }}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                className="px-3 py-1 border border-gray-300 rounded text-sm cursor-pointer hover:bg-gray-100"
                onClick={() => {
                  timeRef.current = 0;
                  setDisplayTime(0);
                  setPlaying(false);
                }}
              >
                Reset
              </button>
              <span className="text-xs tabular-nums text-gray-500 w-24">
                {displayTime.toFixed(2)}s / {totalDuration.toFixed(2)}s
              </span>
              <input
                type="range"
                className="flex-1 max-w-64"
                min={0}
                max={totalDuration}
                step={0.0001}
                value={displayTime}
                onChange={(e) => {
                  const t = Number(e.target.value);
                  timeRef.current = t;
                  setDisplayTime(t);
                  setPlaying(false);
                }}
              />

              <span className="border-l border-gray-200 h-6" />

              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                Speed
                <input
                  type="range"
                  className="w-20"
                  min={0.1}
                  max={5}
                  step={0.1}
                  value={animSpeed}
                  onChange={(e) => onAnimSpeedChange(Number(e.target.value))}
                />
                <span className="tabular-nums text-gray-400 w-8">{animSpeed}x</span>
              </label>
            </>
          )}

          {/* Uncontrolled mode controls */}
          {timeMode === 'uncontrolled' && (
            <>
              <button
                type="button"
                className="px-3 py-1 border border-gray-300 rounded text-sm cursor-pointer hover:bg-gray-100"
                onClick={() => rendererRef.current?.engine?.restart()}
              >
                Restart
              </button>

              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                Speed
                <input
                  type="range"
                  className="w-20"
                  min={0.1}
                  max={5}
                  step={0.1}
                  value={animSpeed}
                  onChange={(e) => onAnimSpeedChange(Number(e.target.value))}
                />
                <span className="tabular-nums text-gray-400 w-8">{animSpeed}x</span>
              </label>

              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                Loop
              </label>

              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                Catch-up
                <input
                  type="range"
                  className="w-20"
                  min={0}
                  max={2}
                  step={0.1}
                  value={catchUp}
                  onChange={(e) => onCatchUpChange(Number(e.target.value))}
                />
                <span className="tabular-nums text-gray-400 w-8">{catchUp}</span>
              </label>
            </>
          )}

          {/* CSS mode: hint */}
          {timeMode === 'css' && <span className="text-xs text-gray-500">Scroll the bar above to control animation progress</span>}
        </div>

        {/* Row 2: display settings */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            Size
            <input
              type="range"
              className="w-20"
              min={16}
              max={256}
              step={1}
              value={fontSizePx}
              onChange={(e) => onFontSizePxChange(Number(e.target.value))}
            />
            <span className="tabular-nums text-gray-400 w-10">{fontSizePx}px</span>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            Line height
            <input
              type="range"
              className="w-20"
              min={0}
              max={3}
              step={0.1}
              value={lineHeightRatio}
              onChange={(e) => onLineHeightRatioChange(Number(e.target.value))}
            />
            <span className="tabular-nums text-gray-400 w-8">{lineHeightRatio}</span>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={showOverlay} onChange={(e) => onShowOverlayChange(e.target.checked)} />
            Overlay
          </label>

          <label
            className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer"
            title="Draw i-dots, nuqṭa, and other disconnected marks after every body stroke in the word"
          >
            <input type="checkbox" checked={deferDots} onChange={(e) => onDeferDotsChange(e.target.checked)} />
            Defer dots
          </label>

          <label
            className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer"
            title="Run text through the harfbuzz shaper for ligatures, contextual forms, and RTL. Off uses the simpler char-keyed glyph path."
          >
            <input type="checkbox" checked={useShaper} onChange={(e) => onUseShaperChange(e.target.checked)} />
            Shaper
          </label>

          <span className="border-l border-gray-200 h-6" />

          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            Stroke easing
            <select
              className="px-1 py-0.5 border border-gray-300 rounded text-xs bg-white"
              value={strokeEasing}
              onChange={(e) => onStrokeEasingChange(e.target.value)}
            >
              {EASING_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key === 'default' ? 'Default (Ease Out Quad)' : p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            Glyph easing
            <select
              className="px-1 py-0.5 border border-gray-300 rounded text-xs bg-white"
              value={glyphEasing}
              onChange={(e) => onGlyphEasingChange(e.target.value)}
            >
              {EASING_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key === 'default' ? 'Default (Linear)' : p.label}
                </option>
              ))}
            </select>
          </label>

          <span className="border-l border-gray-200 h-6" />

          <button
            type="button"
            className={`px-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
              showEffectsDrawer ? 'bg-gray-800 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
            onClick={() => setShowEffectsDrawer(!showEffectsDrawer)}
          >
            Effects{activeEffectCount > 0 ? ` (${activeEffectCount})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
