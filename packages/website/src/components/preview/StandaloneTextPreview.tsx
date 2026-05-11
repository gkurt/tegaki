import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TegakiBundle, TegakiRendererHandle, TimeControlProp, TimelineConfig } from 'tegaki';
import { type ParsedFontInfo, parseFont } from 'tegaki-generator';
import { parseUrlState } from '../url-state.ts';
import { getEasingFn } from './constants.ts';
import { fetchFontFromCDN } from './font-cdn.ts';
import { TegakiTextPreview } from './TegakiTextPreview.tsx';
import { buildEffects, parseStaggerInputs } from './utils.ts';

/**
 * Read `w`/`h` URL params (in px). Falls back to `null` so the container stretches
 * to fill its parent — useful when testing CSS layout behaviour rather than a fixed box.
 */
function parseSize(): { width: number | null; height: number | null } {
  if (typeof window === 'undefined') return { width: null, height: null };
  const p = new URLSearchParams(window.location.search);
  const parse = (raw: string | null) => {
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return { width: parse(p.get('w')), height: parse(p.get('h')) };
}

declare global {
  interface Window {
    /**
     * Populated by the standalone preview once the font has loaded and the glyph
     * bundle is built. E2E tests wait for this to become truthy before snapshotting.
     */
    __tegakiPreviewReady?: { bundle: TegakiBundle; totalDuration: number };
  }
}

/**
 * Minimal text-only preview driven entirely by URL params. No controls, no layout
 * chrome — just a sized container with the rendered text. Used for E2E snapshot
 * tests (in particular, text-wrapping behaviour at various widths).
 */
export function StandaloneTextPreview() {
  const [state] = useState(parseUrlState);
  const [size] = useState(parseSize);
  const [fontInfo, setFontInfo] = useState<ParsedFontInfo | null>(null);
  const [fontBuffer, setFontBuffer] = useState<ArrayBuffer | null>(null);
  const [extraFontBuffers, setExtraFontBuffers] = useState<ArrayBuffer[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { primary, extra } = await fetchFontFromCDN(state.fontFamily);
        if (cancelled) return;
        const info = await parseFont(primary, extra.length > 0 ? extra : undefined);
        setFontInfo(info);
        setFontBuffer(primary);
        setExtraFontBuffers(extra.length > 0 ? extra : undefined);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.fontFamily]);

  const effects = useMemo(() => buildEffects(state.effectsState, state.customEffects), [state.effectsState, state.customEffects]);

  const timingConfig = useMemo<TimelineConfig | undefined>(() => {
    const strokeFn = getEasingFn(state.strokeEasing);
    const glyphFn = getEasingFn(state.glyphEasing);
    const staggerConfig = state.staggerEnabled ? parseStaggerInputs(state.staggerAdvance, state.staggerDuration) : undefined;
    if (strokeFn === undefined && glyphFn === undefined && state.deferDots && !staggerConfig) return undefined;
    return {
      ...(strokeFn !== undefined ? { strokeEasing: strokeFn } : {}),
      ...(glyphFn !== undefined ? { glyphEasing: glyphFn } : {}),
      ...(state.deferDots ? {} : { deferDots: false }),
      ...(staggerConfig ? { stagger: staggerConfig } : {}),
    };
  }, [state.strokeEasing, state.glyphEasing, state.deferDots, state.staggerEnabled, state.staggerAdvance, state.staggerDuration]);

  const timeProp: TimeControlProp =
    state.timeMode === 'controlled'
      ? state.currentTime
      : state.timeMode === 'uncontrolled'
        ? { mode: 'uncontrolled' as const, speed: state.animSpeed, loop: state.loop, catchUp: state.catchUp || undefined }
        : 'css';

  const rendererRef = useRef<TegakiRendererHandle>(null);

  const handleReady = useCallback((info: { bundle: TegakiBundle; totalDuration: number }) => {
    window.__tegakiPreviewReady = info;
    // Expose the live engine for browser-harness / devtools inspection.
    // Same affordance as the generator's TextPreview — keeps ad-hoc debugging
    // available when running against the chrome-free /preview URL.
    (window as Window & { __tegakiEngine?: unknown }).__tegakiEngine = rendererRef.current?.engine ?? null;
    document.body.setAttribute('data-tegaki-ready', 'true');
  }, []);

  const containerStyle: React.CSSProperties = {
    width: size.width ?? '100%',
    height: size.height ?? '100%',
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  if (error) {
    return (
      <div data-tegaki-error style={containerStyle}>
        Failed to load font: {error}
      </div>
    );
  }

  if (!fontInfo || !fontBuffer) {
    return <div data-tegaki-loading style={containerStyle} />;
  }

  return (
    <div data-tegaki-container style={containerStyle}>
      <TegakiTextPreview
        ref={rendererRef}
        style={{ width: '100%', height: '100%' }}
        fontInfo={fontInfo}
        fontBuffer={fontBuffer}
        extraFontBuffers={extraFontBuffers}
        text={state.previewText}
        options={state.options}
        time={timeProp}
        effects={effects}
        timing={timingConfig}
        quality={state.quality}
        showOverlay={state.showOverlay}
        fontSizePx={state.fontSizePx}
        lineHeightRatio={state.lineHeightRatio}
        onReady={handleReady}
      />
    </div>
  );
}
