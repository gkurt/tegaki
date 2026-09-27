import { useEffect, useMemo, useState } from 'react';
import type { TegakiBundle } from 'tegaki';
import type { TimelineEntry } from 'tegaki/core';
import { type ParsedFontInfo, PROGRESS_AXIS_TAG } from 'tegaki-generator';
import { downloadBlob } from '../preview/export.ts';
import { CloseIcon, DownloadIcon } from './icons.tsx';
import { graphemeProgress, studioProgressFont } from './progress-font.ts';
import { IconButton, Spinner } from './ui.tsx';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
let faceCount = 0;

/**
 * The text in the self-writing variable font built from the renderer's
 * bundle: plain DOM text, each grapheme's `font-variation-settings` set from
 * the renderer's timeline at `time`, so it writes along with the canvas.
 * Without `time` (the engine's clock or CSS time) it shows the written text.
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
  onClose: () => void;
}) {
  const built = useMemo(() => {
    if (!bundle) return null;
    try {
      return { font: studioProgressFont(bundle, fontInfo, strokeEasing), error: null };
    } catch (err) {
      return { font: null, error: (err as Error).message };
    }
  }, [bundle, fontInfo, strokeEasing]);

  // Registered under a family of its own per build, so a rebuilt font never draws with the last one's glyphs.
  const [family, setFamily] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    const buffer = built?.font?.buffer;
    if (!buffer) return;
    const name = `Tegaki Progress ${++faceCount}`;
    const face = new FontFace(name, buffer);
    let live = true;
    face
      .load()
      .then(() => {
        if (!live) return;
        document.fonts.add(face);
        setFamily(name);
        setLoadError(null);
      })
      .catch((err: Error) => live && setLoadError(err.message || 'The browser rejected the font'));
    return () => {
      live = false;
      document.fonts.delete(face);
    };
  }, [built]);

  const graphemes = useMemo(() => [...segmenter.segment(text.normalize('NFC'))].map((s) => s.segment), [text]);
  const progress = time === null || !bundle ? null : graphemeProgress(entries, graphemes.length, bundle.glyphData, time, glyphEasing);

  const error = built?.error ?? loadError;
  const size = built?.font ? `${(built.font.buffer.byteLength / 1024).toFixed(1)} KB · ${built.font.chars.length} glyphs` : null;

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
          {built?.font && bundle && (
            <button
              type="button"
              onClick={() => downloadBlob(new Blob([built.font.buffer], { type: 'font/ttf' }), progressFontFileName(bundle))}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2 text-[12px] font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <DownloadIcon size={12} /> .ttf
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
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
          }}
        >
          {graphemes.map((g, i) => (
            <span key={i} style={{ fontVariationSettings: `'${PROGRESS_AXIS_TAG}' ${progress ? progress[i]!.toFixed(2) : 100}` }}>
              {g}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

export function progressFontFileName(bundle: TegakiBundle): string {
  return `${bundle.family.toLowerCase().replace(/\s+/g, '-')}-progress.ttf`;
}
