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
  isHeadlineScriptChar,
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

/** Shared empty variant map, so a bundle without the shaper stays memoized. */
const NO_VARIANTS: Record<string, TegakiGlyphData> = {};

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
  // Blob URLs for every subset buffer (bundle.fontUrl + bundle.extraFontUrls).
  // A URL is revoked only once neither the wanted bundle nor the one still on
  // screen uses it: the renderer keeps drawing the previous bundle until the
  // next is complete, and may still fetch its fonts.
  const fontUrl = useMemo(() => URL.createObjectURL(new Blob([fontBuffer], { type: 'font/ttf' })), [fontBuffer]);
  const extraFontUrls = useMemo(
    () => (extraFontBuffers ?? []).map((buf) => URL.createObjectURL(new Blob([buf], { type: 'font/ttf' }))),
    [extraFontBuffers],
  );

  // Features are detected once at parse time (see `parseFont`) and carried on
  // `fontInfo` — subtract any the user has disabled for this render.
  const enabledFeatures = useMemo<string[]>(
    () => fontInfo.features.filter((f) => !options.disabledFeatures.includes(f)),
    [fontInfo.features, options.disabledFeatures],
  );

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
        const refs =
          geometryOptions.strokeOrder === 'heuristic'
            ? []
            : await collectReferences(char, strokeOrderProviders(geometryOptions.hanLocale)).catch(() => []);
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
  const [variantData, setVariantData] = useState<{ key: string; data: Record<string, TegakiGlyphData> } | null>(null);
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

  // Spaced text is shaped without ligatures or contextual alternates, as the
  // renderer does, so it draws a different set of glyphs.
  const letterSpaced = letterSpacingPx !== 0;
  // Everything the variants depend on: data shaped for other inputs is never
  // put in a bundle (it would draw the previous font's glyph ids).
  const variantWanted = useMemo(
    () =>
      JSON.stringify([
        fontUrl,
        extraFontUrls,
        enabledFeatures,
        fontCacheId(fontInfo),
        options,
        geometry,
        geoKey,
        normalizedText,
        letterSpaced,
      ]),
    [fontUrl, extraFontUrls, enabledFeatures, fontInfo, options, geometry, geoKey, normalizedText, letterSpaced],
  );
  useEffect(() => {
    if (!variantShaper) return;
    let cancelled = false;
    (async () => {
      if (geometry) await prepareGeometry();
      // A shaper that fails to build leaves the bundle without variants (the
      // renderer then shapes nothing either) rather than never ready.
      const shaper = await variantShaper.catch(() => null);
      if (cancelled) return;
      if (!shaper) {
        setVariantData({ key: variantWanted, data: NO_VARIANTS });
        return;
      }
      const optionsKey = `${fontCacheId(fontInfo)}:${JSON.stringify(options)}`;
      const variants: Record<string, TegakiGlyphData> = {};
      for (const { key: variantKey, subsetIdx, gid, char: clusterChar, letter } of collectShapedGlyphs(shaper, normalizedText, {
        letterSpaced,
      })) {
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
        const headline = isHeadlineScriptChar(clusterChar);
        let res: PipelineResult | GeometryPipelineResult | undefined;
        if (geometry) {
          // A glyph drawing one letter takes that letter's stroke-order
          // references, like its char-keyed copy (the renderer draws this one).
          const refs =
            letter === undefined || geometryOptions.strokeOrder === 'heuristic'
              ? []
              : await collectReferences(letter, strokeOrderProviders(geometryOptions.hanLocale)).catch(() => []);
          if (cancelled) return;
          const letterKey = letter === undefined ? '' : `:${letter}:${refs.map((r) => r.source).join('+') || 'noref'}`;
          const cacheKey = `#${subsetIdx}:${gid}:${rtl ? 'r' : 'l'}${headline ? 'h' : ''}${letterKey}:${geoKey}`;
          res = geoCache.get(cacheKey);
          if (!res) {
            const geoRes = processGlyphGeometryById(
              fontInfo,
              gid,
              geometryOptions,
              options.bezierTolerance,
              subsetIdx,
              rtl,
              headline,
              letter === undefined ? undefined : { char: letter, reference: refs },
            );
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
      if (!cancelled) setVariantData({ key: variantWanted, data: variants });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    variantShaper,
    fontInfo,
    normalizedText,
    letterSpaced,
    options,
    activeCache,
    geometry,
    geoKey,
    geometryOptions,
    geoCache,
    prepareGeometry,
    variantWanted,
  ]);

  // The bundle for the current inputs — null until every async part (geometry
  // glyphs, shaped variants) has been built for exactly these inputs, so a
  // bundle never mixes, say, the new font's outline with the old font's strokes.
  const geoCurrent = !geometry || geoGlyphs?.key === geoWanted;
  const variants = !variantShaper ? NO_VARIANTS : variantData?.key === variantWanted ? variantData.data : null;
  const fontBundle = useMemo<TegakiBundle | null>(() => {
    if (!geoCurrent || !variants) return null;
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

    const hasVariants = Object.keys(variants).length > 0;
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
      ...(hasVariants ? { glyphDataById: variants } : {}),
      ...(enabledFeatures.length > 0 ? { features: enabledFeatures } : {}),
    } satisfies TegakiBundle;
  }, [fontInfo, fontUrl, extraFontUrls, normalizedText, options, activeCache, enabledFeatures, variants, geometry, geoGlyphs, geoCurrent]);

  // What the renderer draws: the last complete text + bundle pair. A new pair
  // replaces it once its font faces and shaper are loaded, so switching font,
  // text or settings goes straight from one finished frame to the next — no
  // blank frame, no frame drawn with the old state's glyphs or unshaped.
  const [shown, setShown] = useState<{ text: string; bundle: TegakiBundle } | null>(null);
  useEffect(() => {
    if (!fontBundle) return;
    let cancelled = false;
    TegakiEngine.preload(fontBundle).then(() => {
      if (!cancelled) setShown({ text, bundle: fontBundle });
    });
    return () => {
      cancelled = true;
    };
  }, [fontBundle, text]);

  const liveUrls = useRef(new Set<string>());
  useEffect(() => {
    const keep = new Set([fontUrl, ...extraFontUrls, ...(shown ? [shown.bundle.fontUrl, ...(shown.bundle.extraFontUrls ?? [])] : [])]);
    for (const url of [...liveUrls.current]) {
      if (keep.has(url)) continue;
      URL.revokeObjectURL(url);
      liveUrls.current.delete(url);
    }
    for (const url of keep) liveUrls.current.add(url);
  }, [fontUrl, extraFontUrls, shown]);
  useEffect(
    () => () => {
      for (const url of liveUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  // Latest bundle, captured by ref so the stable `handleTimelineChange`
  // callback can read it without re-subscribing the engine. Without this,
  // every change to `fontBundle` would force the engine option to re-bind.
  const bundleRef = useRef(shown?.bundle);
  bundleRef.current = shown?.bundle;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Drive `onReady` from the engine's first-class onChangeTimeline callback
  // rather than re-running computeTimeline here. The duplicate computation
  // got the unshapped totalDuration: clusters that the harfbuzz shaper
  // collapses to a single half-form glyph (e.g. Devanagari "द्") fell
  // through to the bare consonant's duration, so the host clock stopped
  // before the engine's last stroke had drawn.
  // While the previous pair is still on screen (the next one being built),
  // the preview is not ready: snapshot tooling must wait for the current one.
  const bundleCurrentRef = useRef(true);
  bundleCurrentRef.current = !!shown && shown.bundle === fontBundle && shown.text === text;
  const handleTimelineChange = useCallback((timeline: Timeline) => {
    if (!bundleCurrentRef.current || !bundleRef.current) return;
    onReadyRef.current?.({ bundle: bundleRef.current, totalDuration: timeline.totalDuration });
  }, []);

  if (!shown) return null;

  return (
    <TegakiRenderer
      ref={ref}
      className={className}
      style={{ fontSize: `${fontSizePx}px`, lineHeight: lineHeightRatio, letterSpacing: `${letterSpacingPx}px`, ...style }}
      text={shown.text}
      time={time}
      font={shown.bundle}
      showOverlay={showOverlay}
      effects={effects}
      quality={quality}
      timing={timing}
      shaper={useShaper}
      onChangeTimeline={handleTimelineChange}
    />
  );
});
