import type { Font } from 'opentype.js';
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
  createHbShaper,
  isRtlChar,
  type ParsedFontInfo,
  type PipelineOptions,
  type PipelineResult,
  processGlyph,
  processGlyphById,
} from 'tegaki-generator';

TegakiEngine.registerShaper(harfbuzzShaper);

// Must mirror the set in `packages/renderer/src/shaper-harfbuzz/index.ts` and the
// generator's `hb-shaper.ts`. Explicit enables of these features override
// harfbuzz's contextual positional assignment.
const SHAPER_MANAGED_FEATURES = new Set(['init', 'medi', 'fina', 'isol', 'rlig']);

// Mirrors `toCompactStroke` in `packages/generator/src/commands/generate.ts`
// so browser-generated bundles preserve the `r` priority field (dots etc.).
type CompactStroke = TegakiGlyphData['s'][number];
function toCompactStroke(s: PipelineResult['strokesFontUnits'][number]): CompactStroke {
  const out: CompactStroke = {
    p: s.points.map((p) => [p.x, p.y, p.width] as [number, number, number]),
    d: s.delay,
    a: s.animationDuration,
  };
  if (s.priority && s.priority < 0) out.r = s.priority;
  return out;
}

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
  time?: TimeControlProp;
  effects?: TegakiEffects<Record<string, any>>;
  timing?: TimelineConfig;
  quality?: TegakiQuality;
  showOverlay?: boolean;
  fontSizePx?: number;
  lineHeightRatio?: number;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Optional shared cache keyed by `${char}:${JSON.stringify(options)}`. When
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
    time,
    effects,
    timing,
    quality,
    showOverlay,
    fontSizePx = 128,
    lineHeightRatio = 1.5,
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

  // Variant glyphs the shapers produce for the current text, keyed the same
  // way the renderer looks them up: bare `"<gid>"` for primary-subset glyphs,
  // `"<subsetIdx>:<gid>"` for extras. Populated asynchronously because
  // harfbuzz needs wasm. Nominal glyphs still go through the char-keyed
  // `glyphData` path below.
  const [variantData, setVariantData] = useState<Record<string, TegakiGlyphData>>({});

  useEffect(() => {
    if (!useShaper) {
      setVariantData((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    let cancelled = false;
    (async () => {
      const buffers = [fontBuffer, ...(extraFontBuffers ?? [])];
      const fonts = [fontInfo.font, ...(fontInfo.extraFonts ?? [])];
      const shapers = await Promise.all(buffers.map((buf) => createHbShaper(buf, enabledFeatures)));
      try {
        const optionsKey = JSON.stringify(options);
        const variants: Record<string, TegakiGlyphData> = {};
        const seen = new Set<string>();
        for (const line of normalizedText.split('\n')) {
          // Split each line into per-subset runs so shaping never crosses a
          // subset boundary — same routing rule the renderer's `BundleShaper`
          // uses. For each cluster char, pick the first subset whose cmap
          // covers it; unmapped chars fall back to the primary shaper so we
          // don't drop them.
          const runs = splitByCoverage(line, fonts);
          for (const { subsetIdx, start, end } of runs) {
            const shaper = shapers[subsetIdx]!;
            const runText = line.slice(start, end);
            for (const g of shaper.shape(runText)) {
              if (g.g === 0) continue;
              const keyPrefix = subsetIdx === 0 ? '' : `${subsetIdx}:`;
              const variantKey = `${keyPrefix}${g.g}`;
              if (seen.has(variantKey)) continue;
              seen.add(variantKey);
              const clusterChar = runText[g.cl];
              if (!clusterChar) continue;
              // Process every glyph the shaper emits, including nominal forms
              // (where g.g === font.charToGlyph(clusterChar).index). For Latin
              // clusters the nominal glyph is also reachable via glyphData[char],
              // but for multi-codepoint clusters (Devanagari "हि", "स्ते", etc.)
              // entry.char is the whole grapheme so the char-keyed fallback
              // can't find a nominal glyph that landed on a codepoint past
              // index 0. Storing the variant unconditionally makes
              // glyphDataById self-contained for every shaped glyph and
              // removes the renderer's reliance on the codepoint-fallback
              // path.
              const rtl = isRtlChar(clusterChar);
              const cacheKey = `#${subsetIdx}:${g.g}:${rtl ? 'r' : 'l'}:${optionsKey}`;
              let res = activeCache.get(cacheKey);
              if (!res) {
                res = processGlyphById(fontInfo, g.g, options, subsetIdx, rtl) ?? undefined;
                if (res) activeCache.set(cacheKey, res);
              }
              if (!res) continue;
              const last = res.strokesFontUnits[res.strokesFontUnits.length - 1];
              variants[variantKey] = {
                w: res.advanceWidth,
                t: last ? Math.round((last.delay + last.animationDuration) * 1000) / 1000 : 0,
                s: res.strokesFontUnits.map(toCompactStroke),
              };
            }
          }
        }
        if (!cancelled) setVariantData(variants);
      } finally {
        for (const s of shapers) s.destroy();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fontBuffer, extraFontBuffers, fontInfo, normalizedText, options, enabledFeatures, activeCache, useShaper]);

  const fontBundle = useMemo<TegakiBundle>(() => {
    const glyphData: TegakiBundle['glyphData'] = {};
    const optionsKey = JSON.stringify(options);

    const seen = new Set<string>();
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

      const last = res.strokesFontUnits[res.strokesFontUnits.length - 1];
      glyphData[char] = {
        w: res.advanceWidth,
        t: last ? Math.round((last.delay + last.animationDuration) * 1000) / 1000 : 0,
        s: res.strokesFontUnits.map(toCompactStroke),
      };
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
  }, [fontInfo, fontUrl, extraFontUrls, normalizedText, options, activeCache, enabledFeatures, variantData]);

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
  const handleTimelineChange = useCallback((timeline: Timeline) => {
    onReadyRef.current?.({ bundle: bundleRef.current, totalDuration: timeline.totalDuration });
  }, []);

  if (!fontReady) return null;

  return (
    <TegakiRenderer
      ref={ref}
      className={className}
      style={{ fontSize: `${fontSizePx}px`, lineHeight: lineHeightRatio, ...style }}
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

interface SubsetRun {
  subsetIdx: number;
  /** UTF-16 start offset into the line. */
  start: number;
  /** UTF-16 end offset into the line. */
  end: number;
}

/**
 * Group consecutive characters that resolve to the same subset into runs.
 * Primary-first coverage check (so shared glyphs like digits stick with the
 * Latin primary) matches the renderer's `BundleShaper` routing.
 */
function splitByCoverage(line: string, fonts: Font[]): SubsetRun[] {
  const runs: SubsetRun[] = [];
  let runStart = 0;
  let runSubset = -1;
  const pick = (cp: number): number => {
    for (let i = 0; i < fonts.length; i++) {
      const g = fonts[i]!.charToGlyph(String.fromCodePoint(cp));
      if (g && g.index !== 0) return i;
    }
    return 0;
  };
  const flush = (end: number) => {
    if (end > runStart) runs.push({ subsetIdx: runSubset < 0 ? 0 : runSubset, start: runStart, end });
  };
  for (let i = 0; i < line.length; ) {
    const cp = line.codePointAt(i) ?? line.charCodeAt(i);
    const step = cp > 0xffff ? 2 : 1;
    const subset = pick(cp);
    if (subset !== runSubset) {
      flush(i);
      runStart = i;
      runSubset = subset;
    }
    i += step;
  }
  flush(line.length);
  return runs;
}
