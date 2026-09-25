import { type CSSProperties, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CHARSET_PRESETS,
  collectReferences,
  enumerateFontChars,
  type GeometryPipelineResult,
  initStraightSkeleton,
  isHeadlineScriptChar,
  isRtlChar,
  type PipelineResult,
  processGlyph,
  processGlyphById,
  processGlyphGeometry,
  processGlyphGeometryById,
  type ReferenceGlyph,
} from 'tegaki-generator';
import { GEOMETRY_STAGES, type Pipeline, STAGES } from '../preview/constants.ts';
import { fontCacheId } from '../preview/font-cache-id.ts';
import { GeometryStageRenderer, geometryStageFrame, rasterStageFrame, type StageFrame, StageRenderer } from '../preview/stage-views.tsx';
import { strokeOrderProviders } from '../preview/stroke-order-providers.ts';
import { TegakiTextPreview } from '../preview/TegakiTextPreview.tsx';
import { buildEffects, buildTimingConfig } from '../preview/utils.ts';
import type { UrlState } from '../url-state.ts';
import type { CharsetInfo } from './charsets.ts';
import {
  exampleRange,
  FormStrip,
  formKey,
  formStatus,
  shapedAdvanceEm,
  useCharForms,
  useFormCounts,
  useGsubGraphs,
} from './GlyphForms.tsx';
import { CheckIcon, ChevronDownIcon, CloseIcon, WarningIcon } from './icons.tsx';
import { playbackShortcut, useShortcuts } from './shortcuts.ts';
import type { LoadedFont, SetSetting } from './state.ts';
import { Transport } from './Transport.tsx';
import { cx, GlyphKey, IconButton, Popover, Spinner } from './ui.tsx';
import { ZoomStage } from './ZoomStage.tsx';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const NO_WARNINGS: string[] = [];
const NO_REFS: ReferenceGlyph[] = [];

