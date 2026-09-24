import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BUNDLE_VERSION,
  type TegakiBundle,
  type TegakiEffects,
  TegakiEngine,
  type TegakiGlyphData,
  type TegakiQuality,
  TegakiRenderer,
  type TegakiRendererHandle,
  type TimeControlProp,
  type Timeline,
  type TimelineConfig,
} from 'tegaki';
import harfbuzzShaper from 'tegaki/shaper-harfbuzz';
import {
  collectReferences,
  DEFAULT_GEOMETRY_OPTIONS,
  type GeometryOptions,
  type GeometryPipelineResult,
  initStraightSkeleton,
  isRtlChar,
  type ParsedFontInfo,
  type PipelineOptions,
  type PipelineResult,
  processGlyph,
  processGlyphById,
  processGlyphGeometry,
  processGlyphGeometryById,
  toCompactStroke,
} from 'tegaki-generator';
import type { Pipeline } from './constants.ts';
import { fontCacheId } from './font-cache-id.ts';
import { collectShapedGlyphs } from './shaped-glyphs.ts';
import { strokeOrderProviders } from './stroke-order-providers.ts';

TegakiEngine.registerShaper(harfbuzzShaper);

// Must mirror the set in `packages/renderer/src/shaper-harfbuzz/index.ts` and the
// generator's `hb-shaper.ts`. Explicit enables of these features override
// harfbuzz's contextual positional assignment (and, for the fraction ones,
// turn every digit into a numerator).
const SHAPER_MANAGED_FEATURES = new Set(['init', 'medi', 'fina', 'isol', 'rlig', 'frac', 'numr', 'dnom']);

/** A pipeline result (either pipeline) as the bundle's compact glyph entry. */
function toCompactGlyph(res: PipelineResult | GeometryPipelineResult): TegakiGlyphData {
  const last = res.strokesFontUnits[res.strokesFontUnits.length - 1];
  return {
    w: res.advanceWidth,
    t: last ? Math.round((last.delay + last.animationDuration) * 1000) / 1000 : 0,
    s: res.strokesFontUnits.map(toCompactStroke),
  };
}

/** Let the browser paint between glyphs while a long geometry run is in progress. */
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface TegakiTextPreviewReadyInfo {
  bundle: TegakiBundle;
  totalDuration: number;
}

export interface TegakiTextPreviewProps {
  fontInfo: ParsedFontInfo;
  fontBuffer: ArrayBuffer;
  /** Additional font subset buffers (e.g. for CJK fonts with split subsets). */
  extraFontBuffers?: ArrayBuffer[];
  text: string;
  options: PipelineOptions;
  /**
   * Which stroke-extraction pipeline builds the glyphs. `'geometry'` runs the
   * experimental geometry pipeline with `geometryOptions` (asynchronously —
   * nothing renders until the first bundle is built). Defaults to `'raster'`.
   */
  pipeline?: Pipeline;
  geometryOptions?: GeometryOptions;
  time?: TimeControlProp;
  effects?: TegakiEffects<Record<string, any>>;
  timing?: TimelineConfig;
  quality?: TegakiQuality;
  showOverlay?: boolean;
  fontSizePx?: number;
  lineHeightRatio?: number;
  /** CSS `letter-spacing` in px — inferred by the renderer and applied to glyph positions. */
  letterSpacingPx?: number;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Optional shared cache keyed by `${char}:${fontCacheId}:${JSON.stringify(options)}`. When
   * provided, glyph pipeline results are reused across renders and instances.
   */
  resultsCache?: React.RefObject<Map<string, PipelineResult>>;
  /**
   * Fires once the font has loaded and the glyph bundle is built. Fires again
   * whenever the bundle changes (e.g. text or options change). Useful as a
   * snapshot-ready signal for E2E tests.
   */
  onReady?: (info: TegakiTextPreviewReadyInfo) => void;
  /**
   * Run text through the harfbuzz shaper for ligatures, contextual forms, and
   * RTL. When `false`, skip variant-glyph computation and omit `glyphDataById`
   * from the bundle so the engine falls back to the char-keyed path. Defaults
   * to `true`.
   */
  useShaper?: boolean;
}

