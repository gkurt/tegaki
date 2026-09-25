import { Slider, Toggle } from 'dialkit';
import { useCallback, useRef, useState } from 'react';
import type { TegakiEngine } from 'tegaki';
import { downloadBlob, exportGif, exportPng, exportSvg, exportWebm, webmSupported } from '../preview/export.ts';
import { DownloadIcon } from './icons.tsx';
import { DialScope } from './inspector/dial.tsx';
import { cx, Hint, Popover, Segmented, Spinner } from './ui.tsx';

type Format = 'svg' | 'png' | 'gif' | 'webm';

/** Slugify the preview text into a safe-ish base filename. */
function baseName(text: string): string {
  const slug = text
    .trim()
    .slice(0, 24)
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '');
  return slug || 'tegaki';
}

/**
 * The studio's single "Export" entry point: the font bundle (the generator's
 * product) and, in text mode, the rendered animation as SVG / PNG / GIF / WebM.
 */
export function ExportMenu({
  getEngine,
  text,
  onExportStart,
  canDownloadBundle,
  onDownloadBundle,
  bundleBusy,
  chars,
  pipeline,
  speed,
}: {
  /** Null outside text mode — the animation formats are disabled then. */
  getEngine: (() => TegakiEngine | null) | null;
  text: string;
  onExportStart?: () => void;
  canDownloadBundle: boolean;
  onDownloadBundle: () => void;
  bundleBusy: boolean;
  chars: string;
  pipeline: string;
  /** Motion › Speed — the animated formats play at it. */
  speed: number;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>('svg');
  const [animated, setAnimated] = useState(true);
  const [loop, setLoop] = useState(true);
  const [loopHold, setLoopHold] = useState(1.5);
  const [transparent, setTransparent] = useState(true);
  const [fps, setFps] = useState(20);
  const [maxWidth, setMaxWidth] = useState(800);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const webmOk = webmSupported();
  const bg = transparent ? null : '#ffffff';
  const charCount = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(chars)].length;

  const run = useCallback(async () => {
    const engine = getEngine?.();
    if (!engine) {
      setError('Renderer not ready');
      return;
    }
    onExportStart?.();
    setError(null);
    setBusy(true);
    setProgress(0);
    const abort = new AbortController();
    abortRef.current = abort;
    const name = baseName(text);
    try {
      // Let the host pause its playback loop before we drive the engine.
      await new Promise((r) => requestAnimationFrame(r));
      if (format === 'svg') {
        const blob = await exportSvg(engine, { animated, loop: animated && loop, speed, loopHold });
        downloadBlob(blob, `${name}${animated ? '-animated' : ''}.svg`);
      } else if (format === 'png') {
        const blob = await exportPng(engine, { background: bg });
        downloadBlob(blob, `${name}.png`);
      } else if (format === 'gif') {
        const blob = await exportGif(engine, {
          fps,
          maxWidth,
          speed,
          background: bg ?? '#ffffff',
          onProgress: setProgress,
          signal: abort.signal,
        });
        downloadBlob(blob, `${name}.gif`);
      } else if (format === 'webm') {
        const blob = await exportWebm(engine, {
          fps: Math.max(fps, 24),
          speed,
          background: bg ?? '#ffffff',
          onProgress: setProgress,
          signal: abort.signal,
        });
        downloadBlob(blob, `${name}.webm`);
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError((err as Error)?.message ?? 'Export failed');
    } finally {
      setBusy(false);
      setProgress(0);
      abortRef.current = null;
    }
  }, [getEngine, onExportStart, text, format, animated, loop, loopHold, speed, bg, fps, maxWidth]);

  const showFps = format === 'gif' || format === 'webm';
  const noAlpha = format === 'gif' || format === 'webm';

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      panelClassName="w-80"
      fullWidthOnMobile
      trigger={({ open: isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          title="Export"
          className={cx(
            'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors max-sm:w-8 max-sm:justify-center max-sm:px-0',
            'bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white',
          )}
        >
          <DownloadIcon size={14} />
          <span className="max-sm:hidden">Export</span>
        </button>
      )}
    >
      <div className="flex flex-col gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Font bundle</span>
          <span className="text-[11px] text-zinc-400">
            {charCount} chars · {pipeline}
          </span>
        </div>
        <Hint>Stroke data + font as a .zip — import its bundle.ts into any Tegaki renderer.</Hint>
        <button
          type="button"
          disabled={!canDownloadBundle || bundleBusy}
          onClick={onDownloadBundle}
          className="mt-1 inline-flex h-8 items-center justify-center gap-2 rounded-md bg-zinc-900 text-[13px] font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {bundleBusy ? <Spinner className="size-3" /> : <DownloadIcon size={14} />}
          {bundleBusy ? 'Generating…' : 'Download bundle (.zip)'}
        </button>
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Animation</span>
          {!getEngine && <span className="text-[11px] text-zinc-400">Text mode only</span>}
        </div>
        <div className={cx('flex flex-col gap-2', !getEngine && 'pointer-events-none opacity-40')}>
          <Segmented
            value={format}
            onChange={setFormat}
            className="w-full [&>button]:flex-1"
            options={[
              { value: 'svg', label: 'SVG' },
              { value: 'png', label: 'PNG' },
              { value: 'gif', label: 'GIF' },
              ...(webmOk ? [{ value: 'webm' as const, label: 'WebM' }] : []),
            ]}
          />
          <DialScope className="flex flex-col gap-1.5">
            {format === 'svg' && (
              <>
                <Toggle label="Self-drawing" checked={animated} onChange={setAnimated} />
                {animated && <Toggle label="Loop forever" checked={loop} onChange={setLoop} />}
                {animated && loop && (
                  <Slider label="Pause before repeat" value={loopHold} min={0} max={5} step={0.1} unit="s" onChange={setLoopHold} />
                )}
              </>
            )}
            {showFps && (
              <Slider label="Frame rate" value={fps} min={8} max={format === 'webm' ? 60 : 30} step={1} unit="fps" onChange={setFps} />
            )}
            {format === 'gif' && (
              <Slider label="Max width" value={maxWidth} min={200} max={1600} step={50} unit="px" onChange={setMaxWidth} />
            )}
            {format === 'png' && <Toggle label="Transparent" checked={transparent} onChange={setTransparent} />}
          </DialScope>
          <Hint>
            {format === 'svg'
              ? !animated
                ? 'Static final artwork (every stroke fully drawn).'
                : loop
                  ? 'Loops via CSS keyframes — ideal for a README hero or embed.'
                  : 'Draws itself once on load, then stays complete.'
              : format === 'png'
                ? 'Exports the current frame. Seek or pause first to pick the moment.'
                : noAlpha
                  ? 'White background — the format has no alpha.'
                  : null}
            {format !== 'png' && (format !== 'svg' || animated) && speed !== 1 && ` Plays at ${speed}× (Motion › Speed).`}
          </Hint>
          {busy ? (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full bg-zinc-900 transition-[width] dark:bg-zinc-100"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <button
                type="button"
                className="h-7 rounded-md px-2 text-[12px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                onClick={() => abortRef.current?.abort()}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={run}
              className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 text-[13px] font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              Export {format.toUpperCase()}
            </button>
          )}
          {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </div>
    </Popover>
  );
}
