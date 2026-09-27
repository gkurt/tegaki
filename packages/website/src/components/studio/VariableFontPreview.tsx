import { useEffect, useMemo, useState } from 'react';
import type { TegakiBundle } from 'tegaki';
import type { TimelineEntry } from 'tegaki/core';
import { type ParsedFontInfo, PROGRESS_AXIS_TAG } from 'tegaki-generator';
import { downloadBlob } from '../preview/export.ts';
import { CloseIcon, DownloadIcon } from './icons.tsx';
import {
  loadStudioProgressFonts,
  type ProgressFontFile,
  progressFeatureSettings,
  progressFontDownload,
  progressSpans,
} from './progress-font.ts';
import { IconButton, Spinner } from './ui.tsx';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
let faceCount = 0;

/**
 * The text in the self-writing variable font built from the renderer's
 * bundle: plain DOM text, each shaping cluster's `font-variation-settings`
 * set from the renderer's timeline at `time`, so it writes along with the
 * canvas. Without `time` (the engine's clock or CSS time) it shows the
 * written text.
 */
export function VariableFontPreview({
  bundle,
  fontInfo,
  entries,
  text,
  time,
  strokeEasing,
  glyphEasing,
  fontSizePx,
  lineHeightRatio,
  letterSpacingPx,
  shaped,
  download,
  onDownloaded,
  onClose,
}: {
  bundle: TegakiBundle | null;
  fontInfo: ParsedFontInfo | null;
  entries: readonly TimelineEntry[];
  text: string;
  time: number | null;
  strokeEasing?: (t: number) => number;
  glyphEasing?: (t: number) => number;
  fontSizePx: number;
  lineHeightRatio: number | null;
  letterSpacingPx: number;
  /** Whether the renderer shapes the text (the HarfBuzz shaper setting). */
  shaped: boolean;
  /** Download the font as soon as it's built (Export asked for it). */
  download: boolean;
  onDownloaded: () => void;
  onClose: () => void;
}) {
  // Built from the bundle's font files, read back from their URLs, so each keeps its font's shaping.
  // Null while the renderer builds a bundle with every form the text can take.
  const [built, setBuilt] = useState<{ bundle: TegakiBundle; files: ProgressFontFile[] | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!bundle) return;
    let live = true;
    loadStudioProgressFonts(bundle, fontInfo, strokeEasing).then(
      (files) => live && setBuilt({ bundle, files, error: null }),
      (err: Error) => live && setBuilt({ bundle, files: null, error: err.message }),
    );
    return () => {
      live = false;
    };
  }, [bundle, fontInfo, strokeEasing]);

  // Only a build of the current bundle is downloaded.
  useEffect(() => {
    if (!download || !built || built.bundle !== bundle) return;
    if (built.files) {
      const { blob, name } = progressFontDownload(built.bundle, built.files);
      downloadBlob(blob, name);
    }
    onDownloaded();
  }, [download, built, bundle, onDownloaded]);

  // Registered under a family of its own per build, so a rebuilt font never draws with the last one's
  // glyphs — every file under it, as the renderer registers the bundle's, each extra one to its range.
  const [family, setFamily] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    const files = built?.files;
    if (!files) return;
    const name = `Tegaki Progress ${++faceCount}`;
    const faces = files.map((f) => new FontFace(name, f.font.buffer, f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}));
    let live = true;
    Promise.all(faces.map((face) => face.load()))
      .then(() => {
        if (!live) return;
        for (const face of faces) document.fonts.add(face);
        setFamily(name);
        setLoadError(null);
      })
      .catch((err: Error) => live && setLoadError(err.message || 'The browser rejected the font'));
    return () => {
      live = false;
      for (const face of faces) document.fonts.delete(face);
    };
  }, [built]);

  const graphemes = useMemo(() => [...segmenter.segment(text.normalize('NFC'))].map((s) => s.segment), [text]);
  const spans = bundle ? progressSpans(entries, graphemes.length, bundle, time, glyphEasing) : [];

  const error = built?.error ?? loadError;
  const files = built?.files;
  const size = files
    ? [
        `${(files.reduce((n, f) => n + f.font.buffer.byteLength, 0) / 1024).toFixed(1)} KB`,
        `${files.reduce((n, f) => n + f.font.glyphs, 0)} glyphs`,
        ...(files.length > 1 ? [`${files.length} files`] : []),
        ...(files.some((f) => f.font.layout.length) ? ['shaped'] : []),
      ].join(' · ')
    : null;

  return (
    <section className="mt-10 rounded-lg border border-dashed border-zinc-300 px-4 pt-2 pb-4 dark:border-zinc-700">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">Variable font</span>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          prototype
        </span>
        {size && <span className="font-mono">{size}</span>}
        <span>
          <code className="font-mono">'{PROGRESS_AXIS_TAG}'</code> 0–100 per glyph
          {time === null && ' · controlled time scrubs it'}
        </span>
        <div className="-mr-2 ml-auto flex items-center gap-1">
          {files && bundle && (
            <button
              type="button"
              onClick={() => {
                const { blob, name } = progressFontDownload(bundle, files);
                downloadBlob(blob, name);
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2 text-[12px] font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <DownloadIcon size={12} /> {files.length > 1 ? '.zip' : '.ttf'}
            </button>
          )}
          <IconButton label="Close the variable font preview" onClick={onClose}>
            <CloseIcon size={14} />
          </IconButton>
        </div>
      </div>
      {error ? (
        <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
      ) : !family ? (
        <p className="flex items-center gap-2 text-[12px] text-zinc-400">
          <Spinner className="size-3" /> Building the font…
        </p>
      ) : (
        <p
          data-tegaki-progress-font=""
          className="text-zinc-900 dark:text-zinc-100"
          style={{
            // Characters the font lacks fall back to the original face, drawn whole.
            fontFamily: `'${family}', '${bundle?.family ?? 'serif'}'`,
            fontSize: `${fontSizePx}px`,
            lineHeight: lineHeightRatio ?? 'normal',
            letterSpacing: `${letterSpacingPx}px`,
            fontFeatureSettings: progressFeatureSettings(bundle?.features, shaped, letterSpacingPx !== 0),
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
          }}
        >
          {/* One span per shaping cluster: the browser shapes each span on its own. */}
          {spans.map((s) => (
            <span key={s.start} style={{ fontVariationSettings: `'${PROGRESS_AXIS_TAG}' ${s.progress.toFixed(2)}` }}>
              {graphemes.slice(s.start, s.end).join('')}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