export const TegakiTextPreview = forwardRef<TegakiRendererHandle, TegakiTextPreviewProps>(function TegakiTextPreview(
  {
    fontInfo,
    fontBuffer,
    extraFontBuffers,
    text,
    options,
    pipeline = 'raster',
    geometryOptions = DEFAULT_GEOMETRY_OPTIONS,
    time,
    effects,
    timing,
    quality,
    showOverlay,
    fontSizePx = 128,
    lineHeightRatio = 1.5,
    letterSpacingPx = 0,
    className,
    style,
    resultsCache,
    onReady,
    useShaper = true,
  },
  ref,
) {
  const [fontReady, setFontReady] = useState(false);

  // Make blob URLs for every subset buffer so both the renderer (bundle.fontUrl
  // + bundle.extraFontUrls) and our own DOM FontFace registration point at
  // identical URLs — `ensureFont` keys its cache on URL, so collisions there
  // dedupe automatically.
  const fontUrl = useMemo(() => URL.createObjectURL(new Blob([fontBuffer], { type: 'font/ttf' })), [fontBuffer]);
  const extraFontUrls = useMemo(
    () => (extraFontBuffers ?? []).map((buf) => URL.createObjectURL(new Blob([buf], { type: 'font/ttf' }))),
    [extraFontBuffers],
  );

  const prevFontUrl = useRef(fontUrl);
  useEffect(() => {
    const prev = prevFontUrl.current;
    prevFontUrl.current = fontUrl;
    if (prev && prev !== fontUrl) URL.revokeObjectURL(prev);
    return () => {
      if (fontUrl) URL.revokeObjectURL(fontUrl);
    };
  }, [fontUrl]);

  const prevExtraUrls = useRef(extraFontUrls);
  useEffect(() => {
    const prev = prevExtraUrls.current;
    prevExtraUrls.current = extraFontUrls;
    if (prev !== extraFontUrls) {
      for (const url of prev) URL.revokeObjectURL(url);
    }
    return () => {
      for (const url of extraFontUrls) URL.revokeObjectURL(url);
    };
  }, [extraFontUrls]);

  // Features are detected once at parse time (see `parseFont`) and carried on
  // `fontInfo` — subtract any the user has disabled for this render.
  const enabledFeatures = useMemo<string[]>(
    () => fontInfo.features.filter((f) => !options.disabledFeatures.includes(f)),
    [fontInfo.features, options.disabledFeatures],
  );

  useEffect(() => {
    setFontReady(false);
    // Mirror the renderer's `ensureFont`. With the shaper on, shaper-managed
    // Arabic features (init/medi/fina/isol/rlig) are omitted — explicit
    // enables would override the browser's contextual positional assignment
    // and collapse every glyph to one variant. Fonts with no declared
    // features keep the legacy "disable liga/calt" fallback.
    //
    // With the shaper off, the renderer draws nominal char-keyed glyphs, so
    // every variant-producing GSUB feature must be disabled so the FontFace
    // doesn't emit ligatures or contextual forms the renderer can't draw.
    const featureSettings = useShaper
      ? (() => {
          const explicit = enabledFeatures.filter((f) => !SHAPER_MANAGED_FEATURES.has(f));
          if (enabledFeatures.length === 0) return "'calt' 0, 'liga' 0";
          if (explicit.length === 0) return 'normal';
          return explicit.map((f) => `'${f}' 1`).join(', ');
        })()
      : "'liga' 0, 'calt' 0, 'clig' 0, 'rlig' 0, 'dlig' 0, 'init' 0, 'medi' 0, 'fina' 0, 'isol' 0";
    const faces = [fontUrl, ...extraFontUrls].map((url) => new FontFace(fontInfo.family, `url(${url})`, { featureSettings }));
    let cancelled = false;
    Promise.all(faces.map((f) => f.load())).then((loaded) => {
      if (cancelled) return;
      for (const f of loaded) document.fonts.add(f);
      setFontReady(true);
    });
    return () => {
      cancelled = true;
      for (const f of faces) document.fonts.delete(f);
    };
  }, [fontInfo, fontUrl, extraFontUrls, enabledFeatures, useShaper]);

  const internalCacheRef = useRef<Map<string, PipelineResult>>(new Map());
  const activeCache = resultsCache?.current ?? internalCacheRef.current;

  // NFC normalize once. The engine NFC-normalizes its own `text` prop, so the
  // bundle we build here must use the same form for both `glyphData` keys
  // (single-codepoint) and the shaped text (variant collection) — otherwise
  // the engine would look up NFC keys against an NFD-keyed bundle and miss.
  const normalizedText = useMemo(() => text.normalize('NFC'), [text]);

  // ── Geometry pipeline ────────────────────────────────────────────────
  // Unlike the raster pipeline it may need async work first (stroke-order
  // references for 'auto'/'dataset' ordering, the straight-skeleton wasm),
  // so its char-keyed glyphs are built in an effect. `geoKey` covers every
  // input besides the glyph itself, the font included (see fontCacheId).
  const geometry = pipeline === 'geometry';
  const geoCache = useMemo(() => new Map<string, GeometryPipelineResult>(), []);
  const geoKey = useMemo(
    () => JSON.stringify([fontCacheId(fontInfo), geometryOptions, options.bezierTolerance]),
    [fontInfo, geometryOptions, options.bezierTolerance],
  );
  const geoWanted = `${geoKey}:${normalizedText}`;
  const [geoGlyphs, setGeoGlyphs] = useState<{ key: string; data: TegakiBundle['glyphData'] } | null>(null);
  const prepareGeometry = useCallback(async () => {
    if (geometryOptions.extraction === 'partition' && geometryOptions.medialMethod === 'straight-skeleton') {
      await initStraightSkeleton();
    }
  }, [geometryOptions]);

  useEffect(() => {
    if (!geometry) return;
    let cancelled = false;
    (async () => {
      await prepareGeometry();
      const data: TegakiBundle['glyphData'] = {};
      const seen = new Set<string>();
      for (const char of normalizedText) {
        if (seen.has(char) || char === ' ' || char === '\n') continue;
        seen.add(char);
        const refs = geometryOptions.strokeOrder === 'heuristic' ? [] : await collectReferences(char, strokeOrderProviders).catch(() => []);
        if (cancelled) return;
        const cacheKey = `${char}:${geoKey}:${refs.map((r) => r.source).join('+') || 'noref'}`;
        let res = geoCache.get(cacheKey);
        if (!res) {
          await yieldToBrowser();
          if (cancelled) return;
          res = processGlyphGeometry(fontInfo, char, geometryOptions, options.bezierTolerance, refs) ?? undefined;
          if (res) geoCache.set(cacheKey, res);
        }
        if (res) data[char] = toCompactGlyph(res);
      }
      if (!cancelled) setGeoGlyphs({ key: `${geoKey}:${normalizedText}`, data });
    })();
    return () => {
      cancelled = true;
    };
  }, [geometry, fontInfo, normalizedText, geoKey, geometryOptions, options.bezierTolerance, geoCache, prepareGeometry]);

  // Variant glyphs the renderer's shaper produces for the current text, keyed
  // the way the renderer looks them up: bare `"<gid>"` for primary-subset
  // glyphs, `"<subsetIdx>:<gid>"` for extras. Populated asynchronously because
  // harfbuzz needs wasm. Nominal glyphs still go through the char-keyed
  // `glyphData` path below.
  //
  // The renderer's own shaper, not a re-implementation: it shapes each word
  // in isolation (as the browser does for the clip mask), so a line shaped
  // whole picks different contextual alternates. Caveat's calt cycles three
  // forms of d; every glyph missing from glyphDataById falls back to the base
  // letter's strokes, drawn under the alternate's clip mask.
  const [variantData, setVariantData] = useState<Record<string, TegakiGlyphData>>({});
  const variantShaper = useMemo(
    () =>
      useShaper
        ? harfbuzzShaper({
            fontUrl,
            ...(extraFontUrls.length > 0 ? { extraFontUrls } : {}),
            features: enabledFeatures,
            glyphDataById: {},
          } as unknown as TegakiBundle)
        : null,
    [useShaper, fontUrl, extraFontUrls, enabledFeatures],
  );

  useEffect(() => {
    if (!variantShaper) {
      setVariantData((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    let cancelled = false;
    (async () => {
      if (geometry) await prepareGeometry();
      const shaper = await variantShaper;
      if (cancelled || !shaper) return;
      const optionsKey = `${fontCacheId(fontInfo)}:${JSON.stringify(options)}`;
      const variants: Record<string, TegakiGlyphData> = {};
      for (const { key: variantKey, subsetIdx, gid, char: clusterChar } of collectShapedGlyphs(shaper, normalizedText)) {
        // Process every glyph the shaper emits, including nominal forms
        // (where gid === font.charToGlyph(clusterChar).index). For Latin
        // clusters the nominal glyph is also reachable via glyphData[char],
        // but for multi-codepoint clusters (Devanagari "हि", "स्ते", etc.)
        // entry.char is the whole grapheme so the char-keyed fallback
        // can't find a nominal glyph that landed on a codepoint past
        // index 0. Storing the variant unconditionally makes
        // glyphDataById self-contained for every shaped glyph and
        // removes the renderer's reliance on the codepoint-fallback
        // path.
        const rtl = isRtlChar(clusterChar);
        let res: PipelineResult | GeometryPipelineResult | undefined;
        if (geometry) {
          const cacheKey = `#${subsetIdx}:${gid}:${rtl ? 'r' : 'l'}:${geoKey}`;
          res = geoCache.get(cacheKey);
          if (!res) {
            const geoRes = processGlyphGeometryById(fontInfo, gid, geometryOptions, options.bezierTolerance, subsetIdx, rtl);
            if (geoRes) geoCache.set(cacheKey, geoRes);
            res = geoRes ?? undefined;
          }
        } else {
          const cacheKey = `#${subsetIdx}:${gid}:${rtl ? 'r' : 'l'}:${optionsKey}`;
          res = activeCache.get(cacheKey);
          if (!res) {
            const rasterRes = processGlyphById(fontInfo, gid, options, subsetIdx, rtl);
            if (rasterRes) activeCache.set(cacheKey, rasterRes);
            res = rasterRes ?? undefined;
          }
        }
        if (!res) continue;
        variants[variantKey] = toCompactGlyph(res);
      }
      if (!cancelled) setVariantData(variants);
    })();
    return () => {
      cancelled = true;
    };
  }, [variantShaper, fontInfo, normalizedText, options, activeCache, geometry, geoKey, geometryOptions, geoCache, prepareGeometry]);

  const fontBundle = useMemo<TegakiBundle>(() => {
    const glyphData: TegakiBundle['glyphData'] = {};
    const optionsKey = `${fontCacheId(fontInfo)}:${JSON.stringify(options)}`;

    const seen = new Set<string>();
    if (geometry) Object.assign(glyphData, geoGlyphs?.data);
    else {
      for (const char of normalizedText) {
        if (seen.has(char) || char === ' ' || char === '\n') continue;
        seen.add(char);

        const cacheKey = `${char}:${optionsKey}`;
        let res = activeCache.get(cacheKey);
        if (!res) {
          res = processGlyph(fontInfo, char, options) ?? undefined;
          if (res) activeCache.set(cacheKey, res);
        }
        if (!res) continue;
        glyphData[char] = toCompactGlyph(res);
      }
    }

    const hasVariants = Object.keys(variantData).length > 0;
    return {
      version: BUNDLE_VERSION,
      family: fontInfo.family,
      lineCap: options.lineCap === 'auto' ? fontInfo.lineCap : options.lineCap,
      fontUrl,
      fontFaceCSS: `@font-face { font-family: '${fontInfo.family}'; src: url(${fontUrl}); }`,
      unitsPerEm: fontInfo.unitsPerEm,
      ascender: fontInfo.ascender,
      descender: fontInfo.descender,
      glyphData,
      ...(extraFontUrls.length > 0 ? { extraFontUrls } : {}),
      ...(hasVariants ? { glyphDataById: variantData } : {}),
      ...(enabledFeatures.length > 0 ? { features: enabledFeatures } : {}),
    } satisfies TegakiBundle;
  }, [fontInfo, fontUrl, extraFontUrls, normalizedText, options, activeCache, enabledFeatures, variantData, geometry, geoGlyphs]);

  // Latest bundle, captured by ref so the stable `handleTimelineChange`
  // callback can read it without re-subscribing the engine. Without this,
  // every change to `fontBundle` would force the engine option to re-bind.
  const bundleRef = useRef(fontBundle);
  bundleRef.current = fontBundle;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Drive `onReady` from the engine's first-class onChangeTimeline callback
  // rather than re-running computeTimeline here. The duplicate computation
  // got the unshapped totalDuration: clusters that the harfbuzz shaper
  // collapses to a single half-form glyph (e.g. Devanagari "द्") fell
  // through to the bare consonant's duration, so the host clock stopped
  // before the engine's last stroke had drawn.
  // A geometry bundle still being rebuilt (stale glyphs shown meanwhile) is
  // not ready: snapshot tooling must wait for the current one.
  const bundleCurrentRef = useRef(true);
  bundleCurrentRef.current = !geometry || geoGlyphs?.key === geoWanted;
  const handleTimelineChange = useCallback((timeline: Timeline) => {
    if (!bundleCurrentRef.current) return;
    onReadyRef.current?.({ bundle: bundleRef.current, totalDuration: timeline.totalDuration });
  }, []);

  if (!fontReady) return null;
  if (geometry && !geoGlyphs) return null;

  return (
    <TegakiRenderer
      ref={ref}
      className={className}
      style={{ fontSize: `${fontSizePx}px`, lineHeight: lineHeightRatio, letterSpacing: `${letterSpacingPx}px`, ...style }}
      text={text}
      time={time}
      font={fontBundle}
      showOverlay={showOverlay}
      effects={effects}
      quality={quality}
      timing={timing}
      shaper={useShaper}
      onChangeTimeline={handleTimelineChange}
    />
  );
});