/** Font size of the Final stage's live render — ZoomStage scales it to fit anyway. */
const FINAL_FONT_SIZE = 320;

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
  charsets,
  settings,
  set,
  resultsCache,
  onGlyphReport,
}: {
  font: LoadedFont | null;
  charsets: CharsetInfo | null;
  settings: UrlState;
  set: SetSetting;
  resultsCache: RefObject<Map<string, PipelineResult>>;
  /** The inspected glyph and its warnings, for the agent prompt (null once unmounted). */
  onGlyphReport?: (report: { char: string; form?: string; warnings: string[] } | null) => void;
}) {
  const fontInfo = font?.info ?? null;
  const { pipeline, selectedChar, selectedForm, options, geometryOptions, activeStage, geometryStage } = settings;
  const glyphFamily = useFontFaceFamily(font);

  // Pipeline results tagged with the inputs they were computed from (`key`).
  // Only a result whose key matches the current inputs is current; the last
  // one stays on screen, dimmed, until the next is ready — never passed off
  // as the current glyph's.
  const [rasterRun, setRasterRun] = useState<{ key: string; result: PipelineResult | null } | null>(null);
  const [geoRun, setGeoRun] = useState<{ key: string; result: GeometryPipelineResult | null; error: string } | null>(null);
  const geoResultsCache = useRef(new Map<string, GeometryPipelineResult>());
  // Stroke-order reference variants, tagged with the char + locale they were
  // fetched for: [] = no dataset has an entry (or fetches failed). Fetched
  // BEFORE the pipeline runs so the (synchronous) pipeline can register +
  // match them.
  const [refs, setRefs] = useState<{ key: string; glyphs: ReferenceGlyph[] } | null>(null);

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

  const selectChar = useCallback(
    (c: string) => {
      set('selectedChar', c);
      set('selectedForm', null);
    },
    [set],
  );

  // A new charset or font can leave the selection behind — move it to the first drawable glyph.
  useEffect(() => {
    if (!fontInfo || availableChars.has(selectedChar)) return;
    const first = chars.find((c) => availableChars.has(c));
    if (first) selectChar(first);
  }, [fontInfo, chars, availableChars, selectedChar, selectChar]);

  // The selected character's forms (alternates, ligatures…) and a text that draws each.
  const gsubGraphs = useGsubGraphs(fontInfo);
  const {
    subset: formSubset,
    forms,
    examples,
    shaper: formShaper,
  } = useCharForms(font, gsubGraphs, selectedChar, chars, settings.previewText, options.disabledFeatures);
  const formCounts = useFormCounts(fontInfo, gsubGraphs, chars);
  // The inspected form — null for the character's default glyph, or a `gv` that isn't one of its forms.
  const form = forms.find((f) => formKey(formSubset, f.gid) === selectedForm && f.kind !== 'default') ?? null;
  const formGid = form?.gid ?? 0;
  useEffect(() => {
    if (fontInfo && gsubGraphs.length && selectedForm !== null && !form) set('selectedForm', null);
  }, [fontInfo, gsubGraphs, selectedForm, form, set]);
  const formExample = form ? examples?.get(form.gid) : undefined;

  // Raster pipeline
  const rasterKey =
    pipeline === 'raster' && fontInfo && selectedChar
      ? formGid
        ? `#${formSubset}:${formGid}:${isRtlChar(selectedChar) ? 'r' : 'l'}:${fontCacheId(fontInfo)}:${JSON.stringify(options)}`
        : `${selectedChar}:${fontCacheId(fontInfo)}:${JSON.stringify(options)}`
      : '';
  useEffect(() => {
    if (!rasterKey || !fontInfo) return;
    const cached = resultsCache.current.get(rasterKey);
    if (cached) {
      setRasterRun({ key: rasterKey, result: cached });
      return;
    }
    // Let the UI paint the spinner before the heavy computation.
    const id = setTimeout(() => {
      const res = formGid
        ? processGlyphById(fontInfo, formGid, options, formSubset, isRtlChar(selectedChar))
        : processGlyph(fontInfo, selectedChar, options);
      if (res) resultsCache.current.set(rasterKey, res);
      setRasterRun({ key: rasterKey, result: res });
    }, 10);
    return () => clearTimeout(id);
  }, [rasterKey, fontInfo, selectedChar, formGid, formSubset, options, resultsCache]);

  // Fetch the stroke-order reference variants for the selected char (memoized
  // per character by each provider). Failures (offline, rate limit) degrade to
  // "no reference" and the pipeline falls back to heuristic ordering. An
  // alternate draws the same letter and takes its references; a ligature or a
  // part draws no one letter and has none.
  const hanLocale = geometryOptions.hanLocale;
  const refChar = form ? (form.kind === 'alternate' ? (form.text ?? '') : '') : selectedChar;
  const refsKey = pipeline === 'geometry' && refChar ? `${refChar}:${hanLocale}` : '';
  useEffect(() => {
    if (!refsKey) return;
    let cancelled = false;
    collectReferences(refChar, strokeOrderProviders(hanLocale))
      .then((glyphs) => !cancelled && setRefs({ key: refsKey, glyphs }))
      .catch(() => !cancelled && setRefs({ key: refsKey, glyphs: [] }));
    return () => {
      cancelled = true;
    };
  }, [refsKey, refChar, hanLocale]);
  const refGlyphs = !refChar ? NO_REFS : refs?.key === refsKey ? refs.glyphs : undefined;

  // Geometry pipeline — waits for the current char's references, so a single
  // pipeline run sees them (and never runs with the previous char's).
  const geoKey =
    pipeline === 'geometry' && fontInfo && selectedChar && refGlyphs
      ? `${fontCacheId(fontInfo)}:${selectedChar}:${formSubset}:${formGid}:${options.bezierTolerance}:${JSON.stringify(geometryOptions)}:${refGlyphs.map((r) => r.source).join('+') || 'noref'}`
      : '';
  useEffect(() => {
    if (!geoKey || !fontInfo || !refGlyphs) return;
    const cached = geoResultsCache.current.get(geoKey);
    if (cached) {
      setGeoRun({ key: geoKey, result: cached, error: '' });
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        // The straight-skeleton method needs its wasm module loaded once before
        // the (synchronous) pipeline can use it.
        if (geometryOptions.medialMethod === 'straight-skeleton') await initStraightSkeleton();
        if (cancelled) return;
        const res = formGid
          ? processGlyphGeometryById(
              fontInfo,
              formGid,
              geometryOptions,
              options.bezierTolerance,
              formSubset,
              isRtlChar(selectedChar),
              isHeadlineScriptChar(selectedChar),
              refChar ? { char: refChar, reference: refGlyphs } : undefined,
            )
          : processGlyphGeometry(fontInfo, selectedChar, geometryOptions, options.bezierTolerance, refGlyphs);
        if (res) geoResultsCache.current.set(geoKey, res);
        setGeoRun({ key: geoKey, result: res, error: '' });
      } catch (e) {
        if (cancelled) return;
        setGeoRun({ key: geoKey, result: null, error: (e as Error).message });
      }
    }, 10);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [geoKey, fontInfo, selectedChar, formGid, formSubset, refChar, geometryOptions, options.bezierTolerance, refGlyphs]);

  // The last result of the active pipeline (possibly for other inputs), and
  // whether the one for the current inputs is still being computed.
  const result = pipeline === 'raster' ? (rasterRun?.result ?? null) : null;
  const geoResult = pipeline === 'geometry' ? (geoRun?.result ?? null) : null;
  const processing =
    !!fontInfo && !!selectedChar && (pipeline === 'raster' ? rasterRun?.key !== rasterKey : !geoKey || geoRun?.key !== geoKey);
  const stageError = pipeline === 'geometry' && !processing ? (geoRun?.error ?? '') : '';

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

  const strokeDuration = useMemo(() => {
    const last = animResult?.strokesFontUnits.at(-1);
    return last ? last.delay + last.animationDuration : 0;
  }, [animResult]);

  // The Final stage is the real renderer drawing the glyph, so its timeline
  // (with the Motion easings and stagger) comes from the renderer itself.
  const stageValue = pipeline === 'raster' ? activeStage : geometryStage;
  const finalActive = stageValue === 'final';
  const [renderedDuration, setRenderedDuration] = useState(0);
  const totalDuration = finalActive && renderedDuration > 0 ? renderedDuration : strokeDuration;

  const animStageActive = stageValue === 'animation' || finalActive;

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

  const seekAnim = (t: number) => {
    setAnimTime(t);
    setAnimPlaying(false);
  };

  // Keyboard: the playback keys on the animated stages, ←/→ through the glyph list, [/] through the stages.
  useShortcuts((key, e) => {
    if (animStageActive && animResult && playbackShortcut(key, e, { time: animTime, duration: totalDuration, playPause, seek: seekAnim })) {
      return true;
    }
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const pickable = chars.filter((c) => !fontInfo || availableChars.has(c));
      const next = pickable[pickable.indexOf(selectedChar) + (key === 'ArrowRight' ? 1 : -1)];
      if (!next) return false;
      selectChar(next);
      return true;
    }
    if (key === '[' || key === ']') {
      const list = pipeline === 'raster' ? STAGES : GEOMETRY_STAGES;
      const next = list[list.findIndex((st) => st.key === stageValue) + (key === ']' ? 1 : -1)];
      if (!next) return false;
      if (pipeline === 'raster') set('activeStage', next.key as UrlState['activeStage']);
      else set('geometryStage', next.key as UrlState['geometryStage']);
      return true;
    }
    return false;
  });

  const stages = pipeline === 'raster' ? STAGES : GEOMETRY_STAGES;
  // Geometry-pipeline warnings for the selected glyph; the panel stays open while browsing glyphs.
  const warnings = pipeline === 'geometry' && geoResult && !processing ? geoResult.warnings : NO_WARNINGS;
  const [showWarnings, setShowWarnings] = useState(false);

  const formName = form?.name;
  useEffect(() => {
    onGlyphReport?.(selectedChar ? { char: selectedChar, ...(formName ? { form: formName } : {}), warnings } : null);
  }, [onGlyphReport, selectedChar, formName, warnings]);
  useEffect(() => () => onGlyphReport?.(null), [onGlyphReport]);
  const activeResult = pipeline === 'raster' ? result : geoResult;

  // The Final stage draws a form in its example text, outlined; the default glyph alone.
  // The Animation stage's artboard, which Final draws a lone glyph into so the two line up.
  const stageFrame = useMemo(() => {
    const frame = geoResult ? geometryStageFrame(geoResult) : result ? rasterStageFrame(result) : null;
    return frame && { char: (geoResult ?? result)!.char, frame };
  }, [geoResult, result]);
  const finalText = form ? (formExample?.text ?? null) : selectedChar;
  const finalHighlight = useMemo(() => (form && formExample ? exampleRange(form, formExample) : null), [form, formExample]);
  const finalAdvance = useMemo(() => {
    if (!fontInfo || finalText === null) return 1;
    if (form && formShaper) return shapedAdvanceEm(formShaper, finalText, fontInfo.unitsPerEm);
    const fonts = [fontInfo.font, ...(fontInfo.extraFonts ?? [])];
    const glyph = fonts.map((f) => f.charToGlyph(finalText)).find((g) => (g?.index ?? 0) !== 0);
    return (glyph?.advanceWidth ?? fontInfo.unitsPerEm) / fontInfo.unitsPerEm;
  }, [fontInfo, finalText, form, formShaper]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
      <GlyphList
        header={
          <CharsetPicker
            value={settings.chars}
            charsets={charsets}
            font={font}
            count={fontInfo ? chars.filter((c) => availableChars.has(c)).length : chars.length}
            total={chars.length}
            onChange={(c) => set('chars', c)}
          />
        }
        chars={chars}
        selected={selectedChar}
        available={fontInfo ? availableChars : null}
        family={glyphFamily}
        formCounts={formCounts}
        onSelect={selectChar}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center border-b border-zinc-200 bg-white pl-2 dark:border-zinc-800 dark:bg-zinc-900">
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

        {fontInfo && forms.length > 1 && (
          <FormStrip
            fontInfo={fontInfo}
            subset={formSubset}
            forms={forms}
            examples={examples}
            selected={form?.gid ?? null}
            disabledFeatures={options.disabledFeatures}
            onSelect={(gid) => set('selectedForm', gid === null ? null : formKey(formSubset, gid))}
          />
        )}

        <ZoomStage
          // Refit when what's drawn changes — the glyph on screen, not the selection.
          contentKey={`${activeResult?.char ?? ''}:${pipeline}:${stageValue}:${activeResult ? 1 : 0}:${finalActive ? finalText : ''}`}
          overlay={
            finalActive && form && examples && !formExample && !processing ? (
              <StageNote>{formStatus(form, formExample, options.disabledFeatures)}</StageNote>
            ) : (
              <StageStatus
                processing={processing}
                error={pipeline === 'geometry' ? stageError : ''}
                fontLoaded={!!fontInfo}
                hasResult={!!activeResult}
                char={selectedChar}
              />
            )
          }
        >
          {finalActive ? (
            // Stays mounted across glyph switches: the renderer keeps the last
            // glyph it drew until the next one is built.
            font &&
            activeResult &&
            finalText !== null && (
              <div className={cx('transition-opacity', processing && 'opacity-40')}>
                <FinalStage
                  font={font}
                  text={finalText}
                  highlight={finalHighlight}
                  advance={finalAdvance}
                  frame={form ? null : stageFrame}
                  settings={settings}
                  time={animTime}
                  resultsCache={resultsCache}
                  onDuration={setRenderedDuration}
                />
              </div>
            )
          ) : (
            // The diagnostic stages draw fixed light-theme art; dark mode inverts it (see studio.css).
            // The previous result stays up, dimmed, while the current one is computed.
            <div className={cx('studio-stage-art text-zinc-900 transition-opacity', processing && 'opacity-40')}>
              {pipeline === 'raster'
                ? result && activeStage !== 'final' && <StageRenderer result={result} stage={activeStage} animTime={animTime} />
                : geoResult &&
                  geometryStage !== 'final' && <GeometryStageRenderer result={geoResult} stage={geometryStage} animTime={animTime} />}
            </div>
          )}
        </ZoomStage>

        {/* Always there — disabled on the static stages — so switching stages never resizes (and refits) the stage. */}
        <Transport
          time={animTime}
          duration={totalDuration}
          playing={animPlaying}
          disabled={!animStageActive || !animResult}
          onPlayPause={playPause}
          onRestart={() => seekAnim(0)}
          onSeek={seekAnim}
        />

        {showWarnings && warnings.length > 0 && (
          <GlyphWarnings char={selectedChar} warnings={warnings} onClose={() => setShowWarnings(false)} />
        )}

        <GlyphStats
          char={selectedChar}
          formName={form?.name ?? null}
          pipeline={pipeline}
          result={result}
          geoResult={geoResult}
          warningsOpen={showWarnings}
          onToggleWarnings={() => setShowWarnings((v) => !v)}
        />
      </div>
    </div>
  );
}

/**
 * The glyph as the shipped renderer draws it, with the Style and Motion
 * settings applied — a form in the text that brings it up, outlined.
 *
 * A lone glyph is drawn into the Animation stage's frame: the same artboard,
 * with the renderer's glyph origin on the frame's, so the two stages line up
 * stroke for stroke. The renderer keeps a fixed font size and the frame
 * scales it — a new glyph then never flashes at the old one's size.
 */
function FinalStage({
  font,
  text,
  highlight,
  advance: pendingAdvance,
  frame,
  settings,
  time,
  resultsCache,
  onDuration,
}: {
  font: LoadedFont;
  text: string;
  /** UTF-16 range of `text` to outline — the inspected form. */
  highlight: { start: number; end: number } | null;
  /** Width of `text` in em. */
  advance: number;
  /** The Animation stage's frame and the glyph it's for; null draws `text` on a card of its own. */
  frame: { char: string; frame: StageFrame } | null;
  settings: UrlState;
  time: number;
  resultsCache: RefObject<Map<string, PipelineResult>>;
  onDuration: (d: number) => void;
}) {
  const { effectsState, customEffects, strokeEasing, glyphEasing, deferDots, staggerEnabled, staggerAdvance, staggerDuration } = settings;
  const effects = useMemo(() => buildEffects(effectsState, customEffects), [effectsState, customEffects]);
  const timing = useMemo(
    () => buildTimingConfig({ strokeEasing, glyphEasing, deferDots, staggerEnabled, staggerAdvance, staggerDuration }),
    [strokeEasing, glyphEasing, deferDots, staggerEnabled, staggerAdvance, staggerDuration],
  );
  // The glyph the renderer has finished drawing (it keeps the previous one up
  // while the next is built): the card stays hidden until there is one — no
  // empty card — and is sized by it rather than by the one still coming.
  // Sized by the text it has drawn (its advance, so the fit-to-view zoom frames it).
  const [drawn, setDrawn] = useState<{ text: string; advance: number } | null>(null);
  const onReady = useCallback(
    (info: { totalDuration: number }) => {
      onDuration(info.totalDuration);
      setDrawn({ text, advance: pendingAdvance });
    },
    [onDuration, text, pendingAdvance],
  );
  const advance = drawn?.advance ?? 1;

  // The frame of the glyph on screen: taken up once both the glyph is drawn
  // and its Animation result is in (either can land first), held until then.
  const shownFrame = useRef<StageFrame | null>(null);
  if (!frame) shownFrame.current = null;
  else if (drawn && frame.char === drawn.text) shownFrame.current = frame.frame;
  const artboard = shownFrame.current;

  // Where the renderer puts the glyph's origin (pen position on the baseline),
  // in its own unscaled px: the text layer's box for the glyph, whose top sits
  // an ascender above the baseline.
  const innerRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<{ text: string; x: number; y: number } | null>(null);
  const { ascender, unitsPerEm } = font.info;
  useLayoutEffect(() => {
    if (!drawn) return;
    let raf = 0;
    let tries = 0;
    const measure = () => {
      const inner = innerRef.current;
      const node = inner?.querySelector('[data-tegaki="overlay"]')?.firstChild;
      // The text layer can trail the ready callback by a frame.
      if (!inner || !node || node.nodeType !== Node.TEXT_NODE || node.textContent !== drawn.text || inner.offsetWidth === 0) {
        if (tries++ < 10) raf = requestAnimationFrame(measure);
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = [...range.getClientRects()].find((r) => r.width > 0) ?? range.getBoundingClientRect();
      const box = inner.getBoundingClientRect();
      const scale = box.width / inner.offsetWidth || 1;
      setOrigin({
        text: drawn.text,
        x: (rect.left - box.left) / scale,
        y: (rect.top - box.top) / scale + (ascender / unitsPerEm) * FINAL_FONT_SIZE,
      });
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [drawn, ascender, unitsPerEm]);

  // Outline the form: measure its range in the renderer's text layer, in the
  // card's own (unzoomed) pixels.
  const cardRef = useRef<HTMLDivElement>(null);
  const [outline, setOutline] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const drawnText = drawn?.text;
  useEffect(() => {
    setOutline(null);
    const card = cardRef.current;
    if (!highlight || !card || drawnText !== text) return;
    const id = setTimeout(() => {
      const node = card.querySelector('[data-tegaki="overlay"]')?.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE || node.textContent !== text) return;
      const range = document.createRange();
      range.setStart(node, highlight.start);
      range.setEnd(node, highlight.end);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      if (!rects.length) return;
      const box = card.getBoundingClientRect();
      const scale = box.width / card.offsetWidth || 1;
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      setOutline({
        left: (left - box.left) / scale,
        top: (top - box.top) / scale,
        width: (right - left) / scale,
        height: (bottom - top) / scale,
      });
    }, 50);
    return () => clearTimeout(id);
  }, [highlight, text, drawnText]);

  // Map the frame's viewBox into its 1px-bordered box as the SVG does
  // (centred, uniform scale), then the renderer's glyph origin onto 0,0.
  let place: { card: CSSProperties; glyph: CSSProperties; origin: CSSProperties } | null = null;
  if (artboard && origin && drawn && origin.text === drawn.text) {
    const { vx, vy, vw, vh, width, height } = artboard;
    const k = Math.min((width - 2) / vw, (height - 2) / vh);
    place = {
      card: { width, height },
      glyph: {
        position: 'absolute',
        left: (width - 2 - vw * k) / 2 - vx * k,
        top: (height - 2 - vh * k) / 2 - vy * k,
        width: 'max-content',
        transform: `scale(${(k * unitsPerEm) / FINAL_FONT_SIZE})`,
        transformOrigin: '0 0',
      },
      origin: { position: 'relative', left: -origin.x, top: -origin.y },
    };
  }

  return (
    <div
      ref={cardRef}
      style={place?.card}
      className={cx(
        'relative overflow-hidden bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100',
        artboard ? 'border border-zinc-200 dark:border-zinc-800' : 'rounded-sm p-8 shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-800',
        (!drawn || (artboard && !place)) && 'invisible',
      )}
    >
      {outline && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute z-10 rounded-md bg-indigo-500/5 ring-2 ring-indigo-500/70 dark:ring-indigo-400/70"
          style={outline}
        />
      )}
      {/* The same element tree in both layouts, so switching them never remounts the renderer. */}
      <div style={place?.glyph}>
        <div ref={innerRef} style={place?.origin}>
          <TegakiTextPreview
            style={{ width: Math.ceil(Math.max(advance, 0.5) * FINAL_FONT_SIZE * 1.1) }}
            fontInfo={font.info}
            fontBuffer={font.buffer}
            extraFontBuffers={font.extraBuffers}
            text={text}
            options={settings.options}
            pipeline={settings.pipeline}
            geometryOptions={settings.geometryOptions}
            time={time}
            effects={effects}
            timing={timing}
            quality={settings.quality}
            fontSizePx={FINAL_FONT_SIZE}
            lineHeightRatio={1.15}
            resultsCache={resultsCache}
            onReady={onReady}
            useShaper={settings.useShaper}
          />
        </div>
      </div>
    </div>
  );
}

/** Which character set the glyph list shows, with the font's recommended preset starred. */
function CharsetPicker({
  value,
  charsets,
  font,
  count,
  total,
  onChange,
}: {
  value: string;
  charsets: CharsetInfo | null;
  font: LoadedFont | null;
  count: number;
  total: number;
  onChange: (chars: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const fontInfo = font?.info ?? null;
  const allInFont = useMemo(() => (fontInfo ? enumerateFontChars(fontInfo.font, fontInfo.extraFonts) : ''), [fontInfo]);
  const allCount = useMemo(() => [...segmenter.segment(allInFont)].length, [allInFont]);
  const preset = CHARSET_PRESETS.find((p) => p.chars === value);
  const label = preset?.name ?? (allInFont && value === allInFont ? 'All in font' : 'Custom');
  const rec = charsets?.recommended ?? null;
  const pick = (chars: string) => {
    onChange(chars);
    setOpen(false);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Popover
        open={open}
        onOpenChange={setOpen}
        panelClassName="w-64"
        trigger={({ open: isOpen, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            title="Character set"
            className={cx(
              '-ml-1.5 flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-xs font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800',
              isOpen && 'bg-zinc-100 dark:bg-zinc-800',
            )}
          >
            <span className="truncate">{label}</span>
            {rec && preset?.name === rec.name && <span className="text-amber-500">★</span>}
            <ChevronDownIcon size={12} className="shrink-0 text-zinc-400" />
          </button>
        )}
      >
        <div className="p-1">
          <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-zinc-400">Character set</div>
          {CHARSET_PRESETS.map((p) => {
            const cov = charsets?.coverage.find((c) => c.name === p.name);
            const isRec = rec?.name === p.name;
            return (
              <button
                type="button"
                key={p.name}
                onClick={() => pick(p.chars)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <span className="min-w-0 truncate">{p.name}</span>
                {isRec && (
                  <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                    Recommended
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-400">{cov ? `${cov.covered}/${cov.total}` : ''}</span>
                <CheckIcon size={14} className={cx('shrink-0', p.chars === value ? 'text-zinc-900 dark:text-zinc-100' : 'invisible')} />
              </button>
            );
          })}
          {fontInfo && (
            <button
              type="button"
              onClick={() => pick(allInFont)}
              className="flex h-8 w-full items-center gap-2 border-t border-zinc-100 px-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <span className="min-w-0 truncate">All in font</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-400">{allCount}</span>
              <CheckIcon size={14} className={cx('shrink-0', label === 'All in font' ? 'text-zinc-900 dark:text-zinc-100' : 'invisible')} />
            </button>
          )}
        </div>
        <p className="border-t border-zinc-200 px-3 py-2 text-[11px] leading-snug text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {rec ? `${rec.name} is recommended for ${fontInfo?.family}. ` : ''}Edit the characters in Pipeline › Characters.
        </p>
      </Popover>
      {rec && preset?.name !== rec.name && (
        <button
          type="button"
          onClick={() => onChange(rec.chars)}
          title={`Recommended for ${fontInfo?.family} — ${rec.covered}/${rec.total} mapped`}
          className="h-6 shrink-0 truncate rounded-md bg-amber-100 px-1.5 text-[11px] font-medium text-amber-700 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:hover:bg-amber-500/25"
        >
          ★ {rec.name}
        </button>
      )}
      <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-400">
        {count}/{total}
      </span>
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
        <Spinner className="size-3" />
        <span>
          Processing <GlyphKey char={char} />…
        </span>
      </>
    );
  else if (!hasResult)
    message = (
      <span>
        No glyph data for <GlyphKey char={char} />
      </span>
    );
  if (!message) return null;
  return (
    <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-zinc-500 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800">
      {message}
    </div>
  );
}

/** A note over the stage, in the status pill's style. */
function StageNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[min(80vw,28rem)] rounded-2xl bg-white px-3 py-1.5 text-center text-xs text-zinc-500 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800">
      {children}
    </div>
  );
}

function GlyphList({
  header,
  chars,
  selected,
  available,
  family,
  formCounts,
  onSelect,
}: {
  header: React.ReactNode;
  chars: string[];
  selected: string;
  available: Set<string> | null;
  family: string | undefined;
  /** How many forms (alternates, ligatures…) each character has, when more than one. */
  formCounts: Map<string, number>;
  onSelect: (c: string) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the selection moves
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);
  return (
    <div className="flex shrink-0 flex-col border-zinc-200 bg-white max-lg:border-b lg:w-60 lg:border-r dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex h-11 shrink-0 items-center px-3 max-lg:h-9">{header}</div>
      <div
        className={cx(
          'studio-scroll studio-scroll-x grid gap-1 p-2',
          'max-lg:auto-cols-[2.5rem] max-lg:grid-flow-col max-lg:grid-rows-1 max-lg:overflow-x-auto',
          'max-lg:pt-0 lg:min-h-0 lg:flex-1 lg:auto-rows-[2.5rem] lg:grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] lg:content-start lg:overflow-y-auto lg:pt-0',
        )}
      >
        {chars.map((c, i) => {
          const missing = available !== null && !available.has(c);
          const isSelected = c === selected;
          const formCount = missing ? 0 : (formCounts.get(c) ?? 0);
          return (
            <button
              type="button"
              key={`${c}-${i}`}
              ref={isSelected ? selectedRef : undefined}
              disabled={missing}
              title={`${c} · U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}${missing ? ' · not in font' : ''}${formCount ? ` · ${formCount} forms` : ''}`}
              onClick={() => onSelect(c)}
              style={{ fontFamily: family }}
              className={cx(
                'relative flex h-10 items-center justify-center rounded-md text-lg leading-none transition-colors',
                missing
                  ? 'cursor-not-allowed text-zinc-300 dark:text-zinc-700'
                  : isSelected
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
              )}
            >
              {c}
              {formCount > 0 && (
                <span
                  aria-hidden="true"
                  className={cx(
                    'absolute top-0.5 right-1 font-sans text-[9px] leading-none font-medium',
                    isSelected ? 'text-white/60 dark:text-zinc-900/60' : 'text-indigo-500 dark:text-indigo-400',
                  )}
                >
                  {formCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Groups repeated warnings so a glyph that trips the same check many times reads as one line. */
function groupWarnings(warnings: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const w of warnings) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts];
}

function GlyphWarnings({ char, warnings, onClose }: { char: string; warnings: string[]; onClose: () => void }) {
  const grouped = groupWarnings(warnings);
  return (
    // Shrinks (down to its header) before the stage does when space runs short.
    <div className="flex max-h-44 min-h-8 shrink flex-col border-t border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/5">
      <div className="flex h-8 shrink-0 items-center gap-2 pr-1 pl-3 text-[11px] font-medium text-amber-800 dark:text-amber-300">
        <WarningIcon size={12} />
        <span className="min-w-0 flex-1 truncate">
          {warnings.length} geometry warning{warnings.length > 1 ? 's' : ''} for <GlyphKey char={char} />
        </span>
        <IconButton label="Close warnings" onClick={onClose} className="size-6 text-amber-700 dark:text-amber-400">
          <CloseIcon size={12} />
        </IconButton>
      </div>
      <ul className="studio-scroll min-h-0 overflow-y-auto px-3 pb-2 font-mono text-[11px] leading-relaxed text-amber-900 dark:text-amber-200/90">
        {grouped.map(([w, n]) => (
          <li key={w} className="flex gap-2 border-t border-amber-200/60 py-1 first:border-t-0 dark:border-amber-500/10">
            <span className="min-w-0 flex-1 break-words select-text">{w}</span>
            {n > 1 && <span className="shrink-0 text-amber-600 dark:text-amber-400">×{n}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function GlyphStats({
  char,
  formName,
  pipeline,
  result,
  geoResult,
  warningsOpen,
  onToggleWarnings,
}: {
  char: string;
  /** Glyph name of the inspected form, when it isn't the character's default glyph. */
  formName: string | null;
  pipeline: Pipeline;
  result: PipelineResult | null;
  geoResult: GeometryPipelineResult | null;
  warningsOpen: boolean;
  onToggleWarnings: () => void;
}) {
  const r = pipeline === 'raster' ? result : geoResult;
  if (!r) return null;
  const hex = (char.codePointAt(0) ?? 0).toString(16).padStart(4, '0').toUpperCase();
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
        {char} <span className="text-zinc-400">U+{hex}</span>
        {formName && <span className="text-indigo-600 dark:text-indigo-400"> · {formName}</span>}
      </span>
      {warnings.length > 0 && (
        <button
          type="button"
          onClick={onToggleWarnings}
          aria-expanded={warningsOpen}
          className={cx(
            '-mx-1 flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-500/15',
            warningsOpen && 'bg-amber-100 dark:bg-amber-500/15',
          )}
        >
          <WarningIcon size={12} /> {warnings.length} warning{warnings.length > 1 ? 's' : ''}
          <ChevronDownIcon size={12} className={cx('transition-transform', !warningsOpen && 'rotate-180')} />
        </button>
      )}
      {items.map(([k, v]) => (
        <span key={k}>
          <span className="text-zinc-400">{k}</span> {v}
        </span>
      ))}
    </div>
  );
}
